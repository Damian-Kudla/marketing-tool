/**
 * Admin Dashboard API Routes
 * 
 * Stellt Endpunkte für das Admin-Dashboard bereit:
 * - Live-Daten (aktueller Tag aus RAM)
 * - Historische Daten (vergangene Tage aus Google Sheets)
 * - PDF-Reports (Download & Status)
 */

import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { dailyDataStore } from '../services/dailyDataStore';
import { scrapeDayData, clearHistoricalCache, getCacheStats } from '../services/historicalDataScraper';
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
    edits: userData.actionsByType.get('edit') || 0,
    saves: userData.actionsByType.get('save') || 0,
    deletes: userData.actionsByType.get('delete') || 0,
    statusChanges: userData.actionsByType.get('status_change') || 0,
    navigations: userData.actionsByType.get('navigate') || 0,
    other: 0
  };

  // Calculate "other" by summing all remaining unmapped action types
  const knownActions = new Set([
    'scan', 'bulk_residents_update', 'dataset_create', 'geocode',
    'edit', 'save', 'delete', 'status_change', 'navigate'
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
    const hour = new Date(log.timestamp).getHours();
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
 * Calculate top 3 breaks (largest time gaps between activities)
 * A break is considered significant if it's at least 15 minutes
 */
function calculateBreaks(rawLogs: TrackingData[]): Array<{ start: number; end: number; duration: number }> {
  if (rawLogs.length < 2) return [];

  // Sort logs by timestamp
  const sortedLogs = [...rawLogs].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate all gaps
  const gaps: Array<{ start: number; end: number; duration: number }> = [];
  
  for (let i = 1; i < sortedLogs.length; i++) {
    const gap = sortedLogs[i].timestamp - sortedLogs[i - 1].timestamp;
    const minBreakDuration = 15 * 60 * 1000; // 15 minutes
    
    if (gap >= minBreakDuration) {
      gaps.push({
        start: sortedLogs[i - 1].timestamp,
        end: sortedLogs[i].timestamp,
        duration: gap
      });
    }
  }

  // Sort by duration (largest first) and take top 3
  return gaps.sort((a, b) => b.duration - a.duration).slice(0, 3);
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

      return {
        userId: userData.userId,
        username: userData.username,
        currentLocation: lastGpsPoint,
        isActive: userData.activeTime > 0,
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
      date: new Date().toISOString().split('T')[0],
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

      return {
        userId: user.userId,
        username: user.username,
        currentLocation: lastGpsPoint,
        isActive: user.activeTime > 0,
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

    // Cache nach Verwendung löschen (wie gefordert: RAM-Daten nach Verwendung löschen)
    setTimeout(() => {
      clearHistoricalCache(date, userId as string | undefined);
    }, 5000); // 5 Sekunden Verzögerung für eventuelle Follow-up Requests

  } catch (error: any) {
    console.error('[Admin API] ❌ Error fetching historical data:', error);
    
    // Detaillierte Fehlerausgabe für Debugging
    const errorMessage = error.message || 'Failed to fetch historical data';
    const errorDetails = {
      error: errorMessage,
      date,
      timestamp: new Date().toISOString(),
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
    const { userId, date } = req.query;

    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required' });
    }

    const dateStr = date as string;
    const userIdStr = userId as string;

    console.log(`[Admin API] Fetching route data for user ${userIdStr} on ${dateStr}`);

    // Prüfe ob es heute ist (Live-Daten) oder historische Daten
    const today = new Date().toISOString().split('T')[0];
    let gpsPoints: any[] = [];
    let photoTimestamps: number[] = [];
    let username = '';

    if (dateStr === today) {
      // Live-Daten aus RAM
      const userData = dailyDataStore.getUserDailyData(userIdStr);
      if (userData) {
        gpsPoints = userData.gpsPoints;
        username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    } else {
      // Historische Daten aus Google Sheets
      const historicalData = await scrapeDayData(dateStr, userIdStr);
      
      if (historicalData && historicalData.length > 0) {
        const userData = historicalData[0];
        gpsPoints = userData.gpsPoints;
        username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    }

    if (gpsPoints.length === 0) {
      return res.status(404).json({ 
        error: 'No GPS data found for this user on this date',
        gpsPoints: [],
        photoTimestamps: [],
        username: username || 'Unknown',
        date: dateStr
      });
    }

    res.json({
      gpsPoints,
      photoTimestamps,
      username,
      date: dateStr,
      totalPoints: gpsPoints.length,
      totalPhotos: photoTimestamps.length
    });

    // Cache nach Verwendung löschen bei historischen Daten
    if (dateStr !== today) {
      setTimeout(() => {
        clearHistoricalCache(dateStr, userIdStr);
      }, 5000);
    }

  } catch (error: any) {
    console.error('[Admin API] ❌ Error fetching route data:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch route data' 
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
      resetTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Admin API] Error resetting data:', error);
    res.status(500).json({ error: 'Failed to reset daily data' });
  }
});

export default router;
