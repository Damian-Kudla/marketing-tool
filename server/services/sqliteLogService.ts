/**
 * SQLite Log Service
 *
 * Verwaltet User-Logs in täglichen SQLite-Datenbanken (logs-YYYY-MM-DD.db)
 * - Speichert GPS, Session, Action, Device-Logs strukturiert
 * - Nutzt Railway Volume für Persistenz (/app/data)
 * - WAL-Mode für Crash-Safety
 * - Automatische Cleanup für Daten >7 Tage
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import type { TrackingData, GPSCoordinates, SessionData, DeviceStatus } from '../../shared/trackingTypes';

const fsp = {
  access: promisify(fs.access),
  unlink: promisify(fs.unlink),
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  rename: promisify(fs.rename),
  stat: promisify(fs.stat)
};

// Railway Volume Path (fallback auf lokales data/ für Development)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'user-logs')
  : path.join(process.cwd(), 'data', 'user-logs');

// Temp-Verzeichnis für Downloads aus Google Drive
const TEMP_DIR = path.join(DATA_DIR, 'temp');

// In-Memory Cache für geöffnete DBs (vermeidet wiederholtes Öffnen)
const dbCache = new Map<string, Database.Database>();

// Cache für alte DBs (>7 Tage) - 1 Stunde TTL
const oldDBCache = new Map<string, { db: Database.Database; expires: number }>();

/**
 * Timezone-Helper: Konvertiert Timestamp zu CET/CEST-Datum
 * Deutsche Zeit ist UTC+1 (Winter) oder UTC+2 (Sommer)
 */
export function getCETDate(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);

  // Konvertiere zu deutscher Zeit (toLocaleString mit timezone)
  const germanTimeString = date.toLocaleString('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // Parse MM/DD/YYYY → YYYY-MM-DD
  const [month, day, year] = germanTimeString.split(/[/,\s]+/);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Initialisiert Verzeichnisse
 */
export function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[SQLite] Created data directory: ${DATA_DIR}`);
  }

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`[SQLite] Created temp directory: ${TEMP_DIR}`);
  }
}

/**
 * Gibt Dateipfad für eine bestimmte Datum-DB zurück
 */
export function getDBPath(date: string, isTemp = false): string {
  const dir = isTemp ? TEMP_DIR : DATA_DIR;
  return path.join(dir, `logs-${date}.db`);
}

/**
 * Prüft ob DB-Datei existiert
 */
export async function dbExists(date: string): Promise<boolean> {
  try {
    await fsp.access(getDBPath(date), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Berechnet SHA256-Checksum einer DB-Datei
 */
export async function getDBChecksum(date: string): Promise<string | null> {
  try {
    const filePath = getDBPath(date);
    const buffer = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    console.error(`[SQLite] Error calculating checksum for ${date}:`, error);
    return null;
  }
}

/**
 * Prüft Integrität einer DB
 */
export function checkDBIntegrity(date: string): boolean {
  try {
    const db = new Database(getDBPath(date), { readonly: true });
    const result = db.pragma('integrity_check');
    db.close();

    const isValid = result.length === 1 && result[0].integrity_check === 'ok';

    if (!isValid) {
      console.error(`[SQLite] Integrity check FAILED for ${date}:`, result);
    }

    return isValid;
  } catch (error) {
    console.error(`[SQLite] Error checking integrity for ${date}:`, error);
    return false;
  }
}

/**
 * Schließt eine DB und entfernt sie aus dem Cache
 * WICHTIG: Muss aufgerufen werden bevor eine DB-Datei überschrieben wird!
 */
export function closeDB(date: string): void {
  if (dbCache.has(date)) {
    try {
      const db = dbCache.get(date)!;
      db.close();
      dbCache.delete(date);
      console.log(`[SQLite] Closed and removed ${date} from cache`);
    } catch (error) {
      console.error(`[SQLite] Error closing ${date}:`, error);
      // Force remove from cache even if close fails
      dbCache.delete(date);
    }
  }

  // Also check old DB cache
  if (oldDBCache.has(date)) {
    try {
      const cached = oldDBCache.get(date)!;
      cached.db.close();
      oldDBCache.delete(date);
      console.log(`[SQLite] Closed and removed ${date} from old DB cache`);
    } catch (error) {
      console.error(`[SQLite] Error closing ${date} from old cache:`, error);
      // Force remove from cache even if close fails
      oldDBCache.delete(date);
    }
  }
}

/**
 * Initialisiert oder öffnet eine DB für ein bestimmtes Datum
 */
export function initDB(date: string, readonly = false): Database.Database {
  const dbPath = getDBPath(date);
  const isNew = !fs.existsSync(dbPath);

  // Check cache first (nur für read-write DBs)
  if (!readonly && dbCache.has(date)) {
    return dbCache.get(date)!;
  }

  try {
    const db = new Database(dbPath, { readonly });

    if (!readonly) {
      // Enable WAL mode for crash-safety and concurrent reads
      db.pragma('journal_mode = WAL');

      // Synchronous mode NORMAL (balance between safety and performance)
      db.pragma('synchronous = NORMAL');

      // Cache size (10MB)
      db.pragma('cache_size = -10000');
    }

    if (isNew && !readonly) {
      // Create schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          log_type TEXT NOT NULL CHECK(log_type IN ('gps', 'session', 'action', 'device')),
          data TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          UNIQUE(user_id, timestamp, log_type)
        );

        CREATE INDEX IF NOT EXISTS idx_user_timestamp ON user_logs(user_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_log_type ON user_logs(log_type);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON user_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_user_date ON user_logs(user_id, log_type, timestamp);
      `);

      console.log(`[SQLite] ✅ Created new database: ${date}`);
    }

    // Cache for reuse (nur read-write)
    if (!readonly) {
      dbCache.set(date, db);
    }

    return db;
  } catch (error) {
    console.error(`[SQLite] ❌ Error initializing DB for ${date}:`, error);
    throw error;
  }
}

