import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { getBerlinTimestamp } from '../utils/timezone';

export interface LogEntry {
  timestamp: string;
  userId: string;
  endpoint: string;
  address?: string;
  newProspects?: string[];
  existingCustomers?: any[];
  method: string;
  userAgent?: string;
}

export class LoggingService {
  private static readonly LOGS_DIR = 'logs';

  // Ensure logs directory exists
  static ensureLogsDirectory(): void {
    if (!fs.existsSync(this.LOGS_DIR)) {
      fs.mkdirSync(this.LOGS_DIR, { recursive: true });
    }
  }

  // Log user activity to their individual log file
  static async logUserActivity(
    req: AuthenticatedRequest, 
    address?: string, 
    newProspects?: string[], 
    existingCustomers?: any[]
  ): Promise<void> {
    if (!req.userId) {
      return; // No user ID, skip logging
    }

    this.ensureLogsDirectory();

    const logEntry: LogEntry = {
      timestamp: getBerlinTimestamp(),
      userId: req.userId,
      endpoint: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
    };

    // Add address if provided
    if (address) {
      logEntry.address = address;
    }

    // Add prospect/customer data if provided
    if (newProspects && newProspects.length > 0) {
      logEntry.newProspects = newProspects;
    }

    if (existingCustomers && existingCustomers.length > 0) {
      logEntry.existingCustomers = existingCustomers.map(customer => ({
        id: customer.id,
        name: customer.name,
        address: customer.address
      }));
    }

    const logLine = JSON.stringify(logEntry) + '\n';
    const logFilePath = path.join(this.LOGS_DIR, `${req.userId}.log`);

    try {
      await fs.promises.appendFile(logFilePath, logLine, 'utf8');
    } catch (error) {
      console.error(`Failed to write to log file ${logFilePath}:`, error);
    }
  }

  // Log authentication attempts (both successful and failed)
  static async logAuthAttempt(
    ip: string, 
    success: boolean, 
    userId?: string, 
    reason?: string
  ): Promise<void> {
    this.ensureLogsDirectory();

    const logEntry = {
      timestamp: getBerlinTimestamp(),
      type: 'auth_attempt',
      ip,
      success,
      userId: userId || 'unknown',
      reason: reason || (success ? 'valid_password' : 'invalid_password')
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    const logFilePath = path.join(this.LOGS_DIR, 'auth.log');

    try {
      await fs.promises.appendFile(logFilePath, logLine, 'utf8');
    } catch (error) {
      console.error(`Failed to write to auth log file:`, error);
    }
  }

  // Get user activity logs (for admin purposes)
  static async getUserLogs(userId: string, limit: number = 100): Promise<LogEntry[]> {
    const logFilePath = path.join(this.LOGS_DIR, `${userId}.log`);
    
    try {
      if (!fs.existsSync(logFilePath)) {
        return [];
      }

      const logData = await fs.promises.readFile(logFilePath, 'utf8');
      const lines = logData.trim().split('\n').filter(line => line.length > 0);
      
      // Get the last 'limit' entries
      const recentLines = lines.slice(-limit);
      
      return recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.error('Failed to parse log line:', line);
          return null;
        }
      }).filter(entry => entry !== null);
    } catch (error) {
      console.error(`Failed to read log file ${logFilePath}:`, error);
      return [];
    }
  }
}
