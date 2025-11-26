import type { LogEntry, AuthLogEntry, CategoryChangeLogEntry } from './fallbackLogging';
import { fallbackLogger } from './fallbackLogging';
import { pushoverService } from './pushover';
import { LOG_CONFIG } from '../config/logConfig';

interface BatchQueueEntry {
  type: 'user_activity' | 'auth' | 'category';
  data: LogEntry | AuthLogEntry | CategoryChangeLogEntry;
}

class BatchLogger {
  private queue: Map<string, BatchQueueEntry[]> = new Map(); // Key: userId / 'auth' / category:datasetId
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 30000; // 30 seconds (increased from 15s to reduce rate limit issues)
  private isProcessing: boolean = false;
  private isFollowMeeSyncing: boolean = false; // Flag to prevent flush during FollowMee sync
  
  // Rate limiting state for Google Sheets API (60 writes/min limit)
  private lastFlushTime: number = 0;
  private consecutiveRateLimitErrors: number = 0;
  private rateLimitBackoffMs: number = 0;

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

  addCategoryChange(logEntry: CategoryChangeLogEntry) {
    const key = `category:${logEntry.datasetId}`;

    if (!this.queue.has(key)) {
      this.queue.set(key, []);
    }

    this.queue.get(key)!.push({
      type: 'category',
      data: logEntry
    });

    if (LOG_CONFIG.BATCH_LOGGER.logQueueAdd) {
      console.log(`[BatchLogger] Added category change log for dataset ${logEntry.datasetId} (queue size: ${this.queue.get(key)!.length})`);
    }
  }