/**
 * Log-Eintrag einfügen (atomic, kein Flush nötig)
 */
export interface LogInsertData {
  userId: string;
  username: string;
  timestamp: number;
  logType: 'gps' | 'session' | 'action' | 'device';
  data: any;
}

export function insertLog(date: string, log: LogInsertData): boolean {
  try {
    const db = initDB(date);

    // Prepare statement (wird gecached von better-sqlite3)
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO user_logs (user_id, username, timestamp, log_type, data)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      log.userId,
      log.username,
      log.timestamp,
      log.logType,
      JSON.stringify(log.data)
    );

    // result.changes > 0 bedeutet: neuer Eintrag (nicht Duplikat)
    return result.changes > 0;
  } catch (error) {
    console.error(`[SQLite] Error inserting log for ${date}:`, error);
    return false;
  }
}

/**
 * Batch-Insert für bessere Performance bei Sync
 */
export function insertLogsBatch(date: string, logs: LogInsertData[]): number {
  if (logs.length === 0) return 0;

  try {
    const db = initDB(date);

    // Transaction für Atomicity
    const insertMany = db.transaction((logsToInsert: LogInsertData[]) => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO user_logs (user_id, username, timestamp, log_type, data)
        VALUES (?, ?, ?, ?, ?)
      `);

      let inserted = 0;
      for (const log of logsToInsert) {
        const result = stmt.run(
          log.userId,
          log.username,
          log.timestamp,
          log.logType,
          JSON.stringify(log.data)
        );
        inserted += result.changes;
      }

      return inserted;
    });

    const count = insertMany(logs);
    console.log(`[SQLite] Batch inserted ${count}/${logs.length} logs for ${date}`);
    return count;
  } catch (error) {
    console.error(`[SQLite] Error in batch insert for ${date}:`, error);
    return 0;
  }
}

/**
 * Query: Alle Logs für einen User an einem Tag
 */
export interface UserLogResult {
  id: number;
  userId: string;
  username: string;
  timestamp: number;
  logType: 'gps' | 'session' | 'action' | 'device';
  data: any;
  createdAt: number;
}

export function getUserLogs(date: string, userId: string): UserLogResult[] {
  try {
    // Check if date is older than 7 days
    const today = getCETDate();
    const daysAgo = Math.floor((new Date(today).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));

    // If >7 days, check temp cache first
    if (daysAgo > 7) {
      const cached = oldDBCache.get(date);
      if (cached && cached.expires > Date.now()) {
        console.log(`[SQLite] Using cached old DB for ${date}`);
        return queryUserLogsFromDB(cached.db, userId);
      }

      // DB nicht im Cache und vermutlich nicht lokal → muss vorher geladen werden
      if (!fs.existsSync(getDBPath(date))) {
        console.warn(`[SQLite] DB for ${date} not found locally (>7 days old)`);
        return [];
      }
    }

    const db = initDB(date, true); // readonly
    const results = queryUserLogsFromDB(db, userId);

    // Close readonly DB (nicht gecached)
    db.close();

    return results;
  } catch (error) {
    console.error(`[SQLite] Error querying user logs for ${date}, user ${userId}:`, error);
    return [];
  }
}

/**
 * Helper: Query aus einer gegebenen DB
 */
function queryUserLogsFromDB(db: Database.Database, userId: string): UserLogResult[] {
  const stmt = db.prepare(`
    SELECT id, user_id, username, timestamp, log_type, data, created_at
    FROM user_logs
    WHERE user_id = ?
    ORDER BY timestamp ASC
  `);

  const rows = stmt.all(userId) as any[];

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    timestamp: row.timestamp,
    logType: row.log_type,
    data: JSON.parse(row.data),
    createdAt: row.created_at
  }));
}

/**
 * Query: Alle User-IDs mit Logs an einem Tag
 */
export function getAllUserIds(date: string): string[] {
  try {
    const db = initDB(date, true);
    const stmt = db.prepare(`
      SELECT DISTINCT user_id FROM user_logs ORDER BY user_id
    `);

    const rows = stmt.all() as any[];
    db.close();

    return rows.map(row => row.user_id);
  } catch (error: any) {
    console.error(`[SQLite] Error getting user IDs for ${date}:`, error);
    
    // Check if database is corrupted
    if (error?.code === 'SQLITE_CORRUPT' || error?.message?.includes('malformed')) {
      console.error(`[SQLite] ⚠️  Database corruption detected for ${date} - attempting recovery...`);
      
      // Delete corrupted local DB and try to re-download from Drive
      try {
        const dbPath = getDBPath(date);
        fs.unlinkSync(dbPath);
        console.log(`[SQLite] 🗑️  Deleted corrupted local DB: ${dbPath}`);
        console.warn(`[SQLite] ℹ️  Please restart the app to re-download ${date} from Google Drive`);
      } catch (deleteError) {
        console.error(`[SQLite] Error deleting corrupted DB:`, deleteError);
      }
    }
    
    return [];
  }
}

/**
 * Cache für alte DB (>7 Tage) mit 1 Stunde TTL
 */
export function cacheOldDB(date: string, dbPath: string): void {
  try {
    const db = new Database(dbPath, { readonly: true });
    const expires = Date.now() + 60 * 60 * 1000; // 1 Stunde

    oldDBCache.set(date, { db, expires });
    console.log(`[SQLite] Cached old DB for ${date} (expires in 1h)`);

    // Auto-cleanup nach Ablauf
    setTimeout(() => {
      const cached = oldDBCache.get(date);
      if (cached && cached.expires <= Date.now()) {
        cached.db.close();
        oldDBCache.delete(date);
        console.log(`[SQLite] Removed expired cache for ${date}`);
      }
    }, 60 * 60 * 1000);
  } catch (error) {
    console.error(`[SQLite] Error caching old DB for ${date}:`, error);
  }
}

/**
 * Cleanup: Lösche DBs älter als N Tage
 */
export async function cleanupOldDBs(daysToKeep = 7): Promise<number> {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const today = getCETDate();
    let deleted = 0;

    for (const file of files) {
      if (!file.startsWith('logs-') || !file.endsWith('.db')) continue;

      // Extract date from filename
      const match = file.match(/logs-(\d{4}-\d{2}-\d{2})\.db/);
      if (!match) continue;

      const fileDate = match[1];
      const daysAgo = Math.floor(
        (new Date(today).getTime() - new Date(fileDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysAgo > daysToKeep) {
        const filePath = path.join(DATA_DIR, file);

        // Close DB if cached
        if (dbCache.has(fileDate)) {
          dbCache.get(fileDate)!.close();
          dbCache.delete(fileDate);
        }

        await fsp.unlink(filePath);
        console.log(`[SQLite] Deleted old DB: ${file} (${daysAgo} days old)`);
        deleted++;

        // Also delete WAL and SHM files
        try {
          await fsp.unlink(filePath + '-wal');
          await fsp.unlink(filePath + '-shm');
        } catch {
          // Ignore if they don't exist
        }
      }
    }

    if (deleted > 0) {
      console.log(`[SQLite] ✅ Cleanup: Deleted ${deleted} old DBs`);
    }

    return deleted;
  } catch (error) {
    console.error('[SQLite] Error during cleanup:', error);
    return 0;
  }
}

/**
 * Checkpoint: WAL → Main DB (vor Upload wichtig)
 */
export function checkpointDB(date: string): void {
  try {
    const db = initDB(date);
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`[SQLite] Checkpointed WAL for ${date}`);
  } catch (error) {
    console.error(`[SQLite] Error checkpointing ${date}:`, error);
  }
}

/**
 * Schließe alle gecachten DBs (z.B. vor Shutdown)
 */
export function closeAllDBs(): void {
  console.log(`[SQLite] Closing ${dbCache.size} cached DBs...`);

  for (const [date, db] of dbCache.entries()) {
    try {
      db.close();
    } catch (error) {
      console.error(`[SQLite] Error closing DB ${date}:`, error);
    }
  }

  dbCache.clear();

  // Close old DBs cache
  for (const [date, cached] of oldDBCache.entries()) {
    try {
      cached.db.close();
    } catch (error) {
      console.error(`[SQLite] Error closing old DB ${date}:`, error);
    }
  }

  oldDBCache.clear();

  console.log('[SQLite] ✅ All DBs closed');
}

/**
 * Stats für Monitoring
 */
export function getDBStats(date: string): {
  exists: boolean;
  size: number;
  rowCount: number;
  userCount: number;
} {
  try {
    if (!fs.existsSync(getDBPath(date))) {
      return { exists: false, size: 0, rowCount: 0, userCount: 0 };
    }

    const stats = fs.statSync(getDBPath(date));
    const db = initDB(date, true);

    const rowCount = (db.prepare('SELECT COUNT(*) as count FROM user_logs').get() as any).count;
    const userCount = (db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM user_logs').get() as any).count;

    db.close();

    return {
      exists: true,
      size: stats.size,
      rowCount,
      userCount
    };
  } catch (error) {
    console.error(`[SQLite] Error getting stats for ${date}:`, error);
    return { exists: false, size: 0, rowCount: 0, userCount: 0 };
  }
}

// Initialize directories on module load
ensureDirectories();
