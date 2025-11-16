import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { cookieStorageService } from '../services/cookieStorageService';
import type { DeviceInfo } from '../../shared/trackingTypes';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userPassword?: string;
  username?: string;
  isAdmin?: boolean;
  deviceInfo?: DeviceInfo;
}

export class AuthService {
  // Generate a secure token for the session (1 month validity)
  static generateSessionToken(password: string, username: string, isAdmin: boolean = false, deviceInfo?: DeviceInfo): string {
    const sessionId = crypto.randomUUID();
    const userId = crypto.createHash('sha256').update(password).digest('hex').substring(0, 8);

    // Store in cookie storage service with 1 month expiration and device info
    cookieStorageService.addCookie(sessionId, userId, password, username, isAdmin, deviceInfo);

    return sessionId;
  }

  // Validate session token and return user info
  static validateSessionToken(token: string): { userId: string, password: string, username: string, isAdmin: boolean } | null {
    const cookie = cookieStorageService.getCookie(token);

    if (!cookie) {
      return null;
    }

    return {
      userId: cookie.userId,
      password: cookie.password,
      username: cookie.username,
      isAdmin: cookie.isAdmin
    };
  }

  // Remove session token
  static revokeSessionToken(token: string): void {
    cookieStorageService.removeCookie(token);
  }

  // Get user ID from password (for consistent logging)
  static getUserIdFromPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex').substring(0, 8);
  }

  // Get all active cookies for a user
  static getUserCookies(userId: string): string[] {
    return cookieStorageService.getUserCookies(userId);
  }

  // Get cookie storage statistics
  static getCookieStats(): { totalCookies: number; activeUsers: number } {
    return cookieStorageService.getStats();
  }

  // Get all devices for a user
  static getUserDevices(userId: string): Array<{ sessionId: string; deviceInfo?: DeviceInfo; createdAt: Date; expiresAt: Date }> {
    return cookieStorageService.getUserDevices(userId);
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