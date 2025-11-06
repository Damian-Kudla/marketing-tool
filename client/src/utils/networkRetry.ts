/**
 * Professional Network Retry Utility
 *
 * Similar to WhatsApp, this implements:
 * - Exponential backoff retry strategy
 * - Network quality detection
 * - Timeout handling for slow connections
 * - Intelligent error differentiation
 * - Progress callbacks for UI updates
 */

export interface RetryConfig {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  timeout?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: any) => void;
  onProgress?: (message: string, attempt: number) => void;
}

export interface NetworkTestResult {
  isOnline: boolean;
  quality: 'good' | 'medium' | 'poor' | 'offline';
  latency?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  timeout: 60000, // 60 seconds for upload
  backoffMultiplier: 2,
  onRetry: () => {},
  onProgress: () => {},
};

/**
 * Tests actual network connectivity by pinging the server
 * More reliable than navigator.onLine
 */
export async function testNetworkConnection(timeoutMs: number = 5000): Promise<NetworkTestResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-cache',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      return {
        isOnline: false,
        quality: 'offline',
      };
    }

    // Determine connection quality based on latency
    let quality: 'good' | 'medium' | 'poor' | 'offline';
    if (latency < 200) {
      quality = 'good';
    } else if (latency < 1000) {
      quality = 'medium';
    } else {
      quality = 'poor';
    }

    return {
      isOnline: true,
      quality,
      latency,
    };
  } catch (error: any) {
    // Network error or timeout
    return {
      isOnline: false,
      quality: 'offline',
    };
  }
}

/**
 * Determines if an error is retryable
 */
function isRetryableError(error: any): boolean {
  // Network errors are retryable
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // Abort/Timeout errors are retryable
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return true;
  }

  // HTTP status codes that are retryable
  const status = error.response?.status;
  if (status) {
    // 408 Request Timeout
    // 429 Too Many Requests (with backoff)
    // 500-599 Server errors
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  return false;
}

/**
 * Calculates delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  const exponentialDelay = Math.min(
    config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelay
  );

  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Executes a function with retry logic and exponential backoff
 *
 * @example
 * const result = await withRetry(
 *   async () => {
 *     const response = await fetch('/api/upload', {
 *       method: 'POST',
 *       body: formData
 *     });
 *     if (!response.ok) throw new Error('Upload failed');
 *     return response.json();
 *   },
 *   {
 *     maxRetries: 3,
 *     onProgress: (msg, attempt) => console.log(`${msg} (Attempt ${attempt})`),
 *   }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  userConfig: RetryConfig = {}
): Promise<T> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Test network before retry (except first attempt)
      if (attempt > 0) {
        config.onProgress?.('Prüfe Netzwerkverbindung...', attempt);
        const networkTest = await testNetworkConnection();

        if (!networkTest.isOnline) {
          config.onProgress?.('Keine Verbindung - warte auf Netzwerk...', attempt);
          // Wait before testing again
          await sleep(calculateDelay(attempt, config));
          continue;
        }

        if (networkTest.quality === 'poor') {
          config.onProgress?.('Schwache Verbindung erkannt - erhöhe Timeout...', attempt);
          // Increase timeout for poor connection
          config.timeout = Math.min(config.timeout * 1.5, 120000); // Max 2 minutes
        }

        config.onProgress?.(
          `Verbindung verfügbar (${networkTest.quality}) - versuche Upload...`,
          attempt
        );
      }

      // Create timeout controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);

      try {
        // Execute the function with timeout
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error('Request timeout'));
            });
          }),
        ]);

        clearTimeout(timeoutId);

        // Success!
        if (attempt > 0) {
          config.onProgress?.('Upload erfolgreich!', attempt);
        }

        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      lastError = error;

      console.log(`[NetworkRetry] Attempt ${attempt + 1} failed:`, {
        error: error.message,
        isRetryable: isRetryableError(error),
        attemptsLeft: config.maxRetries - attempt,
      });

      // Check if we should retry
      if (attempt < config.maxRetries && isRetryableError(error)) {
        const delay = calculateDelay(attempt, config);

        config.onRetry?.(attempt + 1, error);
        config.onProgress?.(
          `Verbindungsfehler - versuche erneut in ${Math.round(delay / 1000)}s...`,
          attempt + 1
        );

        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries reached
      break;
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Helper function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a fetch wrapper with timeout support
 * Use this for API calls that need timeout handling
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 30000, ...fetchInit } = init || {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return fetch(input, {
    ...fetchInit,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

/**
 * Network quality monitor
 * Continuously monitors connection quality
 */
export class NetworkMonitor {
  private quality: 'good' | 'medium' | 'poor' | 'offline' = 'good';
  private listeners: Set<(quality: typeof this.quality) => void> = new Set();
  private intervalId?: number;

  start(intervalMs: number = 30000) {
    this.stop();

    // Initial test
    this.checkQuality();

    // Periodic checks
    this.intervalId = window.setInterval(() => {
      this.checkQuality();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async checkQuality() {
    const result = await testNetworkConnection();
    const newQuality = result.quality;

    if (newQuality !== this.quality) {
      this.quality = newQuality;
      this.notifyListeners();
    }
  }

  getQuality() {
    return this.quality;
  }

  onChange(callback: (quality: typeof this.quality) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.quality));
  }
}
