// PWA Logging Service for comprehensive PWA analytics and monitoring
export interface PWALogEntry {
  timestamp: string;
  action: string;
  details: any;
  userAgent: string;
  online: boolean;
  installed: boolean;
  standalone: boolean;
  sessionId: string;
}

export interface PWAMetrics {
  installationEvents: number;
  offlineUsage: number;
  cacheHitRate: number;
  averageLoadTime: number;
  backgroundSyncEvents: number;
  errorCount: number;
}

export class PWALoggingService {
  private static instance: PWALoggingService;
  private logs: PWALogEntry[] = [];
  private sessionId: string;
  private metrics: PWAMetrics;
  private maxLogSize = 1000; // Maximum number of logs to keep in memory

  private constructor() {
    this.sessionId = this.generateSessionId();
    this.metrics = this.initializeMetrics();
    this.setupPerformanceLogging();
    this.loadStoredLogs();
  }

  public static getInstance(): PWALoggingService {
    if (!PWALoggingService.instance) {
      PWALoggingService.instance = new PWALoggingService();
    }
    return PWALoggingService.instance;
  }

  // Initialize metrics
  private initializeMetrics(): PWAMetrics {
    return {
      installationEvents: 0,
      offlineUsage: 0,
      cacheHitRate: 0,
      averageLoadTime: 0,
      backgroundSyncEvents: 0,
      errorCount: 0
    };
  }

  // Setup performance logging
  private setupPerformanceLogging(): void {
    // Log page load performance
    window.addEventListener('load', () => {
      const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigationTiming) {
        const loadTime = navigationTiming.loadEventEnd - navigationTiming.loadEventStart;
        this.updateMetrics('loadTime', loadTime);
        
        this.log('PAGE_LOAD_PERFORMANCE', {
          loadTime,
          domContentLoaded: navigationTiming.domContentLoadedEventEnd - navigationTiming.domContentLoadedEventStart,
          firstContentfulPaint: this.getFirstContentfulPaint(),
          transferSize: navigationTiming.transferSize,
          cacheHit: navigationTiming.transferSize === 0
        });
      }
    });

