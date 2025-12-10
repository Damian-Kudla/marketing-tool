/**
 * Cookie Storage Service
 *
 * Manages session cookies with:
 * - RAM-based storage for fast access
 * - Local SQLite storage for persistence (PRIMARY)
 * - 1-month expiration per cookie
 * - Automatic sync to Google Sheets "Cookies" sheet every 10 minutes
 * - Persistence across server restarts via SQLite + Google Sheets
 */

import { google } from './googleApiWrapper';
import crypto from 'crypto';
import type { DeviceInfo } from '../../shared/trackingTypes';
import { getBerlinTimestamp } from '../utils/timezone';
import { cookiesDB } from './systemDatabaseService';

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
  // IMPORTANT: Use SYSTEM_SHEET for Cookies (separate from user logs to avoid 10M limit)
  private spreadsheetId = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';
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

    // CRITICAL: Save to SQLite FIRST (persistence layer)
    try {
      cookiesDB.upsert({
        sessionId,
        userId,
        username,
        isAdmin,
        createdAt: now.getTime(),
        expiresAt: expiresAt.getTime(),
        deviceId: deviceInfo?.deviceId,
        deviceName: deviceInfo?.deviceName,
        platform: deviceInfo?.platform,
        userAgent: deviceInfo?.userAgent
      });
    } catch (error) {
      console.error(`[CookieStorage] CRITICAL: Failed to save cookie to SQLite, aborting:`, error);
      throw new Error(`Failed to persist session: ${error}`);
    }

    // Only add to RAM if SQLite succeeded
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
   * Remove a cookie (atomic: SQLite first, then RAM)
   */
  removeCookie(sessionId: string): void {
    // CRITICAL: Remove from SQLite FIRST (persistence layer)
    try {
      cookiesDB.delete(sessionId);
    } catch (error) {
      console.error(`[CookieStorage] CRITICAL: Failed to remove cookie from SQLite, aborting:`, error);
      throw new Error(`Failed to delete session: ${error}`);
    }

    // Only remove from RAM if SQLite succeeded
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

    // Also cleanup expired in SQLite
    try {
      const sqliteDeleted = cookiesDB.deleteExpired();
      if (sqliteDeleted > 0) {
        console.log(`[CookieStorage] Cleaned up ${sqliteDeleted} expired cookies from SQLite`);
      }
    } catch (error) {
      console.error(`[CookieStorage] Error cleaning up SQLite cookies:`, error);
    }

    if (removedCount > 0) {
      console.log(`[CookieStorage] Cleaned up ${removedCount} expired cookies from RAM`);
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
   * Uses Flat Format compatible with systemDatabaseService
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

      // Prepare data for the sheet (Flat Format)
      const rows: any[][] = [
        ['Session ID', 'User ID', 'Username', 'Is Admin', 'Created At', 'Expires At', 'Device ID', 'Device Name', 'Platform', 'User Agent']
      ];

      this.cookieStore.forEach((cookie, sessionId) => {
        rows.push([
          sessionId,
          cookie.userId,
          cookie.username,
          cookie.isAdmin ? '1' : '0',
          cookie.createdAt.getTime().toString(),
          cookie.expiresAt.getTime().toString(),
          cookie.deviceInfo?.deviceId || '',
          cookie.deviceInfo?.deviceName || '',
          cookie.deviceInfo?.platform || '',
          cookie.deviceInfo?.userAgent || ''
        ]);
      });

      // Clear existing data and write new data
      await this.sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:J`
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

      console.log(`[CookieStorage] Synced ${this.cookieStore.size} cookies to sheet: ${this.sheetName}`);

    } catch (error) {
      console.error('[CookieStorage] Error syncing to Google Sheets:', error);
    }
  }

  /**
   * Load cookies from local SQLite first, then merge from Google Sheets
   */
  async loadFromGoogleSheets(): Promise<void> {
    // Step 1: Load from local SQLite (PRIMARY SOURCE)
    try {
      const sqliteCookies = cookiesDB.getAll();
      let loadedFromSQLite = 0;
      
      for (const cookie of sqliteCookies) {
        // Only load cookies that haven't expired
        if (cookie.expiresAt > Date.now()) {
          this.cookieStore.set(cookie.sessionId, {
            userId: cookie.userId,
            password: '', // Password not stored for security
            username: cookie.username,
            isAdmin: cookie.isAdmin,
            createdAt: new Date(cookie.createdAt),
            expiresAt: new Date(cookie.expiresAt),
            deviceInfo: cookie.deviceId ? {
              deviceId: cookie.deviceId,
              deviceName: cookie.deviceName || 'Unknown Device',
              platform: cookie.platform || 'Unknown',
              userAgent: cookie.userAgent || '',
              screenResolution: ''
            } : undefined
          });
          loadedFromSQLite++;
        }
      }
      
      console.log(`[CookieStorage] Loaded ${loadedFromSQLite} valid cookies from SQLite`);
    } catch (error) {
      console.error('[CookieStorage] Error loading from SQLite:', error);
    }

    // Step 2: Also load from Sheets and merge (for bidirectional sync)
    if (!this.sheetsClient) {
      console.log('[CookieStorage] Skipping Sheets load - Sheets client not initialized');
      return;
    }

    try {
      console.log('[CookieStorage] Merging cookies from Google Sheets...');

      // Ensure "Cookies" sheet exists
      await this.ensureSheetExists();

      // Read data from the sheet (Flat Format: A-J)
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A2:J` // Skip header row
      });

      const rows = response.data.values || [];
      let mergedFromSheets = 0;

      rows.forEach((row: any[]) => {
        if (row.length < 6) return; // Minimum required fields

        const sessionId = row[0];
        const userId = row[1];
        const username = row[2];
        const isAdmin = row[3] === '1' || row[3] === 'TRUE';
        const createdAt = parseInt(row[4]);
        const expiresAt = parseInt(row[5]);
        
        // Optional fields
        const deviceId = row[6];
        const deviceName = row[7];
        const platform = row[8];
        const userAgent = row[9];

        // Only merge cookies that: 1) haven't expired, 2) don't already exist in RAM
        if (expiresAt > Date.now() && !this.cookieStore.has(sessionId)) {
          this.cookieStore.set(sessionId, {
            userId,
            password: '',
            username,
            isAdmin,
            createdAt: new Date(createdAt),
            expiresAt: new Date(expiresAt),
            deviceInfo: deviceId ? {
              deviceId,
              deviceName: deviceName || 'Unknown Device',
              platform: platform || 'Unknown',
              userAgent: userAgent || '',
              screenResolution: ''
            } : undefined
          });
          
          // Also persist to SQLite
          try {
            cookiesDB.upsert({
              sessionId,
              userId,
              username,
              isAdmin,
              createdAt,
              expiresAt,
              deviceId,
              deviceName,
              platform,
              userAgent
            });
          } catch (e) {
            // Ignore SQLite errors during merge
          }
          
          mergedFromSheets++;
        }
      });

      console.log(`[CookieStorage] Merged ${mergedFromSheets} additional cookies from Sheets`);

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
