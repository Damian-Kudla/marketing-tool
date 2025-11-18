/**
 * Daily Report Generator
 * 
 * Creates comprehensive JSON reports with all dashboard data:
 * - User metrics (actions, photos, active time, distance, etc.)
 * - Status change details
 * - Final status assignments
 * - Pause locations (POI enrichment)
 * - Peak time analysis
 * 
 * Reports are stored in Google Drive for n8n consumption
 * 
 * POI System Optimizations:
 * - Batch coordinate deduplication (50m radius)
 * - Single API call per unique location
 * - Batch Google Sheets writes
 * - Real-time cache hit rate tracking
 */

import { google } from 'googleapis';
import { dailyDataStore } from './dailyDataStore';
import { scrapeDayDataFromSQLite } from './sqliteHistoricalData';
import { getBerlinDate, getBerlinTimestamp } from '../utils/timezone';
import { pauseLocationCache, type POIInfo } from './pauseLocationCache';
import type { TrackingData } from '../../shared/trackingTypes';

const REPORTS_FOLDER_ID = process.env.GOOGLE_DRIVE_REPORTS_FOLDER_ID || '';

interface PauseLocation {
  startTime: number;
  endTime: number;
  duration: number; // minutes (total pause duration)
  locations: Array<{
    name: string;
    type: string;
    address: string;
    distance: number; // meters from GPS center
    durationAtLocation?: number; // minutes spent at this specific location
  }>;
}

interface UserReport {
  username: string;
  userId: string;
  activeTime: number; // milliseconds (-1 if app not used)
  distance: number; // meters
  totalActions: number;
  uniquePhotos: number;
  peakTime: string; // Hour with most activity (format: "HH:00")
  
  gpsStats: {
    native: number;        // GPS points from background tracking (every 5min)
    followmee: number;     // GPS points from FollowMee API
    externalApp: number;   // GPS points from external tracking app (high frequency)
  };
  
  actionDetails: {
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
  };
  
  statusChangeDetails: {
    laterInterest: number;
    appointmentScheduled: number;
    written: number;
    noInterest: number;
    notReached: number;
  };
  
  finalStatusAssignments: {
    laterInterest: number;
    appointmentScheduled: number;
    written: number;
    noInterest: number;
    notReached: number;
  };
  
  pauses: PauseLocation[];
}

interface DailyReport {
  date: string; // YYYY-MM-DD (MEZ timezone)
  isPartial: boolean; // true = intermediate report, false = final daily report
  generatedAt: number; // timestamp (MEZ)
  users: UserReport[];
}

/**
 * Get Google Auth for Drive API
 */
const getGoogleAuth = () => {
  try {
    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    if (!sheetsKey) throw new Error('GOOGLE_SHEETS_KEY not found');
    
    const credentials = JSON.parse(sheetsKey);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
    });
  } catch (error) {
    console.error('[DailyReport] Failed to initialize Google Auth:', error);
    throw error;
  }
};

/**
 * Calculate distance between two GPS points (Haversine formula)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Detect stationary clusters (GPS points within radius for duration)
 */
