import { gpsTrackingService } from './gpsTracking';
import { sessionTrackingService } from './sessionTracking';
import { deviceTrackingService } from './deviceTracking';

class TrackingManager {
  private isInitialized = false;
  private currentUserId: string | null = null;
  private currentUsername: string | null = null;

  /**
   * Initialize tracking for current user
   * Call this after successful login
   */
  async initialize(userId: string, username: string): Promise<void> {
    if (this.isInitialized) {
      console.warn('[Tracking] Already initialized');
      return;
    }

    this.currentUserId = userId;
    this.currentUsername = username;

    console.log('[Tracking] Initializing tracking for user:', username);

    try {
      // Start all tracking services
      await Promise.all([
        gpsTrackingService.startTracking(),
        sessionTrackingService.startSession(userId, username),
        deviceTrackingService.startTracking()
      ]);

      // Request background tracking permission
      await gpsTrackingService.requestBackgroundTracking();

      this.isInitialized = true;
      console.log('[Tracking] All tracking services started successfully');
    } catch (error) {
      console.error('[Tracking] Error initializing tracking:', error);
      throw error;
    }
  }

  /**
   * Stop all tracking
   * Call this on logout or app close
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    console.log('[Tracking] Stopping all tracking services...');

    try {
      gpsTrackingService.stopTracking();
      await sessionTrackingService.stopSession();
      deviceTrackingService.stopTracking();

      this.isInitialized = false;
      this.currentUserId = null;
      this.currentUsername = null;

      console.log('[Tracking] All tracking services stopped');
    } catch (error) {
      console.error('[Tracking] Error stopping tracking:', error);
    }
  }

  /**
   * Log user action (convenience method)
   */
  logAction(
    action: 'scan' | 'edit' | 'save' | 'delete' | 'status_change' | 'navigate',
    details?: string,
    residentStatus?: 'interessiert' | 'nicht_interessiert' | 'nicht_angetroffen' | 'termin_vereinbart'
  ): void {
    sessionTrackingService.logAction(action, details, residentStatus);
  }

  /**
   * Check if tracking is initialized
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current user info
   */
  getCurrentUser(): { userId: string; username: string } | null {
    if (!this.currentUserId || !this.currentUsername) {
      return null;
    }
    return {
      userId: this.currentUserId,
      username: this.currentUsername
    };
  }

  /**
   * Get current tracking status (for debugging)
   */
  getStatus(): {
    initialized: boolean;
    gpsActive: boolean;
    sessionActive: boolean;
    deviceActive: boolean;
  } {
    return {
      initialized: this.isInitialized,
      gpsActive: gpsTrackingService.isActive(),
      sessionActive: sessionTrackingService.isSessionActive(),
      deviceActive: deviceTrackingService.isActive()
    };
  }
}

export const trackingManager = new TrackingManager();
