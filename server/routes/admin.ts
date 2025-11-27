/**
 * Admin Dashboard API Routes
 *
 * Stellt Endpunkte für das Admin-Dashboard bereit:
 * - Live-Daten (aktueller Tag aus RAM)
 * - Historische Daten (vergangene Tage aus SQLite + Drive)
 * - PDF-Reports (Download & Status)
 */

import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { dailyDataStore } from '../services/dailyDataStore';
import { scrapeDayDataFromSQLite as scrapeDayData, clearHistoricalCache, getCacheStats } from '../services/sqliteHistoricalData';
import { getCETDate } from '../services/sqliteLogService';
import { getBerlinDate, getBerlinHour, getBerlinTimestamp } from '../utils/timezone';
import { pauseLocationCache } from '../services/pauseLocationCache';
import { egonOrdersDB } from '../services/egonScraperService';
import fs from 'fs';
import path from 'path';
import type { DailyUserData, DashboardLiveData, TrackingData, ActionLog } from '../../shared/trackingTypes';

const router = Router();

/**
 * Calculate action details breakdown from actionsByType Map
 */
function calculateActionDetails(userData: DailyUserData): {
  scans: number;
  ocrCorrections: number;
  datasetCreates: number;
  geocodes: number;
  edits: number;
  saves: number;
  deletes: number;
  statusChanges: number;
  navigations: number;
  other: number;
} {
  const details = {
    scans: userData.actionsByType.get('scan') || 0,
    ocrCorrections: userData.actionsByType.get('bulk_residents_update') || 0,
    datasetCreates: userData.actionsByType.get('dataset_create') || 0,
    geocodes: userData.actionsByType.get('geocode') || 0,
    // Map actual action types to expected frontend names
    edits: userData.actionsByType.get('resident_update') || 0,
    saves: 0, // Deprecated: bulk updates are now tracked as ocrCorrections
    deletes: userData.actionsByType.get('resident_delete') || 0,
    statusChanges: userData.actionsByType.get('status_change') || 0,
    navigations: userData.actionsByType.get('navigate') || 0,
    other: 0
  };

  // Calculate "other" by summing all remaining unmapped action types
  const knownActions = new Set([
    'scan', 'bulk_residents_update', 'dataset_create', 'geocode',
    'resident_update', 'resident_delete', 'status_change', 'navigate'
  ]);
  
  // Actions to explicitly ignore (not "other", just ignore)
  const ignoredActions = new Set(['gps_update', 'external_app', 'unknown', '', 'undefined', 'null']);

  userData.actionsByType.forEach((count, actionType) => {
    if (!knownActions.has(actionType) && !ignoredActions.has(actionType)) {
      console.log(`[Admin API] Found unknown action type: "${actionType}" (count: ${count}) for user ${userData.username}`);
      details.other += count;
    }
  });

  return details;
}

/**
 * Calculate peak time period (most active consecutive hours)
 */
function calculatePeakTime(rawLogs: TrackingData[]): string | undefined {
  if (rawLogs.length === 0) return undefined;

  // Group activities by hour
  const hourlyActivity = new Map<number, number>();
  
  for (const log of rawLogs) {
    const hour = getBerlinHour(log.timestamp);
    hourlyActivity.set(hour, (hourlyActivity.get(hour) || 0) + 1);
  }

  if (hourlyActivity.size === 0) return undefined;

  // Find consecutive hours with highest total activity
  const hours = Array.from(hourlyActivity.keys()).sort((a, b) => a - b);
  let maxActivity = 0;
  let maxStart = hours[0];
  let maxEnd = hours[0];

  // Try different window sizes (1-4 hours)
  for (let windowSize = 1; windowSize <= 4; windowSize++) {
    for (let i = 0; i <= hours.length - windowSize; i++) {
      const windowHours = hours.slice(i, i + windowSize);
      // Check if hours are consecutive
      let isConsecutive = true;
      for (let j = 1; j < windowHours.length; j++) {
        if (windowHours[j] - windowHours[j - 1] !== 1) {
          isConsecutive = false;
          break;
        }
      }
      
      if (isConsecutive) {
        const windowActivity = windowHours.reduce((sum, h) => sum + (hourlyActivity.get(h) || 0), 0);
        if (windowActivity > maxActivity) {
          maxActivity = windowActivity;
          maxStart = windowHours[0];
          maxEnd = windowHours[windowHours.length - 1];
        }
      }
    }
  }

  // Format as "HH:00-HH:00"
  const startStr = maxStart.toString().padStart(2, '0');
  const endStr = (maxEnd + 1).toString().padStart(2, '0');
  return `${startStr}:00-${endStr}:00`;
}

/**
 * Calculate distance between two GPS points (Haversine formula, in meters)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

/**
 * Parse EGON timestamp format to Unix milliseconds
 * Format: "DD.MM.YYYY HH:MM:SS" (German format, in MEZ/CEST timezone)
 * The timestamp is already in Berlin timezone - we need to interpret it correctly
 * @returns Unix timestamp in milliseconds, or null if parsing fails
 */
function parseEgonTimestamp(egonTimestamp: string): number | null {
  try {
    // Format: "DD.MM.YYYY HH:MM:SS"
    const match = egonTimestamp.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    
    const [, day, month, year, hour, minute, second] = match;
    
    // Use Luxon to correctly interpret the time as Berlin timezone
    // This ensures the UTC timestamp is correct regardless of server timezone
    const { DateTime } = require('luxon');
    const berlinDateTime = DateTime.fromObject(
      {
        year: parseInt(year),
        month: parseInt(month),
        day: parseInt(day),
        hour: parseInt(hour),
        minute: parseInt(minute),
        second: parseInt(second)
      },
      { zone: 'Europe/Berlin' }
    );
    
    if (!berlinDateTime.isValid) return null;
    return berlinDateTime.toMillis();
  } catch {
    return null;
  }
}

/**
 * Check if a contract was written during a break period
 * @param breakStart Break start timestamp (Unix ms)
 * @param breakEnd Break end timestamp (Unix ms)
 * @param contracts Array of contract timestamps (Unix ms)
 * @returns Array of contract timestamps that fall within the break
 */
function getContractsInBreak(breakStart: number, breakEnd: number, contractTimestamps: number[]): number[] {
  return contractTimestamps.filter(ts => ts >= breakStart && ts <= breakEnd);
}

/**
 * Calculate all breaks longer than 20 minutes (time gaps between GPS tracking)
 * 
 * POI lookup rules (to minimize API calls):
 * 1. Break must be ≥20 minutes (native GPS gap - background tracking every 5min)
 * 2. External tracking data (separate native app via /api/external-tracking/location) must be available during the break
 * 3. User must stay within 50m radius for ≥3 seconds during the break (from external tracking data)
 * 
 * Only when ALL conditions are met, a POI lookup is performed.
 */