function detectStationaryClusters(
  gpsPoints: Array<{ latitude: number; longitude: number; timestamp: number }>,
  radiusMeters: number = 50,
  minDurationMs: number = 3 * 60 * 1000
): Array<{ center: { lat: number; lng: number }; startTime: number; endTime: number; duration: number }> {
  if (gpsPoints.length < 2) return [];

  const sorted = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);
  const clusters: Array<{ center: { lat: number; lng: number }; startTime: number; endTime: number; duration: number }> = [];
  let currentCluster: typeof sorted = [];

  for (const point of sorted) {
    if (currentCluster.length === 0) {
      currentCluster.push(point);
      continue;
    }

    // Calculate center of current cluster
    const centerLat = currentCluster.reduce((sum, p) => sum + p.latitude, 0) / currentCluster.length;
    const centerLng = currentCluster.reduce((sum, p) => sum + p.longitude, 0) / currentCluster.length;

    // Check if point is within radius
    const distance = calculateDistance(centerLat, centerLng, point.latitude, point.longitude);

    if (distance <= radiusMeters) {
      currentCluster.push(point);
    } else {
      // Cluster ended - check duration
      if (currentCluster.length >= 2) {
        const duration = currentCluster[currentCluster.length - 1].timestamp - currentCluster[0].timestamp;
        if (duration >= minDurationMs) {
          const finalCenterLat = currentCluster.reduce((sum, p) => sum + p.latitude, 0) / currentCluster.length;
          const finalCenterLng = currentCluster.reduce((sum, p) => sum + p.longitude, 0) / currentCluster.length;

          clusters.push({
            center: { lat: finalCenterLat, lng: finalCenterLng },
            startTime: currentCluster[0].timestamp,
            endTime: currentCluster[currentCluster.length - 1].timestamp,
            duration,
          });
        }
      }
      currentCluster = [point];
    }
  }

  // Check final cluster
  if (currentCluster.length >= 2) {
    const duration = currentCluster[currentCluster.length - 1].timestamp - currentCluster[0].timestamp;
    if (duration >= minDurationMs) {
      const finalCenterLat = currentCluster.reduce((sum, p) => sum + p.latitude, 0) / currentCluster.length;
      const finalCenterLng = currentCluster.reduce((sum, p) => sum + p.longitude, 0) / currentCluster.length;

      clusters.push({
        center: { lat: finalCenterLat, lng: finalCenterLng },
        startTime: currentCluster[0].timestamp,
        endTime: currentCluster[currentCluster.length - 1].timestamp,
        duration,
      });
    }
  }

  return clusters;
}

/**
 * Calculate pauses WITHOUT POI enrichment (when disabled via config)
 */
async function calculatePausesWithoutPOI(
  rawLogs: TrackingData[]
): Promise<PauseLocation[]> {
  if (rawLogs.length < 2) return [];

  const nativeGpsLogs = rawLogs.filter(log =>
    log.gps !== undefined && (log.gps.source === 'native' || !log.gps.source)
  );

  if (nativeGpsLogs.length < 2) return [];

  const sortedLogs = [...nativeGpsLogs].sort((a, b) => a.timestamp - b.timestamp);
  const MIN_BREAK_MS = 20 * 60 * 1000;
  const pausePeriods: PauseLocation[] = [];

  for (let i = 1; i < sortedLogs.length; i++) {
    const gap = sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp;
    if (gap >= MIN_BREAK_MS) {
      pausePeriods.push({
        startTime: sortedLogs[i - 1].timestamp,
        endTime: sortedLogs[i].timestamp,
        duration: Math.round(gap / 60000),
        locations: [], // Empty when POI disabled
      });
    }
  }

  return pausePeriods;
}

/**
 * Calculate pauses with POI enrichment (optimized with batch caching)
 */
