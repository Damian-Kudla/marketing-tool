import { Router, Request, Response } from 'express';
import { googleSheetsService } from '../services/googleSheets';
import { AuthService } from '../middleware/auth';
import { GoogleSheetsLoggingService } from '../services/googleSheetsLogging';

const router = Router();

// Health check endpoint for deployment platforms (no auth required)
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'energy-scan-capture-api'
  });
});

// Simple rate limiter for login attempts
interface RateLimitEntry {
  attempts: number;
  firstAttempt: Date;
  blockedUntil?: Date;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = new Date();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    // First attempt from this IP
    rateLimitMap.set(ip, {
      attempts: 1,
      firstAttempt: now
    });
    return { allowed: true };
  }

  // Check if still blocked
  if (entry.blockedUntil && now < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 1000);
    return { allowed: false, retryAfter };
  }

  // Check if rate limit window has expired
  const windowExpired = now.getTime() - entry.firstAttempt.getTime() > RATE_LIMIT_WINDOW;
  if (windowExpired) {
    // Reset the counter
    rateLimitMap.set(ip, {
      attempts: 1,
      firstAttempt: now
    });
    return { allowed: true };
  }

  // Increment attempts
  entry.attempts++;

  if (entry.attempts > MAX_ATTEMPTS) {
    // Block this IP
    entry.blockedUntil = new Date(now.getTime() + BLOCK_DURATION);
    const retryAfter = Math.ceil(BLOCK_DURATION / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

// Login route
router.post('/login', async (req: Request, res: Response) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Check rate limit
  const rateLimitResult = checkRateLimit(clientIP);
  if (!rateLimitResult.allowed) {
    await GoogleSheetsLoggingService.logAuthAttempt(clientIP, false, undefined, undefined, 'rate_limit_exceeded');
    
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfter: rateLimitResult.retryAfter || 900
    });
  }

  const { password } = req.body;

  // Validate input
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    await GoogleSheetsLoggingService.logAuthAttempt(clientIP, false, undefined, undefined, 'missing_password');
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    // Get username by password from Google Sheets
    const username = await googleSheetsService.getUserByPassword(password.trim());
    
    if (!username) {
      await GoogleSheetsLoggingService.logAuthAttempt(clientIP, false, undefined, undefined, 'invalid_password');
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate session token with username
    const sessionToken = AuthService.generateSessionToken(password.trim(), username);
    const userId = AuthService.getUserIdFromPassword(password.trim());

    // Set secure HTTP-only cookie
    res.cookie('authToken', sessionToken, {
      httpOnly: true,
      secure: false, // Always false for development to work with http://localhost
      sameSite: 'lax', // Changed from 'strict' to 'lax' for better compatibility
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    });

    // Log successful authentication
    await GoogleSheetsLoggingService.logAuthAttempt(clientIP, true, username, userId, 'valid_password');

    res.json({ 
      success: true, 
      message: 'Login successful',
      userId: userId,
      username: username
    });

  } catch (error) {
    console.error('Login error:', error);
    await GoogleSheetsLoggingService.logAuthAttempt(clientIP, false, undefined, undefined, 'server_error');
    res.status(500).json({ error: 'Authentication service unavailable' });
  }
});

// Logout route
router.post('/logout', (req: Request, res: Response) => {
  const authToken = req.cookies?.authToken;
  
  if (authToken) {
    // Revoke the session token
    AuthService.revokeSessionToken(authToken);
  }
  
  // Clear the cookie
  res.clearCookie('authToken', {
    httpOnly: true,
    secure: false, // Always false for development
    sameSite: 'lax',
    path: '/'
  });

  res.json({ success: true, message: 'Logged out successfully' });
});

// Check authentication status
router.get('/check', (req: Request, res: Response) => {
  const authToken = req.cookies?.authToken;
  
  if (!authToken) {
    return res.status(401).json({ authenticated: false });
  }

  const session = AuthService.validateSessionToken(authToken);
  if (!session) {
    // Clear invalid cookie
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: false, // Always false for development
      sameSite: 'lax',
      path: '/'
    });
    return res.status(401).json({ authenticated: false });
  }

  res.json({ 
    authenticated: true, 
    userId: session.userId,
    username: session.username
  });
});

export { router as authRouter };