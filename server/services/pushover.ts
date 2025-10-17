interface PushoverMessage {
  message: string;
  title?: string;
  priority?: -2 | -1 | 0 | 1 | 2;
  sound?: string;
}

class PushoverService {
  private token: string | undefined;
  private user: string | undefined;
  private enabled: boolean = false;
  private readonly PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';

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
    const message = `⚠️ RATE LIMIT EXCEEDED\n\n` +
      `User: ${username} (${userId})\n\n` +
      `Google Sheets API rate limit has been reached. Logs are being queued.`;

    await this.sendNotification(message, {
      title: 'Rate Limit Warning',
      priority: 1 // High priority
    });
  }

  async sendFallbackStorageAlert(failedLogCount: number) {
    const message = `💾 FALLBACK STORAGE ACTIVE\n\n` +
      `Failed logs: ${failedLogCount}\n\n` +
      `Logs are being saved to file. Will retry later.`;

    await this.sendNotification(message, {
      title: 'Fallback Storage Alert',
      priority: 1
    });
  }

  async sendRecoverySuccess(recoveredLogCount: number) {
    const message = `✅ LOGS RECOVERED\n\n` +
      `Successfully sent ${recoveredLogCount} previously failed logs to Google Sheets.`;

    await this.sendNotification(message, {
      title: 'Recovery Success',
      priority: 0 // Normal priority
    });
  }
}

export const pushoverService = new PushoverService();
