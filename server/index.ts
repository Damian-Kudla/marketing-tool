import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { cronJobService } from "./services/cronJobService";
import { dailyDataStore } from "./services/dailyDataStore";
import { followMeeSyncScheduler } from "./services/followMeeSyncScheduler";
import { cookieStorageService } from "./services/cookieStorageService";
import { googleRoadsService } from "./services/googleRoadsService";
import { googleDriveSyncService } from "./services/googleDriveSyncService";
import { sqliteBackupService } from "./services/sqliteBackupService";
import { sqliteStartupSyncService } from "./services/sqliteStartupSync";
import { sqliteDailyArchiveService } from "./services/sqliteDailyArchive";
import { closeAllDBs } from "./services/sqliteLogService";
import { shouldLogEndpoint } from "./config/logConfig";
import { batchLogger } from "./services/batchLogger";
import { systemStartupSync, systemDB } from "./services/systemDatabaseService";
import { egonScraperService } from "./services/egonScraperService";

// Force Railway rebuild - production path fix

const app = express();
app.use(express.json({ limit: '10mb' })); // Erhöhe Body-Limit für Snap-to-Roads mit vielen GPS-Punkten
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    
    // Only log API requests that match our filter criteria
    if (path.startsWith("/api") && shouldLogEndpoint(path)) {
      // Extract username from session if available
      const username = (req as any).username;
      const userPrefix = username ? `[${username}]` : '';
      
      let logLine = `${userPrefix} ${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  
  server.listen(port, "0.0.0.0", async () => {
    log(`Server is running on port ${port}`);
    log(`Environment: ${app.get("env")}`);
    log(`Health check available at: http://0.0.0.0:${port}/api/auth/check`);

    // Initialize Google Sheets Caches (user auth, datasets, validated streets)
    // THIS MUST BE FIRST - required for authentication to work immediately
    log('Initializing Google Sheets caches (user auth, datasets, validated streets)...');
    try {
      const { initializeGoogleSheetsCaches } = await import('./services/googleSheets');
      await initializeGoogleSheetsCaches();
      log('✅ Google Sheets caches initialized - login ready!');
    } catch (error) {
      log(`❌ Failed to initialize Google Sheets caches: ${error}`);
      log('⚠️  Authentication may not work properly!');
    }

    // Initialize cookie storage service (loads from Google Sheets)
    log('Initializing cookie storage service...');
    await cookieStorageService.initialize();

    // Initialize daily data store from today's logs
    log('Initializing daily data from Google Sheets logs...');
    await dailyDataStore.initializeFromLogs();

    // Start cron jobs for failed log retry
    cronJobService.start();

    // Start FollowMee GPS sync scheduler (every 5 minutes)
    if (process.env.FOLLOWMEE_API) {
      log('Starting FollowMee GPS sync scheduler...');
      followMeeSyncScheduler.start();
    } else {
      log('FollowMee API key not configured, skipping GPS sync scheduler');
    }

    // Initialize Google Roads Service (loads current month's cache)
    log('Initializing Google Roads Service...');
    await googleRoadsService.initialize();

    // Initialize Google Drive Sync Service (hourly sync of cache files)
    log('Initializing Google Drive Sync Service...');
    await googleDriveSyncService.initialize();

    // Initialize SQLite Backup Service (for DB archiving to Drive)
    log('Initializing SQLite Backup Service...');
    await sqliteBackupService.initialize();

    // Perform External Tracking Reconciliation (before startup sync)
    log('Checking for unassigned external tracking data...');
    try {
      const { externalTrackingReconciliationService } = await import('./services/externalTrackingReconciliation');
      const stats = await externalTrackingReconciliationService.reconcileUnassignedTrackingData();

      if (stats.devicesProcessed > 0) {
        log(`External Tracking Reconciliation: ${stats.devicesAssigned} devices assigned, ${stats.devicesRemaining} remaining, ${stats.totalDataPoints} GPS points processed`);

        // If we added current-day data, flush batchLogger and reload DailyStore
        if (stats.currentDataPoints > 0) {
          log('Flushing new GPS data to Google Sheets...');
          await batchLogger.flushNow();

          log('Reloading DailyStore with updated tracking data...');
          await dailyDataStore.initializeFromLogs();
          log(`✅ DailyStore updated with ${stats.currentDataPoints} new GPS points`);
        }
      } else {
        log('No unassigned external tracking data found');
      }
    } catch (error) {
      log(`⚠️ External tracking reconciliation failed: ${error}`);
    }

    // ============================================================
    // TEMPORARY: Immediate Drive Backup of ALL SQLite DBs
    // This runs BEFORE all sync phases to get the current state
    // DELETE THIS BLOCK AFTER ONE SUCCESSFUL RUN!
    // ============================================================
    log('🚨 IMMEDIATE DRIVE BACKUP - Uploading ALL SQLite databases to Drive...');
    try {
      const { systemDriveBackup } = await import('./services/systemDatabaseService');
      const { sqliteBackupService } = await import('./services/sqliteBackupService');
      
      // Backup System DBs (cookies, appointments, pauseLocations, authLogs, categoryChanges, addressDatasets)
      log('  → Backing up System DBs to Drive...');
      const systemBackupResult = await systemDriveBackup.backupAll();
      log(`  ✅ System DBs backed up: ${systemBackupResult.success.length} success, ${systemBackupResult.failed.length} failed`);
      if (systemBackupResult.failed.length > 0) {
        log(`  ⚠️ Failed: ${systemBackupResult.failed.join(', ')}`);
      }
      
      // Backup User Activity Log DBs (logs-YYYY-MM-DD.db files)
      log('  → Backing up User Activity Log DBs to Drive...');
      const logBackupResult = await sqliteBackupService.backupAllToDrive();
      log(`  ✅ User Log DBs backed up: ${logBackupResult.uploaded} uploaded, ${logBackupResult.skipped} skipped, ${logBackupResult.failed} failed`);
      
      log('🎉 IMMEDIATE DRIVE BACKUP COMPLETE - You can now download DBs from Drive!');
    } catch (error) {
      log(`❌ IMMEDIATE DRIVE BACKUP FAILED: ${error}`);
    }
    // ============================================================
    // END TEMPORARY BLOCK
    // ============================================================

    // Perform Startup Sync (check local DBs, download missing, merge Sheets)
    log('Starting SQLite Startup Sync (this may take a moment)...');
    await sqliteStartupSyncService.performStartupSync();

    // Perform System Database Startup Sync (Cookies, Appointments, etc.)
    log('Starting System Database Startup Sync...');
    try {
      const systemSyncResult = await systemStartupSync.performStartupSync();
      if (systemSyncResult.errors.length > 0) {
        log(`⚠️ System DB sync completed with ${systemSyncResult.errors.length} errors`);
      } else {
        log('✅ System Database Startup Sync completed');
      }
    } catch (error) {
      log(`⚠️ System DB startup sync failed: ${error}`);
    }

    // Perform EGON Orders Startup Sync (restore from Drive/Sheets if local is empty)
    log('Starting EGON Orders Startup Sync...');
    try {
      await egonScraperService.performStartupSync();
      log(`✅ EGON Orders Startup Sync completed (${egonScraperService.getOrderCount()} orders)`);
    } catch (error) {
      log(`⚠️ EGON Orders startup sync failed: ${error}`);
    }

    // Start Daily Archive Cron Job (runs at midnight CET)
    log('Starting SQLite Daily Archive cron job...');
    sqliteDailyArchiveService.start();

    // Initialize Pause Location Cache (loads from Google Sheets)
    log('Initializing Pause Location Cache...');
    try {
      const { pauseLocationCache } = await import('./services/pauseLocationCache');
      await pauseLocationCache.initialize();
      log('✅ Pause Location Cache initialized');
    } catch (error) {
      log(`⚠️ Failed to initialize Pause Location Cache: ${error}`);
    }

    // Start Daily Report Cron Job (runs at midnight MEZ)
    log('Starting Daily Report cron job...');
    try {
      const { dailyReportCronService } = await import('./services/dailyReportCron');
      dailyReportCronService.start();
      
      // Generate missing reports since 17.11.2025
      await dailyReportCronService.generateMissingReports();
      log('✅ Daily Report cron job started');
    } catch (error) {
      log(`⚠️ Failed to start Daily Report cron: ${error}`);
    }
  });

  // Graceful shutdown: save cache before exit
  process.on('SIGINT', async () => {
    log('Received SIGINT, saving cache and shutting down...');
    await googleRoadsService.saveCache();
    googleDriveSyncService.stop();
    sqliteDailyArchiveService.stop();
    closeAllDBs();
    systemDB.closeAll();
    egonScraperService.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('Received SIGTERM, saving cache and shutting down...');
    await googleRoadsService.saveCache();
    googleDriveSyncService.stop();
    sqliteDailyArchiveService.stop();
    closeAllDBs();
    systemDB.closeAll();
    egonScraperService.close();
    process.exit(0);
  });
})();
