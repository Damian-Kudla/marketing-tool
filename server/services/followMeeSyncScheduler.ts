/**
 * FollowMee Sync Scheduler
 * 
 * Runs every 5 minutes to fetch GPS data from FollowMee API
 * and integrate it into user activity logs
 */

import { followMeeApiService } from './followMeeApi';
import { googleSheetsService } from './googleSheets';
import { batchLogger } from './batchLogger';

class FollowMeeSyncScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private isRunning = false;

  /**
   * Start the automatic sync scheduler
   */
  start() {
    if (this.intervalId) {
      console.log('[FollowMee Scheduler] Already running');
      return;
    }

    console.log('[FollowMee Scheduler] Starting automatic sync (every 5 minutes)...');

    // Run immediately on startup
    this.syncNow();

    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.syncNow();
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Stop the automatic sync scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[FollowMee Scheduler] Stopped automatic sync');
    }
  }

  /**
   * Trigger sync immediately
   */
  async syncNow() {
    if (this.isRunning) {
      console.log('[FollowMee Scheduler] Sync already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[FollowMee Scheduler] Starting sync...');

    try {
      // STEP 1: Block batch logger from writing during FollowMee sync
      batchLogger.setFollowMeeSyncing(true);

      // Load user mappings from Google Sheets
      const users = await googleSheetsService.getAllUsers();
      const usersWithDevices = users.filter(u => u.followMeeDeviceId);

      if (usersWithDevices.length === 0) {
        console.log('[FollowMee Scheduler] No users with FollowMee devices configured');
        return;
      }

      // Update mappings in FollowMee service
      followMeeApiService.updateUserMappings(usersWithDevices.map(u => ({
        userId: u.userId,
        username: u.username,
        followMeeDeviceId: u.followMeeDeviceId!
      })));

      // STEP 2: Fetch and sync GPS data (writes to Google Sheets)
      await followMeeApiService.syncAllUsers();

      console.log('[FollowMee Scheduler] ✅ Sync completed successfully');
    } catch (error) {
      console.error('[FollowMee Scheduler] ❌ Sync failed:', error);
    } finally {
      // STEP 3: Always unblock batch logger, even on error
      batchLogger.setFollowMeeSyncing(false);
      this.isRunning = false;

      // STEP 4: After FollowMee sync, trigger batch flush to write queued logs
      // This ensures batch logs are written AFTER FollowMee data, respecting the new row count
      console.log('[FollowMee Scheduler] Triggering batch flush after sync...');
      await batchLogger.forceFlushNow();
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: !!this.intervalId,
      syncing: this.isRunning,
      intervalMs: this.SYNC_INTERVAL_MS,
      followMeeStatus: followMeeApiService.getStatus()
    };
  }
}

export const followMeeSyncScheduler = new FollowMeeSyncScheduler();
