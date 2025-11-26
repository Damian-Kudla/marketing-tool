/**
 * Global Rate Limit Manager for Google Sheets API
 * 
 * When ANY Google Sheets 429 error occurs, ALL Sheets operations are paused
 * for 5 minutes to allow rate limits to reset.
 */
class GoogleSheetsRateLimitManager {
  private rateLimitedUntil: number = 0;
  private readonly RATE_LIMIT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if we're currently in a rate limit cooldown period
   */
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  /**
   * Get remaining cooldown time in seconds
   */
  getRemainingCooldownSeconds(): number {
    if (!this.isRateLimited()) return 0;
    return Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
  }

  /**
   * Trigger a 5-minute rate limit cooldown
   */
  triggerRateLimit(): void {
    this.rateLimitedUntil = Date.now() + this.RATE_LIMIT_DURATION_MS;
    console.warn(`[GoogleSheetsRateLimitManager] Rate limit triggered! Pausing ALL Google Sheets operations for 5 minutes (until ${new Date(this.rateLimitedUntil).toISOString()})`);
  }

  /**
   * Check if an error is a Google Sheets rate limit error (429)
   */
  isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    // Check for HTTP 429 status
    if (error.status === 429 || error.code === 429) return true;
    
    // Check for rate limit message in error
    const message = error.message || error.toString();
    if (message.includes('Quota exceeded') || 
        message.includes('Rate Limit Exceeded') ||
        message.includes('Too Many Requests') ||
        message.includes('rateLimitExceeded')) {
      return true;
    }
    
    return false;
  }
}

// Singleton instance - shared across all modules
export const googleSheetsRateLimitManager = new GoogleSheetsRateLimitManager();
