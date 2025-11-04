import type { LogEntry, AuthLogEntry } from './fallbackLogging';
import { fallbackLogger } from './fallbackLogging';
import { pushoverService } from './pushover';
import { LOG_CONFIG } from '../config/logConfig';

interface BatchQueueEntry {
  type: 'user_activity' | 'auth';
  data: LogEntry | AuthLogEntry;
}

class BatchLogger {
  private queue: Map<string, BatchQueueEntry[]> = new Map(); // Key: userId or 'auth'
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 30000; // 30 seconds (reduced rate limit pressure)
  private isProcessing: boolean = false;

  constructor() {
    this.startBatchProcessing();
  }

  private startBatchProcessing() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(async () => {
      await this.flush();
    }, this.FLUSH_INTERVAL_MS);

    console.log(`[BatchLogger] Started batch processing (every ${this.FLUSH_INTERVAL_MS}ms)`);
  }

  addUserActivity(logEntry: LogEntry) {
    const key = logEntry.userId;
    
    if (!this.queue.has(key)) {
      this.queue.set(key, []);
    }

    this.queue.get(key)!.push({
      type: 'user_activity',
      data: logEntry
    });

    // Only log if enabled in config (reduces noise)
    if (LOG_CONFIG.BATCH_LOGGER.logQueueAdd) {
      console.log(`[BatchLogger] Added log to queue for user ${logEntry.username} (queue size: ${this.queue.get(key)!.length})`);
    }
  }

  addAuthLog(logEntry: AuthLogEntry) {
    const key = 'auth';
    
    if (!this.queue.has(key)) {
      this.queue.set(key, []);
    }

    this.queue.get(key)!.push({
      type: 'auth',
      data: logEntry
    });

    if (LOG_CONFIG.BATCH_LOGGER.logQueueAdd) {
      console.log(`[BatchLogger] Added auth log to queue (queue size: ${this.queue.get(key)!.length})`);
    }
  }

  async flush() {
    if (this.isProcessing) {
      console.log('[BatchLogger] Already processing, skipping flush');
      return;
    }

    if (this.queue.size === 0) {
      // Only log if enabled (reduces noise from empty flushes)
      if (LOG_CONFIG.BATCH_LOGGER.logEmptyFlush) {
        console.log('[BatchLogger] Queue empty, nothing to flush');
      }
      return;
    }

    this.isProcessing = true;

    try {
      console.log(`[BatchLogger] Flushing ${this.queue.size} user queue(s)...`);

      // RATE LIMIT PROTECTION: Process users sequentially with delay
      // Google Sheets API allows ~100 requests per 100 seconds per user
      // With multiple active users, we need to space out requests
      const entries = Array.from(this.queue.entries());
      
      for (let i = 0; i < entries.length; i++) {
        const [userId, userEntries] = entries[i];
        
        if (userEntries.length === 0) continue;

        try {
          await this.flushUserQueue(userId, userEntries);
          
          // Add delay between users to avoid rate limit (500ms spacing)
          // This means ~2 users per second, well within API limits
          if (i < entries.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`[BatchLogger] Failed to flush queue for ${userId}:`, error);
          // Continue with next user even if one fails
        }
      }

      console.log('[BatchLogger] Flush complete');
    } catch (error) {
      console.error('[BatchLogger] Error during flush:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async flushUserQueue(userId: string, entries: BatchQueueEntry[]): Promise<void> {
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[BatchLogger] Flushing ${entries.length} logs for ${userId}... (attempt ${attempt + 1}/${maxRetries})`);

        // Google Sheets doesn't support multi-worksheet batch writes in one request
        // So we need to send each user's logs separately
        
        // Import GoogleSheetsLoggingService dynamically to avoid circular dependency
        const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');

        if (userId === 'auth') {
          // Flush auth logs
          await this.flushAuthLogs(entries as { type: 'auth'; data: AuthLogEntry }[]);
        } else {
          // Flush user activity logs
          await this.flushUserActivityLogs(userId, entries as { type: 'user_activity'; data: LogEntry }[]);
        }

        // Remove successfully flushed entries from queue
        this.queue.delete(userId);

        console.log(`[BatchLogger] Successfully flushed logs for ${userId}`);
        return; // Success, exit retry loop
        
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error (429)
        const isRateLimitError = error?.code === 429 || 
                                error?.response?.status === 429 ||
                                error?.message?.includes('429') ||
                                error?.message?.includes('Too Many Requests');

        if (isRateLimitError && attempt < maxRetries - 1) {
          // Exponential backoff: 2s, 4s, 8s
          const delayMs = Math.pow(2, attempt + 1) * 1000;
          console.warn(`[BatchLogger] Rate limit hit for ${userId}, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue; // Retry
        }

        // Non-rate-limit error or final retry failed
        console.error(`[BatchLogger] Failed to flush logs for ${userId}:`, error);
        break; // Exit retry loop
      }
    }

    // All retries failed, save to fallback
    console.error(`[BatchLogger] All retry attempts failed for ${userId}, saving to fallback`);
    
    // Save failed logs to fallback file
    for (const entry of entries) {
      await fallbackLogger.saveFailed(entry.data);
    }

    // Remove from queue even on failure (already saved to fallback)
    this.queue.delete(userId);

    // Send alert if fallback storage is being used
    await pushoverService.sendFallbackStorageAlert(entries.length);
  }

  private async flushUserActivityLogs(userId: string, entries: { type: 'user_activity'; data: LogEntry }[]) {
    const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');

    // We can't batch write to different worksheets in one request
    // So we send all logs for this user to their worksheet
    const logRows = entries.map(entry => {
      const log = entry.data;
      
      // Serialize data to JSON string if provided
      let dataString = '';
      if (log.data) {
        try {
          dataString = JSON.stringify(log.data);
        } catch (error) {
          console.error('[BatchLogger] Failed to serialize data:', error);
          dataString = String(log.data);
        }
      }
      
      return [
        log.timestamp,
        log.userId,
        log.username,
        log.endpoint,
        log.method,
        log.address || '',
        log.newProspects?.join(', ') || '',
        log.existingCustomers?.map(c => `${c.name} (${c.id})`).join(', ') || '',
        log.userAgent,
        dataString
      ];
    });

    // Get first entry to determine worksheet
    const firstLog = entries[0].data;
    const worksheetName = await GoogleSheetsLoggingService.ensureUserWorksheet(
      firstLog.userId,
      firstLog.username
    );

    // Batch append all rows
    await GoogleSheetsLoggingService.batchAppendToWorksheet(worksheetName, logRows);
  }

  private async flushAuthLogs(entries: { type: 'auth'; data: AuthLogEntry }[]) {
    const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');

    const logRows = entries.map(entry => {
      const log = entry.data;
      return [
        log.timestamp,
        log.ipAddress,
        log.success ? 'SUCCESS' : 'FAILED',
        log.username || 'unknown',
        log.userId || 'unknown',
        log.reason
      ];
    });

    // Batch append all rows to AuthLogs worksheet
    await GoogleSheetsLoggingService.batchAppendToWorksheet('AuthLogs', logRows);
  }

  async forceFlushNow(): Promise<void> {
    console.log('[BatchLogger] Force flush requested');
    await this.flush();
  }

  getQueueStatus(): { userId: string; queueSize: number }[] {
    return Array.from(this.queue.entries()).map(([userId, entries]) => ({
      userId,
      queueSize: entries.length
    }));
  }

  stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
      console.log('[BatchLogger] Stopped batch processing');
    }
  }
}

// Singleton instance
export const batchLogger = new BatchLogger();
