import { google } from 'googleapis';
import type { LocationData } from '../../shared/externalTrackingTypes';
import { googleSheetsService } from './googleSheets';
import { batchLogger } from './batchLogger';
import { getBerlinDate, getBerlinTimestamp } from '../utils/timezone';
import { insertLog, getCETDate, type LogInsertData } from './sqliteLogService';

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
   * Erstellt ein neues Sheet (Tabellenblatt) für einen Nutzer, falls es noch nicht existiert
   */
  private async ensureUserSheetExists(userName: string): Promise<string> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    const normalizedUserName = this.normalizeUserName(userName);

    try {
      // Prüfe ob das Sheet bereits existiert
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.SHEET_ID,
      });

      const sheetExists = response.data.sheets?.some(
        (sheet: any) => sheet.properties?.title === normalizedUserName
      );

      if (!sheetExists) {
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
          'Device Unique ID',         // NEU: Eindeutige Geräte-ID
          'Device Serial Number',     // NEU: Hardware-Seriennummer
          'Is Connected',
          'Connection Type',
          'Received At' // Server-Zeitstempel
        ];

        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.SHEET_ID,
          range: `'${normalizedUserName}'!A1:T1`,
          valueInputOption: 'RAW',
          resource: {
            values: [headers]
          }
        });

        console.log(`[ExternalTrackingService] Added headers to sheet: ${normalizedUserName}`);
      }

      return normalizedUserName;
    } catch (error) {
      console.error(`[ExternalTrackingService] Error ensuring sheet exists for user ${userName}:`, error);
      throw error;
    }
  }

  /**
   * Speichert Location-Daten - entweder in Nutzer-Log oder als Fallback in Google Sheet
   */
  async saveLocationData(locationData: LocationData): Promise<void> {
    try {
      // Versuche, den Nutzer anhand des userName zu finden
      const user = await googleSheetsService.getUserByTrackingName(locationData.userName);

      if (user) {
        // Nutzer gefunden - schreibe in dessen Log
        console.log(`[ExternalTrackingService] Found user ${user.username} for tracking name "${locationData.userName}"`);

        // ✅ Verwende GPS-Timestamp aus dem Request-Body, NICHT Server-Zeit!
        const gpsTimestamp = getBerlinTimestamp(new Date(locationData.timestamp));
        
        // Debug: Check precision of received coordinates
        console.log(`[ExternalTrackingService] Received coordinates - lat: ${locationData.latitude} (type: ${typeof locationData.latitude}), lon: ${locationData.longitude} (type: ${typeof locationData.longitude})`);
        console.log(`[ExternalTrackingService] Coordinates as string: lat="${locationData.latitude.toString()}", lon="${locationData.longitude.toString()}"`);

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
            receivedAt: getBerlinTimestamp() // Optional: Server-Empfangszeit
          }
        };

        console.log(`[ExternalTrackingService] LogEntry data field:`, JSON.stringify(logEntry.data));

        // Schreibe in Nutzer-Log über batchLogger (Google Sheets)
        batchLogger.addUserActivity(logEntry);
        console.log(`[ExternalTrackingService] Added tracking data to user log for ${user.username} with GPS timestamp ${gpsTimestamp}`);

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
          // Don't throw - Google Sheets backup still works
        }
      } else {
        // Nutzer nicht gefunden - Fallback: schreibe in Google Sheet
        console.log(`[ExternalTrackingService] No user found for tracking name "${locationData.userName}" - writing to Google Sheet as fallback`);
        await this.saveToGoogleSheet(locationData);
      }
    } catch (error) {
      console.error('[ExternalTrackingService] Error saving location data:', error);
      // Bei Fehler auch Fallback zu Google Sheet
      console.log('[ExternalTrackingService] Falling back to Google Sheet due to error');
      await this.saveToGoogleSheet(locationData);
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
        receivedAt
      ];

      // Füge die Daten an das Ende des Sheets an
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `'${sheetName}'!A:T`,
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

      console.log(
        `[ExternalTrackingService] Found ${externalTrackingLogs.length} external tracking logs for ${username} on ${getBerlinDate(date)}`
      );
      return externalTrackingLogs;
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
}

// Exportiere eine Singleton-Instanz
export const externalTrackingService = new ExternalTrackingService();
