import { AuthenticatedRequest } from '../middleware/auth';
import { GoogleSheetsLoggingService } from './googleSheetsLogging';
import { fallbackLogger } from './fallbackLogging';
import { pushoverService } from './pushover';
import { batchLogger } from './batchLogger';
import type { LogEntry, AuthLogEntry } from './fallbackLogging';

class LoggingMetrics {
  private successCount = 0;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private readonly ERROR_RATE_THRESHOLD = 0.1; // 10%

  recordSuccess() {
    this.successCount++;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = new Date();
    
    // Check error rate
    const totalLogs = this.successCount + this.failureCount;
    if (totalLogs >= 10) { // Only check after at least 10 logs
      const errorRate = this.failureCount / totalLogs;
      if (errorRate > this.ERROR_RATE_THRESHOLD) {
        this.sendErrorRateAlert(errorRate);
      }
    }
  }

  private async sendErrorRateAlert(errorRate: number) {
    await pushoverService.sendHighErrorRateAlert(
      errorRate,
      this.successCount,
      this.failureCount
    );

    // Reset counters after alert
    this.successCount = 0;
    this.failureCount = 0;
  }

  getMetrics() {
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      errorRate: this.successCount + this.failureCount > 0
        ? this.failureCount / (this.successCount + this.failureCount)
        : 0
    };
  }
}

const loggingMetrics = new LoggingMetrics();

// Helper function: Sleep/delay
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry with exponential backoff (max 1 minute total wait time)
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  maxWaitTime: number = 60000 // 60 seconds
): Promise<T> {
  let lastError: any;
  let totalWaitTime = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fn();
      loggingMetrics.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries - 1) {
        // Last attempt failed
        loggingMetrics.recordFailure();
        throw error;
      }

      // Calculate wait time: 1s, 2s, 4s, 8s, 16s, 32s (exponential)
      const waitTime = Math.pow(2, attempt) * 1000;
      totalWaitTime += waitTime;

      // Don't wait if we would exceed max wait time
      if (totalWaitTime > maxWaitTime) {
        console.warn(`[RetryWithBackoff] Max wait time (${maxWaitTime}ms) exceeded, aborting retry`);
        loggingMetrics.recordFailure();
        throw lastError;
      }

      console.warn(`[RetryWithBackoff] Attempt ${attempt + 1} failed, retrying in ${waitTime}ms...`);
      await sleep(waitTime);
    }
  }

  loggingMetrics.recordFailure();
  throw lastError;
}

// Enhanced log user activity with retry and fallback
export async function logUserActivityWithRetry(
  req: AuthenticatedRequest,
  address?: string,
  newProspects?: string[],
  existingCustomers?: any[]
): Promise<void> {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    userId: req.userId!,
    username: req.username!,
    endpoint: req.path,
    method: req.method,
    address,
    newProspects,
    existingCustomers,
    userAgent: req.get('User-Agent') || ''
  };

  // Add to batch queue
  batchLogger.addUserActivity(logEntry);
}

// Enhanced log auth attempt with retry and fallback
export async function logAuthAttemptWithRetry(
  ip: string,
  success: boolean,
  username?: string,
  userId?: string,
  reason?: string
): Promise<void> {
  const logEntry: AuthLogEntry = {
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    success,
    username,
    userId,
    reason: reason || (success ? 'valid_password' : 'invalid_password')
  };

  // Add to batch queue
  batchLogger.addAuthLog(logEntry);
}

// Cron job to retry failed logs
export async function retryFailedLogs(): Promise<void> {
  try {
    // Check if there are failed logs
    const hasFailedLogs = await fallbackLogger.hasFailedLogs();
    
    if (!hasFailedLogs) {
      console.log('[RetryFailedLogs] No failed logs to retry');
      return;
    }

    console.log('[RetryFailedLogs] Starting retry of failed logs...');
    
    const failedLogs = await fallbackLogger.getFailedLogs();
    console.log(`[RetryFailedLogs] Found ${failedLogs.length} failed logs`);

    const successfulLogs: (LogEntry | AuthLogEntry)[] = [];

    for (const log of failedLogs) {
      try {
        if ('ipAddress' in log) {
          // Auth log
          await retryWithBackoff(() => 
            GoogleSheetsLoggingService.logAuthAttempt(
              log.ipAddress,
              log.success,
              log.username,
              log.userId,
              log.reason
            )
          );
        } else {
          // User activity log
          const mockReq = {
            userId: log.userId,
            username: log.username,
            path: log.endpoint,
            method: log.method,
            get: (header: string) => log.userAgent
          } as AuthenticatedRequest;

          await retryWithBackoff(() =>
            GoogleSheetsLoggingService.logUserActivity(
              mockReq,
              log.address,
              log.newProspects,
              log.existingCustomers
            )
          );
        }

        successfulLogs.push(log);
      } catch (error) {
        console.error('[RetryFailedLogs] Failed to retry log:', error);
        // Keep in failed logs for next retry
      }
    }

    // Remove successfully retried logs from file
    if (successfulLogs.length > 0) {
      await fallbackLogger.removeSuccessfulLogs(successfulLogs);
      console.log(`[RetryFailedLogs] Successfully retried ${successfulLogs.length} logs`);
      
      // Send success notification
      await pushoverService.sendRecoverySuccess(successfulLogs.length);
    }

    const remainingFailed = failedLogs.length - successfulLogs.length;
    if (remainingFailed > 0) {
      console.warn(`[RetryFailedLogs] ${remainingFailed} logs still failed after retry`);
    }

  } catch (error) {
    console.error('[RetryFailedLogs] Error during retry process:', error);
  }
}

// Get logging metrics for monitoring
export function getLoggingMetrics() {
  return {
    ...loggingMetrics.getMetrics(),
    queueStatus: batchLogger.getQueueStatus()
  };
}