  async flush() {
    if (this.isProcessing) {
      console.log('[BatchLogger] Already processing, skipping flush');
      return;
    }

    if (this.isFollowMeeSyncing) {
      console.log('[BatchLogger] FollowMee sync in progress, skipping flush');
      return;
    }

    if (this.queue.size === 0) {
      // Only log if enabled (reduces noise from empty flushes)
      if (LOG_CONFIG.BATCH_LOGGER.logEmptyFlush) {
        console.log('[BatchLogger] Queue empty, nothing to flush');
      }
      return;
    }

    // Rate limiting: Check if we need to back off due to previous 429 errors
    if (this.rateLimitBackoffMs > 0) {
      const timeSinceLastFlush = Date.now() - this.lastFlushTime;
      if (timeSinceLastFlush < this.rateLimitBackoffMs) {
        console.log(`[BatchLogger] Rate limit backoff active, waiting ${Math.ceil((this.rateLimitBackoffMs - timeSinceLastFlush) / 1000)}s more`);
        return;
      }
    }

    this.isProcessing = true;
    this.lastFlushTime = Date.now();

    try {
      console.log(`[BatchLogger] Flushing ${this.queue.size} user queue(s)...`);

      // Process each user's queue SEQUENTIALLY (not in parallel)
      // This helps stay under the rate limit by spacing out API calls
      const queueEntries = Array.from(this.queue.entries());
      
      for (const [userId, entries] of queueEntries) {
        if (entries.length === 0) continue;
        
        // Add small delay between users to spread out API calls
        if (queueEntries.indexOf([userId, entries] as any) > 0) {
          await this.sleep(1000); // 1 second delay between user flushes
        }
        
        await this.flushUserQueue(userId, entries);
        
        // If we hit rate limit during this flush, stop processing more queues
        if (this.rateLimitBackoffMs > 0 && this.consecutiveRateLimitErrors > 0) {
          console.log('[BatchLogger] Rate limit hit, stopping flush cycle early');
          break;
        }
      }

      // Reset rate limit backoff on successful flush
      if (this.consecutiveRateLimitErrors > 0) {
        console.log('[BatchLogger] Flush successful, resetting rate limit backoff');
        this.consecutiveRateLimitErrors = 0;
        this.rateLimitBackoffMs = 0;
      }

      console.log('[BatchLogger] Flush complete');
    } catch (error) {
      console.error('[BatchLogger] Error during flush:', error);
    } finally {
      this.isProcessing = false;
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async flushUserQueue(queueKey: string, entries: BatchQueueEntry[]): Promise<void> {
    try {
      console.log(`[BatchLogger] Flushing ${entries.length} logs for ${queueKey}...`);

      const firstEntryType = entries[0].type;

      if (firstEntryType === 'auth') {
        await this.flushAuthLogs(entries as { type: 'auth'; data: AuthLogEntry }[]);
      } else if (firstEntryType === 'category') {
        await this.flushCategoryChangeLogs(queueKey, entries as { type: 'category'; data: CategoryChangeLogEntry }[]);
      } else {
        await this.flushUserActivityLogs(queueKey, entries as { type: 'user_activity'; data: LogEntry }[]);
      }

      // Remove successfully flushed entries from queue
      this.queue.delete(queueKey);

      console.log(`[BatchLogger] Successfully flushed logs for ${queueKey}`);
    } catch (error: any) {
      // Check if it's a rate limit error (429)
      const isRateLimitError = error?.status === 429 || error?.code === 429 || 
        (error?.message && error.message.includes('Quota exceeded'));
      
      if (isRateLimitError) {
        this.consecutiveRateLimitErrors++;
        // Exponential backoff: 30s, 60s, 120s, 240s (max 4 min)
        this.rateLimitBackoffMs = Math.min(30000 * Math.pow(2, this.consecutiveRateLimitErrors - 1), 240000);
        console.warn(`[BatchLogger] Rate limit hit (429). Backoff for ${this.rateLimitBackoffMs / 1000}s. Consecutive errors: ${this.consecutiveRateLimitErrors}`);
        
        // DON'T save to fallback on rate limit - keep in queue for retry
        // The data will be flushed on next successful attempt
        console.log(`[BatchLogger] Keeping ${entries.length} entries in queue for retry after backoff`);
        return; // Don't delete from queue
      }
      
      console.error(`[BatchLogger] Failed to flush logs for ${queueKey}:`, error);

      // Save failed logs to fallback file (only for non-rate-limit errors)
      for (const entry of entries) {
        await fallbackLogger.saveFailed(entry.data);
      }

      // Remove from queue even on failure (already saved to fallback)
      this.queue.delete(queueKey);

      // Send alert if fallback storage is being used
      await pushoverService.sendFallbackStorageAlert(entries.length);
    }
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

    // Batch append all rows (pass userId and username for auto-recreation if needed)
    await GoogleSheetsLoggingService.batchAppendToWorksheet(worksheetName, logRows, firstLog.userId, firstLog.username);
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

  private async flushCategoryChangeLogs(
    queueKey: string,
    entries: { type: 'category'; data: CategoryChangeLogEntry }[]
  ) {
    const { categoryChangeLoggingService } = await import('./googleSheets');

    for (const entry of entries) {
      const log = entry.data;
      try {
        await categoryChangeLoggingService.logCategoryChange(
          log.datasetId,
          log.residentOriginalName,
          log.residentCurrentName,
          log.oldCategory,
          log.newCategory,
          log.changedBy,
          log.addressDatasetSnapshot
        );
      } catch (error) {
        console.error(`[BatchLogger] Failed to flush category change log for dataset ${log.datasetId}:`, error);
        throw error;
      }
    }

    if (LOG_CONFIG.BATCH_LOGGER.logFlushSuccess) {
      console.log(`[BatchLogger] Category change logs flushed for ${queueKey}`);
    }
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

  getRateLimitStatus(): { consecutiveErrors: number; backoffMs: number; isBackingOff: boolean } {
    const timeSinceLastFlush = Date.now() - this.lastFlushTime;
    return {
      consecutiveErrors: this.consecutiveRateLimitErrors,
      backoffMs: this.rateLimitBackoffMs,
      isBackingOff: this.rateLimitBackoffMs > 0 && timeSinceLastFlush < this.rateLimitBackoffMs
    };
  }

  stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
      console.log('[BatchLogger] Stopped batch processing');
    }
  }

  /**
   * Set FollowMee syncing flag
   * When true, flush() will be skipped to prevent write conflicts
   */
  setFollowMeeSyncing(syncing: boolean) {
    this.isFollowMeeSyncing = syncing;
    if (syncing) {
      console.log('[BatchLogger] FollowMee sync started - batch flushing paused');
    } else {
      console.log('[BatchLogger] FollowMee sync ended - batch flushing resumed');
    }
  }
}

// Singleton instance
export const batchLogger = new BatchLogger();
