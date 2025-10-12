export interface OrientationLogEntry {
  timestamp: string;
  sessionId: string;
  deviceType: string;
  detectionMethod: string;
  orientationApplied: number;
  frontendCorrection: boolean;
  backendCorrection: boolean;
  originalSize: number;
  correctedSize: number;
  processingTime: number;
  ocrSuccess: boolean;
  textBlocksDetected: number;
  userAgent: string;
}

class OrientationLoggingService {
  private static logs: OrientationLogEntry[] = [];
  private static sessionId = this.generateSessionId();

  private static generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  static logOrientationCorrection(
    deviceType: string,
    detectionMethod: string,
    orientationApplied: number,
    frontendCorrection: boolean,
    backendCorrection: boolean,
    originalSize: number,
    correctedSize: number,
    processingTime: number,
    ocrSuccess: boolean = true,
    textBlocksDetected: number = 0
  ) {
    const logEntry: OrientationLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      deviceType,
      detectionMethod,
      orientationApplied,
      frontendCorrection,
      backendCorrection,
      originalSize,
      correctedSize,
      processingTime,
      ocrSuccess,
      textBlocksDetected,
      userAgent: navigator.userAgent
    };

    this.logs.push(logEntry);
    
    // Keep only last 100 entries to prevent memory issues
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }

    console.log('Orientation correction logged:', logEntry);
    
    // In a production environment, you might want to send these logs to your analytics service
    // Example: this.sendToAnalytics(logEntry);
  }

  static logOrientationAnalysis(
    analysisResult: {
      deviceType: string;
      detectionMethod: string;
      needsCorrection: boolean;
      confidence?: number;
      rotation?: number;
    },
    processingTime: number
  ) {
    console.log('Orientation analysis:', {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...analysisResult,
      processingTime,
      userAgent: navigator.userAgent
    });
  }

  static getOrientationStats() {
    const stats = {
      totalCorrections: this.logs.length,
      frontendCorrections: this.logs.filter(log => log.frontendCorrection).length,
      backendCorrections: this.logs.filter(log => log.backendCorrection).length,
      deviceTypes: this.groupBy(this.logs, 'deviceType'),
      detectionMethods: this.groupBy(this.logs, 'detectionMethod'),
      orientationDistribution: this.groupBy(this.logs, 'orientationApplied'),
      successRate: this.logs.length > 0 ? this.logs.filter(log => log.ocrSuccess).length / this.logs.length : 0,
      avgProcessingTime: this.logs.length > 0 ? this.logs.reduce((sum, log) => sum + log.processingTime, 0) / this.logs.length : 0,
      avgTextBlocks: this.logs.length > 0 ? this.logs.reduce((sum, log) => sum + log.textBlocksDetected, 0) / this.logs.length : 0
    };

    return stats;
  }

  private static groupBy(array: OrientationLogEntry[], key: keyof OrientationLogEntry) {
    return array.reduce((groups, item) => {
      const value = String(item[key]);
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  static exportLogs(): OrientationLogEntry[] {
    return [...this.logs];
  }

  static clearLogs() {
    this.logs = [];
  }

  // Method to send logs to backend analytics (if needed)
  private static async sendToAnalytics(logEntry: OrientationLogEntry) {
    try {
      // Uncomment and modify this if you want to send logs to your backend
      /*
      const response = await fetch('/api/analytics/orientation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logEntry),
      });
      
      if (!response.ok) {
        console.warn('Failed to send orientation analytics');
      }
      */
    } catch (error) {
      console.warn('Failed to send orientation analytics:', error);
    }
  }
}

export default OrientationLoggingService;