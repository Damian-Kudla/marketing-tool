// PWA Service for managing Progressive Web App functionality
import { pwaLogger } from './pwaLogger';

export class PWAService {
  private static instance: PWAService;
  private serviceWorker: ServiceWorker | null = null;
  private installPrompt: any = null;
  private isInstalled = false;
  private isOnline = navigator.onLine;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): PWAService {
    if (!PWAService.instance) {
      PWAService.instance = new PWAService();
    }
    return PWAService.instance;
  }

  private async initialize() {
    await this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupOnlineOfflineHandlers();
    this.setupPWAEventListeners();
    this.checkInstallationStatus();
    this.logPWAAction('PWA_SERVICE_INITIALIZED');
  }

  // Register Service Worker with comprehensive error handling
  private async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      this.logPWAAction('SW_NOT_SUPPORTED');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      this.logPWAAction('SW_REGISTERED', {
        scope: registration.scope,
        updateViaCache: registration.updateViaCache
      });

      // Handle service worker updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          this.logPWAAction('SW_UPDATE_FOUND');
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.logPWAAction('SW_UPDATE_READY');
              this.notifyUpdate();
            }
          });
        }
      });

      // Listen for service worker messages
      navigator.serviceWorker.addEventListener('message', this.handleServiceWorkerMessage.bind(this));

      // Store reference to active service worker
      if (registration.active) {
        this.serviceWorker = registration.active;
      }

    } catch (error) {
      this.logPWAAction('SW_REGISTRATION_FAILED', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  // Setup install prompt handling
  private setupInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.logPWAAction('INSTALL_PROMPT_AVAILABLE');
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.installPrompt = null;
      this.logPWAAction('APP_INSTALLED');
    });
  }

  // Setup online/offline event handlers
  private setupOnlineOfflineHandlers(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.logPWAAction('NETWORK_ONLINE');
      this.triggerBackgroundSync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.logPWAAction('NETWORK_OFFLINE');
    });
  }

  // Setup PWA-specific event listeners
  private setupPWAEventListeners(): void {
    // Handle visibility changes for performance optimization
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.logPWAAction('APP_BACKGROUNDED');
      } else {
        this.logPWAAction('APP_FOREGROUNDED');
      }
    });

    // Handle page load for performance tracking
    window.addEventListener('load', () => {
      this.logPWAAction('PAGE_LOADED', {
        loadTime: performance.now(),
        cacheHit: this.wasCacheHit()
      });
    });
  }

  // Check if app is already installed
  private checkInstallationStatus(): void {
    // Check if running in standalone mode (installed PWA)
    this.isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                     (window.navigator as any).standalone === true;
    
    if (this.isInstalled) {
      this.logPWAAction('APP_RUNNING_INSTALLED');
    }
  }

  // Handle messages from service worker
  private handleServiceWorkerMessage(event: MessageEvent): void {
    const { data } = event;
    
    if (data.type === 'PWA_LOG') {
      this.logPWAAction('SW_MESSAGE', data);
    }
  }

  // Show install prompt to user
  public async showInstallPrompt(): Promise<boolean> {
    if (!this.installPrompt) {
      this.logPWAAction('INSTALL_PROMPT_NOT_AVAILABLE');
      return false;
    }

    try {
      const result = await this.installPrompt.prompt();
      this.logPWAAction('INSTALL_PROMPT_SHOWN', { outcome: result.outcome });
      
      if (result.outcome === 'accepted') {
        this.installPrompt = null;
        return true;
      }
      
      return false;
    } catch (error) {
      this.logPWAAction('INSTALL_PROMPT_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  // Check if install prompt is available
  public isInstallPromptAvailable(): boolean {
    return this.installPrompt !== null;
  }

  // Get installation status
  public getInstallationStatus(): boolean {
    return this.isInstalled;
  }

  // Get online status
  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  // Trigger background sync for offline data
  public async triggerBackgroundSync(): Promise<void> {
    if (!this.serviceWorker || !('serviceWorker' in navigator)) {
      this.logPWAAction('BACKGROUND_SYNC_NOT_SUPPORTED');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Type assertion for sync property (not all browsers support it)
      const syncManager = (registration as any).sync;
      if (syncManager) {
        await syncManager.register('background-sync-ocr-results');
        await syncManager.register('background-sync-addresses');
        this.logPWAAction('BACKGROUND_SYNC_REGISTERED');
      } else {
        this.logPWAAction('BACKGROUND_SYNC_NOT_SUPPORTED');
      }
    } catch (error) {
      this.logPWAAction('BACKGROUND_SYNC_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  // Force service worker update
  public async updateServiceWorker(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      this.logPWAAction('SW_UPDATE_FORCED');
    } catch (error) {
      this.logPWAAction('SW_UPDATE_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  // Check if page was loaded from cache
  private wasCacheHit(): boolean {
    const navigationEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navigationEntries.length > 0) {
      return navigationEntries[0].transferSize === 0;
    }
    return false;
  }

  // Notify user about available update
  private notifyUpdate(): void {
    // This would integrate with your toast system
    this.logPWAAction('UPDATE_NOTIFICATION_SHOWN');
  }

  // Log PWA actions with structured data
  private logPWAAction(action: string, details: any = {}): void {
    // Use the comprehensive PWA logger
    pwaLogger.log(action, details);
  }

  // Get PWA status information
  public getStatus(): {
    isInstalled: boolean;
    isOnline: boolean;
    canInstall: boolean;
    hasServiceWorker: boolean;
  } {
    return {
      isInstalled: this.isInstalled,
      isOnline: this.isOnline,
      canInstall: this.installPrompt !== null,
      hasServiceWorker: this.serviceWorker !== null
    };
  }

  // Preload critical resources
  public async preloadCriticalResources(): Promise<void> {
    const criticalResources = [
      '/icons/icon-192x192.svg',
      '/icons/icon-512x512.svg',
      '/manifest.json'
    ];

    try {
      await Promise.all(
        criticalResources.map(resource => {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = resource;
          document.head.appendChild(link);
        })
      );
      
      this.logPWAAction('CRITICAL_RESOURCES_PRELOADED', { 
        count: criticalResources.length 
      });
    } catch (error) {
      this.logPWAAction('PRELOAD_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
}

// Export singleton instance
export const pwaService = PWAService.getInstance();