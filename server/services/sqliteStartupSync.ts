/**
 * SQLite Startup Sync Service
 *
 * Umfassender Abgleich bei Serverstart:
 * 1. Prüfe lokale DBs (letzte 7 Tage)
 * 2. Fehlende DBs aus Drive downloaden
 * 3. Checksum-Vergleich (lokal vs. Drive) → sync conflicts
 * 4. Sheets-Merge: Extrahiere alte Logs, merge in DBs
 * 5. Batch-Upload geänderter DBs
 * 6. Cleanup: Alte Logs aus Sheets löschen
 */

import fs from 'fs';
import { promisify } from 'util';
import {
  getCETDate,
  dbExists,
  initDB,
  insertLogsBatch,
  getDBPath,
  checkDBIntegrity,
  closeDB,
  LogInsertData
} from './sqliteLogService';
import { sqliteBackupService } from './sqliteBackupService';
import { GoogleSheetsLoggingService, LogEntry } from './googleSheetsLogging';
import { pushoverService } from './pushover';
import type { TrackingData } from '../../shared/trackingTypes';
import { getBerlinDate } from '../utils/timezone';

const fsp = {
  stat: promisify(fs.stat),
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile)
};

interface SyncStats {
  localDBsChecked: number;
  dbsDownloaded: number;
  dbsUploaded: number;
  sheetsProcessed: number;
  logsMerged: number;
  sheetsRowsDeleted: number;
  conflicts: number;
  errors: string[];
}

class SQLiteStartupSyncService {
  private syncInProgress = false;

