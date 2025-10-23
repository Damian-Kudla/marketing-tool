import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { cronJobService } from "./services/cronJobService";
import { dailyDataStore } from "./services/dailyDataStore";
import { shouldLogEndpoint } from "./config/logConfig";

// Force Railway rebuild - production path fix

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
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
    
    // Initialize daily data store from today's logs
    log('Initializing daily data from Google Sheets logs...');
    await dailyDataStore.initializeFromLogs();
    
    // Start cron jobs for failed log retry
    cronJobService.start();
  });
})();