async function calculateBreaks(rawLogs: TrackingData[], contractTimestamps: number[] = []): Promise<Array<{ 
  start: number; 
  end: number; 
  duration: number;
  location?: { lat: number; lng: number }; // Center of stationary period
  locations?: Array<{
    poi_name: string;
    poi_type: string;
    address: string;
    place_id: string;
    durationAtLocation?: number;
  }>;
  isCustomerConversation?: boolean; // True if contract was written during this break
  contractsInBreak?: number[]; // Contract timestamps that fall within this break
}>> {
  if (rawLogs.length < 2) {
    console.log('[calculateBreaks] ❌ Not enough logs:', rawLogs.length);
    return [];
  }

  // Check if POI lookups are enabled
  const poiEnabled = process.env.ENABLE_POI_LOOKUPS !== 'false';
  console.log('[calculateBreaks] 🔧 POI lookups enabled:', poiEnabled);

  // Filter to only NATIVE GPS logs (matching activeTime calculation)
  const nativeGpsLogs = rawLogs.filter(log => 
    log.gps !== undefined && 
    (log.gps.source === 'native' || !log.gps.source)
  );

  console.log(`[calculateBreaks] 📊 Total logs: ${rawLogs.length}, Native GPS: ${nativeGpsLogs.length}`);

  if (nativeGpsLogs.length < 2) {
    console.log('[calculateBreaks] ❌ Not enough native GPS logs');
    return [];
  }

  // Sort native GPS logs by timestamp
  const sortedNativeLogs = [...nativeGpsLogs].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate all gaps between native GPS updates
  const gaps: Array<{ 
    start: number; 
    end: number; 
    duration: number; 
  }> = [];

  for (let i = 1; i < sortedNativeLogs.length; i++) {
    const gap = sortedNativeLogs[i].timestamp - sortedNativeLogs[i - 1].timestamp;
    const minBreakDuration = 20 * 60 * 1000; // 20 minutes

    if (gap >= minBreakDuration) {
      gaps.push({
        start: sortedNativeLogs[i - 1].timestamp,
        end: sortedNativeLogs[i].timestamp,
        duration: gap,
      });
    }
  }

  // Sort chronologically (by start time) to maintain correct order
  const sortedGaps = gaps.sort((a, b) => a.start - b.start);

  console.log(`[calculateBreaks] 🔍 Found ${sortedGaps.length} gaps (≥20min)`);

  // Enrich with POI information (only if conditions are met)
  const enrichedGaps = await Promise.all(
    sortedGaps.map(async (gap) => {
      const gapMinutes = Math.round(gap.duration / 60000);
      console.log(`[calculateBreaks]   Gap: ${gapMinutes}min (${new Date(gap.start).toLocaleTimeString()} - ${new Date(gap.end).toLocaleTimeString()})`);

      // Skip POI lookup if disabled
      if (!poiEnabled) {
        console.log('[calculateBreaks]     ⏭️  POI lookup disabled');
        return { start: gap.start, end: gap.end, duration: gap.duration };
      }

      // Rule 1: Check if external tracking data (separate native tracking app) is available during the break
      // External tracking app sends high-frequency GPS data via /api/external-tracking/location
      const externalTrackingLogs = rawLogs.filter(log => 
        log.gps?.source === 'external_app' &&
        log.timestamp >= gap.start && 
        log.timestamp <= gap.end &&
        typeof log.gps.latitude === 'number' && 
        typeof log.gps.longitude === 'number' &&
        !isNaN(log.gps.latitude) && 
        !isNaN(log.gps.longitude)
      );

      console.log(`[calculateBreaks]     External GPS points: ${externalTrackingLogs.length}`);

      if (externalTrackingLogs.length === 0) {
        // No external tracking data during break - skip POI lookup
        console.log('[calculateBreaks]     ❌ No external tracking data');
        return { start: gap.start, end: gap.end, duration: gap.duration };
      }

      // Rule 2: Check if user stayed within 50m radius for ≥3 seconds
      const sortedExternalLogs = externalTrackingLogs.sort((a, b) => a.timestamp - b.timestamp);
      
      let stationaryPeriod: { lat: number; lng: number; duration: number } | null = null;
      
      for (let i = 0; i < sortedExternalLogs.length; i++) {
        const startLog = sortedExternalLogs[i];
        let maxDuration = 0;
        let endIndex = i;
        
        // Find how long user stayed within 50m of this point
        for (let j = i + 1; j < sortedExternalLogs.length; j++) {
          const currentLog = sortedExternalLogs[j];
          const distance = calculateDistance(
            startLog.gps!.latitude, startLog.gps!.longitude,
            currentLog.gps!.latitude, currentLog.gps!.longitude
          );
          
          if (distance <= 50) {
            endIndex = j;
            maxDuration = currentLog.timestamp - startLog.timestamp;
          } else {
            break; // Left the 50m radius
          }
        }
        
        // Check if stayed ≥3 seconds
        if (maxDuration >= 3000 && (!stationaryPeriod || maxDuration > stationaryPeriod.duration)) {
          stationaryPeriod = {
            lat: startLog.gps!.latitude,
            lng: startLog.gps!.longitude,
            duration: maxDuration
          };
        }
      }

      if (!stationaryPeriod) {
        // User didn't stay in 50m radius for ≥3 seconds - skip POI lookup
        console.log('[calculateBreaks]     ❌ No stationary period (≥3s in 50m radius)');
        return { start: gap.start, end: gap.end, duration: gap.duration };
      }

      console.log(`[calculateBreaks]     ✅ Stationary period found: ${Math.round(stationaryPeriod.duration / 1000)}s at [${stationaryPeriod.lat.toFixed(5)}, ${stationaryPeriod.lng.toFixed(5)}]`);

      // All conditions met - perform POI lookup
      try {
        const poiInfo = await pauseLocationCache.getPOIInfo(stationaryPeriod.lat, stationaryPeriod.lng);
        console.log(`[calculateBreaks]     🏪 POI lookup returned ${poiInfo.length} places`);
        
        // Calculate actual time spent within 50m of each POI
        const enrichedPOIs = poiInfo.map(poi => {
          // Find all external tracking points within 50m of THIS POI (not stationary period center)
          const pointsNearPOI = sortedExternalLogs.filter(log => {
            const distance = calculateDistance(
              log.gps!.latitude,
              log.gps!.longitude,
              poi.lat,
              poi.lng
            );
            return distance <= 50;
          });

          let timeAtPOI = 0;
          if (pointsNearPOI.length > 0) {
            const firstPoint = pointsNearPOI[0].timestamp;
            const lastPoint = pointsNearPOI[pointsNearPOI.length - 1].timestamp;
            timeAtPOI = Math.round((lastPoint - firstPoint) / 60000); // minutes
            
            // Edge case: Single point or very short duration
            if (timeAtPOI === 0 && pointsNearPOI.length > 0) {
              timeAtPOI = 1; // At least 1 minute if user was detected there
            }
          }

          return {
            poi_name: poi.name,
            poi_type: poi.type,
            address: poi.address,
            place_id: poi.placeId,
            durationAtLocation: timeAtPOI
          };
        });

        console.log(`[calculateBreaks] POI lookup for ${Math.round(stationaryPeriod.duration / 1000)}s stationary period, found ${enrichedPOIs.length} POIs`);
        
        return {
          start: gap.start,
          end: gap.end,
          duration: gap.duration,
          location: { lat: stationaryPeriod.lat, lng: stationaryPeriod.lng }, // Add GPS coordinates
          locations: enrichedPOIs.length > 0 ? enrichedPOIs : undefined
        };
      } catch (error) {
        console.error('[calculateBreaks] Error fetching POI info:', error);
        return { 
          start: gap.start, 
          end: gap.end, 
          duration: gap.duration,
          location: { lat: stationaryPeriod.lat, lng: stationaryPeriod.lng } // Include location even on error
        };
      }
    })
  );

  // Enrich breaks with customer conversation detection (based on EGON contracts)
  const breaksWithContracts = enrichedGaps.map(gap => {
    const contractsInThisBreak = getContractsInBreak(gap.start, gap.end, contractTimestamps);
    const isCustomerConversation = contractsInThisBreak.length > 0;
    
    if (isCustomerConversation) {
      console.log(`[calculateBreaks] 📝 Kundengespräch detected: ${contractsInThisBreak.length} contract(s) during break ${new Date(gap.start).toLocaleTimeString()} - ${new Date(gap.end).toLocaleTimeString()}`);
    }
    
    return {
      ...gap,
      isCustomerConversation,
      contractsInBreak: contractsInThisBreak.length > 0 ? contractsInThisBreak : undefined
    };
  });

  return breaksWithContracts;
}

