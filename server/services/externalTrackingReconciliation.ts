import { google } from './googleApiWrapper';
import { googleSheetsService } from './googleSheets';
import { batchLogger } from './batchLogger';
import { getBerlinTimestamp } from '../utils/timezone';
import { initDB } from './sqliteLogService';
import path from 'path';
import fs from 'fs/promises';
// TODO: Implement uploadDatabase function in utils/googleDrive
// import { uploadDatabase } from '../utils/googleDrive';

/**
 * External Tracking Reconciliation Service
 *
 * Automatische Zuweisung von unzugeordneten Tracking-Daten aus der "Tracking App" Sheet.
 * 
 * Workflow:
 * 1. Lädt alle Tabellenblätter aus der "Tracking App" Sheet (1 Blatt = 1 Gerätename)
 * 2. Prüft für jeden Gerätenamen, ob er jetzt in Zugangsdaten Spalte F existiert
 * 3. Bei Match: Konvertiert GPS-Daten zu Log-Format und weist dem Nutzer zu
 * 4. Schreibt historische Daten in SQLite-DBs (gruppiert nach Datum)
 * 5. Schreibt aktuelle Daten (heute) in Google Sheets Log
 * 6. Löscht das Tabellenblatt nach erfolgreicher Zuordnung
 * 
 * Trigger-Punkte:
 * - Server-Start (vor Phase 1 der DB-Sync)
 * - Mitternacht-Cron (vor Archivierung)
 */

interface TrackingDataRow {
  timestamp: string; // ISO timestamp from GPS
  latitude: number;
  longitude: number;
}

interface ReconciliationStats {
  devicesProcessed: number;
  devicesAssigned: number;
  devicesRemaining: number;
  totalDataPoints: number;
  historicalDataPoints: number;
  currentDataPoints: number;
  errors: Array<{ deviceName: string; error: string }>;
}

class ExternalTrackingReconciliationService {
  private readonly TRACKING_APP_SHEET_ID = '1OspTbAfG6TM4SiUIHeRAF_QlODy3oHjubbiUTRGDo3Y';
  private sheetsClient: any = null;
  private sheetsEnabled = false;

  constructor() {
    this.initializeClient();
  }

