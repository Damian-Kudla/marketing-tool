interface PushoverMessage {
  message: string;
  title?: string;
  priority?: -2 | -1 | 0 | 1 | 2;
  sound?: string;
}

// Rate limiting configuration for different alert types
const ALERT_COOLDOWNS: Record<string, number> = {
  'fallback_storage': 5 * 60 * 1000,  // 5 minutes
  'rate_limit': 5 * 60 * 1000,         // 5 minutes
  'high_error_rate': 10 * 60 * 1000,   // 10 minutes
  'recovery_success': 60 * 1000,       // 1 minute (allow more frequent good news)
};

class PushoverService {
  private token: string | undefined;
  private user: string | undefined;
  private enabled: boolean = false;
  private readonly PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
  
  // Track last notification time per alert type to prevent spam
  private lastNotificationTime: Map<string, number> = new Map();
  // Accumulate counts during cooldown period
  private accumulatedCounts: Map<string, number> = new Map();

  constructor() {
    this.token = process.env.PUSHOVER_TOKEN;
    this.user = process.env.PUSHOVER_USER;
    this.enabled = !!(this.token && this.user);

    if (!this.enabled) {
      console.warn('[PushoverService] Pushover credentials not configured - notifications disabled');
    } else {
      console.log('[PushoverService] Pushover notifications enabled');
    }
  }

  /**
   * Check if we should send a notification based on cooldown
   * Returns true if enough time has passed since the last notification of this type
   */
  private shouldSendNotification(alertType: string): boolean {
    const lastTime = this.lastNotificationTime.get(alertType) || 0;
    const cooldown = ALERT_COOLDOWNS[alertType] || 5 * 60 * 1000; // Default 5 min
    const now = Date.now();
    
    if (now - lastTime >= cooldown) {
      this.lastNotificationTime.set(alertType, now);
      return true;
    }
    return false;
  }

  /**
   * Accumulate count during cooldown period
   */
  private accumulateCount(alertType: string, count: number): number {
    const currentAccumulated = this.accumulatedCounts.get(alertType) || 0;
    const newAccumulated = currentAccumulated + count;
    this.accumulatedCounts.set(alertType, newAccumulated);
    return newAccumulated;
  }

  /**
   * Get and reset accumulated count
   */
  private getAndResetAccumulatedCount(alertType: string): number {
    const accumulated = this.accumulatedCounts.get(alertType) || 0;
    this.accumulatedCounts.set(alertType, 0);
    return accumulated;
  }

  async sendNotification(message: string, options?: Partial<PushoverMessage>): Promise<boolean> {
    if (!this.enabled) {
      console.warn('[PushoverService] Pushover not enabled - skipping notification');
      return false;
    }

    try {
      const payload = {
        token: this.token,
        user: this.user,
        message,
        title: options?.title || 'EnergyScanner Alert',
        priority: options?.priority || 1,
        sound: options?.sound || 'pushover'
      };

      const response = await fetch(this.PUSHOVER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log('[PushoverService] Notification sent successfully');
        return true;
      } else {
        const errorText = await response.text();
        console.error('[PushoverService] Failed to send notification:', errorText);
        return false;
      }
    } catch (error) {
      console.error('[PushoverService] Error sending notification:', error);
      return false;
    }
  }

  async sendHighErrorRateAlert(errorRate: number, successCount: number, failureCount: number) {
    // Rate limit: max once per 10 minutes
    if (!this.shouldSendNotification('high_error_rate')) {
      console.log('[PushoverService] High error rate alert throttled (cooldown active)');
      return;
    }

    const message = `🚨 HIGH ERROR RATE DETECTED!\n\n` +
      `Error Rate: ${(errorRate * 100).toFixed(1)}%\n` +
      `Successes: ${successCount}\n` +
      `Failures: ${failureCount}\n\n` +
      `Google Sheets Logging is experiencing issues.`;

    await this.sendNotification(message, {
      title: 'Logging Error Alert',
      priority: 2 // Emergency priority
    });
  }

  async sendRateLimitAlert(userId: string, username: string) {
    // Rate limit: max once per 5 minutes
    if (!this.shouldSendNotification('rate_limit')) {
      console.log('[PushoverService] Rate limit alert throttled (cooldown active)');
      return;
    }

    const message = `⚠️ RATE LIMIT EXCEEDED\n\n` +
      `User: ${username} (${userId})\n\n` +
      `Google Sheets API rate limit has been reached. Logs are being queued.`;

    await this.sendNotification(message, {
      title: 'Rate Limit Warning',
      priority: 1 // High priority
    });
  }

  async sendFallbackStorageAlert(failedLogCount: number) {
    // Accumulate failed log count
    const totalAccumulated = this.accumulateCount('fallback_storage', failedLogCount);
    
    // Rate limit: max once per 5 minutes
    if (!this.shouldSendNotification('fallback_storage')) {
      console.log(`[PushoverService] Fallback storage alert throttled (cooldown active). Accumulated: ${totalAccumulated} logs`);
      return;
    }

    // Get total accumulated since last notification
    const totalFailed = this.getAndResetAccumulatedCount('fallback_storage');
    
    const message = `💾 FALLBACK STORAGE ACTIVE\n\n` +
      `Failed logs (last 5 min): ${totalFailed}\n\n` +
      `Logs are being saved to file. Will retry later.`;

    await this.sendNotification(message, {
      title: 'Fallback Storage Alert',
      priority: 1
    });
  }

  async sendRecoverySuccess(recoveredLogCount: number) {
    // Accumulate recovered log count
    const totalAccumulated = this.accumulateCount('recovery_success', recoveredLogCount);
    
    // Rate limit: max once per 1 minute (allow more frequent good news)
    if (!this.shouldSendNotification('recovery_success')) {
      console.log(`[PushoverService] Recovery success notification throttled. Accumulated: ${totalAccumulated} logs`);
      return;
    }

    // Get total accumulated since last notification
    const totalRecovered = this.getAndResetAccumulatedCount('recovery_success');
    
    const message = `✅ LOGS RECOVERED\n\n` +
      `Successfully sent ${totalRecovered} previously failed logs to Google Sheets.`;

    await this.sendNotification(message, {
      title: 'Recovery Success',
      priority: 0 // Normal priority
    });
  }
}

export const pushoverService = new PushoverService();