/**
 * Middleware: Prüft Admin-Rechte
 */
function requireAdmin(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!req.isAdmin) {
    return res.status(403).json({ 
      error: 'Access denied. Admin privileges required.' 
    });
  }
  next();
}

/**
 * GET /api/admin/dashboard/live
 * Gibt Live-Daten für den aktuellen Tag zurück
 */
router.get('/dashboard/live', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Admin API] Fetching live dashboard data');

    // Import addressDatasetService for final status calculation
    const { addressDatasetService, googleSheetsService } = await import('../services/googleSheets');

    const allUserData = dailyDataStore.getAllUserData();

    // Calculate final statuses and conversions for all users
    await Promise.all(
      Array.from(allUserData.values()).map(userData => 
        dailyDataStore.calculateFinalStatusesAndConversions(
          userData.userId,
          userData.username,
          addressDatasetService
        )
      )
    );

    // Get today's date in EGON format (DD.MM.YYYY) - use Berlin timezone
    const berlinTodayStr = getBerlinDate(); // Returns YYYY-MM-DD
    const [yearB, monthB, dayB] = berlinTodayStr.split('-');
    const todayEgonFormat = `${dayB}.${monthB}.${yearB}`;
    
    // Load all users to get resellerName mapping
    const allUsers = await googleSheetsService.getAllUsers();
    const userIdToResellerName = new Map<string, string>();
    allUsers.forEach(user => {
      if (user.resellerName) {
        userIdToResellerName.set(user.userId, user.resellerName);
      }
    });

    // Get EGON contract counts for users with resellerNames
    const resellerNames = allUsers.filter(u => u.resellerName).map(u => u.resellerName!);
    const egonContractCounts = egonOrdersDB.getCountsByResellersAndDate(resellerNames, todayEgonFormat);
    
    // Debug: Log all users with resellerNames
    console.log(`[Admin API LIVE] 📝 Users with resellerNames:`);
    allUsers.filter(u => u.resellerName).forEach(u => {
      console.log(`  - ${u.username} (userId: ${u.userId}) → resellerName: "${u.resellerName}"`);
    });
    console.log(`[Admin API LIVE] 📝 EGON contract counts from DB:`);
    egonContractCounts.forEach((count, name) => {
      console.log(`  - "${name}": ${count} contracts`);
    });
    
    // Create userId -> contract count mapping
    const userIdToContractCount = new Map<string, number>();
    allUsers.forEach(user => {
      if (user.resellerName && egonContractCounts.has(user.resellerName)) {
        userIdToContractCount.set(user.userId, egonContractCounts.get(user.resellerName)!);
        console.log(`[Admin API LIVE] ✅ Mapped ${user.username} → ${egonContractCounts.get(user.resellerName)} contracts`);
      }
    });

    console.log(`[Admin API LIVE] 📝 EGON contracts loaded: ${egonContractCounts.size} resellers with contracts, ${todayEgonFormat}`);

    // Konvertiere Map zu Array und sortiere nach totalActions
    const usersArray = Array.from(allUserData.values()).sort((a, b) => {
      return b.totalActions - a.totalActions;
    });

    // Transformiere DailyUserData zu DashboardLiveData Format (async)
    const dashboardUsers = await Promise.all(usersArray.map(async userData => {
      // Find the last VALID GPS point (filter out corrupted coordinates like lat=0, lng=0)
      const validGpsPoints = userData.gpsPoints.filter(p => {
        const lat = p.latitude;
        const lng = p.longitude;
        return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90 && Math.abs(lat) > 0.001 &&
               typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180 && Math.abs(lng) > 0.001;
      });
      const lastGpsPoint = validGpsPoints.length > 0 
        ? validGpsPoints[validGpsPoints.length - 1]
        : undefined;
      
      // Status changes are now tracked consistently in statusChanges Map (backward compatible)
      const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((sum, count) => sum + count, 0);

      // Konvertiere Map zu Objekt für JSON-Serialisierung
      const statusChangesObj: Record<string, number> = {};
      userData.statusChanges.forEach((count, status) => {
        statusChangesObj[status] = count;
      });

      // Berechne finalStatuses aus addressDatasetService (aktuelle Status der bearbeiteten Anwohner)
      const finalStatusesMap = userData.finalStatuses || new Map();
      const finalStatusesObj: Record<string, number> = {};
      finalStatusesMap.forEach((count, status) => {
        finalStatusesObj[status] = count;
      });

      // Berechne conversionRates aus historischen Status-Änderungen
      const conversionRates = userData.conversionRates || {
        interest_later_to_written: 0,
        interest_later_to_no_interest: 0,
        interest_later_to_appointment: 0,
        interest_later_to_not_reached: 0,
        interest_later_total: 0
      };

      // Calculate action details breakdown
      const actionDetails = calculateActionDetails(userData);

      // Calculate peak time and breaks (await breaks)
      const peakTime = calculatePeakTime(userData.rawLogs);
      const breaks = await calculateBreaks(userData.rawLogs);
      
      console.log(`[Admin API LIVE] 📍 User ${userData.username}: Calculated ${breaks.length} breaks from ${userData.rawLogs.length} logs`);
      if (breaks.length > 0) {
        breaks.forEach((b, idx) => {
          console.log(`[Admin API LIVE]   Break ${idx + 1}: ${Math.round(b.duration / 60000)}min, locations: ${b.locations?.length || 0}, hasLocation: ${!!b.location}`);
        });
      }

      // Debug: Log if breaks are empty but rawLogs exist
      if (breaks.length === 0 && userData.rawLogs.length > 0) {
        const nativeGps = userData.rawLogs.filter(log => log.gps && (log.gps.source === 'native' || !log.gps.source));
        const externalGps = userData.rawLogs.filter(log => log.gps?.source === 'external_app');
        console.log(`[Admin API] ⚠️  No breaks for ${userData.username}: ${nativeGps.length} native GPS, ${externalGps.length} external GPS`);
      }

      // Determine if user is currently active (last activity within 15 minutes)
      const lastActivityTime = userData.rawLogs.length > 0 
        ? userData.rawLogs[userData.rawLogs.length - 1].timestamp 
        : 0;
      const isCurrentlyActive = userData.activeTime > 0 && (Date.now() - lastActivityTime) < 15 * 60 * 1000; // 15 minutes

      // Get EGON contract count for this user
      const egonContracts = userIdToContractCount.get(userData.userId) || 0;

      return {
        userId: userData.userId,
        username: userData.username,
        currentLocation: lastGpsPoint,
        isActive: isCurrentlyActive,
        lastSeen: userData.rawLogs.length > 0 
          ? userData.rawLogs[userData.rawLogs.length - 1].timestamp 
          : Date.now(),
        todayStats: {
          totalActions: userData.totalActions,
          actionDetails,
          statusChanges: statusChangesObj,
          finalStatuses: finalStatusesObj,
          conversionRates,
          activeTime: userData.activeTime,
          distance: userData.totalDistance,
          uniquePhotos: dailyDataStore.getUniquePhotoCount(userData.userId),
          peakTime,
          breaks,
          egonContracts, // EGON contract count from egon_orders.db
        },
      };
    }));

    const totalStatusChanges = usersArray.reduce((sum, u) => {
      return sum + Array.from(u.statusChanges.values()).reduce((s, c) => s + c, 0);
    }, 0);

    const response: DashboardLiveData = {
      timestamp: Date.now(),
      users: dashboardUsers,
    };

    res.json({
      ...response,
      date: getBerlinDate(),
      totalUsers: usersArray.length,
      activeUsers: usersArray.filter(u => u.activeTime > 0).length,
      totalStatusChanges,
      totalDistance: usersArray.reduce((sum, u) => sum + u.totalDistance, 0),
    });
  } catch (error) {
    console.error('[Admin API] Error fetching live data:', error);
    res.status(500).json({ error: 'Failed to fetch live dashboard data' });
  }
});

