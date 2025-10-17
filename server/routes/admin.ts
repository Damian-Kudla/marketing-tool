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
import type { DailyUserData, DashboardLiveData } from '../../shared/trackingTypes';

const router = Router();

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

    const allUserData = dailyDataStore.getAllUserData();

    // Konvertiere Map zu Array und sortiere nach Activity Score
    const usersArray = Array.from(allUserData.values()).sort((a, b) => {
      return b.activityScore - a.activityScore;
    });

    // Transformiere DailyUserData zu DashboardLiveData Format
    const dashboardUsers = usersArray.map(userData => {
      const lastGpsPoint = userData.gpsPoints[userData.gpsPoints.length - 1];
      const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((sum, count) => sum + count, 0);

      return {
        userId: userData.userId,
        username: userData.username,
        currentLocation: lastGpsPoint,
        isActive: userData.activeTime > 0,
        lastSeen: userData.rawLogs.length > 0 
          ? userData.rawLogs[userData.rawLogs.length - 1].timestamp 
          : Date.now(),
        todayStats: {
          activityScore: userData.activityScore,
          totalActions: userData.totalActions,
          statusChanges: userData.statusChanges,
          activeTime: userData.activeTime,
          distance: userData.totalDistance,
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
      averageActivityScore: usersArray.length > 0
        ? Math.round(usersArray.reduce((sum, u) => sum + u.activityScore, 0) / usersArray.length)
        : 0,
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

    // Sortiere nach Activity Score
    userData.sort((a, b) => b.activityScore - a.activityScore);

    // Transformiere zu DashboardLiveData Format
    const dashboardUsers = userData.map(user => {
      const lastGpsPoint = user.gpsPoints[user.gpsPoints.length - 1];
      
      return {
        userId: user.userId,
        username: user.username,
        currentLocation: lastGpsPoint,
        isActive: user.activeTime > 0,
        lastSeen: user.rawLogs.length > 0 
          ? user.rawLogs[user.rawLogs.length - 1].timestamp 
          : Date.now(),
        todayStats: {
          activityScore: user.activityScore,
          totalActions: user.totalActions,
          statusChanges: user.statusChanges,
          activeTime: user.activeTime,
          distance: user.totalDistance,
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
      averageActivityScore: userData.length > 0
        ? Math.round(userData.reduce((sum, u) => sum + u.activityScore, 0) / userData.length)
        : 0,
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
 * GET /api/admin/reports/:date
 * Prüft ob ein Report für das Datum existiert
 */
router.get('/reports/:date', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.params;

    // Validiere Datumsformat
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const reportsDir = path.join(process.cwd(), 'reports');
    const filename = `daily-report-${date}.pdf`;
    const filePath = path.join(reportsDir, filename);

    const exists = fs.existsSync(filePath);

    if (!exists) {
      return res.status(404).json({ 
        exists: false,
        message: 'Report not found for this date' 
      });
    }

    // Hole Datei-Statistiken
    const stats = fs.statSync(filePath);

    res.json({
      exists: true,
      date,
      filename,
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      downloadUrl: `/api/admin/reports/${date}/download`,
    });

  } catch (error) {
    console.error('[Admin API] Error checking report:', error);
    res.status(500).json({ error: 'Failed to check report status' });
  }
});

/**
 * GET /api/admin/reports/:date/download
 * Lädt den PDF-Report für ein bestimmtes Datum herunter
 */
router.get('/reports/:date/download', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.params;

    // Validiere Datumsformat
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const reportsDir = path.join(process.cwd(), 'reports');
    const filename = `daily-report-${date}.pdf`;
    const filePath = path.join(reportsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found for this date' });
    }

    console.log(`[Admin API] Downloading report for ${date}`);

    // Setze Response Headers für PDF-Download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream PDF-Datei
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('[Admin API] Error streaming PDF:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download report' });
      }
    });

  } catch (error) {
    console.error('[Admin API] Error downloading report:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download report' });
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
        activityScore: userData.activityScore,
        lastUpdate: lastLogTimestamp,
        statusChangesCount: totalStatusChanges,
        activeTime: userData.activeTime,
      };
    });

    // Sortiere nach Activity Score
    users.sort((a, b) => b.activityScore - a.activityScore);

    res.json({
      users,
      totalUsers: users.length,
    });

  } catch (error) {
    console.error('[Admin API] Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
