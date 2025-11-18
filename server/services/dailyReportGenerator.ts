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
  duration: number; // minutes
  locations: Array<{
    name: string;
    type: string;
    address: string;
    distance: number; // meters from GPS center
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
 * Calculate pauses with POI enrichment
 */
async function calculatePausesWithLocations(
  rawLogs: TrackingData[]
): Promise<PauseLocation[]> {
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

  // Enrich pauses with location data
  const enrichedPauses: PauseLocation[] = [];

  for (const pause of pausePeriods) {
    // Get ALL GPS points during pause (native + external)
    const pauseGpsPoints = rawLogs
      .filter(log => log.gps && log.timestamp >= pause.start && log.timestamp <= pause.end)
      .map(log => ({
        latitude: log.gps!.latitude,
        longitude: log.gps!.longitude,
        timestamp: log.timestamp,
      }));

    if (pauseGpsPoints.length === 0) {
      // No GPS data during pause
      enrichedPauses.push({
        startTime: pause.start,
        endTime: pause.end,
        duration: Math.round(pause.duration / 60000), // Convert to minutes
        locations: [],
      });
      continue;
    }

    // Detect clusters within pause (user might have moved around)
    const clusters = detectStationaryClusters(pauseGpsPoints);

    if (clusters.length === 0) {
      // No stationary clusters found
      enrichedPauses.push({
        startTime: pause.start,
        endTime: pause.end,
        duration: Math.round(pause.duration / 60000),
        locations: [],
      });
      continue;
    }

    // Use longest cluster as main pause location
    const longestCluster = clusters.sort((a, b) => b.duration - a.duration)[0];

    // Fetch POI information
    const pois = await pauseLocationCache.getPOIInfo(
      longestCluster.center.lat,
      longestCluster.center.lng
    );

    enrichedPauses.push({
      startTime: pause.start,
      endTime: pause.end,
      duration: Math.round(pause.duration / 60000),
      locations: pois.map(poi => ({
        name: poi.name,
        type: poi.type,
        address: poi.address,
        distance: poi.distance || 0,
      })),
    });
  }

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

  for (const userData of allUserData.values()) {
    // Calculate pauses with locations
    const pauses = await calculatePausesWithLocations(userData.rawLogs);

    // Calculate peak time
    const peakTime = calculatePeakTime(userData.rawLogs);

    users.push({
      username: userData.username,
      userId: userData.userId,
      activeTime: userData.activeTime,
      distance: userData.totalDistance,
      totalActions: userData.totalActions,
      uniquePhotos: userData.uniquePhotos || 0,
      peakTime,

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

  return {
    date: dateStr,
    isPartial,
    generatedAt: getBerlinTimestamp(),
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