/**
 * GET /api/admin/dashboard/historical?date=YYYY-MM-DD&userId=optional
 * Gibt historische Daten für ein bestimmtes Datum zurück
 */
router.get('/dashboard/historical', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  // Deklariere date und userId außerhalb des try-Blocks für catch-Block Zugriff
  let date: string | undefined;
  let userId: string | undefined;
  
  try {
    date = req.query.date as string | undefined;
    userId = req.query.userId as string | undefined;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Date parameter required (format: YYYY-MM-DD)' });
    }

    // Validiere Datumsformat
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Prüfe ob Datum in der Zukunft liegt
    const requestedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate > today) {
      return res.status(400).json({ error: 'Cannot fetch data for future dates' });
    }

    console.log(`[Admin API] 🔍 Fetching historical data for ${date}${userId ? ` (user: ${userId})` : ''}`);

    // Scrape Daten aus Google Sheets
    let userData: DailyUserData[];
    try {
      userData = await scrapeDayData(date, userId as string | undefined);
      console.log(`[Admin API] ✅ Successfully scraped ${userData.length} user records`);
    } catch (scrapeError: any) {
      console.error(`[Admin API] ❌ Error scraping data:`, scrapeError.message);
      throw scrapeError; // Re-throw für äußeren catch
    }

    // Sortiere nach totalActions
    userData.sort((a, b) => b.totalActions - a.totalActions);

    // Transformiere zu DashboardLiveData Format (async)
    const dashboardUsers = await Promise.all(userData.map(async user => {
      // Find the last VALID GPS point (filter out corrupted coordinates like lat=0, lng=0)
      const validGpsPoints = user.gpsPoints.filter(p => {
        const lat = p.latitude;
        const lng = p.longitude;
        return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90 && Math.abs(lat) > 0.001 &&
               typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180 && Math.abs(lng) > 0.001;
      });
      const lastGpsPoint = validGpsPoints.length > 0 
        ? validGpsPoints[validGpsPoints.length - 1]
        : undefined;
      
      // Konvertiere Map zu Objekt für JSON-Serialisierung
      const statusChangesObj: Record<string, number> = {};
      user.statusChanges.forEach((count, status) => {
        statusChangesObj[status] = count;
      });

      // Berechne finalStatuses aus historischen Daten
      const finalStatusesMap = user.finalStatuses || new Map();
      const finalStatusesObj: Record<string, number> = {};
      finalStatusesMap.forEach((count, status) => {
        finalStatusesObj[status] = count;
      });

      // Berechne conversionRates aus historischen Daten
      const conversionRates = user.conversionRates || {
        interest_later_to_written: 0,
        interest_later_to_no_interest: 0,
        interest_later_to_appointment: 0,
        interest_later_to_not_reached: 0,
        interest_later_total: 0
      };

      // Calculate action details breakdown
      const actionDetails = calculateActionDetails(user);

      // Calculate peak time and breaks (await breaks)
      const peakTime = calculatePeakTime(user.rawLogs);
      const breaks = await calculateBreaks(user.rawLogs);
      
      console.log(`[Admin API] 📍 User ${user.username}: Calculated ${breaks.length} breaks`);
      if (breaks.length > 0) {
        breaks.forEach((b, idx) => {
          console.log(`[Admin API]   Break ${idx + 1}: ${Math.round(b.duration / 60000)}min, locations: ${b.locations?.length || 0}, hasLocation: ${!!b.location}`);
        });
      }

      // For historical data, always set isActive to false (it's past data)
      // Historical data is never "active" since it's from a previous day
      const isActive = false;

      return {
        userId: user.userId,
        username: user.username,
        currentLocation: lastGpsPoint,
        isActive: isActive,
        lastSeen: user.rawLogs.length > 0 
          ? user.rawLogs[user.rawLogs.length - 1].timestamp 
          : Date.now(),
        todayStats: {
          totalActions: user.totalActions,
          actionDetails,
          statusChanges: statusChangesObj,
          finalStatuses: finalStatusesObj,
          conversionRates,
          activeTime: user.activeTime,
          distance: user.totalDistance,
          uniquePhotos: user.uniquePhotos || 0, // Use actual value from historical data
          peakTime,
          breaks,
        },
      };
    }));

    // DEBUG: Log response for Raphael to verify uniquePhotos is sent
    const raphaelUser = dashboardUsers.find(u => u.username === 'Raphael');
    if (raphaelUser) {
      console.log(`[Admin API] 🔍 Raphael response for ${date}:`, {
        username: raphaelUser.username,
        totalActions: raphaelUser.todayStats.totalActions,
        uniquePhotos: raphaelUser.todayStats.uniquePhotos,
        statusChangesCount: Object.keys(raphaelUser.todayStats.statusChanges).length
      });
    }

    const totalStatusChanges = userData.reduce((sum, u) => {
      return sum + Array.from(u.statusChanges.values()).reduce((s, c) => s + c, 0);
    }, 0);

    const response: DashboardLiveData = {
      timestamp: Date.now(),
      users: dashboardUsers,
    };

    res.json({
      ...response,
      date,
      totalUsers: userData.length,
      activeUsers: userData.filter(u => u.activeTime > 0).length,
      totalStatusChanges,
      totalDistance: userData.reduce((sum, u) => sum + u.totalDistance, 0),
    });

    // Cache nach Verwendung löschen (15 Minuten für bessere Performance)
    setTimeout(() => {
      clearHistoricalCache(date, userId as string | undefined);
    }, 15 * 60 * 1000); // 15 minutes

  } catch (error: any) {
    console.error('[Admin API] ❌ Error fetching historical data:', error);
    
    // Detaillierte Fehlerausgabe für Debugging
    const errorMessage = error.message || 'Failed to fetch historical data';
    const errorDetails = {
      error: errorMessage,
      date,
      timestamp: getBerlinTimestamp(),
    };
    
    // Log vollständigen Fehler-Stack für Server-Debugging
    if (error.stack) {
      console.error('[Admin API] Error stack:', error.stack);
    }
    
    res.status(500).json(errorDetails);
  }
});

