import type { GPSCoordinates } from '../../../shared/trackingTypes';

class GPSTrackingService {
  private watchId: number | null = null;
  private isTracking = false;
  private lastPosition: GPSCoordinates | null = null;
  private trackingInterval: number | null = null;
  private readonly TRACKING_INTERVAL = 30000; // 30 seconds

  /**
   * Start GPS tracking
   * Sends coordinates to backend every 30 seconds
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      console.log('[GPS] Already tracking');
      return;
    }

    if (!('geolocation' in navigator)) {
      console.error('[GPS] Geolocation not supported');
      return;
    }

    this.isTracking = true;
    console.log('[GPS] Starting GPS tracking...');

    // Request permission and start watching position
    try {
      // High accuracy for field work
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      };

      // Use watchPosition for continuous tracking
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePositionUpdate(position),
        (error) => this.handlePositionError(error),
        options
      );

      // Also send position every 30 seconds even if it hasn't changed much
      this.trackingInterval = window.setInterval(() => {
        this.sendCurrentPosition();
      }, this.TRACKING_INTERVAL);

      console.log('[GPS] GPS tracking started');
    } catch (error) {
      console.error('[GPS] Error starting tracking:', error);
      this.isTracking = false;
    }
  }

  /**
   * Stop GPS tracking
   */
  stopTracking(): void {
    if (!this.isTracking) {
      return;
    }

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.trackingInterval !== null) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }

    this.isTracking = false;
    console.log('[GPS] GPS tracking stopped');
  }

  /**
   * Handle position update from watchPosition
   */
  private handlePositionUpdate(position: GeolocationPosition): void {
    const coords: GPSCoordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude ?? undefined,
      altitudeAccuracy: position.coords.altitudeAccuracy ?? undefined,
      heading: position.coords.heading ?? undefined,
      speed: position.coords.speed ?? undefined,
      timestamp: position.timestamp
    };

    this.lastPosition = coords;
    console.log('[GPS] Position updated:', coords.latitude, coords.longitude, `±${coords.accuracy}m`);
  }

  /**
   * Handle geolocation errors
   */
  private handlePositionError(error: GeolocationPositionError): void {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        console.error('[GPS] User denied geolocation permission');
        this.stopTracking();
        break;
      case error.POSITION_UNAVAILABLE:
        console.warn('[GPS] Position unavailable');
        break;
      case error.TIMEOUT:
        console.warn('[GPS] Geolocation timeout');
        break;
    }
  }

  /**
   * Send current position to backend
   */
  private async sendCurrentPosition(): Promise<void> {
    if (!this.lastPosition) {
      console.warn('[GPS] No position to send');
      return;
    }

    try {
      const response = await fetch('/api/tracking/gps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          gps: this.lastPosition,
          timestamp: Date.now()
        })
      });

      if (!response.ok) {
        console.error('[GPS] Failed to send position:', response.status);
      } else {
        console.log('[GPS] Position sent successfully');
      }
    } catch (error) {
      console.error('[GPS] Error sending position:', error);
      // Don't stop tracking on network errors - will retry in 30s
    }
  }

  /**
   * Get current position (for immediate use)
   */
  getCurrentPosition(): GPSCoordinates | null {
    return this.lastPosition;
  }

  /**
   * Check if tracking is active
   */
  isActive(): boolean {
    return this.isTracking;
  }

  /**
   * Request background tracking permission (iOS/Safari)
   * Note: Background tracking requires service worker or wake lock
   */
  async requestBackgroundTracking(): Promise<void> {
    // iOS requires user gesture for background tracking
    console.log('[GPS] Background tracking requested');
    
    // Try to acquire wake lock to keep tracking active
    if ('wakeLock' in navigator) {
      try {
        // @ts-ignore - WakeLock API might not be fully typed
        const wakeLock = await navigator.wakeLock.request('screen');
        console.log('[GPS] Wake lock acquired for background tracking');
        
        // Re-acquire wake lock on visibility change
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible') {
            try {
              // @ts-ignore
              await navigator.wakeLock.request('screen');
              console.log('[GPS] Wake lock re-acquired');
            } catch (err) {
              console.warn('[GPS] Could not re-acquire wake lock:', err);
            }
          }
        });
      } catch (err) {
        console.warn('[GPS] Wake lock not available:', err);
      }
    }
  }
}

export const gpsTrackingService = new GPSTrackingService();
