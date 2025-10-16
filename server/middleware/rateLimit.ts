import { Request, Response, NextFunction } from 'express';

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_GEOCODING_REQUESTS = 10;
const MAX_VISION_REQUESTS = 10;

interface RateLimitEntry {
  geocodingCount: number;
  visionCount: number;
  windowStart: number;
}

// In-memory store for rate limiting (per username)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitStore.forEach((entry, username) => {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(username);
    }
  });
}, 5 * 60 * 1000);

export type RateLimitType = 'geocoding' | 'vision';

/**
 * Rate limiting middleware for API endpoints
 * Limits requests per user per minute
 */
export function rateLimitMiddleware(type: RateLimitType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const username = (req as any).username;
    
    if (!username) {
      // If no username (shouldn't happen after auth), skip rate limiting
      return next();
    }

    const now = Date.now();
    let entry = rateLimitStore.get(username);

    // Initialize or reset if window expired
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = {
        geocodingCount: 0,
        visionCount: 0,
        windowStart: now,
      };
      rateLimitStore.set(username, entry);
    }

    // Check limits based on type
    const maxLimit = type === 'geocoding' ? MAX_GEOCODING_REQUESTS : MAX_VISION_REQUESTS;
    const currentCount = type === 'geocoding' ? entry.geocodingCount : entry.visionCount;

    if (currentCount >= maxLimit) {
      const timeUntilReset = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
      
      const errorMessage = type === 'geocoding'
        ? `Wegen Einschränkungen sind leider nur ${MAX_GEOCODING_REQUESTS} Standortabfragen pro Minute pro Nutzer möglich. Du hast das Limit für diese Minute erreicht. Bitte warte ${timeUntilReset} Sekunden. Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael.`
        : `Wegen Einschränkungen sind leider nur ${MAX_VISION_REQUESTS} Bildübermittlungen pro Minute pro Nutzer möglich. Du hast das Limit für diese Minute erreicht. Bitte warte ${timeUntilReset} Sekunden. Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael.`;

      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: errorMessage,
        type,
        limit: maxLimit,
        retryAfter: timeUntilReset,
      });
    }

    // Increment counter
    if (type === 'geocoding') {
      entry.geocodingCount++;
    } else {
      entry.visionCount++;
    }

    rateLimitStore.set(username, entry);
    next();
  };
}

/**
 * Check rate limit without middleware (for internal use)
 * Returns true if limit is reached
 */
export function checkRateLimit(username: string, type: RateLimitType): { limited: boolean; message?: string } {
  const now = Date.now();
  let entry = rateLimitStore.get(username);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = {
      geocodingCount: 0,
      visionCount: 0,
      windowStart: now,
    };
    rateLimitStore.set(username, entry);
  }

  const maxLimit = type === 'geocoding' ? MAX_GEOCODING_REQUESTS : MAX_VISION_REQUESTS;
  const currentCount = type === 'geocoding' ? entry.geocodingCount : entry.visionCount;

  if (currentCount >= maxLimit) {
    const timeUntilReset = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    const errorMessage = type === 'geocoding'
      ? `Wegen Einschränkungen sind leider nur ${MAX_GEOCODING_REQUESTS} Standortabfragen pro Minute pro Nutzer möglich. Du hast das Limit für diese Minute erreicht. Bitte warte ${timeUntilReset} Sekunden. Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael.`
      : `Wegen Einschränkungen sind leider nur ${MAX_VISION_REQUESTS} Bildübermittlungen pro Minute pro Nutzer möglich. Du hast das Limit für diese Minute erreicht. Bitte warte ${timeUntilReset} Sekunden. Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael.`;

    return { limited: true, message: errorMessage };
  }

  return { limited: false };
}

/**
 * Increment rate limit counter (for internal use)
 */
export function incrementRateLimit(username: string, type: RateLimitType): void {
  const now = Date.now();
  let entry = rateLimitStore.get(username);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = {
      geocodingCount: 0,
      visionCount: 0,
      windowStart: now,
    };
  }

  if (type === 'geocoding') {
    entry.geocodingCount++;
  } else {
    entry.visionCount++;
  }

  rateLimitStore.set(username, entry);
}

/**
 * Get current rate limit status for debugging
 */
export function getRateLimitStatus(username: string): RateLimitEntry | null {
  return rateLimitStore.get(username) || null;
}
