/**
 * Activity Log Backup Service
 *
 * Sichert alle heutigen Activity Logs nach Google Drive
 * für manuelle Datenwiederherstellung
 */

import { google } from './googleApiWrapper';
import fs from 'fs';
import path from 'path';
import { initDB, getCETDate } from './sqliteLogService';
import { getBerlinTimestamp } from '../utils/timezone';

const BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || '';

interface ActivityLogEntry {
  timestamp: string;
  userId: string;
  username: string;
  endpoint: string;
  method: string;
  address?: string;
  newProspects?: string;
  existingCustomers?: string;
  userAgent: string;
  data?: string;
}

class ActivityLogBackupService {
  private driveClient: any = null;
  private sheetsClient: any = null;

  async initialize(): Promise<void> {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY;

      if (!credentialsJson) {
        throw new Error('Google credentials not configured');
      }

      const credentials = JSON.parse(credentialsJson);

      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/spreadsheets'
        ]
      });

      this.driveClient = google.drive({ version: 'v3', auth });
      this.sheetsClient = google.sheets({ version: 'v4', auth });

      console.log('[ActivityLogBackup] Service initialized');
    } catch (error) {
      console.error('[ActivityLogBackup] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Sichert alle heutigen Activity Logs nach Google Drive
   */
  async backupTodayLogs(): Promise<{
    sqliteEntries: number;
    sheetsEntries: number;
    driveFileId: string;
    backupFilePath: string;
  }> {
    console.log('[ActivityLogBackup] Starting backup of today\'s logs...');

    if (!this.driveClient || !this.sheetsClient) {
      await this.initialize();
    }

    if (!BACKUP_FOLDER_ID) {
      throw new Error('GOOGLE_DRIVE_BACKUP_FOLDER_ID not configured in environment variables');
    }

    const today = getCETDate();
    const timestamp = getBerlinTimestamp().replace(/[:\s]/g, '-');

    // Step 1: Collect from SQLite
    const sqliteLogs = await this.collectFromSQLite(today);
    console.log(`[ActivityLogBackup] Collected ${sqliteLogs.length} entries from SQLite`);

    // Step 2: Collect from Google Sheets
    const sheetsLogs = await this.collectFromSheets();
    console.log(`[ActivityLogBackup] Collected ${sheetsLogs.length} entries from Sheets`);

    // Step 3: Merge and deduplicate
    const allLogs = this.mergeLogs(sqliteLogs, sheetsLogs);
    console.log(`[ActivityLogBackup] Total unique entries: ${allLogs.length}`);

    // Step 4: Create backup JSON file
    const backupData = {
      backupDate: timestamp,
      dateRange: today,
      sqliteCount: sqliteLogs.length,
      sheetsCount: sheetsLogs.length,
      totalCount: allLogs.length,
      logs: allLogs
    };

    const backupFileName = `activity-logs-backup-${timestamp}.json`;
    const tempPath = path.join(process.cwd(), 'data', 'temp', backupFileName);

    // Ensure temp directory exists
    const tempDir = path.dirname(tempPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    fs.writeFileSync(tempPath, JSON.stringify(backupData, null, 2));
    console.log(`[ActivityLogBackup] Created backup file: ${backupFileName}`);

    // Step 5: Upload to Google Drive
    const driveFileId = await this.uploadToDrive(tempPath, backupFileName);
    console.log(`[ActivityLogBackup] Uploaded to Drive: ${driveFileId}`);

    // Step 6: Clean up temp file
    fs.unlinkSync(tempPath);

    return {
      sqliteEntries: sqliteLogs.length,
      sheetsEntries: sheetsLogs.length,
      driveFileId,
      backupFilePath: backupFileName
    };
  }

  /**
   * Sammelt Logs aus SQLite für ein bestimmtes Datum
   */
  private async collectFromSQLite(date: string): Promise<ActivityLogEntry[]> {
    try {
      const db = initDB(date, true); // readonly mode

      // Query all action logs (enthalten die meisten Activity-Daten)
      const rows = db.prepare(`
        SELECT
          timestamp,
          userId,
          username,
          endpoint,
          method,
          address,
          newProspects,
          existingCustomers,
          userAgent,
          data
        FROM action_logs
        ORDER BY timestamp DESC
      `).all();

      return rows.map((row: any) => ({
        timestamp: row.timestamp,
        userId: row.userId,
        username: row.username,
        endpoint: row.endpoint,
        method: row.method,
        address: row.address,
        newProspects: row.newProspects,
        existingCustomers: row.existingCustomers,
        userAgent: row.userAgent,
        data: row.data
      }));
    } catch (error) {
      console.error('[ActivityLogBackup] Error collecting from SQLite:', error);
      return [];
    }
  }

  /**
   * Sammelt Logs aus Google Sheets
   */
  private async collectFromSheets(): Promise<ActivityLogEntry[]> {
    try {
      const SHEET_ID = process.env.GOOGLE_SHEET_ID;
      if (!SHEET_ID) {
        console.warn('[ActivityLogBackup] GOOGLE_SHEET_ID not configured');
        return [];
      }

      // Get all user worksheets
      const spreadsheet = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: SHEET_ID
      });

      const sheets = spreadsheet.data.sheets || [];
      const allLogs: ActivityLogEntry[] = [];
      const today = getCETDate();

      for (const sheet of sheets) {
        const sheetTitle = sheet.properties?.title;

        // Skip system sheets
        if (!sheetTitle || sheetTitle === 'AuthLogs' || sheetTitle === 'Users') {
          continue;
        }

        // Get logs from this worksheet
        try {
          const response = await this.sheetsClient.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${sheetTitle}!A2:J` // Skip header
          });

          const rows = response.data.values || [];

          for (const row of rows) {
            if (row.length < 4) continue;

            const timestamp = row[0];

            // Only include today's logs
            if (!timestamp || !timestamp.startsWith(today)) {
              continue;
            }

            allLogs.push({
              timestamp,
              userId: row[1] || '',
              username: row[2] || '',
              endpoint: row[3] || '',
              method: row[4] || '',
              address: row[5] || undefined,
              newProspects: row[6] || undefined,
              existingCustomers: row[7] || undefined,
              userAgent: row[8] || '',
              data: row[9] || undefined
            });
          }
        } catch (error) {
          console.warn(`[ActivityLogBackup] Error reading sheet ${sheetTitle}:`, error);
        }
      }

      return allLogs;
    } catch (error) {
      console.error('[ActivityLogBackup] Error collecting from Sheets:', error);
      return [];
    }
  }

  /**
   * Merged SQLite und Sheets Logs und entfernt Duplikate
   */
  private mergeLogs(sqliteLogs: ActivityLogEntry[], sheetsLogs: ActivityLogEntry[]): ActivityLogEntry[] {
    const seen = new Set<string>();
    const merged: ActivityLogEntry[] = [];

    // Helper: Create unique key for deduplication
    const getKey = (log: ActivityLogEntry) => {
      return `${log.timestamp}-${log.userId}-${log.endpoint}-${log.method}`;
    };

    // Add SQLite logs first (primary source)
    for (const log of sqliteLogs) {
      const key = getKey(log);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(log);
      }
    }

    // Add Sheets logs (if not already in SQLite)
    for (const log of sheetsLogs) {
      const key = getKey(log);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(log);
      }
    }

    // Sort by timestamp descending
    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return merged;
  }

  /**
   * Lädt Backup-Datei nach Google Drive hoch
   */
  private async uploadToDrive(filePath: string, fileName: string): Promise<string> {
    try {
      const fileMetadata = {
        name: fileName,
        parents: [BACKUP_FOLDER_ID]
      };

      const media = {
        mimeType: 'application/json',
        body: fs.createReadStream(filePath)
      };

      const response = await this.driveClient.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id'
      });

      return response.data.id;
    } catch (error) {
      console.error('[ActivityLogBackup] Error uploading to Drive:', error);
      throw error;
    }
  }

  /**
   * Analysiert Backup und extrahiert Address Dataset Daten
   */
  async analyzeBackupForDatasets(backupFilePath: string): Promise<{
    potentialDatasets: Array<{
      address: string;
      street?: string;
      houseNumber?: string;
      city?: string;
      postalCode?: string;
      createdBy: string;
      timestamp: string;
      endpoint: string;
    }>;
  }> {
    console.log(`[ActivityLogBackup] Analyzing backup: ${backupFilePath}`);

    const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf-8'));
    const logs = backupData.logs as ActivityLogEntry[];

    const potentialDatasets: any[] = [];

    // Look for address-related endpoints
    for (const log of logs) {
      // Check if this is an address dataset creation
      if (log.endpoint === '/api/address-datasets' && log.method === 'POST') {
        // Parse data field to extract address info
        let addressData: any = {};

        try {
          if (log.data) {
            addressData = JSON.parse(log.data);
          }
        } catch (e) {
          // Data might be stringified twice or malformed
          console.warn(`[ActivityLogBackup] Failed to parse data for log at ${log.timestamp}`);
        }

        potentialDatasets.push({
          address: log.address || addressData.normalizedAddress || 'Unknown',
          street: addressData.street,
          houseNumber: addressData.houseNumber,
          city: addressData.city,
          postalCode: addressData.postalCode,
          createdBy: log.username,
          timestamp: log.timestamp,
          endpoint: log.endpoint,
          rawData: addressData
        });
      }

      // Also check for address lookups (might indicate datasets being used)
      if (log.address && (
        log.endpoint.includes('/api/address') ||
        log.endpoint.includes('/api/residents')
      )) {
        potentialDatasets.push({
          address: log.address,
          createdBy: log.username,
          timestamp: log.timestamp,
          endpoint: log.endpoint,
          rawData: log.data ? JSON.parse(log.data) : undefined
        });
      }
    }

    console.log(`[ActivityLogBackup] Found ${potentialDatasets.length} potential datasets`);

    return { potentialDatasets };
  }
}

export const activityLogBackupService = new ActivityLogBackupService();
