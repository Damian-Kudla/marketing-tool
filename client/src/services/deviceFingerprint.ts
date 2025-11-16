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

    // 1. User Agent
    components.push(navigator.userAgent);

    // 2. Screen Resolution
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);

    // 3. Timezone
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

    // 4. Platform
    components.push(navigator.platform);

    // 5. Language
    components.push(navigator.language);

    // 6. Hardware Concurrency (CPU cores)
    if (navigator.hardwareConcurrency) {
      components.push(`cpu:${navigator.hardwareConcurrency}`);
    }

    // 7. Device Memory (if available)
    // @ts-ignore - deviceMemory is not in all TypeScript definitions
    if (navigator.deviceMemory) {
      // @ts-ignore
      components.push(`mem:${navigator.deviceMemory}`);
    }

    // 8. Max Touch Points
    components.push(`touch:${navigator.maxTouchPoints}`);

    // 9. Vendor
    components.push(navigator.vendor);

    // 10. Canvas Fingerprint (unique per device/browser combination)
    const canvasId = await this.getCanvasFingerprint();
    components.push(canvasId);

    // 11. WebGL Fingerprint
    const webglId = this.getWebGLFingerprint();
    components.push(webglId);

    // 12. Random component (stored in localStorage) for additional uniqueness
    let randomComponent = localStorage.getItem('deviceRandomSeed');
    if (!randomComponent) {
      randomComponent = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('deviceRandomSeed', randomComponent);
    }
    components.push(randomComponent);

    // Combine all components and hash
    const fingerprint = components.join('|');
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
   * WebGL Fingerprinting
   */
  private getWebGLFingerprint(): string {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;

      if (!gl) return 'no-webgl';

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return 'no-debug-info';

      const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

      return `${vendor}|${renderer}`;
    } catch (error) {
      console.warn('[DeviceFingerprint] WebGL fingerprinting failed:', error);
      return 'webgl-error';
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
