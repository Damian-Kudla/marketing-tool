/**
 * FollowMee GPS Tracking API Integration
 *
 * Fetches GPS location data from FollowMee devices and integrates
 * it chronologically into user activity logs via batch queue.
 *
 * SYSTEM DESIGN:
 *
 * 1. INITIAL SYNC (Server Start):
 *    - Fetch 24h FollowMee data for all devices
 *    - For each user with FollowMee device:
 *      - Load logs from Google Sheets until we reach yesterday's date
 *      - Filter to ONLY today's logs (CET date)
 *      - Compare FollowMee data timestamps with existing logs
 *      - Queue new GPS data via batchLogger (not direct write)
 *    - Store ONLY today's FollowMee data in cache
 *
 * 2. CRON JOB (Every 5 minutes):
 *    - Fetch 24h FollowMee data
 *    - Filter to ONLY today's logs (CET date)
 *    - Compare with cached data (by timestamp)
 *    - Queue only NEW data via batchLogger
 *    - Update cache (keep only today)
 */

import { batchLogger } from './batchLogger';
import type { LogEntry } from './fallbackLogging';
import { getBerlinTimestamp } from '../utils/timezone';
import { getCETDate, insertLog, type LogInsertData } from './sqliteLogService';

const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API;
const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';
const FOLLOWMEE_BASE_URL = 'https://www.followmee.com/api/tracks.aspx';
const FOLLOWMEE_INFO_URL = 'https://www.followmee.com/api/info.aspx';

interface FollowMeeLocation {
  DeviceID: string;
  DeviceName: string;
  Date: string; // Format: "2025-11-04T22:52:24+01:00" (ISO with timezone)
  Latitude: number;
  Longitude: number;
  Type: string; // "GPS"
  'Speed(mph)': number | null;
  'Speed(km/h)': number | null;
  Direction: number | null;
  'Altitude(ft)': number | null;
  'Altitude(m)': number | null;
  Accuracy: number;
  Battery: string; // "10%"
  Address?: string;
}

interface FollowMeeResponse {
  Data: FollowMeeLocation[]; // Note: FollowMee API uses capital 'D'
}

interface UserFollowMeeMapping {
  userId: string;
  username: string;
  followMeeDeviceId: string;
}

interface CachedGPSData {
  timestamp: number; // Unix timestamp in ms
  location: FollowMeeLocation;
  logEntry: LogEntry; // Pre-formatted log entry for queue
}

class FollowMeeApiService {
  private userMappings: Map<string, UserFollowMeeMapping> = new Map();
  private gpsDataCache: Map<string, CachedGPSData[]> = new Map(); // Key: userId, Value: sorted array of GPS data
  private initialSyncCompleted: boolean = false;
  private lastSyncTime: number = 0;