async function calculatePausesWithLocations(
  rawLogs: TrackingData[],
  username: string
): Promise<PauseLocation[]> {
  // Check if POI lookups are enabled via config
  const poiEnabled = process.env.ENABLE_POI_LOOKUPS !== 'false';
  
  if (!poiEnabled) {
    console.log(`[DailyReport] ${username}: POI lookups disabled via config`);
    return await calculatePausesWithoutPOI(rawLogs);
  }

  if (rawLogs.length < 2) return [];

  // Filter native GPS points for pause detection (20+ min gaps)
  const nativeGpsLogs = rawLogs.filter(log =>
    log.gps !== undefined && (log.gps.source === 'native' || !log.gps.source)
  );

  if (nativeGpsLogs.length < 2) return [];

  const sortedLogs = [...nativeGpsLogs].sort((a, b) => a.timestamp - b.timestamp);

  const MIN_BREAK_MS = 20 * 60 * 1000; // 20 minutes
  const pausePeriods: Array<{ start: number; end: number; duration: number }> = [];

  for (let i = 1; i < sortedLogs.length; i++) {
    const gap = sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp;
    if (gap >= MIN_BREAK_MS) {
      pausePeriods.push({
        start: sortedLogs[i - 1].timestamp,
        end: sortedLogs[i].timestamp,
        duration: gap,
      });
    }
  }

  // Collect all pause locations first (batch)
  const pauseLocations: Array<{ pause: typeof pausePeriods[0]; center: { lat: number; lng: number } | null }> = [];

  for (const pause of pausePeriods) {
    // CRITICAL: Only proceed if external tracking data (source: 'external_app') is available during pause
    // External tracking app sends high-frequency GPS data via /api/external-tracking/location
    const externalTrackingPoints = rawLogs
      .filter(log => 
        log.gps && 
        log.gps.source === 'external_app' && 
        log.timestamp >= pause.start && 
        log.timestamp <= pause.end
      )
      .map(log => ({
        latitude: log.gps!.latitude,
        longitude: log.gps!.longitude,
        timestamp: log.timestamp,
      }));

    if (externalTrackingPoints.length === 0) {
      // No external tracking data during pause - skip POI lookup
      pauseLocations.push({ pause, center: null });
      continue;
    }

    // Detect clusters within pause (user might have moved around)
    const clusters = detectStationaryClusters(externalTrackingPoints);

    if (clusters.length === 0) {
      pauseLocations.push({ pause, center: null });
      continue;
    }

    // Use longest cluster as main pause location
    const longestCluster = clusters.sort((a, b) => b.duration - a.duration)[0];
    pauseLocations.push({ pause, center: longestCluster.center });
  }

  // Deduplicate locations by 50m radius to minimize API calls
  const uniqueLocations: Array<{ lat: number; lng: number; pauseIndices: number[] }> = [];

  pauseLocations.forEach((loc, idx) => {
    if (!loc.center) return;

    // Check if location already exists within 50m
    const existing = uniqueLocations.find(ul =>
      calculateDistance(ul.lat, ul.lng, loc.center!.lat, loc.center!.lng) < 50
    );

    if (existing) {
      existing.pauseIndices.push(idx);
    } else {
      uniqueLocations.push({
        lat: loc.center.lat,
        lng: loc.center.lng,
        pauseIndices: [idx],
      });
    }
  });

  console.log(`[DailyReport] ${username}: ${pauseLocations.length} pauses → ${uniqueLocations.length} unique locations (POI lookup)`);

  // Safety limit: Max 15 API calls per report to prevent excessive costs
  const MAX_API_CALLS_PER_REPORT = 15;

  // Check API call limit
  if (uniqueLocations.length > MAX_API_CALLS_PER_REPORT) {
    console.warn(`[DailyReport] ${username}: Skipping POI lookups - ${uniqueLocations.length} locations exceeds limit of ${MAX_API_CALLS_PER_REPORT}`);
    
    // Return pauses without POI data
    return pauseLocations.map(loc => ({
      startTime: loc.pause.start,
      endTime: loc.pause.end,
      duration: Math.round(loc.pause.duration / 60000),
      locations: [], // Empty due to limit exceeded
    }));
  }

  // Fetch POI data for unique locations only
  const locationPOIs = new Map<number, POIInfo[]>();

  for (const uniqueLoc of uniqueLocations) {
    try {
      const pois = await pauseLocationCache.getPOIInfo(uniqueLoc.lat, uniqueLoc.lng);
      
      // Assign POIs to all pauses at this location
      for (const pauseIdx of uniqueLoc.pauseIndices) {
        locationPOIs.set(pauseIdx, pois);
      }
    } catch (error) {
      console.error('[DailyReport] Error fetching POI:', error);
      // Set empty array for failed lookups
      for (const pauseIdx of uniqueLoc.pauseIndices) {
        locationPOIs.set(pauseIdx, []);
      }
    }
  }

  // Build enriched pauses
  const enrichedPauses: PauseLocation[] = pauseLocations.map((loc, idx) => {
    const pois = locationPOIs.get(idx) || [];
    const pauseDurationMinutes = Math.round(loc.pause.duration / 60000);

    // Get all external tracking points during this pause for duration calculation
    const pauseTrackingPoints = rawLogs
      .filter(log => 
        log.gps && 
        log.gps.source === 'external_app' && 
        log.timestamp >= loc.pause.start && 
        log.timestamp <= loc.pause.end
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      startTime: loc.pause.start,
      endTime: loc.pause.end,
      duration: pauseDurationMinutes,
      locations: pois.map(poi => {
        // Calculate actual time spent within 50m of this POI
        let timeAtPOI = 0;
        
        if (pauseTrackingPoints.length > 0 && loc.center) {
          // Find all GPS points within 50m of POI
          const pointsNearPOI = pauseTrackingPoints.filter(log => {
            const distance = calculateDistance(
              log.gps!.latitude,
              log.gps!.longitude,
              loc.center!.lat,
              loc.center!.lng
            );
            return distance <= 50;
          });

          if (pointsNearPOI.length > 0) {
            // Calculate duration based on timestamps of points within radius
            const firstPoint = pointsNearPOI[0].timestamp;
            const lastPoint = pointsNearPOI[pointsNearPOI.length - 1].timestamp;
            timeAtPOI = Math.round((lastPoint - firstPoint) / 60000); // minutes
            
            // Edge case: Single point or very short duration
            if (timeAtPOI === 0 && pointsNearPOI.length > 0) {
              timeAtPOI = 1; // At least 1 minute if user was detected there
            }
          }
        }

        return {
          name: poi.name,
          type: poi.type,
          address: poi.address,
          distance: poi.distance || 0,
          durationAtLocation: timeAtPOI, // Actual minutes spent within 50m of this POI
        };
      }),
    };
  });

  return enrichedPauses;
}