  /**
   * Initialisiert den Google Sheets Client
   */
  private initializeClient() {
    try {
      const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';

      if (sheetsKey.startsWith('{')) {
        const credentials = JSON.parse(sheetsKey);

        if (credentials.client_email && credentials.private_key) {
          const auth = new google.auth.JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: [
              'https://www.googleapis.com/auth/spreadsheets.readonly',
              'https://www.googleapis.com/auth/spreadsheets'
            ],
          });

          this.sheetsClient = google.sheets({ version: 'v4', auth });
          this.sheetsEnabled = true;
          console.log('[ExternalTrackingReconciliation] Google Sheets API initialized');
        } else {
          console.warn('[ExternalTrackingReconciliation] Google service account credentials missing required fields');
        }
      } else {
        console.warn('[ExternalTrackingReconciliation] Google Sheets API disabled - invalid credentials format');
      }
    } catch (error) {
      console.error('[ExternalTrackingReconciliation] Failed to initialize Google Sheets client:', error);
    }
  }

  /**
   * Hauptfunktion: Lädt und verarbeitet alle unzugeordneten Tracking-Daten
   */
  async reconcileUnassignedTrackingData(): Promise<ReconciliationStats> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    const stats: ReconciliationStats = {
      devicesProcessed: 0,
      devicesAssigned: 0,
      devicesRemaining: 0,
      totalDataPoints: 0,
      historicalDataPoints: 0,
      currentDataPoints: 0,
      errors: []
    };

    try {
      console.log('[ExternalTrackingReconciliation] Starting reconciliation process...');

      // 1. Lade alle Tabellenblätter aus der "Tracking App" Sheet
      const worksheets = await this.getTrackingAppWorksheets();
      console.log(`[ExternalTrackingReconciliation] Found ${worksheets.length} device worksheets`);

      if (worksheets.length === 0) {
        console.log('[ExternalTrackingReconciliation] No unassigned tracking data found');
        return stats;
      }

      // Aktuelles Datum für heute/historisch-Unterscheidung
      const today = getBerlinTimestamp().split('T')[0]; // "2024-11-16"

      // 2. Verarbeite jedes Tabellenblatt (= 1 Gerät)
      for (const worksheet of worksheets) {
        stats.devicesProcessed++;
        const deviceName = worksheet.title;

        try {
          console.log(`[ExternalTrackingReconciliation] Processing device: "${deviceName}"`);

          // 3. Prüfe, ob Gerätename jetzt in Zugangsdaten existiert
          const user = await googleSheetsService.getUserByTrackingName(deviceName);

          if (!user) {
            console.log(`[ExternalTrackingReconciliation] No user found for device "${deviceName}" - keeping worksheet`);
            stats.devicesRemaining++;
            continue; // Blatt behalten, noch nicht zuordenbar
          }

          console.log(`[ExternalTrackingReconciliation] ✅ Found user ${user.username} (${user.userId}) for device "${deviceName}"`);

          // 4. Lade GPS-Daten aus dem Tabellenblatt
          const trackingData = await this.getTrackingDataFromWorksheet(deviceName);

          if (trackingData.length === 0) {
            console.log(`[ExternalTrackingReconciliation] No data in worksheet "${deviceName}" - skipping`);
            stats.devicesRemaining++;
            continue;
          }

          console.log(`[ExternalTrackingReconciliation] Loaded ${trackingData.length} GPS points from "${deviceName}"`);
          stats.totalDataPoints += trackingData.length;

          // 5. Gruppiere Daten nach Datum (für SQLite-Insertion)
          const dataByDate = this.groupDataByDate(trackingData);
          console.log(`[ExternalTrackingReconciliation] Data spans ${dataByDate.size} different dates`);

          // 6. Verarbeite historische Daten (SQLite)
          const modifiedDatabases = new Set<string>(); // Geänderte DBs für Upload

          for (const [date, dataPoints] of Array.from(dataByDate)) {
            if (date === today) {
              // Heutige Daten → Google Sheets Log (über batchLogger)
              console.log(`[ExternalTrackingReconciliation] Processing ${dataPoints.length} points for TODAY (${date})`);
              await this.assignDataToUserLog(user.userId, user.username, dataPoints);
              stats.currentDataPoints += dataPoints.length;
            } else {
              // Historische Daten → SQLite
              console.log(`[ExternalTrackingReconciliation] Processing ${dataPoints.length} points for PAST date (${date})`);
              await this.assignDataToSQLite(user.username, date, dataPoints);
              modifiedDatabases.add(date);
              stats.historicalDataPoints += dataPoints.length;
            }
          }

          // 7. Upload geänderte SQLite-DBs zu Google Drive
          // TODO: Implement uploadDatabase function
          /*
          for (const date of modifiedDatabases) {
            const dbPath = path.join(process.cwd(), 'databases', `daily_${date}.db`);
            const exists = await fs.access(dbPath).then(() => true).catch(() => false);

            if (exists) {
              console.log(`[ExternalTrackingReconciliation] Uploading modified database for ${date}...`);
              try {
                await uploadDatabase(date, dbPath);
                console.log(`[ExternalTrackingReconciliation] ✅ Successfully uploaded database for ${date}`);
              } catch (uploadError) {
                console.error(`[ExternalTrackingReconciliation] ❌ Failed to upload database for ${date}:`, uploadError);
                stats.errors.push({
                  deviceName,
                  error: `Failed to upload database for ${date}: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`
                });
              }
            }
          }
          */
          console.log(`[ExternalTrackingReconciliation] Skipped database upload (not implemented) for ${modifiedDatabases.size} dates`);

          // 8. Lösche das Tabellenblatt nach erfolgreicher Zuordnung
          await this.deleteWorksheet(worksheet.sheetId);
          console.log(`[ExternalTrackingReconciliation] ✅ Deleted worksheet "${deviceName}" after successful assignment`);

          stats.devicesAssigned++;
        } catch (error) {
          console.error(`[ExternalTrackingReconciliation] Error processing device "${deviceName}":`, error);
          stats.errors.push({
            deviceName,
            error: error instanceof Error ? error.message : String(error)
          });
          stats.devicesRemaining++;
        }
      }

      console.log('[ExternalTrackingReconciliation] Reconciliation complete:', {
        devicesProcessed: stats.devicesProcessed,
        devicesAssigned: stats.devicesAssigned,
        devicesRemaining: stats.devicesRemaining,
        totalDataPoints: stats.totalDataPoints,
        historicalDataPoints: stats.historicalDataPoints,
        currentDataPoints: stats.currentDataPoints,
        errors: stats.errors.length
      });

      return stats;
    } catch (error) {
      console.error('[ExternalTrackingReconciliation] Fatal error during reconciliation:', error);
      throw error;
    }
  }

  /**
   * Lädt alle Tabellenblätter aus der "Tracking App" Sheet
   */
  private async getTrackingAppWorksheets(): Promise<Array<{ title: string; sheetId: number }>> {
    try {
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.TRACKING_APP_SHEET_ID,
      });

      const worksheets = response.data.sheets
        ?.map((sheet: any) => ({
          title: sheet.properties?.title || '',
          sheetId: sheet.properties?.sheetId || 0
        }))
        .filter((ws: any) => ws.title && ws.title !== 'Sheet1'); // Ignoriere Default-Sheet

      return worksheets || [];
    } catch (error) {
      console.error('[ExternalTrackingReconciliation] Error fetching worksheets:', error);
      throw error;
    }
  }

  /**
   * Lädt GPS-Daten aus einem Tabellenblatt
   * Format: Timestamp\tLatitude\tLongitude (Tab-separated)
   */
  private async getTrackingDataFromWorksheet(worksheetName: string): Promise<TrackingDataRow[]> {
    try {
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.TRACKING_APP_SHEET_ID,
        range: `'${worksheetName}'!A:C`, // Timestamp, Latitude, Longitude
      });

      const rows = response.data.values || [];
      const trackingData: TrackingDataRow[] = [];

      for (const row of rows) {
        // Skip Header-Zeile und leere Zeilen
        if (!row[0] || row[0] === 'Timestamp') continue;

        const timestamp = row[0]?.trim();

        // Google Sheets kann Zahlen mit Komma als Dezimaltrennzeichen zurückgeben (europäisches Format)
        // parseFloat() erwartet Punkt als Dezimaltrennzeichen
        const latitudeStr = String(row[1] || '').replace(',', '.');
        const longitudeStr = String(row[2] || '').replace(',', '.');

        const latitude = parseFloat(latitudeStr);
        const longitude = parseFloat(longitudeStr);

        // Validierung
        if (!timestamp || isNaN(latitude) || isNaN(longitude)) {
          console.warn(`[ExternalTrackingReconciliation] Invalid row in "${worksheetName}":`, row);
          console.warn(`[ExternalTrackingReconciliation] Raw values: lat="${row[1]}", lon="${row[2]}", parsed: lat=${latitude}, lon=${longitude}`);
          continue;
        }

        trackingData.push({ timestamp, latitude, longitude });
      }

      return trackingData;
    } catch (error) {
      console.error(`[ExternalTrackingReconciliation] Error reading worksheet "${worksheetName}":`, error);
      throw error;
    }
  }

  /**
   * Gruppiert GPS-Daten nach Datum
   */
  private groupDataByDate(trackingData: TrackingDataRow[]): Map<string, TrackingDataRow[]> {
    const dataByDate = new Map<string, TrackingDataRow[]>();

    for (const dataPoint of trackingData) {
      const date = dataPoint.timestamp.split('T')[0]; // "2024-11-16"
      
      if (!dataByDate.has(date)) {
        dataByDate.set(date, []);
      }
      
      dataByDate.get(date)!.push(dataPoint);
    }

    return dataByDate;
  }

  /**
   * Schreibt heutige Daten in Google Sheets User-Log (über batchLogger)
   */
  private async assignDataToUserLog(
    userId: string,
    username: string,
    dataPoints: TrackingDataRow[]
  ): Promise<void> {
    for (const dataPoint of dataPoints) {
      const logEntry = {
        timestamp: getBerlinTimestamp(new Date(dataPoint.timestamp)),
        userId,
        username,
        endpoint: '/api/external-tracking/location',
        method: 'POST',
        address: '',
        newProspects: [],
        existingCustomers: [],
        userAgent: 'External Tracking App',
        data: {
          latitude: dataPoint.latitude,
          longitude: dataPoint.longitude,
          timestamp: dataPoint.timestamp,
          source: 'external_app' // Markierung für externe Daten
        }
      };

      batchLogger.addUserActivity(logEntry);
    }

    console.log(`[ExternalTrackingReconciliation] Added ${dataPoints.length} GPS points to batchLogger for ${username}`);
  }

  /**
   * Schreibt historische Daten direkt in SQLite-DB
   */
  private async assignDataToSQLite(
    username: string,
    date: string, // "2024-11-16"
    dataPoints: TrackingDataRow[]
  ): Promise<void> {
    const dbPath = path.join(process.cwd(), 'databases', `daily_${date}.db`);

    // Erstelle DB falls sie nicht existiert
    const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
    
    if (!dbExists) {
      console.log(`[ExternalTrackingReconciliation] Creating new database for ${date}...`);
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
    }

    // Öffne DB (wird erstellt falls nicht vorhanden)
    const dbInstance = initDB(date);

    // Erstelle Tabelle falls nicht vorhanden (better-sqlite3 ist synchron)
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        username TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        address TEXT,
        newProspects TEXT,
        existingCustomers TEXT,
        userAgent TEXT,
        data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Füge alle GPS-Punkte ein
    const stmt = dbInstance.prepare(`
      INSERT INTO logs (timestamp, username, endpoint, method, address, newProspects, existingCustomers, userAgent, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const dataPoint of dataPoints) {
      const logData = {
        latitude: dataPoint.latitude,
        longitude: dataPoint.longitude,
        timestamp: dataPoint.timestamp,
        source: 'external_app'
      };

      stmt.run(
        getBerlinTimestamp(new Date(dataPoint.timestamp)), // timestamp
        username,                                            // username
        '/api/external-tracking/location',                   // endpoint
        'POST',                                              // method
        '',                                                  // address
        '',                                                  // newProspects
        '',                                                  // existingCustomers
        'External Tracking App',                             // userAgent
        JSON.stringify(logData)                              // data
      );
    }

    console.log(`[ExternalTrackingReconciliation] Inserted ${dataPoints.length} GPS points into SQLite for ${username} on ${date}`);
  }

  /**
   * Löscht ein Tabellenblatt aus der "Tracking App" Sheet
   */
  private async deleteWorksheet(sheetId: number): Promise<void> {
    try {
      await this.sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: this.TRACKING_APP_SHEET_ID,
        resource: {
          requests: [{
            deleteSheet: {
              sheetId
            }
          }]
        }
      });

      console.log(`[ExternalTrackingReconciliation] Deleted worksheet with sheetId ${sheetId}`);
    } catch (error) {
      console.error('[ExternalTrackingReconciliation] Error deleting worksheet:', error);
      throw error;
    }
  }

  /**
   * Gibt den Status des Services zurück
   */
  getStatus(): { enabled: boolean; sheetId: string } {
    return {
      enabled: this.sheetsEnabled,
      sheetId: this.TRACKING_APP_SHEET_ID
    };
  }
}

// Exportiere eine Singleton-Instanz
export const externalTrackingReconciliationService = new ExternalTrackingReconciliationService();
