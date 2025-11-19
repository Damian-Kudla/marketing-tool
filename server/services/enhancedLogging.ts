import { AuthenticatedRequest } from '../middleware/auth';
import { GoogleSheetsLoggingService } from './googleSheetsLogging';
import { fallbackLogger } from './fallbackLogging';
import { pushoverService } from './pushover';
import { batchLogger } from './batchLogger';
import { getCETDate, insertLog, LogInsertData } from './sqliteLogService';
import { getBerlinTimestamp } from '../utils/timezone';
import type {
  LogEntry,
  AuthLogEntry,
  CategoryChangeLogEntry,
  AnyLogEntry
} from './fallbackLogging';

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
type CategoryChangeLoggingService = typeof import('./googleSheets')['categoryChangeLoggingService'];
let cachedCategoryLoggingService: CategoryChangeLoggingService | null = null;

async function getCategoryLoggingService(): Promise<CategoryChangeLoggingService> {
  if (!cachedCategoryLoggingService) {
    const module = await import('./googleSheets');
    cachedCategoryLoggingService = module.categoryChangeLoggingService;
  }
  return cachedCategoryLoggingService;
}

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
  existingCustomers?: any[],
  data?: any
): Promise<void> {
  // Get device ID from header and append to User-Agent
  const deviceId = req.get('X-Device-ID');
  const baseUserAgent = req.get('User-Agent') || '';
  const userAgent = deviceId 
    ? `${baseUserAgent} [Device:${deviceId.substring(0, 16)}]`
    : baseUserAgent;

  const logEntry: LogEntry = {
    timestamp: getBerlinTimestamp(),
    userId: req.userId!,
    username: req.username!,
    endpoint: req.originalUrl || req.path, // Use originalUrl to include full path with router mount
    method: req.method,
    address,
    newProspects,
    existingCustomers,
    userAgent, // Now includes device fingerprint
    data
  };

  // Add to batch queue (for Google Sheets backup)
  batchLogger.addUserActivity(logEntry);

  // ALSO write to SQLite immediately (atomic, no flush needed)
  try {
    const date = getCETDate();
    const sqliteLog: LogInsertData = {
      userId: req.userId!,
      username: req.username!,
      timestamp: new Date(logEntry.timestamp).getTime(),
      logType: inferLogTypeFromEndpoint(req.originalUrl || req.path, data),
      data: {
        endpoint: logEntry.endpoint,
        method: logEntry.method,
        address: logEntry.address,
        newProspects: logEntry.newProspects,
        existingCustomers: logEntry.existingCustomers,
        userAgent: logEntry.userAgent,
        data: logEntry.data
      }
    };

    insertLog(date, sqliteLog);
  } catch (error) {
    console.error('[EnhancedLogging] Error writing to SQLite:', error);
    // Don't throw - fallback to Sheets still works
  }
}

/**
 * Helper: Infer log type from endpoint and data
 */
function inferLogTypeFromEndpoint(endpoint: string, data?: any): 'gps' | 'session' | 'action' | 'device' {
  if (endpoint.includes('/tracking/gps') || data?.gps || data?.latitude) {
    return 'gps';
  }

  if (endpoint.includes('/tracking/session') || data?.session || data?.actions) {
    return 'session';
  }

  if (endpoint.includes('/tracking/device') || data?.device || data?.batteryLevel) {
    return 'device';
  }

  return 'action'; // default for other endpoints
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
    timestamp: getBerlinTimestamp(),
    ipAddress: ip,
    success,
    username,
    userId,
    reason: reason || (success ? 'valid_password' : 'invalid_password')
  };

  // Add to batch queue
  batchLogger.addAuthLog(logEntry);
}

// Enhanced log category change with batch processing
export async function logCategoryChangeWithRetry(
  datasetId: string,
  residentOriginalName: string,
  residentCurrentName: string,
  oldCategory: string,
  newCategory: string,
  changedBy: string,
  addressDatasetSnapshot: string
): Promise<void> {
  const logEntry: import('./fallbackLogging').CategoryChangeLogEntry = {
    timestamp: getBerlinTimestamp(),
    datasetId,
    residentOriginalName,
    residentCurrentName,
    oldCategory,
    newCategory,
    changedBy,
    addressDatasetSnapshot
  };

  // Add to batch queue
  batchLogger.addCategoryChange(logEntry);
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

    const successfulLogs: AnyLogEntry[] = [];

    for (const log of failedLogs) {
      try {
        if ('ipAddress' in log) {
          await retryWithBackoff(() =>
            GoogleSheetsLoggingService.logAuthAttempt(
              log.ipAddress,
              log.success,
              log.username,
              log.userId,
              log.reason
            )
          );
          successfulLogs.push(log);
          continue;
        }

        if ('datasetId' in log) {
          const categoryService = await getCategoryLoggingService();
          await retryWithBackoff(() =>
            categoryService.logCategoryChange(
              log.datasetId,
              log.residentOriginalName,
              log.residentCurrentName,
              log.oldCategory,
              log.newCategory,
              log.changedBy,
              log.addressDatasetSnapshot
            )
          );
          successfulLogs.push(log);
          continue;
        }

        if ('userId' in log && 'endpoint' in log) {
          const mockReq = {
            userId: log.userId,
            username: log.username,
            path: log.endpoint,
            method: log.method,
            get: (_header: string) => log.userAgent
          } as AuthenticatedRequest;

          await retryWithBackoff(() =>
            GoogleSheetsLoggingService.logUserActivity(
              mockReq,
              log.address,
              log.newProspects,
              log.existingCustomers,
              log.data
            )
          );
          successfulLogs.push(log);
          continue;
        }

        console.warn('[RetryFailedLogs] Unknown log shape, skipping entry', log);
      } catch (error) {
        console.error('[RetryFailedLogs] Failed to retry log:', error);
        // Keep in failed logs for next retry
      }
    }

    // Remove successfully retried logs from file
    if (successfulLogs.length > 0) {
      await fallbackLogger.removeSuccessfulLogs(successfulLogs);
      console.log(`[RetryFailedLogs] Successfully retried ${successfulLogs.length} logs`);
      
      // No Pushover notification for successful recovery - only errors need attention
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