    // Log resource loading performance
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.entryType === 'resource') {
          const resourceEntry = entry as PerformanceResourceTiming;
          this.log('RESOURCE_LOADED', {
            name: resourceEntry.name,
            duration: resourceEntry.duration,
            transferSize: resourceEntry.transferSize,
            cacheHit: resourceEntry.transferSize === 0
          });
        }
      });
    });

    observer.observe({ entryTypes: ['resource'] });
  }

  // Get First Contentful Paint timing
  private getFirstContentfulPaint(): number {
    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
    return fcpEntry ? fcpEntry.startTime : 0;
  }

  // Load stored logs from localStorage
  private async loadStoredLogs(): Promise<void> {
    try {
      const storedLogs = localStorage.getItem('pwa-logs');
      const storedMetrics = localStorage.getItem('pwa-metrics');
      
      if (storedLogs) {
        this.logs = JSON.parse(storedLogs).slice(-this.maxLogSize);
      }
      
      if (storedMetrics) {
        this.metrics = { ...this.metrics, ...JSON.parse(storedMetrics) };
      }
    } catch (error) {
      console.warn('Failed to load stored PWA logs:', error);
    }
  }

  // Save logs to localStorage
  private async saveLogsToStorage(): Promise<void> {
    try {
      localStorage.setItem('pwa-logs', JSON.stringify(this.logs.slice(-this.maxLogSize)));
      localStorage.setItem('pwa-metrics', JSON.stringify(this.metrics));
    } catch (error) {
      console.warn('Failed to save PWA logs:', error);
    }
  }

  // Generate session ID
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Main logging function
  public log(action: string, details: any = {}): void {
    const logEntry: PWALogEntry = {
      timestamp: new Date().toISOString(),
      action,
      details,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      installed: this.isInstalled(),
      standalone: this.isStandalone(),
      sessionId: this.sessionId
    };

    this.logs.push(logEntry);
    
    // Keep logs within size limit
    if (this.logs.length > this.maxLogSize) {
      this.logs = this.logs.slice(-this.maxLogSize);
    }

    // Update metrics based on action
    this.updateMetricsFromLog(action, details);

    // Console log for development
    console.log(`[PWA Log] ${action}:`, details);

    // Save to storage periodically
    if (this.logs.length % 10 === 0) {
      this.saveLogsToStorage();
    }

    // Dispatch custom event for external listeners
    this.dispatchLogEvent(logEntry);
  }

  // Update metrics based on log action
  private updateMetricsFromLog(action: string, details: any): void {
    switch (action) {
      case 'APP_INSTALLED':
        this.metrics.installationEvents++;
        break;
      case 'NETWORK_OFFLINE':
      case 'OFFLINE_ACTION':
        this.metrics.offlineUsage++;
        break;
      case 'STATIC_CACHE_HIT':
      case 'API_CACHE_HIT':
      case 'IMAGE_CACHE_HIT':
        this.updateCacheHitRate(true);
        break;
      case 'STATIC_CACHE_MISS':
      case 'API_FETCH_ERROR':
      case 'IMAGE_FETCH_ERROR':
        this.updateCacheHitRate(false);
        break;
      case 'BACKGROUND_SYNC_START':
        this.metrics.backgroundSyncEvents++;
        break;
      case 'SW_REGISTRATION_FAILED':
      case 'OFFLINE_STORAGE_ERROR':
      case 'PWA_ERROR':
        this.metrics.errorCount++;
        break;
    }
  }

  // Update specific metrics
  private updateMetrics(type: string, value: number): void {
    switch (type) {
      case 'loadTime':
        // Calculate rolling average
        const currentAvg = this.metrics.averageLoadTime;
        const count = this.getLogsByAction('PAGE_LOAD_PERFORMANCE').length;
        this.metrics.averageLoadTime = (currentAvg * (count - 1) + value) / count;
        break;
    }
  }

  // Update cache hit rate
  private updateCacheHitRate(isHit: boolean): void {
    const cacheHits = this.getLogsByAction('STATIC_CACHE_HIT').length + 
                     this.getLogsByAction('API_CACHE_HIT').length + 
                     this.getLogsByAction('IMAGE_CACHE_HIT').length;
    
    const cacheMisses = this.getLogsByAction('STATIC_CACHE_MISS').length + 
                       this.getLogsByAction('API_FETCH_ERROR').length + 
                       this.getLogsByAction('IMAGE_FETCH_ERROR').length;
    
    const total = cacheHits + cacheMisses;
    this.metrics.cacheHitRate = total > 0 ? (cacheHits / total) * 100 : 0;
  }

  // Dispatch log event for external listeners
  private dispatchLogEvent(logEntry: PWALogEntry): void {
    try {
      const event = new CustomEvent('pwa-log', { detail: logEntry });
      window.dispatchEvent(event);
    } catch (error) {
      console.warn('Failed to dispatch PWA log event:', error);
    }
  }

  // Check if app is installed
  private isInstalled(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches ||
           (window.navigator as any).standalone === true;
  }

  // Check if app is running in standalone mode
  private isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches;
  }

  // Get logs by action
  public getLogsByAction(action: string): PWALogEntry[] {
    return this.logs.filter(log => log.action === action);
  }

  // Get logs by time range
  public getLogsByTimeRange(startTime: Date, endTime: Date): PWALogEntry[] {
    return this.logs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime >= startTime && logTime <= endTime;
    });
  }

  // Get current metrics
  public getMetrics(): PWAMetrics {
    return { ...this.metrics };
  }

  // Get session summary
  public getSessionSummary(): {
    sessionId: string;
    startTime: string;
    duration: number;
    logCount: number;
    actions: string[];
    errors: PWALogEntry[];
  } {
    const sessionLogs = this.logs.filter(log => log.sessionId === this.sessionId);
    const startTime = sessionLogs.length > 0 ? sessionLogs[0].timestamp : new Date().toISOString();
    const duration = sessionLogs.length > 0 ? 
      Date.now() - new Date(sessionLogs[0].timestamp).getTime() : 0;

    return {
      sessionId: this.sessionId,
      startTime,
      duration,
      logCount: sessionLogs.length,
      actions: Array.from(new Set(sessionLogs.map(log => log.action))),
      errors: sessionLogs.filter(log => log.action.includes('ERROR') || log.action.includes('FAILED'))
    };
  }

  // Export logs for analysis
  public exportLogs(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      exportTime: new Date().toISOString(),
      metrics: this.metrics,
      logs: this.logs,
      sessionSummary: this.getSessionSummary()
    }, null, 2);
  }

  // Clear all logs
  public clearLogs(): void {
    this.logs = [];
    this.metrics = this.initializeMetrics();
    this.sessionId = this.generateSessionId();
    
    try {
      localStorage.removeItem('pwa-logs');
      localStorage.removeItem('pwa-metrics');
    } catch (error) {
      console.warn('Failed to clear stored logs:', error);
    }
    
    this.log('LOGS_CLEARED', { action: 'manual_clear' });
  }

  // Log PWA installation event
  public logInstallation(source: 'prompt' | 'banner' | 'manual'): void {
    this.log('APP_INSTALLED', {
      source,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
    });
  }

  // Log offline actions
  public logOfflineAction(action: string, details: any = {}): void {
    this.log('OFFLINE_ACTION', {
      action,
      ...details,
      offline: !navigator.onLine
    });
  }

  // Log performance issues
  public logPerformanceIssue(type: string, details: any = {}): void {
    this.log('PERFORMANCE_ISSUE', {
      type,
      ...details,
      memory: (performance as any).memory ? {
        usedJSMemory: (performance as any).memory.usedJSHeapSize,
        totalJSMemory: (performance as any).memory.totalJSHeapSize,
        jsMemoryLimit: (performance as any).memory.jsHeapSizeLimit
      } : undefined
    });
  }

  // Log errors
  public logError(error: Error, context: string = ''): void {
    this.log('PWA_ERROR', {
      message: error.message,
      stack: error.stack,
      context,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  // Auto-save logs before page unload
  public setupAutoSave(): void {
    window.addEventListener('beforeunload', () => {
      this.saveLogsToStorage();
    });

    // Periodic save every 30 seconds
    setInterval(() => {
      this.saveLogsToStorage();
    }, 30000);
  }
}

// Export singleton instance
export const pwaLogger = PWALoggingService.getInstance();

// Auto-setup
pwaLogger.setupAutoSave();
pwaLogger.log('PWA_LOGGER_INITIALIZED', { version: '1.0.0' });