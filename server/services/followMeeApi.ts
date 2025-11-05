/**
 * FollowMee GPS Tracking API Integration
 * 
 * Fetches GPS location data from FollowMee devices and integrates
 * it chronologically into user activity logs in Google Sheets.
 */

import { GoogleSheetsLoggingService } from './googleSheetsLogging';

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

class FollowMeeApiService {
  private userMappings: Map<string, UserFollowMeeMapping> = new Map();
  private lastFetchTimestamps: Map<string, number> = new Map(); // Track last fetch per user
  private processedLocationIds: Map<string, Set<string>> = new Map(); // Track processed locations per user

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
    
    // Log all devices with different possible field names
    if (data.Data && data.Data.length > 0) {
      console.log(`[FollowMee] Device list:`);
      data.Data.forEach((device: any) => {
        // Try different field names for ID
        const deviceId = device.ID || device.DeviceID || device.Id || device.id || 'unknown';
        const deviceName = device.DeviceName || device.Name || device.name || 'unknown';
        const lastUpdate = device.Date || device.LastUpdate || device.date || 'unknown';
        console.log(`[FollowMee]   - ${deviceId}: ${deviceName} (Last update: ${lastUpdate})`);
      });
      
      // Also log the raw structure of first device to debug
      console.log(`[FollowMee] Raw device structure:`, JSON.stringify(data.Data[0], null, 2));
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
  private async fetchHistoryForAllDevices(hours: number = 1): Promise<FollowMeeResponse> {
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
   * Fetch date range history for all devices
   */
  private async fetchDateRangeForAllDevices(from: string, to: string): Promise<FollowMeeResponse> {
    if (!FOLLOWMEE_API_KEY) {
      throw new Error('FOLLOWMEE_API environment variable not set');
    }

    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'daterangeforalldevices');
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);

    console.log(`[FollowMee] Fetching date range ${from} to ${to} for all devices...`);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`FollowMee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[FollowMee] Received ${data.Data?.length || 0} location points`);
    
