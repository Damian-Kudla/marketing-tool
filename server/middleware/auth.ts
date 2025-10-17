import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Store active session tokens in memory (in production, use Redis or database)
const activeSessions = new Map<string, { userId: string, password: string, username: string, isAdmin: boolean, createdAt: Date }>();

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userPassword?: string;
  username?: string;
  isAdmin?: boolean;
}

export class AuthService {
  // Generate a secure token for the session
  static generateSessionToken(password: string, username: string, isAdmin: boolean = false): string {
    const sessionId = crypto.randomUUID();
    const userId = crypto.createHash('sha256').update(password).digest('hex').substring(0, 8);
    
    activeSessions.set(sessionId, {
      userId,
      password,
      username,
      isAdmin,
      createdAt: new Date()
    });

    // Clean up old sessions (older than 24 hours)
    this.cleanupOldSessions();
    
    return sessionId;
  }

  // Validate session token and return user info
  static validateSessionToken(token: string): { userId: string, password: string, username: string, isAdmin: boolean } | null {
    const session = activeSessions.get(token);
    if (!session) {
      return null;
    }

    // Check if session is expired (24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (session.createdAt < twentyFourHoursAgo) {
      activeSessions.delete(token);
      return null;
    }

    return { userId: session.userId, password: session.password, username: session.username, isAdmin: session.isAdmin };
  }

  // Remove session token
  static revokeSessionToken(token: string): void {
    activeSessions.delete(token);
  }

  // Clean up sessions older than 24 hours
  private static cleanupOldSessions(): void {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const tokensToDelete: string[] = [];
    activeSessions.forEach((session, token) => {
      if (session.createdAt < twentyFourHoursAgo) {
        tokensToDelete.push(token);
      }
    });
    
    tokensToDelete.forEach(token => activeSessions.delete(token));
  }

  // Get user ID from password (for consistent logging)
  static getUserIdFromPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex').substring(0, 8);
  }
}

// Middleware to check authentication
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authToken = req.cookies?.authToken;

  if (!authToken) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = AuthService.validateSessionToken(authToken);
  if (!session) {
    // Clear invalid cookie
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: false, // Always false for development
      sameSite: 'lax'
    });
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  // Add user info to request
  req.userId = session.userId;
  req.userPassword = session.password;
  req.username = session.username;
  req.isAdmin = session.isAdmin;
  next();
}

// Optional auth middleware (doesn't fail if no auth)
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authToken = req.cookies?.authToken;

  if (authToken) {
    const session = AuthService.validateSessionToken(authToken);
    if (session) {
      req.userId = session.userId;
      req.userPassword = session.password;
      req.username = session.username;
      req.isAdmin = session.isAdmin;
    }
  }

  next();
}

// Admin-only middleware
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authToken = req.cookies?.authToken;

  if (!authToken) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = AuthService.validateSessionToken(authToken);
  if (!session) {
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax'
    });
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  if (!session.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  // Add user info to request
  req.userId = session.userId;
  req.userPassword = session.password;
  req.username = session.username;
  req.isAdmin = session.isAdmin;
  next();
}