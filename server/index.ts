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
      } else {
        log('No unassigned external tracking data found');
      }
    } catch (error) {
      log(`⚠️ External tracking reconciliation failed: ${error}`);
    }

    // Perform Startup Sync (check local DBs, download missing, merge Sheets)
    log('Starting SQLite Startup Sync (this may take a moment)...');
    await sqliteStartupSyncService.performStartupSync();

    // Start Daily Archive Cron Job (runs at midnight CET)
    log('Starting SQLite Daily Archive cron job...');
    sqliteDailyArchiveService.start();
  });

  // Graceful shutdown: save cache before exit
  process.on('SIGINT', async () => {
    log('Received SIGINT, saving cache and shutting down...');
    await googleRoadsService.saveCache();
    googleDriveSyncService.stop();
    sqliteDailyArchiveService.stop();
    closeAllDBs();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('Received SIGTERM, saving cache and shutting down...');
    await googleRoadsService.saveCache();
    googleDriveSyncService.stop();
    sqliteDailyArchiveService.stop();
    closeAllDBs();
    process.exit(0);
  });
})();