  /**
   * Hauptfunktion: Vollständiger Startup-Sync
   */
  async performStartupSync(): Promise<SyncStats> {
    if (this.syncInProgress) {
      console.warn('[StartupSync] Sync already in progress, skipping...');
      return this.createEmptyStats();
    }

    this.syncInProgress = true;

    const stats: SyncStats = this.createEmptyStats();
    const startTime = Date.now();

    console.log('\n========================================');
    console.log('🔄 STARTUP SYNC STARTED');
    console.log('========================================\n');

    try {
      // Wait for Drive to initialize
      if (!sqliteBackupService.isReady()) {
        console.log('[StartupSync] Waiting for Google Drive...');
        await sqliteBackupService.initialize();

        if (!sqliteBackupService.isReady()) {
          console.error('[StartupSync] ⚠️  Drive not available, limited sync mode');
          stats.errors.push('Google Drive not available');
        }
      }

      // PHASE 1: Check local DBs (last 7 days)
      console.log('\n--- Phase 1: Local DB Check (7 days) ---');
      await this.phase1_CheckLocalDBs(stats);

      // PHASE 2: Download missing DBs from Drive
      if (sqliteBackupService.isReady()) {
        console.log('\n--- Phase 2: Download Missing DBs ---');
        await this.phase2_DownloadMissingDBs(stats);
      }

      // PHASE 3: Checksum comparison (local vs Drive)
      if (sqliteBackupService.isReady()) {
        console.log('\n--- Phase 3: Checksum Comparison ---');
        await this.phase3_ChecksumComparison(stats);
      }

      // PHASE 4: Merge old logs from Sheets
      console.log('\n--- Phase 4: Merge Sheets Logs ---');
      await this.phase4_MergeSheetsLogs(stats);

      // PHASE 5: Batch upload changed DBs
      // CRITICAL: Check both Phase 3 and Phase 4 upload lists
      // - Phase 3: DBs with checksum mismatch (local newer than Drive)
      // - Phase 4: DBs with new/updated logs from Sheets
      const phase3Dates = (stats as any)._phase3DatesToUpload || [];
      const phase4Dates = (stats as any)._datesNeedingUpload || [];
      const hasUploads = phase3Dates.length > 0 || phase4Dates.length > 0;
      
      if (sqliteBackupService.isReady() && hasUploads) {
        console.log('\n--- Phase 5: Upload Changed DBs ---');
        await this.phase5_UploadChangedDBs(stats);
      }

      // PHASE 6: Cleanup old logs from Sheets
      console.log('\n--- Phase 6: Cleanup Sheets ---');
      await this.phase6_CleanupSheets(stats);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('\n========================================');
      console.log('✅ STARTUP SYNC COMPLETED');
      console.log(`⏱️  Duration: ${duration}s`);
      console.log('========================================\n');

      this.logStats(stats);

      // Send Pushover ONLY for actual errors (conflicts are auto-resolved)
      if (stats.errors.length > 0) {
        await this.sendSyncSummary(stats, duration);
      }

      return stats;
    } catch (error) {
      console.error('[StartupSync] ❌ Critical error during sync:', error);
      stats.errors.push(`Critical error: ${error}`);

      await pushoverService.sendNotification(
        `Critical error during startup sync: ${error}`,
        { title: 'Startup Sync Error', priority: 2 }
      );

      return stats;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * PHASE 1: Prüfe lokale DBs der letzten 7 Tage
   */
  private async phase1_CheckLocalDBs(stats: SyncStats): Promise<void> {
    const today = getCETDate();
    const last7Days = this.getLast7Days(today);

    console.log(`[Phase 1] Checking ${last7Days.length} days...`);

    for (const date of last7Days) {
      stats.localDBsChecked++;

      const exists = await dbExists(date);

      if (exists) {
        // CRITICAL: Close DB from cache BEFORE integrity check
        // This ensures WAL checkpoint can complete without locks
        closeDB(date);

        // Integrity check
        const isValid = checkDBIntegrity(date);

        if (!isValid) {
          console.error(`[Phase 1] ❌ Corrupted DB detected: ${date}`);

          // Try to download from Drive as fallback
          if (sqliteBackupService.isReady()) {
            console.log(`[Phase 1] Attempting to restore ${date} from Drive...`);
            const downloaded = await sqliteBackupService.downloadDB(date);

            if (downloaded) {
              console.log(`[Phase 1] ✅ Restored ${date} from Drive backup`);
              // Don't add to errors if successfully restored
            } else {
              console.error(`[Phase 1] ❌ Could not restore ${date} from Drive`);
              stats.errors.push(`Failed to restore corrupted DB: ${date}`);
            }
          } else {
            stats.errors.push(`Corrupted DB: ${date} (Drive not available)`);
          }
        } else {
          console.log(`[Phase 1] ✓ ${date} OK`);
        }
      } else {
        console.log(`[Phase 1] ⚠️  Missing: ${date}`);
      }
    }
  }

  /**
   * PHASE 2: Lade fehlende DBs aus Drive
   */
  private async phase2_DownloadMissingDBs(stats: SyncStats): Promise<void> {
    const today = getCETDate();
    const last7Days = this.getLast7Days(today);

    console.log('[Phase 2] Downloading missing DBs...');

    for (const date of last7Days) {
      const exists = await dbExists(date);

      if (!exists) {
        const existsInDrive = await sqliteBackupService.existsInDrive(date);

        if (existsInDrive) {
          console.log(`[Phase 2] Downloading ${date}...`);

          const downloaded = await sqliteBackupService.downloadDB(date);

          if (downloaded) {
            stats.dbsDownloaded++;
            console.log(`[Phase 2] ✅ Downloaded ${date}`);
          } else {
            stats.errors.push(`Failed to download ${date}`);
            console.error(`[Phase 2] ❌ Failed to download ${date}`);
          }

          // Rate limiting
          await this.sleep(1000);
        } else {
          console.log(`[Phase 2] ℹ️  ${date} not in Drive (new day or no data)`);
        }
      }
    }
  }

  /**
   * PHASE 3: Checksum-Vergleich & Konfliktauflösung
   */
  private async phase3_ChecksumComparison(stats: SyncStats): Promise<void> {
    const today = getCETDate();
    const last7Days = this.getLast7Days(today).filter(d => d !== today); // Skip current day

    console.log('[Phase 3] Comparing checksums...');

    const datesToUpload: string[] = []; // Track DBs that need uploading

    for (const date of last7Days) {
      const exists = await dbExists(date);
      if (!exists) continue;

      const comparison = await sqliteBackupService.compareWithDrive(date);

      if (comparison.action === 'conflict') {
        stats.conflicts++;
        console.warn(`[Phase 3] ⚠️  Conflict detected for ${date}`);

        // Conflict resolution: Compare file modification times
        const localPath = getDBPath(date);
        const localStat = await fsp.stat(localPath);

        // Get Drive modified time
        // (simplified: always prefer Drive in case of conflict - it's the "source of truth")
        console.log(`[Phase 3] Resolving conflict: downloading ${date} from Drive (Drive = source of truth)`);

        // Close DB before attempting to replace it
        closeDB(date);

        const downloaded = await sqliteBackupService.downloadDB(date);

        if (downloaded) {
          console.log(`[Phase 3] ✅ Conflict resolved: ${date} updated from Drive`);
        } else {
          stats.errors.push(`Failed to resolve conflict for ${date}`);
        }

        await this.sleep(1000);
      } else if (comparison.action === 'upload') {
        console.log(`[Phase 3] Local ${date} newer than Drive, marking for upload`);
        datesToUpload.push(date);
      } else if (comparison.action === 'download') {
        console.log(`[Phase 3] Drive ${date} newer, downloading...`);
        await sqliteBackupService.downloadDB(date);
        stats.dbsDownloaded++;
        await this.sleep(1000);
      } else {
        console.log(`[Phase 3] ✓ ${date} in sync`);
      }
    }

    // Store dates for upload (will be merged with Phase 4 uploads)
    (stats as any)._phase3DatesToUpload = datesToUpload;
  }

  /**
   * PHASE 4: Merge alte Logs aus Google Sheets
   */
  private async phase4_MergeSheetsLogs(stats: SyncStats): Promise<void> {
    try {
      // Get ALL user worksheets from spreadsheet (not just active users)
      // This ensures we also process sheets from former employees or renamed accounts
      const allWorksheets = await this.getAllUserWorksheets();

      if (allWorksheets.length === 0) {
        console.log('[Phase 4] No user worksheets found in Log spreadsheet');
        return;
      }

      console.log(`[Phase 4] Processing ${allWorksheets.length} user sheets...`);

      // Log all worksheet names for debugging
      console.log('[Phase 4] Found worksheets:');
      allWorksheets.forEach(ws => console.log(`  - ${ws}`));

      const today = getCETDate();

      // Map: date -> LogInsertData[]
      const logsByDate = new Map<string, LogInsertData[]>();

      // Track sheets with old logs for cleanup
      const sheetsWithOldLogs: string[] = [];

      // Process each user's sheet
      for (const worksheetName of allWorksheets) {
        stats.sheetsProcessed++;

        console.log(`[Phase 4] Processing sheet: ${worksheetName}...`);

        try {
          // Get all logs from this user's sheet
          const logs = await this.getAllLogsFromSheet(worksheetName);

          if (!logs || logs.length === 0) {
            console.log(`[Phase 4]   No logs found`);
            continue;
          }

          console.log(`[Phase 4]   Retrieved ${logs.length} logs from sheet`);

          // Warn if too many logs (potential performance issue)
          if (logs.length > 50000) {
            console.warn(`[Phase 4]   ⚠️  Large dataset detected (${logs.length} logs) - may take a while`);
          }

          // Filter for old logs (YESTERDAY or earlier, not today or same day)
          // WICHTIG: Nur Logs von GESTERN (oder früher) als "old" behandeln
          // Dadurch wird verhindert, dass Logs vom gleichen Tag gelöscht werden,
          // wenn der Server kurz nach Mitternacht startet, aber noch Batch-Uploads
          // vom Vortag ausstehen (z.B. 23:05-23:59 Uhr Logs)
          const oldLogs = logs.filter(log => {
            try {
              // Validate timestamp
              if (!log.timestamp) return false;

              const timestamp = new Date(log.timestamp).getTime();
              if (isNaN(timestamp)) return false;

              const logDate = getCETDate(timestamp);
              // Nur Logs VOR heute (gestern oder früher) als "old" markieren
              return logDate < today;
            } catch (error) {
              console.warn(`[Phase 4]   Invalid timestamp: ${log.timestamp}`);
              return false;
            }
          });

          if (oldLogs.length > 0) {
            console.log(`[Phase 4]   Found ${oldLogs.length} old logs (${logs.length} total)`);
            sheetsWithOldLogs.push(worksheetName);

            // Group by date (process in batches to avoid memory issues)
            const BATCH_SIZE = 1000;
            for (let i = 0; i < oldLogs.length; i += BATCH_SIZE) {
              const batch = oldLogs.slice(i, Math.min(i + BATCH_SIZE, oldLogs.length));

              for (const log of batch) {
                try {
                  const timestamp = new Date(log.timestamp).getTime();
                  if (isNaN(timestamp)) {
                    console.warn(`[Phase 4]   Skipping log with invalid timestamp: ${log.timestamp}`);
                    continue;
                  }

                  const logDate = getCETDate(timestamp);

                  if (!logsByDate.has(logDate)) {
                    logsByDate.set(logDate, []);
                  }

                  // Convert to LogInsertData
                  const insertData: LogInsertData = {
                    userId: log.userId || '',
                    username: log.username || '',
                    timestamp: timestamp,
                    logType: this.inferLogType(log),
                    data: this.extractLogData(log)
                  };

                  logsByDate.get(logDate)!.push(insertData);
                } catch (error) {
                  console.warn(`[Phase 4]   Error converting log:`, error);
                  continue;
                }
              }

              // Progress logging for large datasets
              if (oldLogs.length > 5000 && i > 0 && i % 5000 === 0) {
                console.log(`[Phase 4]   Processed ${i}/${oldLogs.length} logs...`);
              }
            }
          } else {
            console.log(`[Phase 4]   All logs are from today, skipping`);
          }
        } catch (error: any) {
          console.error(`[Phase 4]   Error processing ${worksheetName}:`, error?.message || error);
          stats.errors.push(`Failed to process sheet ${worksheetName}: ${error?.message || 'Unknown error'}`);
          // Continue with next sheet instead of crashing
        }

        // Rate limiting
        await this.sleep(500);
      }

      // Now merge all collected logs into DBs (grouped by date)
      console.log(`[Phase 4] Merging logs into ${logsByDate.size} DBs...`);

      const datesNeedingUpload: string[] = [];
      const newlyCreatedDBs: string[] = []; // Track DBs created during this phase

      for (const [date, logs] of logsByDate.entries()) {
        console.log(`[Phase 4] Merging ${logs.length} logs into ${date}...`);

        // Check if DB exists locally
        let dbPath = getDBPath(date);
        let wasCreatedNow = false;

        if (!(await dbExists(date))) {
          wasCreatedNow = true; // Mark as newly created
          
          // DB not local, check if >7 days old
          const daysAgo = Math.floor(
            (new Date(today).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysAgo > 7) {
            console.log(`[Phase 4]   ${date} is >7 days old, downloading from Drive...`);

            // Try to download
            const downloaded = await sqliteBackupService.downloadDB(date, dbPath);

            if (downloaded) {
              wasCreatedNow = false; // Downloaded from Drive, not newly created
            } else {
              console.log(`[Phase 4]   Not in Drive, creating new DB for ${date}`);
            }
          } else {
            console.log(`[Phase 4]   Creating new DB for ${date}`);
          }
        }

        // Insert logs (batch)
        const inserted = insertLogsBatch(date, logs);
        stats.logsMerged += inserted;

        console.log(`[Phase 4]   ✅ Merged ${inserted}/${logs.length} logs into ${date}`);

        // Mark for upload if:
        // 1. New logs were inserted (inserted > 0), OR
        // 2. DB was newly created (not in Drive yet)
        if (date !== today && (inserted > 0 || wasCreatedNow)) {
          datesNeedingUpload.push(date);
          if (wasCreatedNow && inserted > 0) {
            newlyCreatedDBs.push(date);
          }
        }

        await this.sleep(100);
      }

      console.log(`[Phase 4] ✅ Merged ${stats.logsMerged} logs from Sheets`);
      
      if (newlyCreatedDBs.length > 0) {
        console.log(`[Phase 4] ℹ️  Created ${newlyCreatedDBs.length} new DBs: ${newlyCreatedDBs.join(', ')}`);
      }

      // Store dates for upload in next phase
      (stats as any)._datesNeedingUpload = datesNeedingUpload;
      (stats as any)._sheetsWithOldLogs = sheetsWithOldLogs;
    } catch (error) {
      console.error('[Phase 4] Error merging sheets logs:', error);
      stats.errors.push(`Sheets merge error: ${error}`);
    }
  }

  /**
   * PHASE 5: Upload geänderte DBs nach Drive
   */
  private async phase5_UploadChangedDBs(stats: SyncStats): Promise<void> {
    const phase3Dates = (stats as any)._phase3DatesToUpload || [];
    const phase4Dates = (stats as any)._datesNeedingUpload || [];

    // Merge and deduplicate
    const allDates = [...new Set([...phase3Dates, ...phase4Dates])];

    if (allDates.length === 0) {
      console.log('[Phase 5] No DBs need uploading');
      return;
    }

    console.log(`[Phase 5] Uploading ${allDates.length} changed DBs...`);
    if (phase3Dates.length > 0) {
      console.log(`[Phase 5]   - ${phase3Dates.length} from Phase 3 (checksum mismatch)`);
    }
    if (phase4Dates.length > 0) {
      console.log(`[Phase 5]   - ${phase4Dates.length} from Phase 4 (new/updated logs)`);
    }

    for (const date of allDates) {
      const success = await sqliteBackupService.uploadDB(date);

      if (success) {
        stats.dbsUploaded++;
        console.log(`[Phase 5] ✅ Uploaded ${date}`);
      } else {
        stats.errors.push(`Failed to upload ${date}`);
        console.error(`[Phase 5] ❌ Failed to upload ${date}`);
      }

      // Rate limiting
      await this.sleep(1000);
    }
  }

  /**
   * PHASE 6: Cleanup alte Logs aus Sheets
   */
  private async phase6_CleanupSheets(stats: SyncStats): Promise<void> {
    const sheetsWithOldLogs = (stats as any)._sheetsWithOldLogs || [];

    if (sheetsWithOldLogs.length === 0) {
      console.log('[Phase 6] No sheets need cleanup');
      return;
    }

    console.log(`[Phase 6] Cleaning ${sheetsWithOldLogs.length} sheets...`);

    const today = getCETDate();
    const emptySheets: string[] = [];

    for (const worksheetName of sheetsWithOldLogs) {
      try {
        const deleted = await this.deleteOldLogsFromSheet(worksheetName, today);
        stats.sheetsRowsDeleted += deleted;

        console.log(`[Phase 6] ✅ Deleted ${deleted} old rows from ${worksheetName}`);

        // Check if sheet is now empty (no data rows, only header)
        const remainingLogs = await this.getAllLogsFromSheet(worksheetName);
        if (remainingLogs.length === 0) {
          emptySheets.push(worksheetName);
        }
      } catch (error) {
        console.error(`[Phase 6] Error cleaning ${worksheetName}:`, error);
        stats.errors.push(`Failed to clean ${worksheetName}`);
      }

      await this.sleep(1000); // Rate limiting
    }

    console.log(`[Phase 6] ✅ Deleted ${stats.sheetsRowsDeleted} total rows`);

    // Delete empty sheets
    if (emptySheets.length > 0) {
      console.log(`[Phase 6] Deleting ${emptySheets.length} empty sheets...`);
      
      for (const worksheetName of emptySheets) {
        try {
          const success = await this.deleteEmptySheet(worksheetName);
          if (success) {
            console.log(`[Phase 6] ✅ Deleted empty sheet: ${worksheetName}`);
          }
        } catch (error) {
          console.error(`[Phase 6] Error deleting empty sheet ${worksheetName}:`, error);
        }
        
        await this.sleep(500);
      }
    }
  }

  /**
   * Helper: Get yesterday's date (for safety buffer in cleanup)
   */
  private getYesterday(today: string): string {
    const todayDate = new Date(today);
    todayDate.setDate(todayDate.getDate() - 1);
    return getBerlinDate(todayDate);
  }

  /**
   * Helper: Get all user worksheet names from Log spreadsheet
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

      // Get spreadsheet metadata to list all worksheets
      const response = await sheets.spreadsheets.get({
        spreadsheetId: LOG_SHEET_ID
      });

      const worksheets = response.data.sheets || [];
      const userSheets: string[] = [];

      for (const sheet of worksheets) {
        const title = sheet.properties?.title || '';
        
        // Only include worksheets matching pattern: Username_UserId (contains underscore)
        if (title.includes('_') && !title.startsWith('Template')) {
          userSheets.push(title);
        }
      }

      return userSheets;
    } catch (error) {
      console.error('[getAllUserWorksheets] Error fetching worksheets:', error);
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
        range: `${worksheetName}!A2:J` // Skip header
      });

      const rows = response.data.values || [];

      if (rows.length === 0) {
        return [];
      }

      return rows.map((row: any[]) => ({
        timestamp: row[0] || '',
        userId: row[1] || '',
        username: row[2] || '',
        endpoint: row[3] || '',
        method: row[4] || '',
        address: row[5] || '',
        newProspects: row[6] || '',
        existingCustomers: row[7] || '',
        userAgent: row[8] || '',
        data: row[9] || ''
      }));
    } catch (error: any) {
      // Handle empty sheets gracefully (400 error "Unable to parse range")
      if (error?.code === 400 || error?.message?.includes('Unable to parse range')) {
        // Sheet exists but has no data (empty or only header)
        return [];
      }

      console.error(`Error reading sheet ${worksheetName}:`, error?.message || error);
      return [];
    }
  }

  /**
   * Helper: Delete old logs from sheet (keep only today)
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

      // Find rows to keep (today's and yesterday's logs for safety)
      // WICHTIG: Behalte Logs von heute UND gestern, lösche nur Logs von vorgestern oder älter
      // Dies verhindert Datenverlust bei verspäteten Batch-Uploads
      const yesterday = this.getYesterday(today);
      const rowsToKeep: any[][] = [];

      for (const row of rows) {
        const timestamp = row[0];
        if (!timestamp) continue;

        try {
          const timestampMs = new Date(timestamp).getTime();
          if (isNaN(timestampMs)) continue;

          const logDate = getCETDate(timestampMs);

          // Behalte Logs von heute oder gestern (>= yesterday)
          if (logDate >= yesterday) {
            rowsToKeep.push(row);
          }
        } catch (error) {
          console.warn(`[Cleanup] Invalid timestamp: ${timestamp}`);
          continue;
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
   * Helper: Delete empty user sheets (only header remaining)
   */
  private async deleteEmptySheet(worksheetName: string): Promise<boolean> {
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

      // Get spreadsheet metadata to find sheet ID
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: LOG_SHEET_ID
      });

      const sheet = spreadsheet.data.sheets?.find(
        (s: any) => s.properties?.title === worksheetName
      );

      if (!sheet?.properties?.sheetId) {
        console.warn(`[DeleteEmptySheet] Sheet not found: ${worksheetName}`);
        return false;
      }

      const sheetId = sheet.properties.sheetId;

      // Delete the sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: LOG_SHEET_ID,
        requestBody: {
          requests: [{
            deleteSheet: {
              sheetId: sheetId
            }
          }]
        }
      });

