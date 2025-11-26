import { google } from './googleApiWrapper';
import type { LocationData } from '../../shared/externalTrackingTypes';
import type { GPSCoordinates } from '../../shared/trackingTypes';
import { googleSheetsService } from './googleSheets';
import { batchLogger } from './batchLogger';
import { dailyDataStore } from './dailyDataStore';
import { getBerlinDate, getBerlinTimestamp } from '../utils/timezone';
import { insertLog, getCETDate, getUserLogs, type LogInsertData } from './sqliteLogService';

/**
 * External Tracking Service
 *
 * Verwaltet das Speichern von Location-Daten aus der externen Tracking-App.
 * - Ordnet Tracking-Daten anhand des userName dem entsprechenden Nutzer zu
 * - Schreibt die Daten in das Nutzer-Log (über batchLogger)
 * - Fallback: Bei unbekanntem Nutzer wird in Google Sheet geschrieben
 */
class ExternalTrackingService {
  private readonly SHEET_ID = '1OspTbAfG6TM4SiUIHeRAF_QlODy3oHjubbiUTRGDo3Y';
  private sheetsClient: any = null;
  private sheetsEnabled = false;
  private locationBuffer: LocationData[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private knownSheets: Set<string> = new Set();
  private sheetsLoaded = false;

  constructor() {
    this.initializeClient();
    // Flush buffer every minute to avoid rate limits
    this.flushInterval = setInterval(() => this.flushBuffer(), 60 * 1000);
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
          console.log('[ExternalTrackingService] Google Sheets API initialized successfully');
        } else {
          console.warn('[ExternalTrackingService] Google service account credentials missing required fields');
        }
      } else {
        console.warn('[ExternalTrackingService] Google Sheets API disabled - invalid credentials format');
      }
    } catch (error) {
      console.error('[ExternalTrackingService] Failed to initialize Google Sheets client:', error);
      console.warn('[ExternalTrackingService] External tracking functionality disabled');
    }
  }

  /**
   * Normalisiert den Nutzernamen für die Verwendung als Sheet-Name
   * (entfernt ungültige Zeichen für Google Sheets Tab-Namen)
   */
  private normalizeUserName(userName: string): string {
    // Google Sheets erlaubt keine folgenden Zeichen in Tab-Namen: [ ] * ? : / \
    // Maximale Länge: 100 Zeichen
    return userName
      .replace(/[\[\]\*\?:\/\\]/g, '_')
      .substring(0, 100)
      .trim();
  }

  /**
   * Lädt alle existierenden Sheet-Namen einmalig, um Read-Requests zu sparen
   */
  private async loadExistingSheets(): Promise<void> {
    if (!this.sheetsEnabled || !this.sheetsClient) return;
    
    try {
      console.log('[ExternalTrackingService] Pre-loading existing sheets to cache...');
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.SHEET_ID,
        fields: 'sheets.properties.title'
      });

      if (response.data.sheets) {
        response.data.sheets.forEach((sheet: any) => {
          if (sheet.properties?.title) {
            this.knownSheets.add(sheet.properties.title);
          }
        });
      }
      this.sheetsLoaded = true;
      console.log(`[ExternalTrackingService] Successfully cached ${this.knownSheets.size} existing sheets`);
    } catch (error) {
      console.error('[ExternalTrackingService] Failed to pre-load sheets:', error);
      // Bei Fehler nicht auf true setzen, damit wir es später nochmal versuchen können
    }
  }

  /**
   * Erstellt ein neues Sheet (Tabellenblatt) für einen Nutzer, falls es noch nicht existiert
   */
  private async ensureUserSheetExists(userName: string): Promise<string> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    const normalizedUserName = this.normalizeUserName(userName);

    // Check cache first
    if (this.knownSheets.has(normalizedUserName)) {
      return normalizedUserName;
    }

    // Optimization: Load all sheets once if not yet loaded
    if (!this.sheetsLoaded) {
      await this.loadExistingSheets();
      // Check cache again after loading
      if (this.knownSheets.has(normalizedUserName)) {
        return normalizedUserName;
      }
    }

    try {
      // Erstelle das Sheet
      await this.sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: this.SHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: normalizedUserName,
              }
            }
          }]
        }
      });

      console.log(`[ExternalTrackingService] Created new sheet for user: ${normalizedUserName}`);

      // Füge Header-Zeile hinzu
      const headers = [
        'Timestamp',
        'Latitude',
        'Longitude',
        'Altitude',
        'Accuracy',
        'Altitude Accuracy',
        'Heading',
        'Speed',
        'User Name',
        'Battery Level',
        'Battery State',
        'Is Charging',
        'Device Name',
        'Device Model',
        'OS Version',
        'Device Unique ID',
        'Device Serial Number',
        'Is Connected',
        'Connection Type',
        'Received At',
        'App Version'
      ];

      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.SHEET_ID,
        range: `'${normalizedUserName}'!A1:U1`,
        valueInputOption: 'RAW',
        resource: {
          values: [headers]
        }
      });

      console.log(`[ExternalTrackingService] Added headers to sheet: ${normalizedUserName}`);
      this.knownSheets.add(normalizedUserName);

      return normalizedUserName;
    } catch (error) {
      console.error(`[ExternalTrackingService] Error ensuring sheet exists for user ${userName}:`, error);
      throw error;
    }
  }

  /**
   * Prüft, ob GPS-Koordinaten gültig sind (nicht 0 oder nahe 0)
   */
  private isValidGPSCoordinate(lat: number, lng: number): boolean {
    // Reject lat=0 or lng=0 (GPS not ready) or near-zero values
    const isValidLat = typeof lat === 'number' && 
                       Number.isFinite(lat) && 
                       lat >= -90 && lat <= 90 && 
                       Math.abs(lat) > 0.001;
    const isValidLng = typeof lng === 'number' && 
                       Number.isFinite(lng) && 
                       lng >= -180 && lng <= 180 && 
                       Math.abs(lng) > 0.001;
    return isValidLat && isValidLng;
  }

  /**
   * Speichert Location-Daten - entweder in Nutzer-Log oder als Fallback in Google Sheet
   */
  async saveLocationData(locationData: LocationData): Promise<void> {
    // CRITICAL: Validate GPS coordinates BEFORE any logging
    if (!this.isValidGPSCoordinate(locationData.latitude, locationData.longitude)) {
      console.warn(`[ExternalTrackingService] ⚠️ REJECTED invalid GPS: lat=${locationData.latitude}, lng=${locationData.longitude} from ${locationData.userName} - NOT logging`);
      return; // Don't log, don't buffer, just reject silently
    }

    try {
      // Versuche, den Nutzer anhand des userName zu finden
      const user = await googleSheetsService.getUserByTrackingName(locationData.userName);

      if (user) {
        await this.saveLocationDataForKnownUser(user, locationData);
      } else {
        // Nutzer nicht gefunden - Fallback: Buffer für Batch-Write
        console.log(`[ExternalTrackingService] No user found for tracking name "${locationData.userName}" - buffering for batch write`);
        this.locationBuffer.push(locationData);
      }
    } catch (error) {
      console.error('[ExternalTrackingService] Error saving location data:', error);
      // Bei Fehler auch Fallback zu Buffer
      console.log('[ExternalTrackingService] Buffering data due to error');
      this.locationBuffer.push(locationData);
    }
  }

  /**
   * Speichert einen Batch von Location-Daten
   */
  async saveBatchLocationData(batchData: LocationData[]): Promise<void> {
    // CRITICAL: Filter out invalid GPS coordinates BEFORE any processing/logging
    const originalCount = batchData.length;
    batchData = batchData.filter(data => this.isValidGPSCoordinate(data.latitude, data.longitude));
    const filteredCount = originalCount - batchData.length;
    
    if (filteredCount > 0) {
      console.warn(`[ExternalTrackingService] ⚠️ REJECTED ${filteredCount} invalid GPS points from batch (lat=0 or lng=0) - NOT logging`);
    }

    if (batchData.length === 0) {
      console.log('[ExternalTrackingService] Batch completely filtered - no valid GPS points');
      return;
    }

    // Gruppiere nach User, um effizient zu verarbeiten
    const userBatches = new Map<string, LocationData[]>();

    for (const data of batchData) {
      if (!data.userName) continue;
      const existing = userBatches.get(data.userName) || [];
      existing.push(data);
      userBatches.set(data.userName, existing);
    }

    for (const [userName, locations] of Array.from(userBatches)) {
      try {
        const user = await googleSheetsService.getUserByTrackingName(userName);

        if (user) {
          // User gefunden - verarbeite jeden Punkt einzeln für Logs/SQLite/DailyStore
          console.log(`[ExternalTrackingService] Processing batch of ${locations.length} points for user ${user.username}`);
          
          // Sortiere nach Timestamp, um korrekte Reihenfolge sicherzustellen
          locations.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          for (const locationData of locations) {
             await this.saveLocationDataForKnownUser(user, locationData);
          }
        } else {
          // Fallback: Buffer batch
          console.log(`[ExternalTrackingService] No user found for "${userName}" - buffering batch`);
          this.locationBuffer.push(...locations);
        }
      } catch (error) {
        console.error(`[ExternalTrackingService] Error processing batch for user ${userName}:`, error);
        // Fallback for this user's batch
        this.locationBuffer.push(...locations);
      }
    }
  }

  /**
   * Interne Methode zum Speichern für einen bekannten Nutzer
   */
  private async saveLocationDataForKnownUser(user: any, locationData: LocationData): Promise<void> {
    // Nutzer gefunden - schreibe in dessen Log
    console.log(`[ExternalTrackingService] Found user ${user.username} for tracking name "${locationData.userName}"`);

    // ✅ Verwende GPS-Timestamp aus dem Request-Body, NICHT Server-Zeit!
    const gpsTimestamp = getBerlinTimestamp(new Date(locationData.timestamp));
    
    // Erstelle Log-Eintrag mit GPS-Daten im data-Feld
    const logEntry = {
      timestamp: gpsTimestamp, // ✅ GPS-Zeit verwenden
      userId: user.userId,
      username: user.username,
      endpoint: '/api/external-tracking/location',
      method: 'POST',
      userAgent: 'External Tracking App',
      data: {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        timestamp: locationData.timestamp,
        source: 'external_app', // Markierung für spätere Auswertung
        receivedAt: getBerlinTimestamp(), // Optional: Server-Empfangszeit
        appVersion: locationData.appVersion // NEU: App-Version
      }
    };

    // Schreibe in Nutzer-Log über batchLogger (Google Sheets)
    batchLogger.addUserActivity(logEntry);
    console.log(`[ExternalTrackingService] Added tracking data to user log for ${user.username} with GPS timestamp ${gpsTimestamp}`);

    // CRITICAL: Update DailyDataStore for live view
    try {
      const gpsCoords: GPSCoordinates = {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy || 0,
        altitude: locationData.altitude ?? undefined,
        altitudeAccuracy: locationData.altitudeAccuracy ?? undefined,
        heading: locationData.heading ?? undefined,
        speed: locationData.speed ?? undefined,
        timestamp: new Date(locationData.timestamp).getTime(),
        source: 'external_app'
      };
      
      dailyDataStore.addGPS(user.userId, user.username, gpsCoords);
    } catch (error) {
      console.error('[ExternalTrackingService] ❌ Error updating DailyStore:', error);
    }

    // CRITICAL: AUCH SQLite schreiben (verhindert Datenverlust)
    try {
      const date = getCETDate(new Date(locationData.timestamp).getTime());
      const sqliteLog: LogInsertData = {
        userId: user.userId,
        username: user.username,
        timestamp: new Date(locationData.timestamp).getTime(),
        logType: 'gps', // External GPS ist immer GPS
        data: logEntry.data
      };

      const inserted = insertLog(date, sqliteLog);
      if (inserted) {
        console.log(`[ExternalTrackingService] ✅ Written to SQLite for ${user.username} on ${date}`);
      } else {
        console.log(`[ExternalTrackingService] ℹ️  Duplicate entry in SQLite (already exists)`);
      }
    } catch (error) {
      console.error('[ExternalTrackingService] ❌ Error writing to SQLite:', error);
    }
  }

  /**
   * Fallback: Speichert einen Batch von Location-Daten in das entsprechende Google Sheet
   */
  private async saveBatchToGoogleSheet(userName: string, locations: LocationData[]): Promise<void> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      // Stelle sicher, dass ein Sheet für diesen Nutzer existiert
      const sheetName = await this.ensureUserSheetExists(userName);

      // Bereite die Daten-Zeilen vor
      const receivedAt = getBerlinTimestamp();
      const rows = locations.map(locationData => [
        locationData.timestamp,
        locationData.latitude,
        locationData.longitude,
        locationData.altitude ?? '',
        locationData.accuracy ?? '',
        locationData.altitudeAccuracy ?? '',
        locationData.heading ?? '',
        locationData.speed ?? '',
        locationData.userName,
        locationData.batteryLevel ?? '',
        locationData.batteryState ?? '',
        locationData.isCharging,
        locationData.deviceName ?? '',
        locationData.deviceModel ?? '',
        locationData.osVersion ?? '',
        locationData.deviceUniqueId ?? '',
        locationData.deviceSerialNumber ?? '',
        locationData.isConnected,
        locationData.connectionType ?? '',
        receivedAt,
        locationData.appVersion ?? ''
      ]);

      // Füge die Daten an das Ende des Sheets an
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `'${sheetName}'!A:U`,
        valueInputOption: 'RAW',
        resource: {
          values: rows
        }
      });

      console.log(`[ExternalTrackingService] Successfully saved batch of ${rows.length} locations to Google Sheet for: ${userName}`);
    } catch (error) {
      console.error('[ExternalTrackingService] Error saving batch to Google Sheet:', error);
      throw error;
    }
  }

  /**
   * Fallback: Speichert Location-Daten in das entsprechende Google Sheet
   */
  private async saveToGoogleSheet(locationData: LocationData): Promise<void> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      // Stelle sicher, dass ein Sheet für diesen Nutzer existiert
      const sheetName = await this.ensureUserSheetExists(locationData.userName);

      // Bereite die Daten-Zeile vor
      const receivedAt = getBerlinTimestamp();
      const rowData = [
        locationData.timestamp,
        locationData.latitude,
        locationData.longitude,
        locationData.altitude ?? '',
        locationData.accuracy ?? '',
        locationData.altitudeAccuracy ?? '',
        locationData.heading ?? '',
        locationData.speed ?? '',
        locationData.userName,
        locationData.batteryLevel ?? '',
        locationData.batteryState ?? '',
        locationData.isCharging,
        locationData.deviceName ?? '',
        locationData.deviceModel ?? '',
        locationData.osVersion ?? '',
        locationData.deviceUniqueId ?? '',      // NEU: Abwärtskompatibel
        locationData.deviceSerialNumber ?? '',  // NEU: Abwärtskompatibel
        locationData.isConnected,
        locationData.connectionType ?? '',
        receivedAt,
        locationData.appVersion ?? '' // NEU: App-Version
      ];

      // Füge die Daten an das Ende des Sheets an
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `'${sheetName}'!A:U`, // Range erweitert auf U (21 Spalten)
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      console.log(`[ExternalTrackingService] Successfully saved location data to Google Sheet for: ${locationData.userName}`);
    } catch (error) {
      console.error('[ExternalTrackingService] Error saving to Google Sheet:', error);
      throw error;
    }
  }

  /**
   * Lädt externe Tracking-Daten für einen Nutzer aus dessen User-Log
   * Filtert nur Einträge mit source: 'external_app' im data-Feld
   */
  async getExternalTrackingDataFromUserLog(username: string, date: Date): Promise<Array<{
    timestamp: string;
    latitude: number;
    longitude: number;
  }>> {
    try {
      const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');

      // Lade alle Logs für den User an diesem Tag
      const userLogs = await GoogleSheetsLoggingService.getUserLogsForDate(username, date);

      // Filtere nur externe Tracking-Daten
      const externalTrackingLogs = userLogs
        .filter(log => {
          try {
            const data = typeof log.data === 'string' ? JSON.parse(log.data) : log.data;
            return data && data.source === 'external_app';
          } catch {
            return false;
          }
        })
        .map(log => {
          const data = typeof log.data === 'string' ? JSON.parse(log.data) : log.data;
          return {
            timestamp: data.timestamp || log.timestamp,
            latitude: data.latitude,
            longitude: data.longitude
          };
        })
        .filter(item =>
          typeof item.latitude === 'number' &&
          typeof item.longitude === 'number'
        );

      // Additionally, try to load entries from local SQLite daily DB (in case ingestion wrote there)
      let sqliteExternal: Array<{ timestamp: string; latitude: number; longitude: number }> = [];
      try {
        const users = await googleSheetsService.getAllUsers();
        const user = users.find(u => u.username === username);

        if (user && user.userId) {
          const dateStr = getCETDate(date.getTime());
          const sqliteLogs = getUserLogs(dateStr, user.userId);

          sqliteExternal = sqliteLogs
            .filter(l => l.logType === 'gps' && l.data && l.data.source === 'external_app')
            .map(l => ({
              timestamp: l.data.timestamp || l.timestamp,
              latitude: l.data.latitude,
              longitude: l.data.longitude
            }))
            .filter(item => typeof item.latitude === 'number' && typeof item.longitude === 'number');
        }
      } catch (err) {
        console.error('[ExternalTrackingService] Error loading external logs from SQLite:', err);
      }

      // Merge and dedupe by timestamp+lat+lon
      const combined = [...externalTrackingLogs, ...sqliteExternal];
      const map = new Map<string, { timestamp: string; latitude: number; longitude: number }>();
      for (const it of combined) {
        const key = `${it.timestamp}-${it.latitude}-${it.longitude}`;
        if (!map.has(key)) map.set(key, it);
      }

      const merged = Array.from(map.values()).sort((a, b) => {
        const ta = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : Number(a.timestamp);
        const tb = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : Number(b.timestamp);
        return ta - tb;
      });

      console.log(`[ExternalTrackingService] Found ${merged.length} external tracking logs for ${username} on ${getBerlinDate(date)} (sheets: ${externalTrackingLogs.length}, sqlite: ${sqliteExternal.length})`);
      return merged;
    } catch (error) {
      console.error('[ExternalTrackingService] Error loading external tracking data from user log:', error);
      return [];
    }
  }

  /**
   * Gibt den Status des Services zurück
   */
  getStatus(): { enabled: boolean; sheetId: string } {
    return {
      enabled: this.sheetsEnabled,
      sheetId: this.SHEET_ID
    };
  }

  /**
   * Flushes the buffered location data to Google Sheets
   */
  private async flushBuffer(): Promise<void> {
    if (this.locationBuffer.length === 0) return;

    console.log(`[ExternalTrackingService] Flushing ${this.locationBuffer.length} buffered locations to Google Sheets...`);
    
    // Copy and clear buffer immediately to handle new incoming data
    let bufferToProcess = [...this.locationBuffer];
    this.locationBuffer = [];

    // CRITICAL: Filter out invalid GPS coordinates before writing to Google Sheets
    const originalCount = bufferToProcess.length;
    bufferToProcess = bufferToProcess.filter(data => this.isValidGPSCoordinate(data.latitude, data.longitude));
    const filteredCount = originalCount - bufferToProcess.length;
    
    if (filteredCount > 0) {
      console.warn(`[ExternalTrackingService] ⚠️ Filtered ${filteredCount} invalid GPS points from buffer before flush`);
    }

    if (bufferToProcess.length === 0) {
      console.log('[ExternalTrackingService] Buffer completely filtered - no valid GPS points to flush');
      return;
    }

    // Group by user
    const userBatches = new Map<string, LocationData[]>();
    for (const data of bufferToProcess) {
      if (!data.userName) continue;
      const existing = userBatches.get(data.userName) || [];
      existing.push(data);
      userBatches.set(data.userName, existing);
    }

    // Process each user batch
    for (const [userName, locations] of Array.from(userBatches)) {
      try {
        console.log(`[ExternalTrackingService] Writing batch of ${locations.length} locations for unknown user "${userName}"`);
        await this.saveBatchToGoogleSheet(userName, locations);
      } catch (error) {
        console.error(`[ExternalTrackingService] Error flushing buffer for user ${userName}:`, error);
        // Optional: Re-add to buffer? For now, we just log error to avoid infinite loops
      }
    }
  }
}

// Exportiere eine Singleton-Instanz
export const externalTrackingService = new ExternalTrackingService();
