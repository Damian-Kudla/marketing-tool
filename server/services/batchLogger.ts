import type { LogEntry, AuthLogEntry, CategoryChangeLogEntry } from './fallbackLogging';
import { fallbackLogger } from './fallbackLogging';
import { pushoverService } from './pushover';
import { LOG_CONFIG } from '../config/logConfig';
import { googleSheetsRateLimitManager } from './googleSheetsRateLimitManager';
import { authLogsDB, categoryChangesDB } from './systemDatabaseService';

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

    // Check GLOBAL rate limit manager - if rate limited, skip entirely
    if (googleSheetsRateLimitManager.isRateLimited()) {
      const remaining = googleSheetsRateLimitManager.getRemainingCooldownSeconds();
      console.log(`[BatchLogger] Global rate limit active (${remaining}s remaining), skipping flush`);
      return;
    }

    this.isProcessing = true;

    try {
      console.log(`[BatchLogger] Flushing ${this.queue.size} user queue(s)...`);

      // Process each user's queue SEQUENTIALLY (not in parallel)
      // This helps stay under the rate limit by spacing out API calls
      const queueEntries = Array.from(this.queue.entries());
      
      for (const [userId, entries] of queueEntries) {
        if (entries.length === 0) continue;
        
        // Check rate limit before each user queue
        if (googleSheetsRateLimitManager.isRateLimited()) {
          console.log('[BatchLogger] Rate limit triggered during flush, stopping early');
          break;
        }
        
        // Add small delay between users to spread out API calls
        if (queueEntries.indexOf([userId, entries] as any) > 0) {
          await this.sleep(1000); // 1 second delay between user flushes
        }
        
        await this.flushUserQueue(userId, entries);
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
      // Check if it's a rate limit error (429) using global manager
      if (googleSheetsRateLimitManager.isRateLimitError(error)) {
        // Trigger global 5-minute cooldown
        googleSheetsRateLimitManager.triggerRateLimit();
        console.warn(`[BatchLogger] Rate limit hit (429). Global cooldown activated for 5 minutes.`);
        
        // DON'T save to fallback on rate limit - keep in queue for retry
        // The data will be flushed on next successful attempt
        console.log(`[BatchLogger] Keeping ${entries.length} entries in queue for retry after cooldown`);
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
    // Step 1: Save to SQLite (PRIMARY)
    try {
      const logsToInsert = entries.map(entry => ({
        timestamp: entry.data.timestamp,
        ipAddress: entry.data.ipAddress,
        success: entry.data.success,
        username: entry.data.username || undefined,
        userId: entry.data.userId || undefined,
        reason: entry.data.reason || undefined,
      }));

      const inserted = authLogsDB.insertBatch(logsToInsert);
      console.log(`[BatchLogger] Saved ${inserted} auth logs to SQLite`);
    } catch (error) {
      console.error('[BatchLogger] Failed to save auth logs to SQLite:', error);
    }

    // Step 2: Save to Sheets (BACKUP) - using SYSTEM_SHEET now
    // IMPORTANT: Use consistent data types with SQLite (0/1 for success, not SUCCESS/FAILED)
    try {
      const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');

      const logRows = entries.map(entry => {
        const log = entry.data;
        return [
          log.timestamp,
          log.ipAddress,
          log.success ? '1' : '0',  // Store as 0/1 like SQLite for consistency
          log.username || '',
          log.userId || '',
          log.reason || ''
        ];
      });

      // Batch append to AuthLogs worksheet (in System Sheet)
      await GoogleSheetsLoggingService.batchAppendToWorksheet('AuthLogs', logRows);
    } catch (error) {
      console.warn('[BatchLogger] Failed to save auth logs to Sheets (SQLite backup exists):', error);
    }
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

  getRateLimitStatus(): { isRateLimited: boolean; remainingSeconds: number } {
    return {
      isRateLimited: googleSheetsRateLimitManager.isRateLimited(),
      remainingSeconds: googleSheetsRateLimitManager.getRemainingCooldownSeconds()
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
