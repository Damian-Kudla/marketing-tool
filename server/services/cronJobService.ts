import { retryFailedLogs } from './enhancedLogging';
import { generateDailyReport } from './reportGenerator';
import { getBerlinDate, getBerlinTimestamp, getNextBerlinTime } from '../utils/timezone';
import { systemDriveBackup, systemDB } from './systemDatabaseService';
import { egonScraperService } from './egonScraperService';

class CronJobService {
  private retryInterval: NodeJS.Timeout | null = null;
  private dailyReportTimeout: NodeJS.Timeout | null = null;
  private midnightBackupTimeout: NodeJS.Timeout | null = null;
  private egonScraperInterval: NodeJS.Timeout | null = null;
  private readonly RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly EGON_SCRAPER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  start() {
    console.log('[CronJobService] Starting cron jobs...');
    
    // Retry failed logs every 5 minutes
    this.retryInterval = setInterval(async () => {
      console.log('[CronJobService] Running failed logs retry job...');
      try {
        await retryFailedLogs();
      } catch (error) {
        console.error('[CronJobService] Error in retry job:', error);
      }
    }, this.RETRY_INTERVAL_MS);

    // Schedule daily report at 20:00
    this.scheduleDailyReport();

    // Schedule midnight backup at 00:00
    this.scheduleMidnightBackup();

    // Schedule EGON scraper hourly
    this.scheduleEgonScraper();

    console.log(`[CronJobService] Cron jobs started (retry every ${this.RETRY_INTERVAL_MS / 1000}s, EGON every ${this.EGON_SCRAPER_INTERVAL_MS / 60000}m)`);

    // Run initial retry on startup (after 10 seconds)
    setTimeout(async () => {
      console.log('[CronJobService] Running initial failed logs retry...');
      try {
        await retryFailedLogs();
      } catch (error) {
        console.error('[CronJobService] Error in initial retry:', error);
      }
    }, 10000);
  }

  /**
   * Schedule daily report generation at 20:00 CET/CEST
   */
  private scheduleDailyReport() {
    const now = new Date();
    const target = getNextBerlinTime(20, 0, 0, now);
    const msUntilTarget = Math.max(target.getTime() - now.getTime(), 0);

    console.log(
      `[CronJobService] Daily report scheduled for ${getBerlinTimestamp(target)} (in ${Math.round(msUntilTarget / 60000)} minutes)`
    );

    this.dailyReportTimeout = setTimeout(() => {
      this.runDailyReport();

      setInterval(() => {
        this.runDailyReport();
      }, 24 * 60 * 60 * 1000);
    }, msUntilTarget);
  }

  /**
   * Schedule midnight backup of all system databases at 00:00 CET/CEST
   */
  private scheduleMidnightBackup() {
    const now = new Date();
    const target = getNextBerlinTime(0, 0, 0, now);
    const msUntilTarget = Math.max(target.getTime() - now.getTime(), 0);

    console.log(
      `[CronJobService] Midnight backup scheduled for ${getBerlinTimestamp(target)} (in ${Math.round(msUntilTarget / 60000)} minutes)`
    );

    this.midnightBackupTimeout = setTimeout(() => {
      this.runMidnightBackup();

      // Repeat every 24 hours
      setInterval(() => {
        this.runMidnightBackup();
      }, 24 * 60 * 60 * 1000);
    }, msUntilTarget);
  }

  /**
   * Schedule EGON scraper to run hourly
   */
  private scheduleEgonScraper() {
    console.log(`[CronJobService] EGON scraper scheduled to run every ${this.EGON_SCRAPER_INTERVAL_MS / 60000} minutes`);

    // Run immediately on startup (after 30 seconds delay)
    setTimeout(async () => {
      console.log('[CronJobService] Running initial EGON scraper...');
      await this.runEgonScraper();
    }, 30000);

    // Then run every hour
    this.egonScraperInterval = setInterval(async () => {
      await this.runEgonScraper();
    }, this.EGON_SCRAPER_INTERVAL_MS);
  }

  /**
   * Run EGON scraper job
   */
  private async runEgonScraper() {
    console.log('[CronJobService] 🔄 Running EGON scraper...');
    
    try {
      const result = await egonScraperService.runScraper();
      console.log(`[CronJobService] ✅ EGON scraper complete: ${result.newOrders} new, ${result.syncedToSheets} synced, ${result.totalOrders} total`);
    } catch (error) {
      console.error('[CronJobService] ❌ Error during EGON scraper:', error);
    }
  }

  /**
   * Run midnight backup of all system databases to Google Drive
   */
  private async runMidnightBackup() {
    console.log('[CronJobService] 🌙 Running midnight system DB backup...');
    
    try {
      // Checkpoint all DBs first (flush WAL)
      systemDB.checkpointAll();
      egonScraperService.checkpoint();
      
      // Backup all system DBs to Drive
      const result = await systemDriveBackup.backupAll();
      
      // Backup EGON orders DB to Drive
      const egonBackupSuccess = await egonScraperService.backupToDrive();
      
      console.log(`[CronJobService] ✅ Midnight backup complete:`);
      console.log(`   - System DBs Success: ${result.success.join(', ') || 'none'}`);
      console.log(`   - System DBs Failed: ${result.failed.join(', ') || 'none'}`);
      console.log(`   - EGON Orders DB: ${egonBackupSuccess ? 'success' : 'failed'}`);
      
      if (result.failed.length > 0) {
        console.error('[CronJobService] ⚠️  Some backups failed:', result.failed);
      }
    } catch (error) {
      console.error('[CronJobService] ❌ Error during midnight backup:', error);
    }
  }

  /**
   * Run daily report generation
   * Note: Reports are now generated on-demand only
   * This function is kept for future use but currently disabled
   */
  private async runDailyReport() {
    console.log('[CronJobService] Daily report generation disabled (on-demand only)');
    // Reports werden nur noch bei Download generiert und sofort gelöscht
    // um Speicherplatz zu sparen
    
    /* Deaktiviert - Reports werden on-demand generiert
    try {
      const date = getBerlinDate();
      const reportPath = await generateDailyReport(date);
      console.log(`[CronJobService] Daily report generated successfully: ${reportPath}`);
    } catch (error: any) {
      console.error('[CronJobService] Error generating daily report:', error);
      
      // Check if it's because no users have sufficient logs
      if (error.message?.includes('No users with sufficient activity')) {
        console.log('[CronJobService] No users with minimum 10 logs today - skipping report');
      }
    }
    */
  }

  stop() {
    console.log('[CronJobService] Stopping cron jobs...');
    
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.dailyReportTimeout) {
      clearTimeout(this.dailyReportTimeout);
      this.dailyReportTimeout = null;
    }

    if (this.midnightBackupTimeout) {
      clearTimeout(this.midnightBackupTimeout);
      this.midnightBackupTimeout = null;
    }

    if (this.egonScraperInterval) {
      clearInterval(this.egonScraperInterval);
      this.egonScraperInterval = null;
    }

    console.log('[CronJobService] Cron jobs stopped');
  }
}

export const cronJobService = new CronJobService();
