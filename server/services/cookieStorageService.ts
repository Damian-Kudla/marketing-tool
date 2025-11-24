/**
 * Cookie Storage Service
 *
 * Manages session cookies with:
 * - RAM-based storage for fast access
 * - 1-month expiration per cookie
 * - Automatic sync to Google Sheets "Cookies" sheet every 10 minutes
 * - Persistence across server restarts via Google Sheets
 * - Single "Cookies" sheet that mirrors the RAM database
 */

import { google } from 'googleapis';
import crypto from 'crypto';
import type { DeviceInfo } from '../../shared/trackingTypes';
import { getBerlinTimestamp } from '../utils/timezone';

interface CookieData {
  userId: string;
  password: string;
  username: string;
  isAdmin: boolean;
  createdAt: Date;
  expiresAt: Date;
  deviceInfo?: DeviceInfo;
}

interface UserCookies {
  userId: string;
  username: string;
  cookies: Array<{
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    isAdmin: boolean;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
  }>;
}

type RawSheet = {
  properties?: {
    sheetId?: number;
    title?: string;
  };
};

class CookieStorageService {
  // RAM storage: Map<sessionId, CookieData>
  private cookieStore = new Map<string, CookieData>();

  // Google Sheets configuration
  private sheetsClient: any = null;
  private spreadsheetId = process.env.GOOGLE_LOGS_SHEET_ID || '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
  private sheetName = 'Cookies';

  // Sync configuration
  private syncIntervalMs = 10 * 60 * 1000; // 10 minutes
  private syncIntervalHandle: NodeJS.Timeout | null = null;

  // Cookie expiration: 1 month
  private readonly COOKIE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor() {}

  /**
   * Initialize Google Sheets client
   */
  async initialize(): Promise<void> {
    try {
      // Use the same credential format as other Google Sheets services
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY;

      if (!credentialsJson) {
        console.warn('[CookieStorage] Warning: Google Sheets credentials not configured (GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_SHEETS_KEY)');
        return;
      }

      const credentials = JSON.parse(credentialsJson);

      if (!credentials.client_email || !credentials.private_key) {
        console.warn('[CookieStorage] Warning: Invalid Google Sheets credentials format');
        return;
      }

      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheetsClient = google.sheets({ version: 'v4', auth });

      console.log('[CookieStorage] Google Sheets client initialized');

      // Load existing cookies from Google Sheets
      await this.loadFromGoogleSheets();

      // Start automatic sync every 10 minutes
      this.startAutoSync();

    } catch (error) {
      console.error('[CookieStorage] Error initializing:', error);
    }
  }

  /**
   * Start automatic sync to Google Sheets every 10 minutes
   */
  private startAutoSync(): void {
    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
    }

    // Initial sync after 1 minute
    setTimeout(() => this.syncToGoogleSheets(), 60 * 1000);

    // Then every 10 minutes
    this.syncIntervalHandle = setInterval(() => {
      this.syncToGoogleSheets();
    }, this.syncIntervalMs);

