import fs from 'fs/promises';
import path from 'path';

interface LogEntry {
  timestamp: string;
  userId: string;
  username: string;
  endpoint: string;
  method: string;
  address?: string;
  newProspects?: string[];
  existingCustomers?: { name: string; id: string }[];
  userAgent: string;
  data?: any;
}

interface AuthLogEntry {
  timestamp: string;
  ipAddress: string;
  success: boolean;
  username?: string;
  userId?: string;
  reason: string;
}

interface CategoryChangeLogEntry {
  timestamp: string;
  datasetId: string;
  residentOriginalName: string;
  residentCurrentName: string;
  oldCategory: string;
  newCategory: string;
  changedBy: string;
  addressDatasetSnapshot: string;
}

type AnyLogEntry = LogEntry | AuthLogEntry | CategoryChangeLogEntry;

// Export types for use in other modules
export type { LogEntry, AuthLogEntry, CategoryChangeLogEntry, AnyLogEntry };

class FallbackLogger {
  private logFile = path.join(process.cwd(), 'logs', 'failed-logs.jsonl');
  private logDir = path.join(process.cwd(), 'logs');

  async ensureLogDirectory() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('[FallbackLogger] Failed to create log directory:', error);
    }
  }

  async saveFailed(logEntry: AnyLogEntry) {
    try {
      await this.ensureLogDirectory();
      
      // Append as JSON Lines (one JSON object per line)
      await fs.appendFile(
        this.logFile,
        JSON.stringify(logEntry) + '\n',
        'utf-8'
      );
      
      const userId = 'userId' in logEntry ? logEntry.userId : 'auth';
      const username =
        'username' in logEntry && logEntry.username ? logEntry.username : 'unknown';

      console.warn(`[FallbackLogger] Log saved to file:`, {
        userId,
        username,
        timestamp: logEntry.timestamp
      });
    } catch (error) {
      console.error('[FallbackLogger] Even file logging failed!', error);
    }
  }

  async hasFailedLogs(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.logFile);
      return stats.size > 0;
    } catch (error) {
      // File doesn't exist or can't be read
      return false;
    }
  }

  async getFailedLogs(): Promise<AnyLogEntry[]> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      
      return lines.map(line => JSON.parse(line));
    } catch (error) {
      console.error('[FallbackLogger] Failed to read failed logs:', error);
      return [];
    }
  }

  async clearFailedLogs() {
    try {
      await fs.unlink(this.logFile);
      console.log('[FallbackLogger] Cleared failed logs file');
    } catch (error) {
      // File might not exist - that's okay
      if ((error as any).code !== 'ENOENT') {
        console.error('[FallbackLogger] Failed to clear failed logs:', error);
      }
    }
  }

  async removeSuccessfulLogs(successfulLogs: AnyLogEntry[]) {
    try {
      const allLogs = await this.getFailedLogs();
      
      // Create set of successful log timestamps for quick lookup
      const successfulTimestamps = new Set(
        successfulLogs.map(log => log.timestamp)
      );
      
      // Filter out successful logs
      const remainingLogs = allLogs.filter(
        log => !successfulTimestamps.has(log.timestamp)
      );
      
      // Rewrite file with only failed logs
      if (remainingLogs.length === 0) {
        await this.clearFailedLogs();
      } else {
        await fs.writeFile(
          this.logFile,
          remainingLogs.map(log => JSON.stringify(log)).join('\n') + '\n',
          'utf-8'
        );
        console.log(`[FallbackLogger] Removed ${successfulLogs.length} successful logs, ${remainingLogs.length} remaining`);
      }
    } catch (error) {
      console.error('[FallbackLogger] Failed to remove successful logs:', error);
    }
  }
}

export const fallbackLogger = new FallbackLogger();