/**
 * GET /api/admin/dashboard/route
 * Gibt GPS-Punkte und Photo-Timestamps für einen bestimmten User und Datum zurück
 */
router.get('/dashboard/route', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, date, source } = req.query;

    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required' });
    }

    const dateStr = date as string;
    const userIdStr = userId as string;
    const sourceFilter = source as string | undefined; // 'native', 'followmee', 'external', 'external_app', or undefined (all)
    const today = getBerlinDate(); // Für Cache-Logik am Ende

    console.log(`[Admin API] Fetching route data for user ${userIdStr} on ${dateStr} (source: ${sourceFilter || 'all'})`);

    let gpsPoints: any[] = [];
    let photoTimestamps: number[] = [];
    let username = '';
    let contractTimestamps: number[] = [];
    let contractCount = 0;

    // Finde Username für userId (wird immer benötigt)
    const { googleSheetsService } = await import('../services/googleSheets');
    const allUsers = await googleSheetsService.getAllUsers();
    const user = allUsers.find(u => u.userId === userIdStr);

    if (user) {
      username = user.username;
      
      // Load EGON contracts for this user (if they have a resellerName)
      if (user.resellerName) {
        // Convert dateStr from YYYY-MM-DD to DD.MM.YYYY for EGON database query
        const [year, month, day] = dateStr.split('-');
        const egonDateStr = `${day}.${month}.${year}`;
        
        const egonOrders = egonOrdersDB.getByResellerAndDate(user.resellerName, egonDateStr);
        contractCount = egonOrders.length;
        
        // Convert EGON timestamps to Unix milliseconds
        contractTimestamps = egonOrders
          .map(order => parseEgonTimestamp(order.timestamp))
          .filter((ts): ts is number => ts !== null);
        
        console.log(`[Admin API Route] 📝 EGON Orders: ${contractCount} contracts for ${user.resellerName} on ${egonDateStr}`);
      } else {
        console.log(`[Admin API Route] ⚠️ No EGON reseller name for user ${username}`);
      }
    }

    // Lade Daten (native/followmee/external_app aus Logs/SQLite)
    // WICHTIG: Immer aus SQLite laden, auch für heute!
    // Der dailyDataStore (RAM) wird nur beim Server-Start aus Google Sheets initialisiert,
    // aber wenn Sheets voll ist (10M Zellen Limit), werden neue GPS-Punkte nur in SQLite gespeichert.
    // SQLite enthält IMMER alle GPS-Punkte (wird direkt beschrieben via enhancedLogging).
    const historicalData = await scrapeDayData(dateStr, userIdStr);
    
    console.log(`[Admin API Route] 📊 SQLite loaded: ${historicalData?.length || 0} users, ${historicalData?.[0]?.gpsPoints?.length || 0} GPS points for ${dateStr}`);

    if (historicalData && historicalData.length > 0) {
      const userData = historicalData[0];
      gpsPoints = userData.gpsPoints;
      if (!username) username = userData.username;
      photoTimestamps = userData.photoTimestamps || [];
    }

    // Externe Tracking-Daten sind bereits in gpsPoints enthalten (aus SQLite mit source: 'external_app')
    // Kein separates Laden mehr nötig

    // CRITICAL FIX #1: Filter out corrupted GPS coordinates IMMEDIATELY after loading
    // This catches lat=0, lng=0, or near-zero values from the external tracking app
    const loadedCount = gpsPoints.length;
    gpsPoints = gpsPoints.filter(point => {
      const lat = point.latitude;
      const lng = point.longitude;
      // Strict validation: must be number, finite, in valid range, and not near zero
      const isValidLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && Math.abs(lat) > 0.001;
      const isValidLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180 && Math.abs(lng) > 0.001;
      return isValidLat && isValidLng;
    });
    const corruptedCount = loadedCount - gpsPoints.length;
    if (corruptedCount > 0) {
      console.warn(`[Admin API] ⚠️ IMMEDIATELY filtered ${corruptedCount} corrupted GPS points after loading`);
    }

    // CRITICAL FIX #2: Filter out points that don't match the requested date
    // This removes old FollowMee data that might have been merged incorrectly
    gpsPoints = gpsPoints.filter(point => {
      const pointDate = getBerlinDate(point.timestamp);
      return pointDate === dateStr;
    });

    // Filter GPS points by source if specified
    if (sourceFilter && sourceFilter !== 'all') {
      if (sourceFilter === 'external' || sourceFilter === 'external_app') {
        // Für external/external_app: zeige nur Punkte mit source 'external_app'
        gpsPoints = gpsPoints.filter(point => point.source === 'external_app');
        console.log(`[Admin API] Filtered to ${gpsPoints.length} external_app GPS points`);
      } else {
        // Für native/followmee: exakte Filterung
        gpsPoints = gpsPoints.filter(point => point.source === sourceFilter);
        console.log(`[Admin API] Filtered to ${gpsPoints.length} ${sourceFilter} GPS points`);
      }
    }

    // Ignore GPS points recorded before 06:00 local time
    gpsPoints = gpsPoints.filter(point => {
      const hour = getBerlinHour(point.timestamp);
      return hour >= 6;
    });

    // Note: Corrupted GPS coordinates already filtered immediately after loading (see above)

    // Calculate breaks with POI information (if available)
    let breaks: Array<{
      start: number;
      end: number;
      duration: number;
      location?: { lat: number; lng: number };
      locations?: Array<{
        poi_name: string;
        poi_type: string;
        address: string;
        place_id: string;
        durationAtLocation?: number;
      }>;
      isCustomerConversation?: boolean;
      contractsInBreak?: number[];
    }> = [];

    // Fetch raw logs for break calculation (aus SQLite, nicht RAM)
    let rawLogs: TrackingData[] = [];
    // Lade aus SQLite (historicalData wurde oben bereits geladen)
    if (historicalData && historicalData.length > 0) {
      rawLogs = historicalData[0].rawLogs;
    }

    if (rawLogs.length > 0) {
      // Filter rawLogs by date as well to ensure break calculation is correct
      rawLogs = rawLogs.filter(log => {
        const logDate = getBerlinDate(log.timestamp);
        return logDate === dateStr;
      });

      // Pass contract timestamps to calculateBreaks for customer conversation detection
      breaks = await calculateBreaks(rawLogs, contractTimestamps);
      console.log(`[Admin API] Calculated ${breaks.length} breaks for route (with ${contractTimestamps.length} contract timestamps)`);
    }

    // PERFORMANCE: Downsample GPS points if too many (>5000 causes browser lag)
    const MAX_GPS_POINTS = 5000;
    const originalPointCount = gpsPoints.length;
    
    console.log(`[Admin API] 📊 GPS points before downsampling: ${originalPointCount}`);
    
    if (originalPointCount > MAX_GPS_POINTS) {
      // Sort by timestamp first
      gpsPoints.sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      // Calculate minimum time interval needed to reduce to MAX_GPS_POINTS
      const totalTimeSpan = gpsPoints[gpsPoints.length - 1].timestamp - gpsPoints[0].timestamp;
      const minIntervalMs = Math.ceil(totalTimeSpan / MAX_GPS_POINTS);
      
      console.log(`[Admin API] 📉 Downsampling: totalTimeSpan=${Math.round(totalTimeSpan/1000)}s, minInterval=${Math.round(minIntervalMs/1000)}s`);
      
      // Downsample: keep points that are at least minIntervalMs apart
      // Always keep first and last point
      const downsampledPoints: any[] = [gpsPoints[0]];
      let lastKeptTimestamp = gpsPoints[0].timestamp;
      
      for (let i = 1; i < gpsPoints.length - 1; i++) {
        const point = gpsPoints[i];
        const timeSinceLastKept = point.timestamp - lastKeptTimestamp;
        
        if (timeSinceLastKept >= minIntervalMs) {
          downsampledPoints.push(point);
          lastKeptTimestamp = point.timestamp;
        }
      }
      
      // Always keep last point
      if (gpsPoints.length > 1) {
        downsampledPoints.push(gpsPoints[gpsPoints.length - 1]);
      }
      
      gpsPoints = downsampledPoints;
      
      console.log(`[Admin API] 📉 Downsampled GPS points: ${originalPointCount} → ${gpsPoints.length} (interval: ${Math.round(minIntervalMs / 1000)}s)`);
    } else {
      console.log(`[Admin API] ✅ GPS points under limit (${originalPointCount} <= ${MAX_GPS_POINTS}), no downsampling needed`);
    }

    // Sanitize GPS points to prevent JSON serialization errors
    // User-Agent strings can contain control characters that break JSON
    const sanitizedGpsPoints = gpsPoints.map((point: any) => ({
      ...point,
      // Remove or sanitize userAgent if it contains problematic characters
      userAgent: point.userAgent 
        ? String(point.userAgent).replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        : undefined
    }));

    // Gebe immer 200 zurück, auch wenn keine Daten gefunden wurden
    // (verhindert Service Worker Cache-Probleme)
    res.json({
      gpsPoints: sanitizedGpsPoints || [],
      photoTimestamps: photoTimestamps || [],
      contracts: contractTimestamps || [], // EGON contract timestamps (Unix ms)
      breaks: breaks || [],
      username: username || 'Unknown',
      date: dateStr,
      source: sourceFilter || 'all',
      totalPoints: sanitizedGpsPoints.length,
      originalPointCount: originalPointCount, // Send original count for info
      totalPhotos: photoTimestamps.length,
      totalContracts: contractCount // Number of contracts written by this user on this day
    });

    // Cache nach Verwendung löschen bei historischen Daten (15 Minuten statt 5 Sekunden)
    if (dateStr !== today) {
      setTimeout(() => {
        clearHistoricalCache(dateStr, userIdStr);
      }, 15 * 60 * 1000); // 15 minutes
    }

  } catch (error: any) {
    console.error('[Admin API] ❌ Error fetching route data:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch route data' 
    });
  }
});

