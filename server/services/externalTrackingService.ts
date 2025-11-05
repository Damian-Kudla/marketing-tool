import { google } from 'googleapis';
import type { LocationData } from '../../shared/externalTrackingTypes';

/**
 * External Tracking Service
 *
 * Verwaltet das Speichern von Location-Daten aus der externen Tracking-App
 * in Google Sheets. Jeder Nutzer erhält ein eigenes Tabellenblatt.
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
          'Is Connected',
          'Connection Type',
          'Received At' // Server-Zeitstempel
        ];

        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.SHEET_ID,
          range: `'${normalizedUserName}'!A1:R1`,
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
   * Speichert Location-Daten in das entsprechende Nutzer-Sheet
   */
  async saveLocationData(locationData: LocationData): Promise<void> {
    if (!this.sheetsEnabled || !this.sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      // Stelle sicher, dass ein Sheet für diesen Nutzer existiert
      const sheetName = await this.ensureUserSheetExists(locationData.userName);

      // Bereite die Daten-Zeile vor
      const receivedAt = new Date().toISOString();
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
        locationData.isConnected,
        locationData.connectionType ?? '',
        receivedAt
      ];

      // Füge die Daten an das Ende des Sheets an
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `'${sheetName}'!A:R`,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      console.log(`[ExternalTrackingService] Successfully saved location data for user: ${locationData.userName}`);
    } catch (error) {
      console.error('[ExternalTrackingService] Error saving location data:', error);
      throw error;
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