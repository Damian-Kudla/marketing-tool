/**
 * Device Fingerprinting Service
 *
 * Generates a unique device identifier for tracking multiple devices per user.
 * Works reliably on iOS/iPadOS PWAs.
 */

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  userAgent: string;
  screenResolution: string;
  timestamp: number;
}

class DeviceFingerprintService {
  private deviceId: string | null = null;
  private deviceInfo: DeviceInfo | null = null;

  /**
   * Generate or retrieve device ID
   */
  async getDeviceId(): Promise<string> {
    if (this.deviceId) {
      return this.deviceId;
    }

    // Try to get from localStorage first
    const storedDeviceId = localStorage.getItem('deviceId');
    if (storedDeviceId) {
      this.deviceId = storedDeviceId;
      console.log('[DeviceFingerprint] Device ID loaded from storage:', storedDeviceId);
      return storedDeviceId;
    }

    // Generate new device ID
    this.deviceId = await this.generateDeviceId();
    localStorage.setItem('deviceId', this.deviceId);

    console.log('[DeviceFingerprint] New Device ID generated:', this.deviceId);
    return this.deviceId;
  }

  /**
   * Generate a unique device fingerprint
   * Combines multiple device-specific attributes
   */
  private async generateDeviceId(): Promise<string> {
    const components: string[] = [];

    // Basis-Hardware-Komponenten (stabil + unterscheidungskräftig)
    components.push(navigator.userAgent); // iPhone-Modell + iOS-Version
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`); // Hardware-Display
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone); // Nutzer-Timezone
    components.push(navigator.platform); // Betriebssystem
    components.push(navigator.language); // Nutzer-Sprache

    // Device-spezifische Infos (iOS-spezifisch, falls verfügbar)
    // @ts-ignore - iOS-spezifische Properties
    if (window.navigator?.standalone !== undefined) {
      // @ts-ignore
      components.push(`standalone:${window.navigator.standalone}`);
    }
    
    // Screen Pixel Ratio (unterscheidet iPhone-Modelle)
    components.push(`pixelRatio:${window.devicePixelRatio}`);

    // Canvas Fingerprint (GPU-basiert, ~95% einzigartig pro Gerät)
    const canvasId = await this.getCanvasFingerprint();
    components.push(canvasId);

    // Alle Komponenten zu einem String kombinieren
    const fingerprint = components.join('|');

    // SHA-256 Hash erstellen für eindeutige Device-ID
    const deviceId = await this.hashString(fingerprint);

    return deviceId;
  }

  /**
   * Canvas Fingerprinting
   */
  private async getCanvasFingerprint(): Promise<string> {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) return 'no-canvas';

      canvas.width = 200;
      canvas.height = 50;

      // Draw text with specific styling
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Device ID', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Device ID', 4, 17);

      // Get canvas data
      const dataUrl = canvas.toDataURL();

      // Hash the canvas data
      return await this.hashString(dataUrl);
    } catch (error) {
      console.warn('[DeviceFingerprint] Canvas fingerprinting failed:', error);
      return 'canvas-error';
    }
  }

  /**
   * Hash a string using SHA-256
   */
  private async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 16); // Use first 16 chars
  }

  /**
   * Get full device information
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    if (this.deviceInfo) {
      return this.deviceInfo;
    }

    const deviceId = await this.getDeviceId();

    this.deviceInfo = {
      deviceId,
      deviceName: this.getDeviceName(),
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      timestamp: Date.now()
    };

    return this.deviceInfo;
  }

  /**
   * Get a human-readable device name
   */
  private getDeviceName(): string {
    const ua = navigator.userAgent;

    // iOS Devices
    if (/iPad/.test(ua)) {
      return 'iPad';
    }
    if (/iPhone/.test(ua)) {
      return 'iPhone';
    }
    if (/iPod/.test(ua)) {
      return 'iPod';
    }

    // Android Devices
    if (/Android/.test(ua)) {
      const match = ua.match(/Android.*?;\s([^)]+)/);
      if (match && match[1]) {
        return match[1];
      }
      return 'Android Device';
    }

    // Desktop/Other
    if (/Windows/.test(ua)) {
      return 'Windows PC';
    }
    if (/Macintosh/.test(ua)) {
      return 'Mac';
    }
    if (/Linux/.test(ua)) {
      return 'Linux PC';
    }

    return 'Unknown Device';
  }

  /**
   * Clear stored device ID (for testing)
   */
  clearDeviceId(): void {
    localStorage.removeItem('deviceId');
    localStorage.removeItem('deviceRandomSeed');
    this.deviceId = null;
    this.deviceInfo = null;
    console.log('[DeviceFingerprint] Device ID cleared');
  }

  /**
   * Get device ID synchronously (if already generated)
   */
  getDeviceIdSync(): string | null {
    return this.deviceId || localStorage.getItem('deviceId');
  }
}

export const deviceFingerprintService = new DeviceFingerprintService();
