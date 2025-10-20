import { retryFailedLogs } from './enhancedLogging';
import { generateDailyReport } from './reportGenerator';

class CronJobService {
  private retryInterval: NodeJS.Timeout | null = null;
  private dailyReportTimeout: NodeJS.Timeout | null = null;
  private readonly RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

    console.log(`[CronJobService] Cron jobs started (retry every ${this.RETRY_INTERVAL_MS / 1000}s)`);

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
   * Schedule daily report generation at 20:00
   */
  private scheduleDailyReport() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(20, 0, 0, 0); // 20:00 today

    // If it's already past 20:00 today, schedule for tomorrow
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();

    console.log(`[CronJobService] Daily report scheduled for ${target.toLocaleString('de-DE')} (in ${Math.round(msUntilTarget / 1000 / 60)} minutes)`);

    this.dailyReportTimeout = setTimeout(() => {
      this.runDailyReport();
      
      // Reschedule for next day (24 hours from now)
      setInterval(() => {
        this.runDailyReport();
      }, 24 * 60 * 60 * 1000);
    }, msUntilTarget);
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
      const date = new Date().toISOString().split('T')[0];
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

    console.log('[CronJobService] Cron jobs stopped');
  }
}

export const cronJobService = new CronJobService();
