import type {
  TrackingData,
  DailyUserData,
  GPSCoordinates,
  SessionData,
  DeviceStatus,
  ActionLog
} from '../../shared/trackingTypes';
import crypto from 'crypto';
import {
  getBerlinDate,
  getBerlinTimestamp,
  getNextBerlinMidnight
} from '../utils/timezone';

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
  // Track processed action timestamps to avoid double-counting during multiple syncs
  private processedActionTimestamps: Map<string, Set<number>> = new Map();

  constructor() {
    this.scheduleMidnightReset();
  }

  /**
   * Get current date in YYYY-MM-DD format
   */
  private getCurrentDate(): string {
    return getBerlinDate();
  }

  /**
   * Schedule automatic reset at midnight (CET/CEST)
   */
  private scheduleMidnightReset(): void {
    const now = new Date();
    const nextMidnight = getNextBerlinMidnight(now);
    const msUntilMidnight = Math.max(nextMidnight.getTime() - now.getTime(), 0);

    this.midnightResetTimer = setTimeout(() => {
      console.log('[DailyStore] CET/CEST Midnight reached, resetting daily data...');
      this.reset();
      this.scheduleMidnightReset();
    }, msUntilMidnight);

    console.log(
      `[DailyStore] Scheduled midnight reset for ${getBerlinTimestamp(nextMidnight)} (in ${Math.round(msUntilMidnight / 60000)} minutes)`
    );
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
        activeTime: -1, // -1 indicates "App not used" (no native GPS data)
        sessionCount: 0,
        totalActions: 0,
        actionsByType: new Map(),
        statusChanges: new Map(),
        finalStatuses: new Map(), // Final status assignments per resident
        conversionRates: { // Conversion tracking from 'interest_later'
          interest_later_to_written: 0,
          interest_later_to_no_interest: 0,
          interest_later_to_appointment: 0,
          interest_later_to_not_reached: 0,
          interest_later_total: 0
        },
        avgBatteryLevel: 0,
        lowBatteryEvents: 0,
        offlineEvents: 0,
        scansPerHour: 0,
        avgTimePerAddress: 0,
        conversionRate: 0,
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
    
    // BUGFIX: Validate GPS timestamp is from today
    // Reject GPS points from previous days (delayed sync)
    const gpsDate = new Date(gps.timestamp);
    const gpsDateStr = getBerlinDate(gpsDate);
    const today = this.getCurrentDate();
    
    if (gpsDateStr !== today) {
      console.warn(`[DailyStore] Rejected GPS from wrong date: ${gpsDateStr} (today: ${today}), user: ${username}`);
      return; // Skip GPS points from other days
    }
    
    // BUGFIX: Validate GPS coordinates - reject corrupted values
    // Also reject lat=0 or lng=0 which indicates GPS not yet available on device
    const lat = gps.latitude;
    const lng = gps.longitude;
    const isValidLat = lat !== undefined && !isNaN(lat) && lat >= -90 && lat <= 90 && Math.abs(lat) > 0.001;
    const isValidLng = lng !== undefined && !isNaN(lng) && lng >= -180 && lng <= 180 && Math.abs(lng) > 0.001;
    
    if (!isValidLat || !isValidLng) {
      console.error(`[DailyStore] ⚠️ CORRUPTED GPS REJECTED for ${username}: lat=${lat}, lng=${lng}`);
      return; // Skip corrupted GPS points
    }
    
    // Add GPS point
    userData.gpsPoints.push(gps);

    // Recalculate active time and distance after each GPS update
    this.recalculateActiveTime(userId, username);
    this.recalculateDistance(userId, username);

    // Store raw log
    userData.rawLogs.push({
      userId,
      username,
      timestamp: gps.timestamp,
      gps
    });
  }

  /**
   * Recalculate active time from native GPS points
   * Active Time = Time span between first and last native app GPS point - break times
   * Breaks = Gaps between native GPS points > 20 minutes
   */
  private recalculateActiveTime(userId: string, username: string): void {
    const userData = this.data.get(userId);
    if (!userData) return;

    // Filter ONLY native GPS points
    // Include points without source (old data before source field was added - all native)
    // Exclude: 'followmee', 'external_app', 'external'
    const nativeGpsPoints = userData.gpsPoints.filter(p => 
      p.source === 'native' || !p.source
    );
    
    if (nativeGpsPoints.length >= 2) {
      // Time span between first and last native point
      nativeGpsPoints.sort((a, b) => a.timestamp - b.timestamp);
      const firstTimestamp = nativeGpsPoints[0].timestamp;
      const lastTimestamp = nativeGpsPoints[nativeGpsPoints.length - 1].timestamp;
      const totalTimeSpan = lastTimestamp - firstTimestamp;
      
      // Debug: Log first and last point times
      const firstTime = new Date(firstTimestamp).toLocaleTimeString('de-DE');
      const lastTime = new Date(lastTimestamp).toLocaleTimeString('de-DE');
      
      // Calculate breaks (gaps > 20 minutes between native points)
      const MIN_BREAK_MS = 20 * 60 * 1000; // 20 minutes
      let totalBreakTime = 0;
      const breaks: Array<{start: string, end: string, durationMin: number}> = [];
      
      for (let i = 1; i < nativeGpsPoints.length; i++) {
        const gap = nativeGpsPoints[i].timestamp - nativeGpsPoints[i - 1].timestamp;
        if (gap >= MIN_BREAK_MS) {
          totalBreakTime += gap;
          breaks.push({
            start: new Date(nativeGpsPoints[i - 1].timestamp).toLocaleTimeString('de-DE'),
            end: new Date(nativeGpsPoints[i].timestamp).toLocaleTimeString('de-DE'),
            durationMin: Math.round(gap / 60000)
          });
        }
      }
      
      // Active time = total span - break times
      userData.activeTime = totalTimeSpan - totalBreakTime;
      
      const activeHours = Math.floor(userData.activeTime / (1000 * 60 * 60));
      const activeMinutes = Math.floor((userData.activeTime % (1000 * 60 * 60)) / (1000 * 60));
      
      console.log(`[DailyStore] ${username} activeTime calculation:`, {
        nativePoints: nativeGpsPoints.length,
        firstPoint: firstTime,
        lastPoint: lastTime,
        totalSpanMin: Math.round(totalTimeSpan / 60000),
        breaks: breaks,
        totalBreakMin: Math.round(totalBreakTime / 60000),
        activeTime: `${activeHours}h ${activeMinutes}m`
      });
    } else {
      // 0 or 1 native points: Set to -1 to indicate "App not used"
      userData.activeTime = -1;
      console.log(`[DailyStore] No active time for ${username}: only ${nativeGpsPoints.length} native GPS point(s)`);
    }
  }

  /**
   * Recalculate distance from native GPS points during active time only
   * Distance = Sum of distances between consecutive native GPS points, excluding breaks ≥ 20 min
   */
  private recalculateDistance(userId: string, username: string): void {
    const userData = this.data.get(userId);
    if (!userData) return;

    // Step 1: Determine active time periods from NATIVE GPS points
    const nativeGpsPoints = userData.gpsPoints.filter(p => 
      p.source === 'native' || !p.source
    );
    
    if (nativeGpsPoints.length < 2) {
      userData.totalDistance = 0;
      return;
    }

    nativeGpsPoints.sort((a, b) => a.timestamp - b.timestamp);
    
    // Build active time periods (segments between native points, excluding breaks ≥ 20 min)
    const MIN_BREAK_MS = 20 * 60 * 1000; // 20 minutes
    const activePeriods: Array<{start: number, end: number}> = [];
    
    let periodStart = nativeGpsPoints[0].timestamp;
    
    for (let i = 1; i < nativeGpsPoints.length; i++) {
      const gap = nativeGpsPoints[i].timestamp - nativeGpsPoints[i - 1].timestamp;
      
      if (gap >= MIN_BREAK_MS) {
        // Break detected: close current period
        activePeriods.push({ start: periodStart, end: nativeGpsPoints[i - 1].timestamp });
        // Start new period after break
        periodStart = nativeGpsPoints[i].timestamp;
      }
    }
    
    // Add final period
    activePeriods.push({ start: periodStart, end: nativeGpsPoints[nativeGpsPoints.length - 1].timestamp });
    
    // Step 2: Use ALL GPS points (native + external) but ONLY within active periods
    const allGpsPoints = [...userData.gpsPoints];
    allGpsPoints.sort((a, b) => a.timestamp - b.timestamp);
    
    const WALKING_SPEED_KMH = 8; // Walking threshold
    let totalDistance = 0;
    
    // Helper function to check if timestamp is within any active period
    const isInActivePeriod = (timestamp: number): boolean => {
      return activePeriods.some(period => timestamp >= period.start && timestamp <= period.end);
    };
    
    for (let i = 1; i < allGpsPoints.length; i++) {
      const prevPoint = allGpsPoints[i - 1];
      const currPoint = allGpsPoints[i];
      
      // Only calculate distance if BOTH points are within active periods
      if (!isInActivePeriod(prevPoint.timestamp) || !isInActivePeriod(currPoint.timestamp)) {
        continue;
      }
      
      const gap = currPoint.timestamp - prevPoint.timestamp;
      
      // Calculate distance between consecutive points
      const distance = this.calculateDistance(
        prevPoint.latitude,
        prevPoint.longitude,
        currPoint.latitude,
        currPoint.longitude
      );
      
      // Calculate speed in km/h
      const timeDiffHours = gap / (1000 * 60 * 60);
      const speedKmh = timeDiffHours > 0 ? (distance / 1000) / timeDiffHours : 0;
      
      // Only count distance if walking speed (< 8 km/h)
      if (speedKmh < WALKING_SPEED_KMH) {
        totalDistance += distance;
      }
    }
    
    userData.totalDistance = totalDistance;
    console.log(`[DailyStore] ${username} distance: ${(totalDistance / 1000).toFixed(2)} km (walking speed only, from ${allGpsPoints.length} GPS points in ${activePeriods.length} active periods)`);
  }

  /**
   * Update session data
   */
  updateSession(userId: string, username: string, session: Partial<SessionData>): void {
    const userData = this.getUserData(userId, username);
    
    // BUGFIX: Validate session data is from today
    // Check if session has a valid timestamp to determine date
    const sessionTimestamp = session.lastActivity || Date.now();
    const sessionDate = new Date(sessionTimestamp);
    const sessionDateStr = getBerlinDate(sessionDate);
    const today = this.getCurrentDate();
    
    if (sessionDateStr !== today) {
      console.warn(`[DailyStore] Rejected session update from wrong date: ${sessionDateStr} (today: ${today}), user: ${username}`);
      return; // Skip session data from other days
    }

    if (session.sessionDuration !== undefined) {
      userData.totalSessionTime = session.sessionDuration;
    }

    if (session.idleTime !== undefined) {
      userData.totalIdleTime = session.idleTime;
      // NOTE: activeTime wird aus nativen GPS-Punkten berechnet, nicht hier!
    }

    if (session.actions && session.actions.length > 0) {
      // Process only NEW actions (track by timestamp to avoid duplicates from multiple syncs)
      let processedTimestamps = this.processedActionTimestamps.get(userId);
      if (!processedTimestamps) {
        processedTimestamps = new Set<number>();
        this.processedActionTimestamps.set(userId, processedTimestamps);
      }

      session.actions.forEach((action: ActionLog) => {
        if (!action.action) return; // Ignore empty actions

        // BUGFIX: Validate action timestamp is from today
        const actionDate = new Date(action.timestamp);
        const actionDateStr = getBerlinDate(actionDate);
        
        if (actionDateStr !== today) {
          console.warn(`[DailyStore] Rejected action from wrong date: ${actionDateStr} (today: ${today}), user: ${username}, action: ${action.action}`);
          return; // Skip actions from other days
        }
        
        // Skip if we've already processed this action
        if (processedTimestamps!.has(action.timestamp)) {
          return;
        }

        // BUGFIX: Ignore tracking/GPS actions
        if ((action.action as string) === 'gps_update' || (action.action as string) === 'external_app') {
          return;
        }

        // Mark as processed
        processedTimestamps!.add(action.timestamp);

        userData.totalActions++;

        // Count by type
        const count = userData.actionsByType.get(action.action) || 0;
        userData.actionsByType.set(action.action, count + 1);

        // Track STATUS CHANGES with backward compatibility
        if (action.action === 'status_change' && action.residentStatus) {
          // NEW LOGS (with previousStatus): Only count actual changes
          if (action.previousStatus !== undefined) {
            if (action.previousStatus !== action.residentStatus) {
              const statusCount = userData.statusChanges.get(action.residentStatus) || 0;
              userData.statusChanges.set(action.residentStatus, statusCount + 1);
            }
          }
          // OLD LOGS (without previousStatus): Count all status_change actions
          else {
            const statusCount = userData.statusChanges.get(action.residentStatus) || 0;
            userData.statusChanges.set(action.residentStatus, statusCount + 1);
          }
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
   * Add a single action directly (for API endpoints not tracked via /api/tracking/session)
   * This ensures actions like dataset_create, bulk_residents_update, etc. are counted
   */
  addAction(userId: string, username: string, actionType: string, residentStatus?: string, previousStatus?: string): void {
    if (!actionType) return; // Ignore empty actions
    
    const userData = this.getUserData(userId, username);
    
    const timestamp = Date.now();
    
    // Check if we've already processed this action timestamp
    let processedTimestamps = this.processedActionTimestamps.get(userId);
    if (!processedTimestamps) {
      processedTimestamps = new Set<number>();
      this.processedActionTimestamps.set(userId, processedTimestamps);
    }
    
    // Skip if already processed (avoid duplicates)
    if (processedTimestamps.has(timestamp)) {
      return;
    }
    
    // BUGFIX: Ignore tracking/GPS actions
    if (actionType === 'gps_update' || actionType === 'external_app') {
      return;
    }

    // Mark as processed
    processedTimestamps.add(timestamp);
    
    // Increment total actions
    userData.totalActions++;
    
    // Count by type
    const count = userData.actionsByType.get(actionType) || 0;
    userData.actionsByType.set(actionType, count + 1);
    
    // Track STATUS CHANGES
    if (actionType === 'status_change' && residentStatus) {
      // Only count actual changes if previousStatus is provided
      if (previousStatus !== undefined && previousStatus !== residentStatus) {
        const statusCount = userData.statusChanges.get(residentStatus) || 0;
        userData.statusChanges.set(residentStatus, statusCount + 1);
      }
      // Count all if previousStatus not provided (backward compatibility)
      else if (previousStatus === undefined) {
        const statusCount = userData.statusChanges.get(residentStatus) || 0;
        userData.statusChanges.set(residentStatus, statusCount + 1);
      }
    }
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
   * Falls back to photoTimestamps length if hash tracking was reset
   */
  getUniquePhotoCount(userId: string): number {
    const userHashes = this.uniquePhotoHashes.get(userId);
    if (userHashes && userHashes.size > 0) {
      return userHashes.size;
    }

    // Fallback: Use photoTimestamps count (used after server restart)
    const userData = this.data.get(userId);
    return userData?.photoTimestamps?.length || 0;
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
  }

  /**
   * Calculate final statuses and conversion rates for a user
   * This queries the address datasets to get current status of all edited residents
   */
  async calculateFinalStatusesAndConversions(userId: string, username: string, addressDatasetService: any): Promise<void> {
    const userData = this.data.get(userId);
    if (!userData) return;

    try {
      // Get all datasets created by this user today
      const today = new Date();
      const datasets = await addressDatasetService.getUserDatasetsByDate(username, today);

      // Calculate final statuses from current resident data
      const finalStatuses = new Map<string, number>();

      datasets.forEach((dataset: any) => {
        dataset.editableResidents.forEach((resident: any) => {
          if (resident.status) {
            const count = finalStatuses.get(resident.status) || 0;
            finalStatuses.set(resident.status, count + 1);
          }
        });
      });

      // Calculate conversion rates from interest_later
      // We need to track status changes over time from rawLogs
      const conversionRates = {
        interest_later_to_written: 0,
        interest_later_to_no_interest: 0,
        interest_later_to_appointment: 0,
        interest_later_to_not_reached: 0,
        interest_later_total: 0
      };

      // Track status change sequences from rawLogs
      const residentStatusHistory = new Map<string, string[]>(); // residentName -> [status1, status2, ...]

      // Build status history from action logs
      userData.rawLogs.forEach(log => {
        if (log.session?.actions) {
          log.session.actions.forEach((action: ActionLog) => {
            if (action.residentStatus && action.details) {
              // Extract resident name from details
              const match = action.details.match(/Resident:\s*(.+)/);
              if (match) {
                const residentName = match[1].trim();
                if (!residentStatusHistory.has(residentName)) {
                  residentStatusHistory.set(residentName, []);
                }
                residentStatusHistory.get(residentName)!.push(action.residentStatus);
              }
            }
          });
        }
      });

      // Analyze conversions from interest_later
      residentStatusHistory.forEach((history, residentName) => {
        for (let i = 0; i < history.length - 1; i++) {
          const currentStatus = history[i];
          const nextStatus = history[i + 1];

          if (currentStatus === 'interest_later') {
            conversionRates.interest_later_total++;

            if (nextStatus === 'written') {
              conversionRates.interest_later_to_written++;
            } else if (nextStatus === 'no_interest') {
              conversionRates.interest_later_to_no_interest++;
            } else if (nextStatus === 'appointment') {
              conversionRates.interest_later_to_appointment++;
            } else if (nextStatus === 'not_reached') {
              conversionRates.interest_later_to_not_reached++;
            }
          }
        }
      });

      // Only log if data has changed since last calculation
      const previousFinalStatuses = userData.finalStatuses || new Map();
      const previousConversions = userData.conversionRates || conversionRates;

      const statusesChanged =
        finalStatuses.size !== previousFinalStatuses.size ||
        Array.from(finalStatuses.entries()).some(([status, count]) =>
          previousFinalStatuses.get(status) !== count
        );

      const conversionsChanged =
        JSON.stringify(conversionRates) !== JSON.stringify(previousConversions);

      userData.finalStatuses = finalStatuses;
      userData.conversionRates = conversionRates;

      // Only log if data changed AND there are interesting conversion rates
      if ((statusesChanged || conversionsChanged)) {
        const hasConversions = Object.values(conversionRates).some(rate => rate > 0);
        if (hasConversions || finalStatuses.size > 3) {
          console.log(`[DailyStore] ${username}: ${finalStatuses.size} status types, conversions:`, conversionRates);
        }
      }
    } catch (error) {
      console.error('[DailyStore] Error calculating final statuses and conversions:', error);
    }
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
   * Initialize store with today's data from Google Sheets logs
   * Called on server startup to restore data after restart
   */
  async initializeFromLogs(): Promise<void> {
    const today = this.getCurrentDate();
    console.log(`[DailyStore] Initializing from logs for ${today}...`);
    
    try {
      // Import dynamically to avoid circular dependency
      const { scrapeDayData } = await import('./historicalDataScraper');
      
      // Scrape today's data from Google Sheets
      const todayData = await scrapeDayData(today);
      
      if (todayData.length === 0) {
        console.log('[DailyStore] No data found in logs for today');
        return;
      }

      // Load each user's data into RAM
      for (const userData of todayData) {
        this.data.set(userData.userId, userData);
        
        // Restore photo hashes (if stored in photoTimestamps)
        if (userData.photoTimestamps && userData.photoTimestamps.length > 0) {
          const userHashes = new Set<string>();
          // Note: We can't restore actual hashes, but we can track count
          // Future photo uploads will be properly deduplicated
          this.uniquePhotoHashes.set(userData.userId, userHashes);
        }
        
        // Restore processed action timestamps from rawLogs
        if (userData.rawLogs && userData.rawLogs.length > 0) {
          const actionTimestamps = new Set<number>();
          userData.rawLogs.forEach(log => {
            if (log.session?.actions) {
              log.session.actions.forEach(action => {
                actionTimestamps.add(action.timestamp);
              });
            }
          });
          this.processedActionTimestamps.set(userData.userId, actionTimestamps);
        }
      }

      console.log(`[DailyStore] ✅ Loaded ${todayData.length} users from logs`);
    } catch (error) {
      console.error('[DailyStore] ❌ Error initializing from logs:', error);
      // Continue with empty store - not critical
    }
  }

  /**
   * Reset all data (called at midnight)
   */
  reset(): void {
    console.log('[DailyStore] Resetting daily data...');
    this.data.clear();
    this.uniquePhotoHashes.clear(); // Reset photo tracking
    this.processedActionTimestamps.clear(); // Reset action tracking
    this.currentDate = this.getCurrentDate();
  }

  /**
   * Clear specific user data
   */
  clearUser(userId: string): void {
    this.data.delete(userId);
    this.uniquePhotoHashes.delete(userId); // Clear user's photo hashes
    this.processedActionTimestamps.delete(userId); // Clear user's processed actions
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
