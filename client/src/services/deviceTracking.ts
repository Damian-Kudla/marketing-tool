import type { DeviceStatus } from '../../../shared/trackingTypes';
import { deviceFingerprintService } from './deviceFingerprint';

class DeviceTrackingService {
  private syncInterval: number | null = null;
  private readonly SYNC_INTERVAL = 30000; // 30 seconds
  private batteryManager: any = null;

  /**
   * Start device status tracking
   */
  async startTracking(): Promise<void> {
    console.log('[Device] Starting device status tracking...');

    // Setup Battery API
    await this.setupBatteryTracking();

    // Sync device status periodically
    this.syncInterval = window.setInterval(() => {
      this.syncDeviceStatus();
    }, this.SYNC_INTERVAL);

    // Initial sync
    await this.syncDeviceStatus();
  }

  /**
   * Stop device status tracking
   */
  stopTracking(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    console.log('[Device] Device status tracking stopped');
  }

  /**
   * Setup Battery Status API
   */
  private async setupBatteryTracking(): Promise<void> {
    if ('getBattery' in navigator) {
      try {
        // @ts-ignore - Battery API might not be fully typed
        this.batteryManager = await navigator.getBattery();
        
        // Listen for battery changes
        this.batteryManager.addEventListener('levelchange', () => {
          console.log('[Device] Battery level changed:', this.batteryManager.level * 100 + '%');
        });

        this.batteryManager.addEventListener('chargingchange', () => {
          console.log('[Device] Charging status changed:', this.batteryManager.charging);
        });

        console.log('[Device] Battery tracking active');
      } catch (error) {
        console.warn('[Device] Battery API not available:', error);
      }
    } else {
      console.warn('[Device] Battery API not supported');
    }
  }

  /**
   * Get current device status
   */
  private async getDeviceStatus(): Promise<DeviceStatus> {
    // Get device ID
    const deviceId = await deviceFingerprintService.getDeviceId();

    const status: DeviceStatus = {
      timestamp: Date.now(),
      deviceId
    };

    // Battery Status
    if (this.batteryManager) {
      status.batteryLevel = Math.round(this.batteryManager.level * 100);
      status.isCharging = this.batteryManager.charging;
    }

    // Network Information
    // @ts-ignore - Network Information API might not be fully typed
    if ('connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator) {
      // @ts-ignore
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      
      if (connection) {
        status.effectiveType = connection.effectiveType; // '4g', '3g', '2g', 'slow-2g'
        
        // Map connection type
        if (connection.type) {
          status.connectionType = connection.type;
        } else {
          // Infer from effectiveType
          if (connection.effectiveType === '4g') {
            status.connectionType = navigator.onLine ? '4g' : 'offline';
          } else if (connection.effectiveType === '3g') {
            status.connectionType = '3g';
          } else {
            status.connectionType = navigator.onLine ? 'wifi' : 'offline';
          }
        }
      }
    } else {
      // Fallback: just check online status
      status.connectionType = navigator.onLine ? 'wifi' : 'offline';
    }

    // Screen Orientation
    if ('orientation' in screen) {
      // @ts-ignore
      const orientation = screen.orientation;
      status.screenOrientation = orientation.type; // 'portrait-primary', 'landscape-primary', etc.
    }

    // Memory Usage (Chrome only)
    // @ts-ignore
    if ('memory' in performance) {
      // @ts-ignore
      const memory = performance.memory as any;
      status.memoryUsage = Math.round(memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100);
    }

    return status;
  }

  /**
   * Sync device status to backend
   */
  private async syncDeviceStatus(): Promise<void> {
    try {
      const deviceStatus = await this.getDeviceStatus();

      const response = await fetch('/api/tracking/device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          device: deviceStatus,
          timestamp: Date.now()
        })
      });

      if (response.ok) {
        console.log('[Device] Device status synced', {
          battery: deviceStatus.batteryLevel ? `${deviceStatus.batteryLevel}%` : 'N/A',
          charging: deviceStatus.isCharging ? 'Yes' : 'No',
          connection: deviceStatus.connectionType
        });
      } else {
        console.error('[Device] Failed to sync device status:', response.status);
      }
    } catch (error) {
      console.error('[Device] Error syncing device status:', error);
    }
  }

  /**
   * Get current device status (for immediate use)
   */
  async getCurrentStatus(): Promise<DeviceStatus> {
    return this.getDeviceStatus();
  }

  /**
   * Check if tracking is active
   */
  isActive(): boolean {
    return this.syncInterval !== null;
  }
}

export const deviceTrackingService = new DeviceTrackingService();
