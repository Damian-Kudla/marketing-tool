import { retryFailedLogs } from './enhancedLogging';

class CronJobService {
  private retryInterval: NodeJS.Timeout | null = null;
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

  stop() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
      console.log('[CronJobService] Cron jobs stopped');
    }
  }
}

export const cronJobService = new CronJobService();
