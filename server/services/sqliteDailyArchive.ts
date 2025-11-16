/**
 * SQLite Daily Archive Service
 *
 * Cron-Job für tägliche Archivierung:
 * - Läuft um Mitternacht (CET/CEST)
 * - Archiviert gestrigen Tag in Drive
 * - Löscht alte lokale DBs (>7 Tage)
 * - Leert alte Logs aus Sheets
 */

import cron from 'node-cron';
import { getCETDate, cleanupOldDBs, checkpointDB, dbExists, getDBStats } from './sqliteLogService';
import { sqliteBackupService } from './sqliteBackupService';
import { pushoverService } from './pushover';
import { getBerlinDate } from '../utils/timezone';

class SQLiteDailyArchiveService {
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Startet den Cron-Job
   * Läuft täglich um 00:05 Uhr (CET/CEST) - 5 Minuten nach Mitternacht
   */
  start(): void {
    if (this.cronJob) {
      console.warn('[DailyArchive] Cron job already running');
      return;
    }

    // Cron: Täglich um 00:05 Uhr (nach Mitternacht, damit dailyDataStore reset erfolgt ist)
    // Format: Minute Hour Day Month Weekday
    this.cronJob = cron.schedule(
      '5 0 * * *',
      async () => {
        await this.runDailyArchive();
      },
      {
        timezone: 'Europe/Berlin' // CET/CEST
      }
    );

    console.log('[DailyArchive] ✅ Cron job started (runs daily at 00:05 CET/CEST)');
  }

  /**
   * Stoppt den Cron-Job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('[DailyArchive] Cron job stopped');
    }
  }

  /**
   * Manueller Trigger für Tests
   */
  async runManually(): Promise<void> {
    console.log('[DailyArchive] Manual run triggered');
    await this.runDailyArchive();
  }