/**
 * POST /api/admin/dashboard/snap-to-roads
 * Snap GPS points to roads using Google Roads API with intelligent caching
 */
router.post('/dashboard/snap-to-roads', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, date, source, points, segments } = req.body;

    if (!userId || !date || !points || !Array.isArray(points)) {
      return res.status(400).json({
        error: 'userId, date, and points array are required'
      });
    }

    console.log(`[Admin API] Snap-to-roads request for ${userId}/${date}/${source || 'all'} with ${points.length} points`);

    // Import service
    const { googleRoadsService } = await import('../services/googleRoadsService');

    // Get cache info first
    const cacheInfo = googleRoadsService.getCacheInfo(userId, date, source || 'all');

    // Snap points (uses cache automatically)
    const result = await googleRoadsService.snapToRoads(userId, date, points, source || 'all', segments);

    // Save cache to disk
    await googleRoadsService.saveCache();

    const formattedCost = Number.isFinite(result.costCents) ? result.costCents.toFixed(2) : '0.00';
    console.log(`[Admin API] Snap-to-roads completed: ${result.totalSegments} segments (${result.apiCallsUsed} API calls, ${formattedCost}ct)`);

    res.json({
      segments: result.snappedSegments,
      segmentCount: result.segmentCount,
      apiCallsUsed: result.apiCallsUsed,
      costCents: result.costCents,
      fromCache: result.fromCache,
      cacheHitRatio: result.cacheHitRatio,
      stats: {
        totalSegments: result.totalSegments,
        cachedSegments: result.cachedSegments
      },
      cacheInfo: {
        cached: cacheInfo.cached,
        cachedPointCount: cacheInfo.cachedPointCount,
        cachedSegmentCount: cacheInfo.cachedSegmentCount,
        lastProcessedTimestamp: cacheInfo.lastProcessedTimestamp,
        totalApiCallsUsed: cacheInfo.apiCallsUsed,
        totalCostCents: cacheInfo.costCents,
        segmentKeys: cacheInfo.segmentKeys
      }
    });

  } catch (error: any) {
    console.error('[Admin API] ❌ Error in snap-to-roads:', error);
    res.status(500).json({
      error: error.message || 'Failed to snap points to roads'
    });
  }
});