/**
 * Calculate peak activity hour
 */
function calculatePeakTime(rawLogs: TrackingData[]): string {
  if (rawLogs.length === 0) return 'N/A';

  // Group activities by hour (MEZ timezone)
  const hourlyActivity = new Map<number, number>();
  
  for (const log of rawLogs) {
    const date = new Date(log.timestamp);
    const berlinHour = parseInt(
      date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }),
      10
    );
    hourlyActivity.set(berlinHour, (hourlyActivity.get(berlinHour) || 0) + 1);
  }

  if (hourlyActivity.size === 0) return 'N/A';

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
 * Generate daily report for a specific date
 */
export async function generateDailyReport(
  dateStr: string, // YYYY-MM-DD (MEZ)
  isPartial: boolean = false
): Promise<DailyReport> {
  console.log(`[DailyReport] Generating ${isPartial ? 'partial' : 'final'} report for ${dateStr}`);

  // Ensure pause location cache is initialized
  await pauseLocationCache.initialize();

  // Determine if this is today (MEZ)
  const today = getBerlinDate(new Date());
  const isToday = dateStr === today;

  // Get data from appropriate source
  let allUserData;

  if (isToday) {
    // Live data from dailyDataStore
    allUserData = dailyDataStore.getAllUserData();
  } else {
    // Historical data from SQLite
    const historicalData = await scrapeDayDataFromSQLite(dateStr);
    allUserData = new Map(
      historicalData.map(user => [user.userId, user])
    );
  }

  const users: UserReport[] = [];

  for (const userData of Array.from(allUserData.values())) {
    // Calculate pauses with locations
    const pauses = await calculatePausesWithLocations(userData.rawLogs, userData.username);

    // Calculate peak time
    const peakTime = calculatePeakTime(userData.rawLogs);

    // Calculate GPS source statistics
    const gpsStats = {
      native: userData.rawLogs.filter(log => log.gps?.source === 'native' || (log.gps && !log.gps.source)).length,
      followmee: userData.rawLogs.filter(log => log.gps?.source === 'followmee').length,
      externalApp: userData.rawLogs.filter(log => log.gps?.source === 'external_app').length,
    };

    users.push({
      username: userData.username,
      userId: userData.userId,
      activeTime: userData.activeTime,
      distance: userData.totalDistance,
      totalActions: userData.totalActions,
      uniquePhotos: userData.uniquePhotos || 0,
      peakTime,
      gpsStats,

      actionDetails: {
        scans: userData.actionsByType.get('scan') || 0,
        ocrCorrections: userData.actionsByType.get('bulk_residents_update') || 0,
        datasetCreates: userData.actionsByType.get('dataset_create') || 0,
        geocodes: userData.actionsByType.get('geocode') || 0,
        edits: userData.actionsByType.get('resident_update') || 0,
        saves: userData.actionsByType.get('dataset_update') || 0,
        deletes: userData.actionsByType.get('resident_delete') || 0,
        statusChanges: userData.actionsByType.get('status_change') || 0,
        navigations: userData.actionsByType.get('navigate') || 0,
        other: 0,
      },

      statusChangeDetails: {
        laterInterest: userData.statusChanges.get('interessiert') || 0,
        appointmentScheduled: userData.statusChanges.get('termin_vereinbart') || 0,
        written: userData.statusChanges.get('geschrieben') || 0,
        noInterest: userData.statusChanges.get('nicht_interessiert') || 0,
        notReached: userData.statusChanges.get('nicht_angetroffen') || 0,
      },

      finalStatusAssignments: {
        laterInterest: userData.finalStatuses?.get('interessiert') || 0,
        appointmentScheduled: userData.finalStatuses?.get('termin_vereinbart') || 0,
        written: userData.finalStatuses?.get('geschrieben') || 0,
        noInterest: userData.finalStatuses?.get('nicht_interessiert') || 0,
        notReached: userData.finalStatuses?.get('nicht_angetroffen') || 0,
      },

      pauses,
    });
  }

  // Log POI cache performance
  const cacheStats = pauseLocationCache.getStats();
  console.log('[DailyReport] POI Cache Performance:', cacheStats);

  return {
    date: dateStr,
    isPartial,
    generatedAt: Date.now(),
    users,
  };
}