  /**
   * Haupt-Archivierungslogik
   */
  private async runDailyArchive(): Promise<void> {
    if (this.isRunning) {
      console.warn('[DailyArchive] Archive job already running, skipping...');
      return;
    }

    this.isRunning = true;

    const startTime = Date.now();

    console.log('\n========================================');
    console.log('🌙 DAILY ARCHIVE STARTED');
    console.log(`   Time: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
    console.log('========================================\n');

    try {
      const today = getCETDate();
      const yesterday = this.getYesterday(today);

      console.log(`[DailyArchive] Today: ${today}`);
      console.log(`[DailyArchive] Yesterday: ${yesterday}`);

      // STEP 0: External Tracking Reconciliation (before archiving)
      console.log('\n--- Step 0: External Tracking Reconciliation ---');
      await this.stepReconcileExternalTracking();

      // STEP 1: Checkpoint yesterday's DB (flush WAL to main DB)
      console.log('\n--- Step 1: Checkpoint DBs ---');
      await this.stepCheckpointDBs(yesterday);

      // STEP 2: Upload yesterday's DB to Drive
      if (sqliteBackupService.isReady()) {
        console.log('\n--- Step 2: Upload to Drive ---');
        await this.stepUploadToDrive(yesterday);
      } else {
        console.warn('[DailyArchive] ⚠️  Drive not ready, skipping upload');
      }

      // STEP 3: Cleanup old local DBs (>7 days)
      console.log('\n--- Step 3: Cleanup Old DBs ---');
      await this.stepCleanupOldDBs();

      // STEP 4: Cleanup old Sheets logs (optional - done by startup sync)
      console.log('\n--- Step 4: Cleanup Sheets ---');
      await this.stepCleanupSheets(today);

      // STEP 5: Monitor disk usage
      console.log('\n--- Step 5: Monitor Disk Usage ---');
      await this.stepMonitorDiskUsage();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('\n========================================');
      console.log('✅ DAILY ARCHIVE COMPLETED');
      console.log(`⏱️  Duration: ${duration}s`);
      console.log('========================================\n');

      // No Pushover notification on success - only errors need attention
    } catch (error) {
      console.error('[DailyArchive] ❌ Error during archive:', error);

      await pushoverService.sendNotification(
        `Failed to archive: ${error}`,
        { title: 'Daily Archive Error', priority: 1 }
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * STEP 0: Reconcile External Tracking Data (before archiving)
   */
  private async stepReconcileExternalTracking(): Promise<void> {
    console.log('[Step 0] Reconciling unassigned external tracking data...');

    try {
      const { externalTrackingReconciliationService } = await import('./externalTrackingReconciliation');
      const stats = await externalTrackingReconciliationService.reconcileUnassignedTrackingData();

      if (stats.devicesProcessed > 0) {
        console.log(`[Step 0] ✅ Processed ${stats.devicesProcessed} devices:`);
        console.log(`         - Assigned: ${stats.devicesAssigned}`);
        console.log(`         - Remaining: ${stats.devicesRemaining}`);
        console.log(`         - Total GPS points: ${stats.totalDataPoints}`);
        console.log(`         - Historical points: ${stats.historicalDataPoints}`);
        console.log(`         - Current points: ${stats.currentDataPoints}`);

        if (stats.errors.length > 0) {
          console.warn(`[Step 0] ⚠️  ${stats.errors.length} errors occurred during reconciliation`);
          stats.errors.forEach(err => {
            console.warn(`         - ${err.deviceName}: ${err.error}`);
          });
        }
      } else {
        console.log('[Step 0] ℹ️  No unassigned external tracking data found');
      }
    } catch (error) {
      console.error('[Step 0] ❌ Error during external tracking reconciliation:', error);
      // Don't throw - continue with archive even if reconciliation fails
    }
  }

  /**
   * STEP 1: Checkpoint DBs (flush WAL)
   */
  private async stepCheckpointDBs(yesterday: string): Promise<void> {
    console.log(`[Step 1] Checkpointing ${yesterday}...`);

    const exists = await dbExists(yesterday);

    if (!exists) {
      console.log(`[Step 1] ℹ️  No DB for ${yesterday}, skipping checkpoint`);
      return;
    }

    try {
      checkpointDB(yesterday);
      console.log(`[Step 1] ✅ Checkpointed ${yesterday}`);
    } catch (error) {
      console.error(`[Step 1] ❌ Error checkpointing ${yesterday}:`, error);
    }
  }

  /**
   * STEP 2: Upload zu Drive
   */
  private async stepUploadToDrive(yesterday: string): Promise<void> {
    console.log(`[Step 2] Uploading ${yesterday} to Drive...`);

    const exists = await dbExists(yesterday);

    if (!exists) {
      console.log(`[Step 2] ℹ️  No DB for ${yesterday}, skipping upload`);
      return;
    }

    // Get stats before upload
    const stats = getDBStats(yesterday);
    console.log(`[Step 2] DB Stats: ${stats.rowCount} rows, ${(stats.size / 1024).toFixed(2)} KB`);

    const success = await sqliteBackupService.uploadDB(yesterday);

    if (success) {
      console.log(`[Step 2] ✅ Uploaded ${yesterday} to Drive`);
    } else {
      console.error(`[Step 2] ❌ Failed to upload ${yesterday}`);

      await pushoverService.sendNotification(
        `Could not upload ${yesterday} to Drive`,
        { title: 'Daily Archive Upload Failed', priority: 1 }
      );
    }
  }

  /**
   * STEP 3: Cleanup alte DBs (>7 Tage)
   */
  private async stepCleanupOldDBs(): Promise<void> {
    console.log('[Step 3] Cleaning up old DBs (>7 days)...');

    const deleted = await cleanupOldDBs(7);

    if (deleted > 0) {
      console.log(`[Step 3] ✅ Deleted ${deleted} old DBs`);
    } else {
      console.log('[Step 3] No old DBs to delete');
    }
  }

  /**
   * STEP 4: Merge alte Logs aus Sheets und dann cleanup
   */
  private async stepCleanupSheets(today: string): Promise<void> {
    console.log('[Step 4] Merging old logs from Sheets before cleanup...');

    try {
      // ERST: Merge alte Logs in SQLite (verhindert Datenverlust bei manuell nachgetragenen Daten)
      const logsMerged = await this.mergeOldLogsFromSheets(today);
      
      if (logsMerged > 0) {
        console.log(`[Step 4] ✅ Merged ${logsMerged} old logs into SQLite databases`);
      } else {
        console.log('[Step 4] No old logs to merge');
      }

      // DANN: Cleanup - lösche alte Logs aus Sheets (sind jetzt in SQLite)
      console.log('[Step 4] Cleaning up old logs from Sheets...');

      // Import Google Sheets service
      const { googleSheetsService } = await import('./googleSheets');

      // Get all users
      const allUsers = await googleSheetsService.getAllUsers();

      if (allUsers.length === 0) {
        console.log('[Step 4] No users found');
        return;
      }

      let totalDeleted = 0;

      for (const user of allUsers) {
        const worksheetName = `${user.username}_${user.userId}`;

        try {
          const deleted = await this.deleteOldLogsFromSheet(worksheetName, today);
          totalDeleted += deleted;

          if (deleted > 0) {
            console.log(`[Step 4]   ${worksheetName}: deleted ${deleted} rows`);
          }
        } catch (error) {
          console.error(`[Step 4]   Error cleaning ${worksheetName}:`, error);
        }

        // Rate limiting
        await this.sleep(500);
      }

      console.log(`[Step 4] ✅ Deleted ${totalDeleted} total rows from Sheets`);
    } catch (error) {
      console.error('[Step 4] Error during Sheets cleanup:', error);
    }
  }

  /**
   * Helper: Merge alte Logs aus Sheets in SQLite DBs
   * (Verhindert Datenverlust bei manuell nachgetragenen alten Daten)
   */
  private async mergeOldLogsFromSheets(today: string): Promise<number> {
    try {
      const { insertLogsBatch, getCETDate, dbExists, getDBPath } = await import('./sqliteLogService');
      const { sqliteBackupService } = await import('./sqliteBackupService');
      
      // Get all user worksheets
      const allWorksheets = await this.getAllUserWorksheets();

      if (allWorksheets.length === 0) {
        return 0;
      }

      console.log(`[Step 4] Checking ${allWorksheets.length} user sheets for old logs...`);

      // Map: date -> logs[]
      const logsByDate = new Map<string, any[]>();
      let totalOldLogs = 0;

      // Process each user's sheet
      for (const worksheetName of allWorksheets) {
        try {
          const logs = await this.getAllLogsFromSheet(worksheetName);

          if (!logs || logs.length === 0) continue;

          // Filter for old logs (not today)
          const oldLogs = logs.filter(log => {
            try {
              if (!log.timestamp) return false;
              const timestamp = new Date(log.timestamp).getTime();
              if (isNaN(timestamp)) return false;
              const logDate = getCETDate(timestamp);
              return logDate !== today;
            } catch {
              return false;
            }
          });

          if (oldLogs.length > 0) {
            totalOldLogs += oldLogs.length;

            // Group by date
            for (const log of oldLogs) {
              const timestamp = new Date(log.timestamp).getTime();
              const logDate = getCETDate(timestamp);

              if (!logsByDate.has(logDate)) {
                logsByDate.set(logDate, []);
              }

              // Convert to insert format
              const insertData = {
                userId: log.userId || '',
                username: log.username || '',
                timestamp: timestamp,
                logType: this.inferLogType(log),
                data: this.extractLogData(log)
              };

              logsByDate.get(logDate)!.push(insertData);
            }
          }
        } catch (error) {
          console.error(`[Step 4] Error processing ${worksheetName}:`, error);
        }

        await this.sleep(500);
      }

      if (totalOldLogs === 0) {
        return 0;
      }

      console.log(`[Step 4] Found ${totalOldLogs} old logs in ${logsByDate.size} different dates`);

      // Merge into DBs
      let totalMerged = 0;

      for (const [date, logs] of logsByDate.entries()) {
        try {
          // Check if DB exists locally or download from Drive
          if (!(await dbExists(date))) {
            const daysAgo = Math.floor(
              (new Date(today).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
            );

            if (daysAgo > 7 && sqliteBackupService.isReady()) {
              console.log(`[Step 4]   ${date} is >7 days old, downloading from Drive...`);
              const dbPath = getDBPath(date);
              await sqliteBackupService.downloadDB(date, dbPath);
            }
          }

          // Insert logs
          const inserted = insertLogsBatch(date, logs);
          totalMerged += inserted;

          if (inserted > 0) {
            console.log(`[Step 4]   Merged ${inserted} logs into ${date}`);

            // Upload changed DB if not today
            if (date !== today && sqliteBackupService.isReady()) {
              await sqliteBackupService.uploadDB(date);
            }
          }
        } catch (error) {
          console.error(`[Step 4] Error merging logs for ${date}:`, error);
        }

        await this.sleep(100);
      }

      return totalMerged;
    } catch (error) {
      console.error('[Step 4] Error merging old logs:', error);
      return 0;
    }
  }

  /**
   * Helper: Get all user worksheets
   */
  private async getAllUserWorksheets(): Promise<string[]> {
    try {
      const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
      const credentials = JSON.parse(sheetsKey);

      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const LOG_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';

      const response = await sheets.spreadsheets.get({
        spreadsheetId: LOG_SHEET_ID
      });

      const worksheets = response.data.sheets || [];
      const userSheets: string[] = [];

      for (const sheet of worksheets) {
        const title = sheet.properties?.title || '';
        if (title.includes('_') && !title.startsWith('Template')) {
          userSheets.push(title);
        }
      }

      return userSheets;
    } catch (error) {
      console.error('[getAllUserWorksheets] Error:', error);
      return [];
    }
  }

  /**
   * Helper: Get all logs from a worksheet
   */
  private async getAllLogsFromSheet(worksheetName: string): Promise<any[]> {
    try {
      const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
      const credentials = JSON.parse(sheetsKey);

      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const LOG_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`
      });