/**
 * GET /api/admin/dashboard/snap-to-roads/cache-info
 * Get cache information for a specific route without processing
 */
router.get('/dashboard/snap-to-roads/cache-info', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, date, source } = req.query;

    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required' });
    }

    const { googleRoadsService } = await import('../services/googleRoadsService');
    const cacheInfo = googleRoadsService.getCacheInfo(
      userId as string,
      date as string,
      (source as string) || 'all'
    );

    res.json(cacheInfo);

  } catch (error: any) {
    console.error('[Admin API] ❌ Error getting cache info:', error);
    res.status(500).json({
      error: error.message || 'Failed to get cache info'
    });
  }
});

/**
 * POST /api/admin/dashboard/snap-to-roads/calculate-cost
 * Calculate cost for snapping without actually calling the API
 */
router.post('/dashboard/snap-to-roads/calculate-cost', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { segmentCount } = req.body;

    if (typeof segmentCount !== 'number' || segmentCount < 0) {
      return res.status(400).json({ error: 'Valid segmentCount is required' });
    }

    const { googleRoadsService } = await import('../services/googleRoadsService');
    const cost = googleRoadsService.calculateCost(segmentCount);

    res.json(cost);

  } catch (error: any) {
    console.error('[Admin API] ❌ Error calculating cost:', error);
    res.status(500).json({
      error: error.message || 'Failed to calculate cost'
    });
  }
});

/**
 * GET /api/admin/reports/:date
 * Info: Reports werden on-demand generiert, nicht gespeichert
 * Dieser Endpoint prüft nur, ob das Datumsformat valide ist
 */
router.get('/reports/:date', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.params;

    // Validiere Datumsformat
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Reports werden on-the-fly generiert beim Download
    res.json({
      exists: true,
      date,
      message: 'Report will be generated on download',
      downloadUrl: `/api/admin/reports/${date}/download`,
      generatedOnDemand: true
    });

  } catch (error) {
    console.error('[Admin API] Error checking report:', error);
    res.status(500).json({ error: 'Failed to check report status' });
  }
});

/**
 * GET /api/admin/reports/:date/download
 * Generiert on-the-fly einen PDF-Report, liefert ihn aus und löscht ihn sofort
 */
