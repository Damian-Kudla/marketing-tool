/**
 * Daily Report Cron Job Service
 * 
 * Runs at midnight (MEZ) to:
 * 1. Generate final daily reports (overwrite any partial reports)
 * 2. Check for missing reports since 17.11.2025 and create them
 */

import cron from 'node-cron';
import { getBerlinDate } from '../utils/timezone';
import { createDailyReport } from './dailyReportGenerator';

class DailyReportCronService {
  private cronJob: cron.ScheduledTask | null = null;
  private readonly START_DATE = '2025-11-17'; // First day with complete tracking data

  /**
   * Start cron job (runs at 00:05 MEZ every day)
   */
  start() {
    // Run at 00:05 MEZ (23:05 UTC in winter, 22:05 UTC in summer)
    // Using Europe/Berlin timezone to handle DST automatically
    this.cronJob = cron.schedule(
      '5 0 * * *',
      async () => {
        try {
          await this.runDailyReportTask();
        } catch (error) {
          console.error('[DailyReportCron] Error running daily report task:', error);
        }
      },
      {
        timezone: 'Europe/Berlin',
      }
    );

    console.log('[DailyReportCron] Cron job started (runs at 00:05 MEZ)');
  }

  /**
   * Stop cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log('[DailyReportCron] Cron job stopped');
    }
  }

  /**
   * Main task: Generate report for yesterday
   */
  private async runDailyReportTask() {
    const yesterday = this.getYesterday();
    console.log(`[DailyReportCron] Generating final daily report for ${yesterday}`);

    try {
      await createDailyReport(yesterday, false); // isPartial = false
      console.log(`[DailyReportCron] ✅ Final report for ${yesterday} created successfully`);
    } catch (error) {
      console.error(`[DailyReportCron] ❌ Failed to create report for ${yesterday}:`, error);
    }
  }

  /**
   * Get yesterday's date (MEZ timezone)
   */
  private getYesterday(): string {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return getBerlinDate(yesterday);
  }

  /**
   * Generate missing reports since START_DATE
   * Called on server startup
   */
  async generateMissingReports() {
    console.log(`[DailyReportCron] Checking for missing reports since ${this.START_DATE}...`);

    const today = getBerlinDate(new Date());
    const missingDates = this.getMissingDates(today);

    if (missingDates.length === 0) {
      console.log('[DailyReportCron] No missing reports found');
      return;
    }

    console.log(`[DailyReportCron] Found ${missingDates.length} missing reports, generating...`);

    for (const date of missingDates) {
      try {
        await createDailyReport(date, false);
        console.log(`[DailyReportCron] ✅ Created missing report for ${date}`);
      } catch (error) {
        console.error(`[DailyReportCron] ❌ Failed to create report for ${date}:`, error);
      }
    }

    console.log('[DailyReportCron] Missing reports generation complete');
  }

  /**
   * Get list of dates that need reports (from START_DATE to yesterday)
   * TODO: Check Google Drive to see which reports already exist
   */
  private getMissingDates(today: string): string[] {
    const dates: string[] = [];
    const start = new Date(this.START_DATE);
    const end = new Date(today);
    
    // Only generate up to yesterday (not including today)
    end.setDate(end.getDate() - 1);

    const current = new Date(start);
    
    while (current <= end) {
      dates.push(getBerlinDate(current));
      current.setDate(current.getDate() + 1);
    }

    // TODO: Filter out dates that already have reports in Google Drive
    // For now, we'll just generate all dates (Drive upload will update existing files)
    
    return dates;
  }

  /**
   * Manually trigger report generation for a specific date
   */
  async generateReportForDate(dateStr: string, isPartial: boolean = false) {
    console.log(`[DailyReportCron] Manually generating ${isPartial ? 'partial' : 'final'} report for ${dateStr}`);
    
    try {
      await createDailyReport(dateStr, isPartial);
      console.log(`[DailyReportCron] ✅ Report for ${dateStr} created successfully`);
    } catch (error) {
      console.error(`[DailyReportCron] ❌ Failed to create report for ${dateStr}:`, error);
      throw error;
    }
  }
}

export const dailyReportCronService = new DailyReportCronService();
