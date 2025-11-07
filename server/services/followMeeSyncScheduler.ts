/**
 * FollowMee Sync Scheduler
 *
 * Runs every 5 minutes to fetch GPS data from FollowMee API
 * and queue it via batchLogger (no more direct Google Sheets writes)
 *
 * NEW ARCHITECTURE:
 * - Initial sync on server start: Loads existing logs, compares with FollowMee data
 * - Periodic sync: Compares with cache, queues only new data
 * - No more blocking of batchLogger (FollowMee uses queue now)
 */

import { followMeeApiService } from './followMeeApi';
import { googleSheetsService } from './googleSheets';

class FollowMeeSyncScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private isRunning = false;
  private initialSyncDone = false;

  /**
   * Start the automatic sync scheduler
   */
  start() {
    if (this.intervalId) {
      console.log('[FollowMee Scheduler] Already running');
      return;
    }

    console.log('[FollowMee Scheduler] Starting automatic sync (every 5 minutes)...');

    // Run initial sync on startup
    this.syncNow();

    // Then run periodic sync every 5 minutes
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

    try {
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

      // Run appropriate sync
      if (!this.initialSyncDone) {
        console.log('[FollowMee Scheduler] Running INITIAL SYNC...');
        await followMeeApiService.initialSync();
        this.initialSyncDone = true;
      } else {
        console.log('[FollowMee Scheduler] Running PERIODIC SYNC...');
        await followMeeApiService.periodicSync();
      }

      console.log('[FollowMee Scheduler] ✅ Sync completed successfully');
    } catch (error) {
      console.error('[FollowMee Scheduler] ❌ Sync failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: !!this.intervalId,
      syncing: this.isRunning,
      initialSyncDone: this.initialSyncDone,
      intervalMs: this.SYNC_INTERVAL_MS,
      followMeeStatus: followMeeApiService.getStatus()
    };
  }
}

export const followMeeSyncScheduler = new FollowMeeSyncScheduler();