router.get('/reports/:date/download', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  let tempFilePath: string | null = null;

  try {
    const { date } = req.params;

    // Validiere Datumsformat
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    console.log(`[Admin API] 📄 Generating on-the-fly report for ${date}`);

    // Dynamisch importiere generateDailyReport
    const { generateDailyReport } = await import('../services/reportGenerator');

    // Generiere Report on-the-fly
    tempFilePath = await generateDailyReport(date);

    if (!fs.existsSync(tempFilePath)) {
      console.error('[Admin API] Generated file not found:', tempFilePath);
      return res.status(500).json({ error: 'Report generation failed' });
    }

    const filename = `daily-report-${date}.pdf`;

    console.log(`[Admin API] ✅ Report generated, streaming to client...`);

    // Setze Response Headers für PDF-Download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream PDF-Datei
    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('[Admin API] Error streaming PDF:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download report' });
      }
    });

    // Lösche Datei nach erfolgreichem Stream
    fileStream.on('end', () => {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[Admin API] 🗑️ Deleted temporary report: ${tempFilePath}`);
      }
    });

  } catch (error: any) {
    console.error('[Admin API] Error generating/downloading report:', error);
    
    // Cleanup bei Fehler
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      console.log(`[Admin API] 🗑️ Cleaned up failed report: ${tempFilePath}`);
    }

    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to generate report',
        details: error.message 
      });
    }
  }
});

/**
 * DELETE /api/admin/cache
 * Löscht den historischen Daten-Cache (für Debugging)
 */
router.delete('/cache', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, userId } = req.query;

    clearHistoricalCache(
      date as string | undefined,
      userId as string | undefined
    );

    const stats = getCacheStats();

    res.json({
      message: 'Cache cleared successfully',
      remainingEntries: stats.size,
      remainingKeys: stats.keys,
    });

  } catch (error) {
    console.error('[Admin API] Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

/**
 * GET /api/admin/cache/stats
 * Gibt Cache-Statistiken zurück (für Debugging)
 */
router.get('/cache/stats', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = getCacheStats();
    const memoryUsage = process.memoryUsage();

    res.json({
      cache: stats,
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
        external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100,
        rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
      },
    });

  } catch (error) {
    console.error('[Admin API] Error fetching cache stats:', error);
    res.status(500).json({ error: 'Failed to fetch cache stats' });
  }
});

/**
 * GET /api/admin/users
 * Gibt Liste aller bekannten User zurück (aus Live-Daten)
 */
router.get('/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allUserData = dailyDataStore.getAllUserData();
    
    const users = Array.from(allUserData.values()).map(userData => {
      const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((sum, count) => sum + count, 0);
      const lastLogTimestamp = userData.rawLogs.length > 0 
        ? userData.rawLogs[userData.rawLogs.length - 1].timestamp 
        : Date.now();

      return {
        userId: userData.userId,
        username: userData.username,
        lastUpdate: lastLogTimestamp,
        statusChangesCount: totalStatusChanges,
        activeTime: userData.activeTime,
      };
    });

    // Sortiere nach totalActions
    users.sort((a, b) => b.statusChangesCount - a.statusChangesCount);

    res.json({
      users,
      totalUsers: users.length,
    });

  } catch (error) {
    console.error('[Admin API] Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/reset-daily-data
 * Manually reset daily data (for debugging/testing)
 */
router.post('/reset-daily-data', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Admin API] Manual reset of daily data requested by', req.username);
    dailyDataStore.reset();
    res.json({ 
      success: true, 
      message: 'Daily data has been reset. All tracking data cleared.',
      resetTime: getBerlinTimestamp()
    });
  } catch (error) {
    console.error('[Admin API] Error resetting data:', error);
    res.status(500).json({ error: 'Failed to reset daily data' });
  }
});

/**
 * GET /api/admin/followmee/status
 * Get FollowMee sync scheduler status
 */
router.get('/followmee/status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { followMeeSyncScheduler } = await import('../services/followMeeSyncScheduler');
    const status = followMeeSyncScheduler.getStatus();
    res.json(status);
  } catch (error) {
    console.error('[Admin API] Error fetching FollowMee status:', error);
    res.status(500).json({ error: 'Failed to fetch FollowMee status' });
  }
});

/**
 * POST /api/admin/followmee/sync
 * Manually trigger FollowMee GPS sync
 */
router.post('/followmee/sync', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Admin API] Manual FollowMee sync requested by', req.username);
    const { followMeeSyncScheduler } = await import('../services/followMeeSyncScheduler');
    
    // Trigger sync without waiting (runs in background)
    followMeeSyncScheduler.syncNow().catch(err => {
      console.error('[Admin API] Background sync error:', err);
    });
    
    res.json({ 
      success: true, 
      message: 'FollowMee sync started in background',
      startTime: getBerlinTimestamp()
    });
  } catch (error) {
    console.error('[Admin API] Error triggering FollowMee sync:', error);
    res.status(500).json({ error: 'Failed to trigger FollowMee sync' });
  }
});

/**
 * POST /api/admin/users/refresh-cache
 * Force refresh user cache (useful after updating FollowMee Device IDs in Google Sheets)
 */
router.post('/users/refresh-cache', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Admin API] User cache refresh requested by', req.username);
    const { googleSheetsService } = await import('../services/googleSheets');

    await googleSheetsService.refreshUserCache();
    const users = await googleSheetsService.getAllUsers();
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);

    res.json({
      success: true,
      message: 'User cache refreshed successfully',
      totalUsers: users.length,
      usersWithFollowMeeDevices: usersWithDevices.length,
      users: usersWithDevices.map(u => ({
        username: u.username,
        userId: u.userId,
        deviceId: u.followMeeDeviceId
      }))
    });
  } catch (error) {
    console.error('[Admin API] Error refreshing user cache:', error);
    res.status(500).json({ error: 'Failed to refresh user cache' });
  }
});

/**
 * GET /api/admin/external-tracking/:username/:date
 * Lädt externe Tracking-Daten für einen Nutzer an einem bestimmten Tag
 * aus dessen User-Log (Daten, die über /api/external-tracking/location empfangen wurden)
 */
router.get('/external-tracking/:username/:date', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, date: dateString } = req.params;
    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    console.log(`[Admin API] External tracking data requested for ${username} on ${dateString}`);

    const { externalTrackingService } = await import('../services/externalTrackingService');
    const trackingData = await externalTrackingService.getExternalTrackingDataFromUserLog(username, date);

    res.json({
      success: true,
      username,
      date: dateString,
      count: trackingData.length,
      data: trackingData
    });
  } catch (error) {
    console.error('[Admin API] Error loading external tracking data:', error);
    res.status(500).json({ error: 'Failed to load external tracking data' });
  }
});

/**
 * GET /api/admin/google-maps-config
 * Returns Google Maps API key for client-side use
 */
router.get('/google-maps-config', requireAuth, requireAdmin, (_req, res) => {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY || '';
  res.json({ apiKey });
});

/**
 * POST /api/admin/test-tracking-reconciliation
 * Test endpoint to manually trigger external tracking data reconciliation
 * without needing to restart the server
 */
router.post('/test-tracking-reconciliation', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Admin API] Manual external tracking reconciliation requested by', req.username);

    const { externalTrackingReconciliationService } = await import('../services/externalTrackingReconciliation');

    // Run reconciliation
    const stats = await externalTrackingReconciliationService.reconcileUnassignedTrackingData();

    console.log('[Admin API] Reconciliation completed:', stats);

    res.json({
      success: true,
      message: 'External tracking reconciliation completed',
      timestamp: getBerlinTimestamp(),
      stats: {
        devicesProcessed: stats.devicesProcessed,
        devicesAssigned: stats.devicesAssigned,
        devicesRemaining: stats.devicesRemaining,
        totalDataPoints: stats.totalDataPoints,
        historicalDataPoints: stats.historicalDataPoints,
        currentDataPoints: stats.currentDataPoints,
        errorCount: stats.errors.length,
        errors: stats.errors
      }
    });
  } catch (error) {
    console.error('[Admin API] Error running external tracking reconciliation:', error);
    res.status(500).json({
      error: 'Failed to run external tracking reconciliation',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/admin/generate-report
 * Generate daily report (partial or final) for a specific date
 * Body: { date: "YYYY-MM-DD", isPartial?: boolean }
 */
router.post('/generate-report', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, isPartial = true } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required (format: YYYY-MM-DD)' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
    }

    console.log(`[Admin API] Generating ${isPartial ? 'partial' : 'final'} report for ${date} by ${req.username}`);

    // Reset cache stats for accurate measurement
    pauseLocationCache.resetStats();

    const { dailyReportCronService } = await import('../services/dailyReportCron');
    await dailyReportCronService.generateReportForDate(date, isPartial);

    // Get final cache stats
    const cacheStats = pauseLocationCache.getStats();

    res.json({
      success: true,
      message: `${isPartial ? 'Partial' : 'Final'} report generated successfully`,
      date,
      isPartial,
      timestamp: getBerlinTimestamp(),
      performance: cacheStats,
    });
  } catch (error) {
    console.error('[Admin API] Error generating report:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/admin/poi-cache-stats
 * Get current POI cache statistics (hit rate, API calls, cost estimate)
 */
router.get('/poi-cache-stats', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = pauseLocationCache.getStats();
    
    res.json({
      success: true,
      stats,
      timestamp: getBerlinTimestamp(),
    });
  } catch (error) {
    console.error('[Admin API] Error getting POI cache stats:', error);
    res.status(500).json({
      error: 'Failed to get cache stats',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