      const rows = response.data.values || [];
      const logs: any[] = [];

      for (const row of rows) {
        if (row.length < 4) continue;

        const log: any = {
          timestamp: row[0],
          userId: row[1],
          username: row[2],
          endpoint: row[3],
          method: row[4],
          address: row[5],
          newProspects: row[6],
          existingCustomers: row[7],
          userAgent: row[8]
        };

        // Parse data JSON
        if (row[9]) {
          try {
            log.data = JSON.parse(row[9]);
          } catch {
            log.data = {};
          }
        }

        logs.push(log);
      }

      return logs;
    } catch (error) {
      console.error(`[getAllLogsFromSheet] Error for ${worksheetName}:`, error);
      return [];
    }
  }

  /**
   * Helper: Infer log type from log data
   */
  private inferLogType(log: any): string {
    const data = log.data || {};

    if (data.action === 'gps_update' || (data.latitude && data.longitude)) {
      return 'gps';
    }

    if (data.session || data.sessionDuration !== undefined) {
      return 'session';
    }

    if (data.device || data.batteryLevel !== undefined) {
      return 'device';
    }

    if (log.endpoint || data.action) {
      return 'action';
    }

    return 'other';
  }

  /**
   * Helper: Extract log data
   */
  private extractLogData(log: any): any {
    const data = log.data || {};

    return {
      endpoint: log.endpoint,
      method: log.method,
      address: log.address,
      newProspects: log.newProspects,
      existingCustomers: log.existingCustomers,
      userAgent: log.userAgent,
      ...data
    };
  }

  /**
   * STEP 5: Monitor Disk Usage
   */
  private async stepMonitorDiskUsage(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');

      const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
        ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'user-logs')
        : path.join(process.cwd(), 'data', 'user-logs');

      // Calculate total size
      let totalSize = 0;
      const files = fs.readdirSync(DATA_DIR);

      for (const file of files) {
        if (file.endsWith('.db')) {
          const filePath = path.join(DATA_DIR, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }
      }

      const totalMB = (totalSize / (1024 * 1024)).toFixed(2);

      console.log(`[Step 5] Total disk usage: ${totalMB} MB (${files.length} files)`);

      // Warning if approaching 1GB (Railway free limit)
      if (totalSize > 900 * 1024 * 1024) {
        await pushoverService.sendNotification(
          `SQLite logs using ${totalMB} MB (approaching 1GB limit)`,
          { title: 'Disk Usage Warning', priority: 1 }
        );
      }
    } catch (error) {
      console.error('[Step 5] Error monitoring disk usage:', error);
    }
  }

  /**
   * Helper: Delete old logs from sheet
   */
  private async deleteOldLogsFromSheet(worksheetName: string, today: string): Promise<number> {
    try {
      const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
      const credentials = JSON.parse(sheetsKey);

      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const LOG_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';

      // Get all rows
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`
      });

      const rows = response.data.values || [];

      if (rows.length === 0) return 0;

      // Find rows to keep (today's logs)
      const rowsToKeep: any[][] = [];

      for (const row of rows) {
        const timestamp = row[0];
        if (!timestamp) continue;

        const logDate = getCETDate(new Date(timestamp).getTime());

        if (logDate === today) {
          rowsToKeep.push(row);
        }
      }

      const deleted = rows.length - rowsToKeep.length;

      if (deleted === 0) {
        return 0;
      }

      // Clear all data rows
      await sheets.spreadsheets.values.clear({
        spreadsheetId: LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`
      });

      // Write back only today's rows
      if (rowsToKeep.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: LOG_SHEET_ID,
          range: `${worksheetName}!A2:J`,
          valueInputOption: 'RAW',
          requestBody: {
            values: rowsToKeep
          }
        });
      }

      return deleted;
    } catch (error) {
      console.error(`Error deleting from sheet ${worksheetName}:`, error);
      return 0;
    }
  }

  /**
   * Helper: Get yesterday's date
   */
  private getYesterday(today: string): string {
    const todayDate = new Date(today);
    todayDate.setDate(todayDate.getDate() - 1);
    return getBerlinDate(todayDate);
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const sqliteDailyArchiveService = new SQLiteDailyArchiveService();
