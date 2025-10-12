/**
 * PWA Update Manager
 * 
 * Automatisches Update-System für die PWA:
 * - Erkennt neue Versionen automatisch
 * - Zeigt Update-Benachrichtigung
 * - Lädt neue Version automatisch nach Benutzerbestätigung
 * - Verhindert Probleme mit gecachten alten Daten
 * 
 * Version wird automatisch aus package.json gelesen
 */

import { pwaLogger } from './pwaLogger';

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  newVersion: string;
  isUpdating: boolean;
}

export class PWAUpdateManager {
  private static instance: PWAUpdateManager;
  private registration: ServiceWorkerRegistration | null = null;
  private updateCheckInterval: number | null = null;
  private onUpdateAvailable: ((status: UpdateStatus) => void) | null = null;
  private currentVersion: string = '';
  private newWorker: ServiceWorker | null = null;

  // Update-Check Intervall (Standard: 30 Sekunden)
  private readonly UPDATE_CHECK_INTERVAL = 30000;
  // Version-Check Intervall (Standard: 5 Minuten)
  private readonly VERSION_CHECK_INTERVAL = 300000;

  private constructor() {
    this.currentVersion = this.getCurrentVersion();
    this.initialize();
  }

  public static getInstance(): PWAUpdateManager {
    if (!PWAUpdateManager.instance) {
      PWAUpdateManager.instance = new PWAUpdateManager();
    }
    return PWAUpdateManager.instance;
  }

  private async initialize(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      pwaLogger.log('UPDATE_MANAGER_NOT_SUPPORTED');
      return;
    }