      console.log(`[DeleteEmptySheet] Deleted empty sheet: ${worksheetName}`);
      return true;
    } catch (error) {
      console.error(`[DeleteEmptySheet] Error deleting sheet ${worksheetName}:`, error);
      return false;
    }
  }

  /**
   * Helper: Infer log type from sheet data
   */
  private inferLogType(log: any): 'gps' | 'session' | 'action' | 'device' {
    // Try to parse data field
    if (log.data) {
      try {
        const parsed = JSON.parse(log.data);

        if (parsed.gps || parsed.latitude) return 'gps';
        if (parsed.session || parsed.actions) return 'session';
        if (parsed.device || parsed.batteryLevel) return 'device';
      } catch {
        // Not JSON
      }
    }

    // Fallback: infer from endpoint
    if (log.endpoint?.includes('gps')) return 'gps';
    if (log.endpoint?.includes('session')) return 'session';
    if (log.endpoint?.includes('device')) return 'device';

    return 'action'; // default
  }

  /**
   * Helper: Extract data from log entry
   */
  private extractLogData(log: any): any {
    if (log.data) {
      try {
        return JSON.parse(log.data);
      } catch {
        return { raw: log.data };
      }
    }

    // Construct from other fields
    return {
      endpoint: log.endpoint,
      method: log.method,
      address: log.address,
      newProspects: log.newProspects,
      existingCustomers: log.existingCustomers,
      userAgent: log.userAgent
    };
  }

  /**
   * Helper: Get last N days
   */
  private getLast7Days(today: string): string[] {
    const dates: string[] = [today];
    const todayDate = new Date(today);

    for (let i = 1; i <= 7; i++) {
      const date = new Date(todayDate);
      date.setDate(date.getDate() - i);

      const dateStr = getBerlinDate(date);
      dates.push(dateStr);
    }

    return dates;
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Helper: Create empty stats
   */
  private createEmptyStats(): SyncStats {
    return {
      localDBsChecked: 0,
      dbsDownloaded: 0,
      dbsUploaded: 0,
      sheetsProcessed: 0,
      logsMerged: 0,
      sheetsRowsDeleted: 0,
      conflicts: 0,
      errors: []
    };
  }

  /**
   * Helper: Log stats
   */
  private logStats(stats: SyncStats): void {
    console.log('\n📊 Sync Statistics:');
    console.log(`   Local DBs checked: ${stats.localDBsChecked}`);
    console.log(`   DBs downloaded: ${stats.dbsDownloaded}`);
    console.log(`   DBs uploaded: ${stats.dbsUploaded}`);
    console.log(`   Sheets processed: ${stats.sheetsProcessed}`);
    console.log(`   Logs merged: ${stats.logsMerged}`);
    console.log(`   Sheets rows deleted: ${stats.sheetsRowsDeleted}`);
    console.log(`   Conflicts: ${stats.conflicts}`);
    console.log(`   Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.forEach(err => console.log(`   - ${err}`));
    }
  }

  /**
   * Helper: Send summary via Pushover
   */
  private async sendSyncSummary(stats: SyncStats, duration: string): Promise<void> {
    const message = `
Startup Sync Completed (${duration}s)

✓ ${stats.localDBsChecked} DBs checked
↓ ${stats.dbsDownloaded} downloaded
↑ ${stats.dbsUploaded} uploaded
📄 ${stats.sheetsProcessed} sheets processed
🔀 ${stats.logsMerged} logs merged
🗑️  ${stats.sheetsRowsDeleted} rows deleted
⚠️  ${stats.conflicts} conflicts
❌ ${stats.errors.length} errors
    `.trim();

    const priority = stats.errors.length > 0 ? 1 : 0;

    await pushoverService.sendNotification(message, {
      title: 'Startup Sync Summary',
      priority: priority as 0 | 1
    });
  }
}

export const sqliteStartupSyncService = new SQLiteStartupSyncService();
