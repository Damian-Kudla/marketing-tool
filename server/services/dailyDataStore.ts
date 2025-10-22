import type { 
  TrackingData, 
  DailyUserData, 
  GPSCoordinates, 
  SessionData, 
  DeviceStatus, 
  ActionLog 
} from '../../shared/trackingTypes';
import crypto from 'crypto';

/**
 * In-Memory Daily Data Store
 * Stores tracking data for all users for current day
 * Resets at midnight
 */
class DailyDataStore {
  private data: Map<string, DailyUserData> = new Map();
  private currentDate: string = this.getCurrentDate();
  private midnightResetTimer: NodeJS.Timeout | null = null;
  // Track unique photo hashes per user (deduplicated by prospect data)
  private uniquePhotoHashes: Map<string, Set<string>> = new Map();

  constructor() {
    this.scheduleMidnightReset();
  }

  /**
   * Get current date in YYYY-MM-DD format
   */
  private getCurrentDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Schedule automatic reset at midnight
   */
  private scheduleMidnightReset(): void {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    
    const msUntilMidnight = midnight.getTime() - now.getTime();

    this.midnightResetTimer = setTimeout(() => {
      console.log('[DailyStore] Midnight reached, resetting daily data...');
      this.reset();
      // Schedule next reset
      this.scheduleMidnightReset();
    }, msUntilMidnight);

    console.log(`[DailyStore] Scheduled midnight reset in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
  }

  /**
   * Get or create user data for today
   */
  private getUserData(userId: string, username: string): DailyUserData {
    // Check if date changed
    const today = this.getCurrentDate();
    if (today !== this.currentDate) {
      console.log('[DailyStore] Date changed, resetting data...');
      this.reset();
      this.currentDate = today;
    }

    let userData = this.data.get(userId);
    if (!userData) {
      userData = {
        userId,
        username,
        date: this.currentDate,
        gpsPoints: [],
        totalDistance: 0,
        uniqueAddresses: new Set(),
        totalSessionTime: 0,
        totalIdleTime: 0,
        activeTime: 0,
        sessionCount: 0,
        totalActions: 0,
        actionsByType: new Map(),
        statusChanges: new Map(),
        avgBatteryLevel: 0,
        lowBatteryEvents: 0,
        offlineEvents: 0,
        scansPerHour: 0,
        avgTimePerAddress: 0,
        conversionRate: 0,
        activityScore: 0,
        rawLogs: [],
        photoTimestamps: []
      };
      this.data.set(userId, userData);
      console.log(`[DailyStore] Created new daily data for user: ${username}`);
    }

    return userData;
  }

  /**
   * Add GPS coordinates
   */
  addGPS(userId: string, username: string, gps: GPSCoordinates): void {
    const userData = this.getUserData(userId, username);
    
    // Add GPS point
    userData.gpsPoints.push(gps);

    // Calculate distance from last point
    if (userData.gpsPoints.length > 1) {
      const lastPoint = userData.gpsPoints[userData.gpsPoints.length - 2];
      const distance = this.calculateDistance(
        lastPoint.latitude,
        lastPoint.longitude,
        gps.latitude,
        gps.longitude
      );
      userData.totalDistance += distance;
    }

    // Store raw log
    userData.rawLogs.push({
      userId,
      username,
      timestamp: gps.timestamp,
      gps
    });
  }

  /**
   * Update session data
   */
  updateSession(userId: string, username: string, session: Partial<SessionData>): void {
    const userData = this.getUserData(userId, username);

    if (session.sessionDuration !== undefined) {
      userData.totalSessionTime = session.sessionDuration;
    }

    if (session.idleTime !== undefined) {
      userData.totalIdleTime = session.idleTime;
      userData.activeTime = userData.totalSessionTime - userData.totalIdleTime;
    }

    if (session.actions && session.actions.length > 0) {
      // Process actions
      session.actions.forEach((action: ActionLog) => {
        userData.totalActions++;

        // Count by type
        const count = userData.actionsByType.get(action.action) || 0;
        userData.actionsByType.set(action.action, count + 1);

        // Track status changes (most important KPI!)
        if (action.residentStatus) {
          const statusCount = userData.statusChanges.get(action.residentStatus) || 0;
          userData.statusChanges.set(action.residentStatus, statusCount + 1);
        }
      });
    }

    // Store raw log
    userData.rawLogs.push({
      userId,
      username,
      timestamp: Date.now(),
      session
    });
  }

  /**
   * Update device status
   */
  updateDevice(userId: string, username: string, device: DeviceStatus): void {
    const userData = this.getUserData(userId, username);

    // Track battery
    if (device.batteryLevel !== undefined) {
      // Update average battery level
      const totalPoints = userData.gpsPoints.length || 1;
      userData.avgBatteryLevel = 
        (userData.avgBatteryLevel * (totalPoints - 1) + device.batteryLevel) / totalPoints;

      // Count low battery events
      if (device.batteryLevel < 20 && !device.isCharging) {
        userData.lowBatteryEvents++;
      }
    }

    // Track offline events
    if (device.connectionType === 'offline') {
      userData.offlineEvents++;
    }

    // Store raw log
    userData.rawLogs.push({
      userId,
      username,
      timestamp: device.timestamp,
      device
    });
  }

  /**
   * Track OCR photo submission (deduplicated by prospect data)
   * @param userId User ID
   * @param username Username
   * @param prospectData Column G data from Google Sheets (New Prospects)
   * @param timestamp Timestamp when photo was taken
   * @returns true if this is a unique photo, false if duplicate
   */
  trackOCRPhoto(userId: string, username: string, prospectData: any, timestamp?: number): boolean {
    const userData = this.getUserData(userId, username);

    // Create hash of prospect data to detect duplicates
    const dataString = JSON.stringify(prospectData);
    const hash = crypto.createHash('md5').update(dataString).digest('hex');

    // Get or create user's photo hash set
    let userHashes = this.uniquePhotoHashes.get(userId);
    if (!userHashes) {
      userHashes = new Set<string>();
      this.uniquePhotoHashes.set(userId, userHashes);
    }

    // Check if this photo is unique
    const isUnique = !userHashes.has(hash);
    
    if (isUnique) {
      userHashes.add(hash);
      
      // Add timestamp to photoTimestamps array
      const photoTimestamp = timestamp || Date.now();
      if (!userData.photoTimestamps) {
        userData.photoTimestamps = [];
      }
      userData.photoTimestamps.push(photoTimestamp);
      
      console.log(`[DailyStore] Unique photo tracked for ${username}, total: ${userHashes.size}`);
    } else {
      console.log(`[DailyStore] Duplicate photo detected for ${username} (hash: ${hash.substring(0, 8)}...)`);
    }

    return isUnique;
  }

  /**
   * Get unique photo count for user
   */
  getUniquePhotoCount(userId: string): number {
    const userHashes = this.uniquePhotoHashes.get(userId);
    return userHashes ? userHashes.size : 0;
  }

  /**
   * Calculate distance between two GPS points (Haversine formula)
   * Returns distance in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate KPIs for user
   */
  calculateKPIs(userId: string): void {
    const userData = this.data.get(userId);
    if (!userData) return;

    // Scans per hour
    const hoursActive = userData.activeTime / (1000 * 60 * 60);
    userData.scansPerHour = hoursActive > 0 ? userData.totalActions / hoursActive : 0;

    // Average time per address
    const scanCount = userData.actionsByType.get('scan') || 0;
    userData.avgTimePerAddress = scanCount > 0 ? userData.activeTime / scanCount : 0;

    // Conversion rate (interested / total status changes)
    const interested = userData.statusChanges.get('interessiert') || 0;
    const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((a, b) => a + b, 0);
    userData.conversionRate = totalStatusChanges > 0 ? (interested / totalStatusChanges) * 100 : 0;

    // Activity Score (custom algorithm)
    userData.activityScore = this.calculateActivityScore(userData);
  }

  /**
   * Calculate activity score (0-100)
   * Higher score = more productive
   */
  private calculateActivityScore(userData: DailyUserData): number {
    let score = 0;

    // Active time (max 30 points)
    // Full points for 6+ hours of active time
    const hoursActive = userData.activeTime / (1000 * 60 * 60);
    score += Math.min(hoursActive / 6 * 30, 30);

    // Actions (max 25 points)
    // Full points for 50+ actions
    score += Math.min(userData.totalActions / 50 * 25, 25);

    // Status changes (max 30 points)
    // Full points for 30+ status changes (most important!)
    const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((a, b) => a + b, 0);
    score += Math.min(totalStatusChanges / 30 * 30, 30);

    // Distance (max 10 points)
    // Full points for 10+ km
    score += Math.min(userData.totalDistance / 10000 * 10, 10);

    // Penalty for high idle time (up to -5 points)
    const idleRatio = userData.totalIdleTime / userData.totalSessionTime;
    if (idleRatio > 0.5) {
      score -= (idleRatio - 0.5) * 10; // -5 points at 100% idle
    }

    // Penalty for offline events (up to -5 points)
    score -= Math.min(userData.offlineEvents * 0.5, 5);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get data for specific user
   */
  getUserDailyData(userId: string): DailyUserData | undefined {
    return this.data.get(userId);
  }

  /**
   * Get data for all users
   */
  getAllUserData(): DailyUserData[] {
    return Array.from(this.data.values());
  }

  /**
   * Get users with minimum log count
   */
  getUsersWithMinLogs(minLogs: number): DailyUserData[] {
    return Array.from(this.data.values()).filter(
      userData => userData.rawLogs.length >= minLogs
    );
  }

  /**
   * Get current date
   */
  getDate(): string {
    return this.currentDate;
  }

  /**
   * Reset all data (called at midnight)
   */
  reset(): void {
    console.log('[DailyStore] Resetting daily data...');
    this.data.clear();
    this.uniquePhotoHashes.clear(); // Reset photo tracking
    this.currentDate = this.getCurrentDate();
  }

  /**
   * Clear specific user data
   */
  clearUser(userId: string): void {
    this.data.delete(userId);
    this.uniquePhotoHashes.delete(userId); // Clear user's photo hashes
  }

  /**
   * Get store size (for monitoring)
   */
  getSize(): { users: number; totalLogs: number; memoryEstimate: string } {
    const users = this.data.size;
    const totalLogs = Array.from(this.data.values()).reduce(
      (sum, userData) => sum + userData.rawLogs.length,
      0
    );

    // Rough memory estimate (each log ~ 500 bytes)
    const memoryBytes = totalLogs * 500;
    const memoryMB = (memoryBytes / (1024 * 1024)).toFixed(2);

    return {
      users,
      totalLogs,
      memoryEstimate: `${memoryMB} MB`
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.midnightResetTimer) {
      clearTimeout(this.midnightResetTimer);
      this.midnightResetTimer = null;
    }
  }
}

// Singleton instance
export const dailyDataStore = new DailyDataStore();