    try {
      this.registration = await navigator.serviceWorker.ready;
      this.setupUpdateDetection();
      this.startPeriodicUpdateCheck();
      this.setupVersionMonitoring();
      pwaLogger.log('UPDATE_MANAGER_INITIALIZED', { 
        currentVersion: this.currentVersion 
      });
    } catch (error) {
      pwaLogger.log('UPDATE_MANAGER_INIT_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Setup automatic update detection
   */
  private setupUpdateDetection(): void {
    if (!this.registration) return;

    // Listen for updatefound event
    this.registration.addEventListener('updatefound', () => {
      const installingWorker = this.registration!.installing;
      if (!installingWorker) return;

      pwaLogger.log('UPDATE_FOUND', { 
        currentVersion: this.currentVersion 
      });

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New version available
            this.newWorker = installingWorker;
            this.notifyUpdateAvailable();
            pwaLogger.log('UPDATE_READY', { 
              currentVersion: this.currentVersion 
            });
          } else {
            // First installation
            pwaLogger.log('SW_FIRST_INSTALL');
          }
        }
      });
    });

    // Listen for controller change (update activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      pwaLogger.log('SW_CONTROLLER_CHANGED');
      
      // Show update notification and reload
      this.handleControllerChange();
    });
  }

  /**
   * Start periodic update checks
   * Checks for new service worker every 30 seconds
   */
  private startPeriodicUpdateCheck(): void {
    // Check immediately
    this.checkForUpdates();

    // Then check periodically
    this.updateCheckInterval = window.setInterval(() => {
      this.checkForUpdates();
    }, this.UPDATE_CHECK_INTERVAL);

    pwaLogger.log('PERIODIC_UPDATE_CHECK_STARTED', { 
      interval: this.UPDATE_CHECK_INTERVAL 
    });
  }

  /**
   * Setup version monitoring
   * Checks server version every 5 minutes
   */
  private setupVersionMonitoring(): void {
    // Check version periodically
    setInterval(() => {
      this.checkServerVersion();
    }, this.VERSION_CHECK_INTERVAL);

    pwaLogger.log('VERSION_MONITORING_STARTED', { 
      interval: this.VERSION_CHECK_INTERVAL 
    });
  }

  /**
   * Check for service worker updates
   */
  public async checkForUpdates(): Promise<void> {
    if (!this.registration) return;

    try {
      pwaLogger.log('CHECKING_FOR_UPDATES');
      await this.registration.update();
    } catch (error) {
      pwaLogger.log('UPDATE_CHECK_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Check server version against current version
   */
  private async checkServerVersion(): Promise<void> {
    try {
      // Add cache-busting query parameter
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        pwaLogger.log('VERSION_CHECK_FAILED', { status: response.status });
        return;
      }

      const data = await response.json();
      const serverVersion = data.version;

      if (serverVersion !== this.currentVersion) {
        pwaLogger.log('VERSION_MISMATCH', { 
          current: this.currentVersion, 
          server: serverVersion 
        });
        
        // Force update check
        await this.checkForUpdates();
      } else {
        pwaLogger.log('VERSION_UP_TO_DATE', { version: this.currentVersion });
      }
    } catch (error) {
      pwaLogger.log('VERSION_CHECK_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Get current app version from meta tag or localStorage
   */
  private getCurrentVersion(): string {
    // Try to get version from meta tag
    const metaVersion = document.querySelector('meta[name="app-version"]')?.getAttribute('content');
    if (metaVersion) {
      return metaVersion;
    }

    // Try to get from localStorage
    const storedVersion = localStorage.getItem('app-version');
    if (storedVersion) {
      return storedVersion;
    }

    // Default version
    return '1.0.0';
  }

  /**
   * Notify about available update
   */
  private notifyUpdateAvailable(): void {
    if (this.onUpdateAvailable) {
      const status: UpdateStatus = {
        updateAvailable: true,
        currentVersion: this.currentVersion,
        newVersion: 'latest', // Could be extracted from SW if needed
        isUpdating: false
      };
      
      this.onUpdateAvailable(status);
    }

    pwaLogger.log('UPDATE_NOTIFICATION_SENT');
  }

  /**
   * Handle controller change (update activated)
   */
  private handleControllerChange(): void {
    // Update was activated, reload page
    if (!window.location.pathname.includes('/login')) {
      // Save current state if needed
      this.saveCurrentState();
      
      // Show brief notification
      pwaLogger.log('RELOADING_FOR_UPDATE');
      
      // Reload page after short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }

  /**
   * Save current application state before reload
   */
  private saveCurrentState(): void {
    try {
      // Save any important state to sessionStorage
      const currentPath = window.location.pathname;
      sessionStorage.setItem('pwa-reload-path', currentPath);
      pwaLogger.log('STATE_SAVED_BEFORE_RELOAD', { path: currentPath });
    } catch (error) {
      pwaLogger.log('STATE_SAVE_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Restore application state after reload
   */
  public restoreState(): void {
    try {
      const savedPath = sessionStorage.getItem('pwa-reload-path');
      if (savedPath && savedPath !== window.location.pathname) {
        sessionStorage.removeItem('pwa-reload-path');
        // Could navigate to saved path if needed
        pwaLogger.log('STATE_RESTORED', { path: savedPath });
      }
    } catch (error) {
      pwaLogger.log('STATE_RESTORE_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Apply update immediately
   * Tells waiting service worker to skip waiting and take control
   */
  public async applyUpdate(): Promise<void> {
    if (!this.newWorker) {
      pwaLogger.log('NO_UPDATE_TO_APPLY');
      return;
    }

    try {
      pwaLogger.log('APPLYING_UPDATE');
      
      // Tell the waiting service worker to skip waiting
      this.newWorker.postMessage({ type: 'SKIP_WAITING' });
      
      // The controllerchange event will handle the reload
    } catch (error) {
      pwaLogger.log('APPLY_UPDATE_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Force clear all caches and reload
   * Use this as nuclear option when updates aren't working
   */
  public async forceClearAndReload(): Promise<void> {
    try {
      pwaLogger.log('FORCE_CLEAR_INITIATED');

      // Unregister all service workers
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        pwaLogger.log('SW_UNREGISTERED', { scope: registration.scope });
      }

      // Clear all caches
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
        pwaLogger.log('CACHE_DELETED', { cacheName });
      }

      // Clear storage
      localStorage.clear();
      sessionStorage.clear();

      pwaLogger.log('FORCE_CLEAR_COMPLETE');

      // Reload page
      window.location.reload();
    } catch (error) {
      pwaLogger.log('FORCE_CLEAR_ERROR', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Register callback for update notifications
   */
  public onUpdate(callback: (status: UpdateStatus) => void): void {
    this.onUpdateAvailable = callback;
  }

  /**
   * Get current update status
   */
  public getUpdateStatus(): UpdateStatus {
    return {
      updateAvailable: this.newWorker !== null,
      currentVersion: this.currentVersion,
      newVersion: 'latest',
      isUpdating: false
    };
  }

  /**
   * Stop update checks (e.g., when user logs out)
   */
  public stopUpdateChecks(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
      pwaLogger.log('UPDATE_CHECKS_STOPPED');
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.stopUpdateChecks();
    this.onUpdateAvailable = null;
    this.newWorker = null;
    pwaLogger.log('UPDATE_MANAGER_DESTROYED');
  }
}

// Export singleton instance
export const pwaUpdateManager = PWAUpdateManager.getInstance();