  /**
   * Fetch all devices in the account
   */
  async fetchDeviceList(): Promise<any> {
    if (!FOLLOWMEE_API_KEY) {
      throw new Error('FOLLOWMEE_API environment variable not set');
    }

    const url = new URL(FOLLOWMEE_INFO_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('function', 'devicelist');

    console.log(`[FollowMee] Fetching device list...`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`FollowMee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[FollowMee] Found ${data.Data?.length || 0} devices in account`);

    if (data.Data && data.Data.length > 0) {
      console.log(`[FollowMee] Device list:`);
      data.Data.forEach((device: any) => {
        const deviceId = device.ID || device.DeviceID || device.Id || device.id || 'unknown';
        const deviceName = device.DeviceName || device.Name || device.name || 'unknown';
        const lastUpdate = device.Date || device.LastUpdate || device.date || 'unknown';
        console.log(`[FollowMee]   - ${deviceId}: ${deviceName} (Last update: ${lastUpdate})`);
      });
    }

    return data;
  }

  /**
   * Update user-to-device mappings from users data
   */
  updateUserMappings(users: Array<{ userId: string; username: string; followMeeDeviceId?: string }>) {
    this.userMappings.clear();

    for (const user of users) {
      if (user.followMeeDeviceId && user.followMeeDeviceId.trim()) {
        this.userMappings.set(user.userId, {
          userId: user.userId,
          username: user.username,
          followMeeDeviceId: user.followMeeDeviceId.trim()
        });
        console.log(`[FollowMee] Mapped user ${user.username} to device ${user.followMeeDeviceId}`);
      }
    }

    console.log(`[FollowMee] Updated mappings for ${this.userMappings.size} users with FollowMee devices`);
  }

  /**
   * Fetch history for all devices in the past X hours
   */
  private async fetchHistoryForAllDevices(hours: number = 24): Promise<FollowMeeResponse> {
    if (!FOLLOWMEE_API_KEY) {
      throw new Error('FOLLOWMEE_API environment variable not set');
    }

    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', hours.toString());

    console.log(`[FollowMee] Fetching ${hours}h history for all devices...`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`FollowMee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[FollowMee] Received ${data.Data?.length || 0} location points`);

    return data;
  }

  /**
   * Parse FollowMee date format to Unix timestamp (ms)
   */
  private parseFollowMeeDate(dateStr: string): number {
    const date = new Date(dateStr);
    return date.getTime();
  }

  /**
   * Convert FollowMee location to LogEntry format
   */
  private locationToLogEntry(location: FollowMeeLocation, mapping: UserFollowMeeMapping): LogEntry {
    const timestamp = getBerlinTimestamp(new Date(location.Date));

    return {
      timestamp,
      userId: mapping.userId,
      username: mapping.username,
      endpoint: '/api/tracking/gps',
      method: 'POST',
      address: `GPS: ${location.Latitude.toFixed(6)}, ${location.Longitude.toFixed(6)} [FollowMee]`,
      newProspects: [],
      existingCustomers: [],
      userAgent: 'FollowMee GPS Tracker',
      data: {
        source: 'followmee',
        deviceId: location.DeviceID,
        deviceName: location.DeviceName,
        latitude: location.Latitude,
        longitude: location.Longitude,
        speedKmh: location['Speed(km/h)'],
        speedMph: location['Speed(mph)'],
        direction: location.Direction,
        accuracy: location.Accuracy,
        altitudeM: location['Altitude(m)'],
        battery: location.Battery,
        timestamp: this.parseFollowMeeDate(location.Date)
      }
    };
  }

  /**
   * Load user's existing logs from Google Sheets (last 25 hours)
   */
  private async loadUserLogsFromSheets(mapping: UserFollowMeeMapping): Promise<LogEntry[]> {
    const { GoogleSheetsLoggingService } = await import('./googleSheetsLogging');
    const { google } = await import('googleapis');

    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    if (!sheetsKey) {
      console.error('[FollowMee] GOOGLE_SHEETS_KEY not set');
      return [];
    }

    try {
      const credentials = JSON.parse(sheetsKey);
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheetsClient = google.sheets({ version: 'v4', auth });
      const LOG_SHEET_ID = process.env.GOOGLE_LOGS_SHEET_ID || '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
      const worksheetName = `${mapping.username}_${mapping.userId}`;

      // Check if worksheet exists
      const sheetInfo = await sheetsClient.spreadsheets.get({
        spreadsheetId: LOG_SHEET_ID,
      });

      const worksheetExists = sheetInfo.data.sheets?.some(
        (sheet: any) => sheet.properties.title === worksheetName
      );

      if (!worksheetExists) {
        console.log(`[FollowMee] No worksheet found for ${mapping.username}, will create on first write`);
        return [];
      }

      // Load logs in batches of 10,000 until we have today's logs
      const allLogs: LogEntry[] = [];
      const today = getCETDate(); // YYYY-MM-DD format for today (CET timezone)
      let offset = 2; // Start after header row
      let continueLoading = true;

      while (continueLoading) {
        console.log(`[FollowMee] Loading logs for ${mapping.username} (batch starting at row ${offset})...`);

        const response = await sheetsClient.spreadsheets.values.get({
          spreadsheetId: LOG_SHEET_ID,
          range: `${worksheetName}!A${offset}:J${offset + 9999}`, // 10k rows
        });

        const rows = response.data.values || [];

        if (rows.length === 0) {
          console.log(`[FollowMee] No more logs found for ${mapping.username}`);
          break;
        }

        // Parse rows to LogEntry
        const parsedLogs: LogEntry[] = rows
          .filter((row: any[]) => row[0]) // Must have timestamp
          .map((row: any[]) => ({
            timestamp: row[0] || '',
            userId: row[1] || '',
            username: row[2] || '',
            endpoint: row[3] || '',
            method: row[4] || '',
            address: row[5] || '',
            newProspects: row[6] ? row[6].split(', ').filter((p: string) => p.length > 0) : [],
            existingCustomers: row[7] ? row[7].split(', ').map((c: string) => {
              const match = c.match(/^(.+)\s\((.+)\)$/);
              return match ? { name: match[1], id: match[2] } : { name: c, id: '' };
            }) : [],
            userAgent: row[8] || '',
            data: row[9] || ''
          }));

        allLogs.push(...parsedLogs);

        // Get oldest timestamp in this batch
        const oldestTimestamp = parsedLogs.length > 0
          ? new Date(parsedLogs[parsedLogs.length - 1].timestamp).getTime()
          : Date.now();
        const oldestDate = getCETDate(oldestTimestamp);

        // Stop loading if:
        // 1. Less than 10k logs (end of data)
        // 2. OR oldest log is from a previous day (not today)
        if (rows.length < 10000 || oldestDate < today) {
          console.log(`[FollowMee] Loaded ${allLogs.length} logs for ${mapping.username} (covers today or end reached)`);
          continueLoading = false;
        } else {
          offset += 10000;
          console.log(`[FollowMee] Loaded ${allLogs.length} logs so far, continuing...`);
        }
      }

      // Filter to only today's logs (CET date)
      const logsToday = allLogs.filter(log => {
        const timestamp = new Date(log.timestamp).getTime();
        const logDate = getCETDate(timestamp);
        return logDate === today;
      });

      console.log(`[FollowMee] Filtered to ${logsToday.length} logs from today (${today}) for ${mapping.username}`);
      return logsToday;

    } catch (error) {
      console.error(`[FollowMee] Error loading logs for ${mapping.username}:`, error);
      return [];
    }
  }

  /**
   * Initial sync on server start
   */
  async initialSync() {
    if (this.initialSyncCompleted) {
      console.log('[FollowMee] Initial sync already completed');
      return;
    }

    if (this.userMappings.size === 0) {
      console.log('[FollowMee] No users with FollowMee devices configured');
      this.initialSyncCompleted = true;
      return;
    }

    console.log('[FollowMee] ============================================');
    console.log('[FollowMee] STARTING INITIAL SYNC');
    console.log('[FollowMee] ============================================');

    try {
      // Fetch device list
      await this.fetchDeviceList();

      // Fetch 24h FollowMee data
      const response = await this.fetchHistoryForAllDevices(24);

      if (!response.Data || response.Data.length === 0) {
        console.log('[FollowMee] No FollowMee data available');
        this.initialSyncCompleted = true;
        return;
      }

      // Group locations by device
      const locationsByDevice = new Map<string, FollowMeeLocation[]>();
      for (const location of response.Data) {
        if (!locationsByDevice.has(location.DeviceID)) {
          locationsByDevice.set(location.DeviceID, []);
        }
        locationsByDevice.get(location.DeviceID)!.push(location);
      }

      console.log(`[FollowMee] Found data for ${locationsByDevice.size} devices`);

      // Process each user
      for (const mapping of Array.from(this.userMappings.values())) {
        const deviceLocations = locationsByDevice.get(mapping.followMeeDeviceId);

        if (!deviceLocations || deviceLocations.length === 0) {
          console.log(`[FollowMee] No FollowMee data for ${mapping.username} (Device: ${mapping.followMeeDeviceId})`);
          this.gpsDataCache.set(mapping.userId, []);
          continue;
        }

        // CRITICAL: Filter to ONLY today's locations BEFORE duplicate check
        // This prevents importing yesterday's data that gets deleted later by SQLite sync
        const today = getCETDate();
        const todaysLocations = deviceLocations.filter(loc => {
          const timestamp = this.parseFollowMeeDate(loc.Date);
          const locDate = getCETDate(timestamp);
          return locDate === today;
        });

        console.log(`[FollowMee] Processing ${deviceLocations.length} FollowMee locations (24h) → ${todaysLocations.length} from today (${today}) for ${mapping.username}`);

        if (todaysLocations.length === 0) {
          console.log(`[FollowMee] No locations from today for ${mapping.username}`);
          this.gpsDataCache.set(mapping.userId, []);
          continue;
        }

        // Load existing logs from Google Sheets (only today)
        const existingLogs = await this.loadUserLogsFromSheets(mapping);

        // Build set of existing timestamps (for fast lookup)
        const existingTimestamps = new Set<number>();
        for (const log of existingLogs) {
          // Only track FollowMee entries (to avoid conflicts with manual GPS entries)
          try {
            const data = typeof log.data === 'string' ? JSON.parse(log.data) : log.data;
            if (data?.source === 'followmee') {
              existingTimestamps.add(data.timestamp);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        console.log(`[FollowMee] Found ${existingTimestamps.size} existing FollowMee entries in logs for ${mapping.username}`);

        // Filter new locations (not in existing logs) - using today's locations only
        const newLocations = todaysLocations.filter(loc => {
          const timestamp = this.parseFollowMeeDate(loc.Date);
          return !existingTimestamps.has(timestamp);
        });

        console.log(`[FollowMee] ${newLocations.length} new locations to import for ${mapping.username}`);

        // Sort by timestamp
        newLocations.sort((a, b) =>
          this.parseFollowMeeDate(a.Date) - this.parseFollowMeeDate(b.Date)
        );

        // Queue new locations via batchLogger (Google Sheets) + SQLite
        for (const location of newLocations) {
          const logEntry = this.locationToLogEntry(location, mapping);
          
          // 1. Google Sheets (batch)
          batchLogger.addUserActivity(logEntry);
          
          // 2. CRITICAL: AUCH SQLite schreiben (verhindert Datenverlust)
          try {
            const timestamp = this.parseFollowMeeDate(location.Date);
            const date = getCETDate(timestamp);
            const sqliteLog: LogInsertData = {
              userId: mapping.userId,
              username: mapping.username,
              timestamp: timestamp,
              logType: 'gps',
              data: logEntry.data
            };

            insertLog(date, sqliteLog);
          } catch (error) {
            console.error(`[FollowMee] ❌ SQLite write error for ${mapping.username}:`, error);
            // Don't throw - Google Sheets backup still works
          }
        }

        // Build cache with today's FollowMee data (sorted by timestamp) - already filtered above

        const cacheData: CachedGPSData[] = todaysLocations
          .map(loc => ({
            timestamp: this.parseFollowMeeDate(loc.Date),
            location: loc,
            logEntry: this.locationToLogEntry(loc, mapping)
          }))
          .sort((a, b) => a.timestamp - b.timestamp);

        this.gpsDataCache.set(mapping.userId, cacheData);

        console.log(`[FollowMee] ✅ Queued ${newLocations.length} new locations for ${mapping.username}`);
        console.log(`[FollowMee] 📦 Cached ${todaysLocations.length} total locations for ${mapping.username} (today: ${today})`);
      }

      this.initialSyncCompleted = true;
      this.lastSyncTime = Date.now();

      console.log('[FollowMee] ============================================');
      console.log('[FollowMee] INITIAL SYNC COMPLETED');
      console.log('[FollowMee] ============================================');

    } catch (error) {
      console.error('[FollowMee] Error during initial sync:', error);
      throw error;
    }
  }

  /**
   * Periodic sync (cron job every 5 minutes)
   */
  async periodicSync() {
    if (!this.initialSyncCompleted) {
      console.log('[FollowMee] Initial sync not completed yet, running it now...');
      await this.initialSync();
      return;
    }

    if (this.userMappings.size === 0) {
      console.log('[FollowMee] No users with FollowMee devices configured');
      return;
    }

    try {
      console.log('[FollowMee] Starting periodic sync...');

      // Fetch 24h FollowMee data
      const response = await this.fetchHistoryForAllDevices(24);

      if (!response.Data || response.Data.length === 0) {
        console.log('[FollowMee] No new FollowMee data');
        return;
      }

      // Group locations by device
      const locationsByDevice = new Map<string, FollowMeeLocation[]>();
      for (const location of response.Data) {
        if (!locationsByDevice.has(location.DeviceID)) {
          locationsByDevice.set(location.DeviceID, []);
        }
        locationsByDevice.get(location.DeviceID)!.push(location);
      }

      // Process each user
      for (const mapping of Array.from(this.userMappings.values())) {
        const deviceLocations = locationsByDevice.get(mapping.followMeeDeviceId);

        if (!deviceLocations || deviceLocations.length === 0) {
          continue;
        }

        // Get cached data for comparison
        const cachedData = this.gpsDataCache.get(mapping.userId) || [];
        const cachedTimestamps = new Set(cachedData.map(d => d.timestamp));

        // Find NEW locations (not in cache)
        // CRITICAL: Filter to ONLY today's locations to prevent re-importing yesterday's data
        // (The cache is trimmed to today, so yesterday's data would otherwise look "new")
        const today = getCETDate();
        const newLocations = deviceLocations.filter(loc => {
          const timestamp = this.parseFollowMeeDate(loc.Date);
          const locDate = getCETDate(timestamp);
          
          // Must be from today AND not in cache
          return locDate === today && !cachedTimestamps.has(timestamp);
        });

        if (newLocations.length === 0) {
          console.log(`[FollowMee] No new locations for ${mapping.username}`);
          continue;
        }

        console.log(`[FollowMee] ${newLocations.length} new locations for ${mapping.username}`);

        // Sort by timestamp
        newLocations.sort((a, b) =>
          this.parseFollowMeeDate(a.Date) - this.parseFollowMeeDate(b.Date)
        );

        // Queue new locations via batchLogger (Google Sheets) + SQLite
        for (const location of newLocations) {
          const logEntry = this.locationToLogEntry(location, mapping);
          
          // 1. Google Sheets (batch)
          batchLogger.addUserActivity(logEntry);
          
          // 2. CRITICAL: AUCH SQLite schreiben (verhindert Datenverlust)
          try {
            const timestamp = this.parseFollowMeeDate(location.Date);
            const date = getCETDate(timestamp);
            const sqliteLog: LogInsertData = {
              userId: mapping.userId,
              username: mapping.username,
              timestamp: timestamp,
              logType: 'gps',
              data: logEntry.data
            };

            insertLog(date, sqliteLog);
          } catch (error) {
            console.error(`[FollowMee] ❌ SQLite write error for ${mapping.username}:`, error);
            // Don't throw - Google Sheets backup still works
          }
        }

        // Update cache: add new data and keep sorted
        const newCacheEntries: CachedGPSData[] = newLocations.map(loc => ({
          timestamp: this.parseFollowMeeDate(loc.Date),
          location: loc,
          logEntry: this.locationToLogEntry(loc, mapping)
        }));

        const updatedCache = [...cachedData, ...newCacheEntries]
          .sort((a, b) => a.timestamp - b.timestamp);

        // Keep only today's data in cache (to prevent memory growth)
        const trimmedCache = updatedCache.filter(d => {
          const logDate = getCETDate(d.timestamp);
          return logDate === today;
        });

        this.gpsDataCache.set(mapping.userId, trimmedCache);

        console.log(`[FollowMee] ✅ Queued ${newLocations.length} new locations for ${mapping.username}`);
        console.log(`[FollowMee] 📦 Cache updated: ${trimmedCache.length} locations (trimmed to today: ${today})`);
      }

      this.lastSyncTime = Date.now();
      console.log('[FollowMee] ✅ Periodic sync completed');

    } catch (error) {
      console.error('[FollowMee] Error during periodic sync:', error);
      throw error;
    }
  }

  /**
   * Get current status (for monitoring)
   */
  getStatus() {
    return {
      configured: !!FOLLOWMEE_API_KEY,
      userCount: this.userMappings.size,
      initialSyncCompleted: this.initialSyncCompleted,
      lastSyncTime: this.lastSyncTime,
      users: Array.from(this.userMappings.values()).map(m => ({
        username: m.username,
        deviceId: m.followMeeDeviceId,
        cachedLocations: this.gpsDataCache.get(m.userId)?.length || 0
      }))
    };
  }
}

export const followMeeApiService = new FollowMeeApiService();
