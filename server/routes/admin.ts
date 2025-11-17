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
  userData.actionsByType.forEach((count, actionType) => {
    if (!knownActions.has(actionType)) {
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
 * Calculate all breaks longer than 20 minutes (time gaps between GPS tracking)
 * A break is considered significant if it's at least 20 minutes
 * Only uses GPS logs to match the route visualization
 */
function calculateBreaks(rawLogs: TrackingData[]): Array<{ start: number; end: number; duration: number }> {
  if (rawLogs.length < 2) return [];

  // Filter to only NATIVE GPS logs (matching activeTime calculation)
  const gpsLogs = rawLogs.filter(log => 
    log.gps !== undefined && 
    (log.gps.source === 'native' || !log.gps.source)
  );

  if (gpsLogs.length < 2) return [];

  // Sort GPS logs by timestamp
  const sortedLogs = [...gpsLogs].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate all gaps between GPS updates
  const gaps: Array<{ start: number; end: number; duration: number }> = [];

  for (let i = 1; i < sortedLogs.length; i++) {
    const gap = sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp;
    const minBreakDuration = 20 * 60 * 1000; // 20 minutes

    if (gap >= minBreakDuration) {
      gaps.push({
        start: sortedLogs[i - 1].timestamp,
        end: sortedLogs[i].timestamp,
        duration: gap
      });
    }
  }

  // Sort by duration (largest first) - return ALL breaks, not just top 3
  return gaps.sort((a, b) => b.duration - a.duration);
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
    const { addressDatasetService } = await import('../services/googleSheets');

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

    // Konvertiere Map zu Array und sortiere nach totalActions
    const usersArray = Array.from(allUserData.values()).sort((a, b) => {
      return b.totalActions - a.totalActions;
    });

    // Transformiere DailyUserData zu DashboardLiveData Format
    const dashboardUsers = usersArray.map(userData => {
      const lastGpsPoint = userData.gpsPoints.length > 0 
        ? userData.gpsPoints[userData.gpsPoints.length - 1]
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

      // Calculate peak time and breaks
      const peakTime = calculatePeakTime(userData.rawLogs);
      const breaks = calculateBreaks(userData.rawLogs);

      // Debug: Log if breaks are empty but rawLogs exist
      if (breaks.length === 0 && userData.rawLogs.length > 0) {
        console.log(`[Admin API] No breaks found for ${userData.username} despite ${userData.rawLogs.length} logs`);
      }

      // Determine if user is currently active (last activity within 15 minutes)
      const lastActivityTime = userData.rawLogs.length > 0 
        ? userData.rawLogs[userData.rawLogs.length - 1].timestamp 
        : 0;
      const isCurrentlyActive = userData.activeTime > 0 && (Date.now() - lastActivityTime) < 15 * 60 * 1000; // 15 minutes

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
        },
      };
    });

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

    // Transformiere zu DashboardLiveData Format
    const dashboardUsers = userData.map(user => {
      const lastGpsPoint = user.gpsPoints.length > 0 
        ? user.gpsPoints[user.gpsPoints.length - 1]
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

      // Calculate peak time and breaks
      const peakTime = calculatePeakTime(user.rawLogs);
      const breaks = calculateBreaks(user.rawLogs);

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
    });

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

    console.log(`[Admin API] Fetching route data for user ${userIdStr} on ${dateStr} (source: ${sourceFilter || 'all'})`);

    // Prüfe ob es heute ist (Live-Daten) oder historische Daten
    const today = getBerlinDate();
    let gpsPoints: any[] = [];
    let photoTimestamps: number[] = [];
    let username = '';

    // Finde Username für userId (wird immer benötigt)
    const { googleSheetsService } = await import('../services/googleSheets');
    const allUsers = await googleSheetsService.getAllUsers();
    const user = allUsers.find(u => u.userId === userIdStr);

    if (user) {
      username = user.username;
    }

    // Lade Daten (native/followmee/external_app aus Logs/SQLite)
    if (dateStr === today) {
      // Live-Daten aus RAM
      const userData = dailyDataStore.getUserDailyData(userIdStr);
      if (userData) {
        gpsPoints = userData.gpsPoints;
        if (!username) username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    } else {
      // Historische Daten aus SQLite
      const historicalData = await scrapeDayData(dateStr, userIdStr);

      if (historicalData && historicalData.length > 0) {
        const userData = historicalData[0];
        gpsPoints = userData.gpsPoints;
        if (!username) username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    }

    // Externe Tracking-Daten sind bereits in gpsPoints enthalten (aus SQLite mit source: 'external_app')
    // Kein separates Laden mehr nötig

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

    // Gebe immer 200 zurück, auch wenn keine Daten gefunden wurden
    // (verhindert Service Worker Cache-Probleme)
    res.json({
      gpsPoints: gpsPoints || [],
      photoTimestamps: photoTimestamps || [],
      username: username || 'Unknown',
      date: dateStr,
      source: sourceFilter || 'all',
      totalPoints: gpsPoints.length,
      totalPhotos: photoTimestamps.length
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

export default router;