/**
 * Upload report to Google Drive
 */
export async function uploadReportToDrive(report: DailyReport): Promise<string> {
  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  const fileName = `daily-report-${report.date}.json`;
  const fileContent = JSON.stringify(report, null, 2);

  try {
    // Check if file already exists
    const searchResponse = await drive.files.list({
      q: `name='${fileName}' and '${REPORTS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });

    const existingFile = searchResponse.data.files?.[0];

    if (existingFile) {
      // Update existing file
      console.log(`[DailyReport] Updating existing report: ${fileName}`);
      
      await drive.files.update({
        fileId: existingFile.id!,
        media: {
          mimeType: 'application/json',
          body: fileContent,
        },
      });

      return existingFile.id!;
    } else {
      // Create new file
      console.log(`[DailyReport] Creating new report: ${fileName}`);

      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [REPORTS_FOLDER_ID],
          mimeType: 'application/json',
        },
        media: {
          mimeType: 'application/json',
          body: fileContent,
        },
        fields: 'id',
      });

      return response.data.id!;
    }
  } catch (error) {
    console.error('[DailyReport] Failed to upload report:', error);
    throw error;
  }
}

/**
 * Generate and upload daily report
 */
export async function createDailyReport(dateStr: string, isPartial: boolean = false): Promise<void> {
  const report = await generateDailyReport(dateStr, isPartial);
  await uploadReportToDrive(report);
  console.log(`[DailyReport] Report for ${dateStr} ${isPartial ? '(partial)' : '(final)'} uploaded successfully`);
}
