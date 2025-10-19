import type { SessionData, ActionLog } from '../../../shared/trackingTypes';

class SessionTrackingService {
  private sessionData: SessionData | null = null;
  private idleTimer: number | null = null;
  private syncInterval: number | null = null;
  private idleDetector: any = null;
  
  private readonly IDLE_THRESHOLD = 60000; // 1 minute idle = inactive
  private readonly SYNC_INTERVAL = 30000; // Sync every 30 seconds
  private readonly MAX_ACTIONS_BUFFER = 100; // Max actions in memory before sync

  /**
   * Start session tracking for current user
   */
  async startSession(userId: string, username: string): Promise<void> {
    if (this.sessionData) {
      console.log('[Session] Session already active');
      return;
    }

    const now = Date.now();
    this.sessionData = {
      userId,
      username,
      startTime: now,
      lastActivity: now,
      isActive: true,
      idleTime: 0,
      sessionDuration: 0,
      pageViews: 1,
      actions: []
    };

    console.log('[Session] Session started for user:', username);

    // Setup activity listeners
    this.setupActivityListeners();

    // Setup Idle Detection API (if available)
    await this.setupIdleDetection();

    // Sync session data periodically
    this.syncInterval = window.setInterval(() => {
      this.syncSession();
    }, this.SYNC_INTERVAL);

    // Initial sync
    await this.syncSession();
  }

  /**
   * Stop current session
   */
  async stopSession(): Promise<void> {
    if (!this.sessionData) {
      return;
    }

    // Final sync before stopping
    await this.syncSession();

    // Cleanup
    this.cleanupActivityListeners();
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.idleDetector) {
      this.idleDetector.stop();
      this.idleDetector = null;
    }

    console.log('[Session] Session stopped');
    this.sessionData = null;
  }

  /**
   * Setup Idle Detection API (Chrome/Edge)
   * Falls back to manual idle detection if not available
   */
  private async setupIdleDetection(): Promise<void> {
    // @ts-ignore - IdleDetector might not be fully typed
    if ('IdleDetector' in window) {
      try {
        // @ts-ignore
        const state = await IdleDetector.requestPermission();
        if (state === 'granted') {
          // @ts-ignore
          this.idleDetector = new IdleDetector();
          this.idleDetector.addEventListener('change', () => {
            const userState = this.idleDetector.userState;
            const screenState = this.idleDetector.screenState;

            console.log('[Session] Idle state changed:', userState, screenState);

            if (userState === 'idle' || screenState === 'locked') {
              this.markAsIdle();
            } else {
              this.markAsActive();
            }
          });

          await this.idleDetector.start({
            threshold: this.IDLE_THRESHOLD
          });

          console.log('[Session] Idle Detection API active');
          return;
        }
      } catch (error) {
        console.warn('[Session] Idle Detection API not available:', error);
      }
    }

    // Fallback: manual idle detection
    this.setupManualIdleDetection();
  }

  /**
   * Fallback manual idle detection using activity events
   */
  private setupManualIdleDetection(): void {
    console.log('[Session] Using manual idle detection');
    this.resetIdleTimer();
  }

  /**
   * Reset idle timer on user activity
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = window.setTimeout(() => {
      this.markAsIdle();
    }, this.IDLE_THRESHOLD);

    if (this.sessionData && !this.sessionData.isActive) {
      this.markAsActive();
    }
  }

  /**
   * Mark session as idle
   */
  private markAsIdle(): void {
    if (!this.sessionData || !this.sessionData.isActive) {
      return;
    }

    this.sessionData.isActive = false;
    console.log('[Session] User is now IDLE');
    this.syncSession();
  }

  /**
   * Mark session as active
   */
  private markAsActive(): void {
    if (!this.sessionData || this.sessionData.isActive) {
      return;
    }

    const now = Date.now();
    const idleDuration = now - this.sessionData.lastActivity;
    this.sessionData.idleTime += idleDuration;
    this.sessionData.isActive = true;
    this.sessionData.lastActivity = now;

    console.log('[Session] User is now ACTIVE');
    this.syncSession();
  }

  /**
   * Setup activity event listeners
   */
  private setupActivityListeners(): void {
    // Mouse and keyboard activity
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => {
      document.addEventListener(event, this.handleActivity, { passive: true });
    });

    // Visibility change
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Page focus
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('blur', this.handleBlur);
  }

  /**
   * Cleanup activity event listeners
   */
  private cleanupActivityListeners(): void {
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => {
      document.removeEventListener(event, this.handleActivity);
    });

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('blur', this.handleBlur);
  }

  /**
   * Handle user activity
   */
  private handleActivity = (): void => {
    if (!this.sessionData) return;

    this.sessionData.lastActivity = Date.now();
    this.resetIdleTimer();
  };

  /**
   * Handle visibility change (tab switch, minimize)
   */
  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.markAsIdle();
    } else {
      this.markAsActive();
      this.sessionData!.pageViews++;
    }
  };

  /**
   * Handle window focus
   */
  private handleFocus = (): void => {
    this.markAsActive();
  };

  /**
   * Handle window blur
   */
  private handleBlur = (): void => {
    this.markAsIdle();
  };

  /**
   * Log user action
   */
  logAction(
    action: ActionLog['action'],
    details?: string,
    residentStatus?: ActionLog['residentStatus']
  ): void {
    if (!this.sessionData) {
      return;
    }

    const actionLog: ActionLog = {
      timestamp: Date.now(),
      action,
      details,
      residentStatus
    };

    this.sessionData.actions.push(actionLog);
    this.sessionData.lastActivity = actionLog.timestamp;
    this.resetIdleTimer();

    console.log('[Session] Action logged:', action, details);

    // Sync if buffer is full
    if (this.sessionData.actions.length >= this.MAX_ACTIONS_BUFFER) {
      console.log('[Session] Action buffer full, syncing...');
      this.syncSession();
    }
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number | null {
    // @ts-ignore - performance.memory is only available in Chrome/Edge
    if (performance.memory && performance.memory.usedJSHeapSize) {
      // @ts-ignore
      const usedMemoryMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
      return usedMemoryMB;
    }
    return null;
  }

  /**
   * Sync session data to backend
   */
  private async syncSession(): Promise<void> {
    if (!this.sessionData) {
      return;
    }

    // Calculate session duration
    const now = Date.now();
    this.sessionData.sessionDuration = now - this.sessionData.startTime;

    // Capture memory usage (negligible performance impact)
    const memoryUsageMB = this.getMemoryUsage();
    if (memoryUsageMB !== null) {
      console.log(`[Session] Memory usage: ${memoryUsageMB} MB`);
    }

    try {
      const response = await fetch('/api/tracking/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          session: {
            ...this.sessionData,
            // Convert Set/Map to arrays for JSON serialization
            actions: this.sessionData.actions
          },
          timestamp: now,
          memoryUsageMB // Add RAM usage to payload
        })
      });

      if (response.ok) {
        console.log('[Session] Session data synced');
        // Clear actions buffer after successful sync
        this.sessionData.actions = [];
      } else {
        console.error('[Session] Failed to sync session:', response.status);
      }
    } catch (error) {
      console.error('[Session] Error syncing session:', error);
    }
  }

  /**
   * Get current session data
   */
  getCurrentSession(): SessionData | null {
    return this.sessionData;
  }

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.sessionData !== null;
  }
}

export const sessionTrackingService = new SessionTrackingService();