    console.log('[CookieStorage] Auto-sync started (every 10 minutes)');
  }

  /**
   * Add or update a cookie
   */
  addCookie(sessionId: string, userId: string, password: string, username: string, isAdmin: boolean, deviceInfo?: DeviceInfo): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.COOKIE_LIFETIME_MS);

    this.cookieStore.set(sessionId, {
      userId,
      password,
      username,
      isAdmin,
      createdAt: now,
      expiresAt,
      deviceInfo
    });

    const deviceLog = deviceInfo ? ` on ${deviceInfo.deviceName} (${deviceInfo.deviceId})` : '';
    console.log(`[CookieStorage] Cookie added for user ${username}${deviceLog} (expires: ${getBerlinTimestamp(expiresAt)})`);
  }

  /**
   * Get cookie data
   */
  getCookie(sessionId: string): CookieData | null {
    const cookie = this.cookieStore.get(sessionId);

    if (!cookie) {
      return null;
    }

    // Check if cookie is expired
    if (new Date() > cookie.expiresAt) {
      this.cookieStore.delete(sessionId);
      console.log(`[CookieStorage] Expired cookie removed: ${sessionId}`);
      return null;
    }

    return cookie;
  }

  /**
   * Remove a cookie
   */
  removeCookie(sessionId: string): void {
    this.cookieStore.delete(sessionId);
    console.log(`[CookieStorage] Cookie removed: ${sessionId}`);
  }

  /**
   * Clean up expired cookies
   */
  cleanupExpiredCookies(): number {
    const now = new Date();
    let removedCount = 0;

    const expiredSessions: string[] = [];

    this.cookieStore.forEach((cookie, sessionId) => {
      if (now > cookie.expiresAt) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      this.cookieStore.delete(sessionId);
      removedCount++;
    });

    if (removedCount > 0) {
      console.log(`[CookieStorage] Cleaned up ${removedCount} expired cookies`);
    }

    return removedCount;
  }

  /**
   * Get all cookies for a specific user
   */
  getUserCookies(userId: string): string[] {
    const userCookies: string[] = [];

    this.cookieStore.forEach((cookie, sessionId) => {
      if (cookie.userId === userId) {
        userCookies.push(sessionId);
      }
    });

    return userCookies;
  }

  /**
   * Get all devices for a specific user
   */
  getUserDevices(userId: string): Array<{ sessionId: string; deviceInfo?: DeviceInfo; createdAt: Date; expiresAt: Date }> {
    const devices: Array<{ sessionId: string; deviceInfo?: DeviceInfo; createdAt: Date; expiresAt: Date }> = [];

    this.cookieStore.forEach((cookie, sessionId) => {
      if (cookie.userId === userId) {
        devices.push({
          sessionId,
          deviceInfo: cookie.deviceInfo,
          createdAt: cookie.createdAt,
          expiresAt: cookie.expiresAt
        });
      }
    });

    return devices;
  }

  /**
   * Sync cookies to Google Sheets (single "Cookies" sheet)
   */
  async syncToGoogleSheets(): Promise<void> {
    if (!this.sheetsClient) {
      console.log('[CookieStorage] Skipping sync - Sheets client not initialized');
      return;
    }

    try {
      // Clean up expired cookies first
      this.cleanupExpiredCookies();

      console.log('[CookieStorage] Starting sync to Google Sheets...');

      // Ensure "Cookies" sheet exists
      await this.ensureSheetExists();

      // Group cookies by user
      const userCookiesMap = new Map<string, UserCookies>();

      this.cookieStore.forEach((cookie, sessionId) => {
        if (!userCookiesMap.has(cookie.userId)) {
          userCookiesMap.set(cookie.userId, {
            userId: cookie.userId,
            username: cookie.username,
            cookies: []
          });
        }

        userCookiesMap.get(cookie.userId)!.cookies.push({
          sessionId,
          createdAt: getBerlinTimestamp(cookie.createdAt),
          expiresAt: getBerlinTimestamp(cookie.expiresAt),
          isAdmin: cookie.isAdmin,
          deviceId: cookie.deviceInfo?.deviceId,
          deviceName: cookie.deviceInfo?.deviceName,
          platform: cookie.deviceInfo?.platform
        });
      });

      // Prepare data for the sheet
      const rows: any[][] = [
        ['User ID', 'Username', 'Cookies (JSON)', 'Last Updated']
      ];

      userCookiesMap.forEach((userCookies) => {
        rows.push([
          userCookies.userId,
          userCookies.username,
          JSON.stringify(userCookies.cookies),
          getBerlinTimestamp()
        ]);
      });

      // Clear existing data and write new data
      await this.sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:D`
      });

      // Write data to sheet
      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: rows
        }
      });

      console.log(`[CookieStorage] Synced ${userCookiesMap.size} users to sheet: ${this.sheetName}`);

    } catch (error) {
      console.error('[CookieStorage] Error syncing to Google Sheets:', error);
    }
  }

  /**
   * Load cookies from the "Cookies" sheet
   */
  async loadFromGoogleSheets(): Promise<void> {
    if (!this.sheetsClient) {
      console.log('[CookieStorage] Skipping load - Sheets client not initialized');
      return;
    }

    try {
      console.log('[CookieStorage] Loading cookies from Google Sheets...');

      // Ensure "Cookies" sheet exists
      await this.ensureSheetExists();

      // Read data from the sheet
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A2:D` // Skip header row
      });

      const rows = response.data.values || [];
      let loadedCookies = 0;

      rows.forEach((row: any[]) => {
        if (row.length < 3) return;

        const userId = row[0];
        const username = row[1];
        const cookiesJson = row[2];

        try {
          const cookies = JSON.parse(cookiesJson);

          cookies.forEach((cookie: any) => {
            const expiresAt = new Date(cookie.expiresAt);

            // Only load cookies that haven't expired
            if (expiresAt > new Date()) {
              this.cookieStore.set(cookie.sessionId, {
                userId,
                password: '', // Password not stored in sheets for security
                username,
                isAdmin: cookie.isAdmin || false, // Load admin status from sheet
                createdAt: new Date(cookie.createdAt),
                expiresAt,
                deviceInfo: cookie.deviceId ? {
                  deviceId: cookie.deviceId,
                  deviceName: cookie.deviceName || 'Unknown Device',
                  platform: cookie.platform || 'Unknown',
                  userAgent: '',
                  screenResolution: ''
                } : undefined
              });
              loadedCookies++;
            }
          });
        } catch (error) {
          console.error(`[CookieStorage] Error parsing cookies for user ${username}:`, error);
        }
      });

      console.log(`[CookieStorage] Loaded ${loadedCookies} valid cookies from ${rows.length} users`);

    } catch (error) {
      console.error('[CookieStorage] Error loading from Google Sheets:', error);
    }
  }

  /**
   * Ensure the "Cookies" sheet exists in the spreadsheet
   */
  private async ensureSheetExists(): Promise<void> {
    try {
      const spreadsheet = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const sheets = (spreadsheet.data.sheets as RawSheet[]) || [];
      const sheetExists = sheets.some(
        sheet => sheet.properties?.title === this.sheetName
      );

      if (!sheetExists) {
        console.log(`[CookieStorage] Creating "${this.sheetName}" sheet...`);

        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: this.sheetName
                }
              }
            }]
          }
        });

        // Add header row
        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['User ID', 'Username', 'Cookies (JSON)', 'Last Updated']]
          }
        });

        console.log(`[CookieStorage] "${this.sheetName}" sheet created successfully`);
      }
    } catch (error) {
      console.error('[CookieStorage] Error ensuring sheet exists:', error);
      throw error;
    }
  }

  /**
   * Get statistics
   */
  getStats(): { totalCookies: number; activeUsers: number } {
    const userIds = new Set<string>();

    this.cookieStore.forEach(cookie => {
      userIds.add(cookie.userId);
    });

    return {
      totalCookies: this.cookieStore.size,
      activeUsers: userIds.size
    };
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
      console.log('[CookieStorage] Auto-sync stopped');
    }
  }
}

// Singleton instance
export const cookieStorageService = new CookieStorageService();