    return data;
  }

  /**
   * Parse FollowMee date format to timestamp
   */
  private parseFollowMeeDate(dateStr: string): number {
    // Format: "2025-11-04T22:52:24+01:00" (ISO with timezone)
    const date = new Date(dateStr);
    return date.getTime();
  }

  /**
   * Create unique ID for location (to detect duplicates)
   */
  private createLocationId(location: FollowMeeLocation): string {
    return `${location.DeviceID}_${location.Date}_${location.Latitude}_${location.Longitude}`;
  }

  /**
   * Check if location was already processed
   */
  private isLocationProcessed(userId: string, locationId: string): boolean {
    const processed = this.processedLocationIds.get(userId);
    return processed ? processed.has(locationId) : false;
  }

  /**
   * Mark location as processed
   */
  private markLocationProcessed(userId: string, locationId: string) {
    let processed = this.processedLocationIds.get(userId);
    if (!processed) {
      processed = new Set();
      this.processedLocationIds.set(userId, processed);
    }
    processed.add(locationId);
  }

  /**
   * Fetch and integrate GPS data for all users
   * Called by cron job every 5 minutes
   */
  async syncAllUsers() {
    if (this.userMappings.size === 0) {
      console.log('[FollowMee] No users with FollowMee devices configured');
      return;
    }

    try {
      // First, fetch device list to see all available devices
      await this.fetchDeviceList();
      
      // Fetch last 24 hours of data (whole day)
      const response = await this.fetchHistoryForAllDevices(24);
      
      if (!response.Data || response.Data.length === 0) {
        console.log('[FollowMee] No new location data');
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

      // Log which devices have data
      const deviceIds = Array.from(locationsByDevice.keys());
      console.log(`[FollowMee] Devices in this batch: ${deviceIds.join(', ')}`);
      deviceIds.forEach(deviceId => {
        const locations = locationsByDevice.get(deviceId)!;
        const deviceName = locations[0]?.DeviceName || 'Unknown';
        console.log(`[FollowMee]   Device ${deviceId} (${deviceName}): ${locations.length} points`);
      });

      // Process each user's device
      const mappings = Array.from(this.userMappings.values());
      for (const mapping of mappings) {
        const deviceLocations = locationsByDevice.get(mapping.followMeeDeviceId);
        
        if (!deviceLocations || deviceLocations.length === 0) {
          console.log(`[FollowMee] No locations in this batch for user ${mapping.username} (Device ID: ${mapping.followMeeDeviceId})`);
          continue;
        }

        console.log(`[FollowMee] Processing ${deviceLocations.length} locations for user ${mapping.username}`);

        // Filter out already processed locations
        const newLocations = deviceLocations.filter(loc => {
          const locationId = this.createLocationId(loc);
          return !this.isLocationProcessed(mapping.userId, locationId);
        });

        if (newLocations.length === 0) {
          console.log(`[FollowMee] No new locations for user ${mapping.username} (all already processed)`);
          continue;
        }

        console.log(`[FollowMee] ${newLocations.length} new locations for user ${mapping.username}`);

        // Sort by timestamp (chronological order)
        newLocations.sort((a, b) => {
          const timeA = this.parseFollowMeeDate(a.Date);
          const timeB = this.parseFollowMeeDate(b.Date);
          return timeA - timeB;
        });

        // Insert into Google Sheets chronologically
        await this.insertLocationsChronologically(mapping, newLocations);

        // Mark as processed
        for (const location of newLocations) {
          const locationId = this.createLocationId(location);
          this.markLocationProcessed(mapping.userId, locationId);
        }
      }

    } catch (error) {
      console.error('[FollowMee] Error syncing users:', error);
      throw error;
    }
  }

  /**
   * Insert FollowMee locations chronologically into user's Google Sheets log
   */
  private async insertLocationsChronologically(
    mapping: UserFollowMeeMapping,
    locations: FollowMeeLocation[]
  ) {
    const worksheetName = `${mapping.username}_${mapping.userId}`;

    try {
      // Ensure worksheet exists
      await GoogleSheetsLoggingService.ensureUserWorksheet(mapping.userId, mapping.username);

      // Note: For now we append to the end
      // In the future, could implement true chronological insertion by reading existing data

      // Convert locations to log rows
      const logRows = locations.map(location => {
        const timestamp = new Date(location.Date).toISOString();
        
        return [
          timestamp, // Timestamp
          mapping.userId, // User ID
          mapping.username, // Username
          '/api/tracking/gps', // Endpoint
          'POST', // Method
          `GPS: ${location.Latitude.toFixed(6)}, ${location.Longitude.toFixed(6)} [FollowMee]`, // Address
          '', // New Prospects
          '', // Existing Customers
          'FollowMee GPS Tracker', // User Agent
          JSON.stringify({
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
          })
        ];
      });

      // Insert chronologically (reads existing logs, merges, sorts, rewrites)
      await GoogleSheetsLoggingService.batchInsertChronologically(worksheetName, logRows);
      console.log(`[FollowMee] Inserted ${logRows.length} locations chronologically into ${mapping.username}'s log`);

    } catch (error) {
      console.error(`[FollowMee] Error inserting locations for ${mapping.username}:`, error);
      throw error;
    }
  }

  /**
   * Fetch and sync GPS data for a specific date range (for historical data)
   */
  async syncDateRange(from: string, to: string) {
    if (this.userMappings.size === 0) {
      console.log('[FollowMee] No users with FollowMee devices configured');
      return;
    }

    try {
      const response = await this.fetchDateRangeForAllDevices(from, to);
      
      if (!response.Data || response.Data.length === 0) {
        console.log('[FollowMee] No location data for date range');
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

      // Process each user's device
      const mappings = Array.from(this.userMappings.values());
      for (const mapping of mappings) {
        const deviceLocations = locationsByDevice.get(mapping.followMeeDeviceId);
        
        if (!deviceLocations || deviceLocations.length === 0) {
          continue;
        }

        console.log(`[FollowMee] Processing ${deviceLocations.length} locations for user ${mapping.username} (${from} to ${to})`);

        // Sort by timestamp
        deviceLocations.sort((a, b) => {
          const timeA = this.parseFollowMeeDate(a.Date);
          const timeB = this.parseFollowMeeDate(b.Date);
          return timeA - timeB;
        });

        // Insert into Google Sheets
        await this.insertLocationsChronologically(mapping, deviceLocations);
      }

    } catch (error) {
      console.error('[FollowMee] Error syncing date range:', error);
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
      users: Array.from(this.userMappings.values()).map(m => ({
        username: m.username,
        deviceId: m.followMeeDeviceId,
        lastFetch: this.lastFetchTimestamps.get(m.userId) || null,
        processedLocations: this.processedLocationIds.get(m.userId)?.size || 0
      }))
    };
  }
}

export const followMeeApiService = new FollowMeeApiService();
