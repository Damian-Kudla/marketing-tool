/**
 * System Database Service
 * 
 * Zentrale Verwaltung aller System-Datenbanken:
 * - Cookies (Session-Daten)
 * - Termine (Appointments)
 * - PauseLocations (POI Cache)
 * - AuthLogs (Login-Versuche)
 * - CategoryChanges (Kategorie-Änderungen)
 * 
 * Speicherung:
 * - Primär: Lokale SQLite-Datenbanken
 * - Backup: Google Drive (täglich um Mitternacht)
 * - Sync: Google Sheets (für manuelle Bearbeitung/Einsicht)
 * 
 * Startup-Sync:
 * - Bidirektionaler Abgleich: Drive ↔ SQLite ↔ Sheets
 * - Intelligentes Merging (nur bei Unterschieden)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { google } from './googleApiWrapper';
import { getBerlinTimestamp } from '../utils/timezone';

// Railway Volume Path (fallback auf lokales data/ für Development)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'system-dbs')
  : path.join(process.cwd(), 'data', 'system-dbs');

// System Sheet ID (separate von User-Logs)
const SYSTEM_SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';

// Drive Backup Folder für System-DBs
const SYSTEM_BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_SYSTEM_BACKUP_FOLDER_ID || '1Vhe5gnGCr8s_9xeXq71RHp5ucfhAPjxu';

// Database file names
const DB_FILES = {
  cookies: 'cookies.db',
  appointments: 'appointments.db',
  pauseLocations: 'pause-locations.db',
  authLogs: 'auth-logs.db',
  categoryChanges: 'category-changes.db'
} as const;

type DBName = keyof typeof DB_FILES;

// In-Memory Cache für geöffnete DBs
const dbCache = new Map<DBName, Database.Database>();

/**
 * Ensure data directory exists
 */
function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[SystemDB] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Get DB file path
 */
function getDBPath(name: DBName): string {
  return path.join(DATA_DIR, DB_FILES[name]);
}

/**
 * Calculate SHA256 checksum
 */
function getFileChecksum(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Initialize or open a system database
 */
function initDB(name: DBName): Database.Database {
  ensureDirectories();
  
  if (dbCache.has(name)) {
    return dbCache.get(name)!;
  }

  const dbPath = getDBPath(name);
  const isNew = !fs.existsSync(dbPath);
  
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  if (isNew) {
    createSchema(db, name);
    console.log(`[SystemDB] Created new database: ${name}`);
  }

  dbCache.set(name, db);
  return db;
}

/**
 * Create schema for each database type
 */
function createSchema(db: Database.Database, name: DBName): void {
  switch (name) {
    case 'cookies':
      db.exec(`
        CREATE TABLE IF NOT EXISTS cookies (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          device_id TEXT,
          device_name TEXT,
          platform TEXT,
          user_agent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cookies_user ON cookies(user_id);
        CREATE INDEX IF NOT EXISTS idx_cookies_expires ON cookies(expires_at);
      `);
      break;

    case 'appointments':
      db.exec(`
        CREATE TABLE IF NOT EXISTS appointments (
          id TEXT PRIMARY KEY,
          dataset_id TEXT NOT NULL,
          resident_name TEXT NOT NULL,
          address TEXT NOT NULL,
          appointment_date TEXT NOT NULL,
          appointment_time TEXT NOT NULL,
          notes TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
        CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(created_by);
      `);
      break;

    case 'pauseLocations':
      db.exec(`
        CREATE TABLE IF NOT EXISTS pause_locations (
          place_id TEXT PRIMARY KEY,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          address TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pause_coords ON pause_locations(lat, lng);
      `);
      break;

    case 'authLogs':
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          ip_address TEXT NOT NULL,
          success INTEGER NOT NULL,
          username TEXT,
          user_id TEXT,
          reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_auth_timestamp ON auth_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_auth_user ON auth_logs(username);
      `);
      break;

    case 'categoryChanges':
      db.exec(`
        CREATE TABLE IF NOT EXISTS category_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          resident_original_name TEXT,
          resident_current_name TEXT,
          old_category TEXT,
          new_category TEXT,
          changed_by TEXT NOT NULL,
          address_snapshot TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_category_timestamp ON category_changes(timestamp);
        CREATE INDEX IF NOT EXISTS idx_category_dataset ON category_changes(dataset_id);
      `);
      break;
  }
}

/**
 * Close a database
 */
function closeDB(name: DBName): void {
  if (dbCache.has(name)) {
    try {
      dbCache.get(name)!.close();
      dbCache.delete(name);
      console.log(`[SystemDB] Closed database: ${name}`);
    } catch (error) {
      console.error(`[SystemDB] Error closing ${name}:`, error);
      dbCache.delete(name);
    }
  }
}

/**
 * Checkpoint WAL (wichtig vor Upload)
 * Returns true if successful, false otherwise
 */
function checkpointDB(name: DBName): boolean {
  try {
    const db = initDB(name);
    const result = db.pragma('wal_checkpoint(TRUNCATE)', { simple: true }) as any;

    // WAL checkpoint returns [busy, log, checkpointed]
    // busy = 0 means checkpoint succeeded
    if (Array.isArray(result) && result[0] === 0) {
      console.log(`[SystemDB] Checkpointed ${name} successfully`);
      return true;
    } else {
      console.error(`[SystemDB] Checkpoint ${name} failed or incomplete: ${JSON.stringify(result)}`);
      return false;
    }
  } catch (error) {
    console.error(`[SystemDB] Error checkpointing ${name}:`, error);
    return false;
  }
}

// ============================================
// COOKIES DATABASE OPERATIONS
// ============================================

export interface CookieRecord {
  sessionId: string;
  userId: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
  expiresAt: number;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  userAgent?: string;
}

export const cookiesDB = {
  getAll(): CookieRecord[] {
    const db = initDB('cookies');
    const rows = db.prepare('SELECT * FROM cookies WHERE expires_at > ?').all(Date.now()) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      deviceId: row.device_id,
      deviceName: row.device_name,
      platform: row.platform,
      userAgent: row.user_agent
    }));
  },

  get(sessionId: string): CookieRecord | null {
    const db = initDB('cookies');
    const row = db.prepare('SELECT * FROM cookies WHERE session_id = ? AND expires_at > ?').get(sessionId, Date.now()) as any;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      deviceId: row.device_id,
      deviceName: row.device_name,
      platform: row.platform,
      userAgent: row.user_agent
    };
  },

  upsert(cookie: CookieRecord): void {
    const db = initDB('cookies');
    db.prepare(`
      INSERT OR REPLACE INTO cookies 
      (session_id, user_id, username, is_admin, created_at, expires_at, device_id, device_name, platform, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cookie.sessionId,
      cookie.userId,
      cookie.username,
      cookie.isAdmin ? 1 : 0,
      cookie.createdAt,
      cookie.expiresAt,
      cookie.deviceId || null,
      cookie.deviceName || null,
      cookie.platform || null,
      cookie.userAgent || null
    );
  },

  delete(sessionId: string): void {
    const db = initDB('cookies');
    db.prepare('DELETE FROM cookies WHERE session_id = ?').run(sessionId);
  },

  deleteExpired(): number {
    const db = initDB('cookies');
    const result = db.prepare('DELETE FROM cookies WHERE expires_at <= ?').run(Date.now());
    return result.changes;
  },

  getByUser(userId: string): CookieRecord[] {
    const db = initDB('cookies');
    const rows = db.prepare('SELECT * FROM cookies WHERE user_id = ? AND expires_at > ?').all(userId, Date.now()) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      deviceId: row.device_id,
      deviceName: row.device_name,
      platform: row.platform,
      userAgent: row.user_agent
    }));
  },

  count(): number {
    const db = initDB('cookies');
    const row = db.prepare('SELECT COUNT(*) as count FROM cookies WHERE expires_at > ?').get(Date.now()) as any;
    return row.count;
  }
};

// ============================================
// APPOINTMENTS DATABASE OPERATIONS
// ============================================

export interface AppointmentRecord {
  id: string;
  datasetId: string;
  residentName: string;
  address: string;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export const appointmentsDB = {
  getAll(): AppointmentRecord[] {
    const db = initDB('appointments');
    const rows = db.prepare('SELECT * FROM appointments ORDER BY appointment_date, appointment_time').all() as any[];
    return rows.map(row => ({
      id: row.id,
      datasetId: row.dataset_id,
      residentName: row.resident_name,
      address: row.address,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  },

  get(id: string): AppointmentRecord | null {
    const db = initDB('appointments');
    const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      datasetId: row.dataset_id,
      residentName: row.resident_name,
      address: row.address,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  },

  upsert(appointment: AppointmentRecord): void {
    const db = initDB('appointments');
    db.prepare(`
      INSERT OR REPLACE INTO appointments 
      (id, dataset_id, resident_name, address, appointment_date, appointment_time, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appointment.id,
      appointment.datasetId,
      appointment.residentName,
      appointment.address,
      appointment.appointmentDate,
      appointment.appointmentTime,
      appointment.notes || null,
      appointment.createdBy,
      appointment.createdAt
    );
  },

  delete(id: string): void {
    const db = initDB('appointments');
    db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  },

  getByUser(username: string): AppointmentRecord[] {
    const db = initDB('appointments');
    const rows = db.prepare('SELECT * FROM appointments WHERE created_by = ? ORDER BY appointment_date, appointment_time').all(username) as any[];
    return rows.map(row => ({
      id: row.id,
      datasetId: row.dataset_id,
      residentName: row.resident_name,
      address: row.address,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  },

  getUpcoming(username: string): AppointmentRecord[] {
    const db = initDB('appointments');
    const today = new Date().toISOString().split('T')[0];
    const rows = db.prepare(`
      SELECT * FROM appointments 
      WHERE created_by = ? AND appointment_date >= ?
      ORDER BY appointment_date, appointment_time
    `).all(username, today) as any[];
    return rows.map(row => ({
      id: row.id,
      datasetId: row.dataset_id,
      residentName: row.resident_name,
      address: row.address,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  }
};

// ============================================
// PAUSE LOCATIONS DATABASE OPERATIONS
// ============================================

export interface PauseLocationRecord {
  placeId: string;
  lat: number;
  lng: number;
  name: string;
  type: string;
  address?: string;
  createdAt: number;
}

export const pauseLocationsDB = {
  getAll(): PauseLocationRecord[] {
    const db = initDB('pauseLocations');
    const rows = db.prepare('SELECT * FROM pause_locations').all() as any[];
    return rows.map(row => ({
      placeId: row.place_id,
      lat: row.lat,
      lng: row.lng,
      name: row.name,
      type: row.type,
      address: row.address,
      createdAt: row.created_at
    }));
  },

  get(placeId: string): PauseLocationRecord | null {
    const db = initDB('pauseLocations');
    const row = db.prepare('SELECT * FROM pause_locations WHERE place_id = ?').get(placeId) as any;
    if (!row) return null;
    return {
      placeId: row.place_id,
      lat: row.lat,
      lng: row.lng,
      name: row.name,
      type: row.type,
      address: row.address,
      createdAt: row.created_at
    };
  },

  upsert(location: PauseLocationRecord): void {
    const db = initDB('pauseLocations');
    db.prepare(`
      INSERT OR REPLACE INTO pause_locations 
      (place_id, lat, lng, name, type, address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      location.placeId,
      location.lat,
      location.lng,
      location.name,
      location.type,
      location.address || null,
      location.createdAt
    );
  },

  upsertBatch(locations: PauseLocationRecord[]): number {
    if (locations.length === 0) return 0;

    const db = initDB('pauseLocations');
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO pause_locations
      (place_id, lat, lng, name, type, address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((locs: PauseLocationRecord[]) => {
      let count = 0;
      for (const loc of locs) {
        const result = stmt.run(loc.placeId, loc.lat, loc.lng, loc.name, loc.type, loc.address || null, loc.createdAt);
        count += result.changes;
      }
      return count;
    });

    const inserted = insertMany(locations);
    return inserted;
  },

  count(): number {
    const db = initDB('pauseLocations');
    const row = db.prepare('SELECT COUNT(*) as count FROM pause_locations').get() as any;
    return row.count;
  }
};

// ============================================
// AUTH LOGS DATABASE OPERATIONS
// ============================================

export interface AuthLogRecord {
  id?: number;
  timestamp: string;
  ipAddress: string;
  success: boolean;
  username?: string;
  userId?: string;
  reason?: string;
}

export const authLogsDB = {
  getAll(limit = 1000): AuthLogRecord[] {
    const db = initDB('authLogs');
    const rows = db.prepare('SELECT * FROM auth_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      success: Boolean(row.success),
      username: row.username,
      userId: row.user_id,
      reason: row.reason
    }));
  },

  insert(log: Omit<AuthLogRecord, 'id'>): void {
    const db = initDB('authLogs');
    db.prepare(`
      INSERT INTO auth_logs (timestamp, ip_address, success, username, user_id, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      log.timestamp,
      log.ipAddress,
      log.success ? 1 : 0,
      log.username || null,
      log.userId || null,
      log.reason || null
    );
  },

  insertBatch(logs: Omit<AuthLogRecord, 'id'>[]): number {
    if (logs.length === 0) return 0;

    const db = initDB('authLogs');
    const stmt = db.prepare(`
      INSERT INTO auth_logs (timestamp, ip_address, success, username, user_id, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: Omit<AuthLogRecord, 'id'>[]) => {
      let count = 0;
      for (const log of entries) {
        stmt.run(log.timestamp, log.ipAddress, log.success ? 1 : 0, log.username || null, log.userId || null, log.reason || null);
        count++;
      }
      return count;
    });

    const inserted = insertMany(logs);
    return inserted;
  },

  getByUser(username: string, limit = 100): AuthLogRecord[] {
    const db = initDB('authLogs');
    const rows = db.prepare('SELECT * FROM auth_logs WHERE username = ? ORDER BY timestamp DESC LIMIT ?').all(username, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      success: Boolean(row.success),
      username: row.username,
      userId: row.user_id,
      reason: row.reason
    }));
  },

  count(): number {
    const db = initDB('authLogs');
    const row = db.prepare('SELECT COUNT(*) as count FROM auth_logs').get() as any;
    return row.count;
  }
};

// ============================================
// CATEGORY CHANGES DATABASE OPERATIONS
// ============================================

export interface CategoryChangeRecord {
  id?: number;
  timestamp: string;
  datasetId: string;
  residentOriginalName?: string;
  residentCurrentName?: string;
  oldCategory?: string;
  newCategory?: string;
  changedBy: string;
  addressSnapshot?: string;
}

export const categoryChangesDB = {
  getAll(limit = 1000): CategoryChangeRecord[] {
    const db = initDB('categoryChanges');
    const rows = db.prepare('SELECT * FROM category_changes ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      datasetId: row.dataset_id,
      residentOriginalName: row.resident_original_name,
      residentCurrentName: row.resident_current_name,
      oldCategory: row.old_category,
      newCategory: row.new_category,
      changedBy: row.changed_by,
      addressSnapshot: row.address_snapshot
    }));
  },

  insert(change: Omit<CategoryChangeRecord, 'id'>): void {
    const db = initDB('categoryChanges');
    db.prepare(`
      INSERT INTO category_changes 
      (timestamp, dataset_id, resident_original_name, resident_current_name, old_category, new_category, changed_by, address_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      change.timestamp,
      change.datasetId,
      change.residentOriginalName || null,
      change.residentCurrentName || null,
      change.oldCategory || null,
      change.newCategory || null,
      change.changedBy,
      change.addressSnapshot || null
    );
  },

  insertBatch(changes: Omit<CategoryChangeRecord, 'id'>[]): number {
    if (changes.length === 0) return 0;

    const db = initDB('categoryChanges');
    const stmt = db.prepare(`
      INSERT INTO category_changes
      (timestamp, dataset_id, resident_original_name, resident_current_name, old_category, new_category, changed_by, address_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: Omit<CategoryChangeRecord, 'id'>[]) => {
      let count = 0;
      for (const change of entries) {
        stmt.run(
          change.timestamp,
          change.datasetId,
          change.residentOriginalName || null,
          change.residentCurrentName || null,
          change.oldCategory || null,
          change.newCategory || null,
          change.changedBy,
          change.addressSnapshot || null
        );
        count++;
      }
      return count;
    });

    const inserted = insertMany(changes);
    return inserted;
  },

  getByDataset(datasetId: string): CategoryChangeRecord[] {
    const db = initDB('categoryChanges');
    const rows = db.prepare('SELECT * FROM category_changes WHERE dataset_id = ? ORDER BY timestamp DESC').all(datasetId) as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      datasetId: row.dataset_id,
      residentOriginalName: row.resident_original_name,
      residentCurrentName: row.resident_current_name,
      oldCategory: row.old_category,
      newCategory: row.new_category,
      changedBy: row.changed_by,
      addressSnapshot: row.address_snapshot
    }));
  },

  count(): number {
    const db = initDB('categoryChanges');
    const row = db.prepare('SELECT COUNT(*) as count FROM category_changes').get() as any;
    return row.count;
  }
};

// ============================================
// GOOGLE DRIVE BACKUP OPERATIONS
// ============================================

async function getGoogleAuth() {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
  const credentials = JSON.parse(sheetsKey);
  
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
}

export const systemDriveBackup = {
  /**
   * Upload a single DB to Drive (with WAL checkpoint validation)
   */
  async uploadDB(name: DBName): Promise<boolean> {
    try {
      // CRITICAL: Close DB from cache first to ensure WAL is not actively written
      closeDB(name);

      // Checkpoint WAL - MUST succeed before upload
      const checkpointSuccess = checkpointDB(name);
      if (!checkpointSuccess) {
        console.error(`[SystemDrive] Cannot upload ${name}: WAL checkpoint failed`);
        return false;
      }

      const dbPath = getDBPath(name);
      if (!fs.existsSync(dbPath)) {
        console.log(`[SystemDrive] DB ${name} does not exist, skipping upload`);
        return false;
      }

      const auth = await getGoogleAuth();
      const drive = google.drive({ version: 'v3', auth });

      const fileName = DB_FILES[name];
      const fileContent = fs.readFileSync(dbPath);

      // Check if file already exists in Drive
      const existingFiles = await drive.files.list({
        q: `name='${fileName}' and '${SYSTEM_BACKUP_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      if (existingFiles.data.files && existingFiles.data.files.length > 0) {
        // Update existing file
        const fileId = existingFiles.data.files[0].id!;
        await drive.files.update({
          fileId,
          media: {
            mimeType: 'application/x-sqlite3',
            body: require('stream').Readable.from(fileContent)
          }
        });
        console.log(`[SystemDrive] Updated ${name} in Drive`);
      } else {
        // Create new file
        await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [SYSTEM_BACKUP_FOLDER_ID]
          },
          media: {
            mimeType: 'application/x-sqlite3',
            body: require('stream').Readable.from(fileContent)
          }
        });
        console.log(`[SystemDrive] Uploaded ${name} to Drive`);
      }

      return true;
    } catch (error) {
      console.error(`[SystemDrive] Error uploading ${name}:`, error);
      return false;
    }
  },

  /**
   * Download a DB from Drive
   */
  async downloadDB(name: DBName): Promise<boolean> {
    try {
      const auth = await getGoogleAuth();
      const drive = google.drive({ version: 'v3', auth });
      
      const fileName = DB_FILES[name];
      
      // Find file in Drive
      const files = await drive.files.list({
        q: `name='${fileName}' and '${SYSTEM_BACKUP_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      if (!files.data.files || files.data.files.length === 0) {
        console.log(`[SystemDrive] ${name} not found in Drive`);
        return false;
      }

      const fileId = files.data.files[0].id!;
      
      // Close DB before downloading
      closeDB(name);
      
      // Download file
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      ensureDirectories();
      const dbPath = getDBPath(name);
      fs.writeFileSync(dbPath, Buffer.from(response.data as ArrayBuffer));
      
      console.log(`[SystemDrive] Downloaded ${name} from Drive`);
      return true;
    } catch (error) {
      console.error(`[SystemDrive] Error downloading ${name}:`, error);
      return false;
    }
  },

  /**
   * Backup all system DBs to Drive
   */
  async backupAll(): Promise<{ success: string[]; failed: string[] }> {
    const results = { success: [] as string[], failed: [] as string[] };
    
    console.log('[SystemDrive] Starting backup of all system DBs...');
    
    for (const name of Object.keys(DB_FILES) as DBName[]) {
      const success = await this.uploadDB(name);
      if (success) {
        results.success.push(name);
      } else {
        results.failed.push(name);
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log(`[SystemDrive] Backup complete: ${results.success.length} success, ${results.failed.length} failed`);
    return results;
  },

  /**
   * Check if DB exists in Drive
   */
  async existsInDrive(name: DBName): Promise<boolean> {
    try {
      const auth = await getGoogleAuth();
      const drive = google.drive({ version: 'v3', auth });
      
      const fileName = DB_FILES[name];
      
      const files = await drive.files.list({
        q: `name='${fileName}' and '${SYSTEM_BACKUP_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id)'
      });

      return !!(files.data.files && files.data.files.length > 0);
    } catch (error) {
      console.error(`[SystemDrive] Error checking ${name}:`, error);
      return false;
    }
  }
};

// ============================================
// GOOGLE SHEETS SYNC OPERATIONS
// ============================================

const SHEET_NAMES = {
  cookies: 'Cookies',
  appointments: 'Termine',
  pauseLocations: 'PauseLocations',
  authLogs: 'AuthLogs',
  categoryChanges: 'CategoryChanges'
} as const;

export const systemSheetsSync = {
  /**
   * Sync Cookies: Local ↔ Sheets (with timestamp-based conflict resolution)
   */
  async syncCookies(): Promise<{ synced: number; direction: string }> {
    try {
      const auth = await getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      // Get from Sheets
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${SHEET_NAMES.cookies}!A2:J`
      });

      const sheetRows = response.data.values || [];
      const localCookies = cookiesDB.getAll();

      // Build maps for intelligent merging
      const sheetCookiesMap = new Map<string, any>();
      for (const row of sheetRows) {
        if (row.length >= 6) {
          sheetCookiesMap.set(row[0], {
            sessionId: row[0],
            userId: row[1],
            username: row[2],
            isAdmin: row[3] === 'true' || row[3] === '1',
            createdAt: parseInt(row[4]) || Date.now(),
            expiresAt: parseInt(row[5]) || Date.now(),
            deviceId: row[6] || undefined,
            deviceName: row[7] || undefined,
            platform: row[8] || undefined,
            userAgent: row[9] || undefined
          });
        }
      }

      const localCookiesMap = new Map<string, any>();
      for (const cookie of localCookies) {
        localCookiesMap.set(cookie.sessionId, cookie);
      }

      let synced = 0;
      let direction = 'none';

      // Sheets → Local (only if newer or missing)
      sheetCookiesMap.forEach((sheetCookie, sessionId) => {
        const localCookie = localCookiesMap.get(sessionId);

        if (!localCookie) {
          // Not in local → add from Sheets
          cookiesDB.upsert(sheetCookie);
          synced++;
          direction = 'sheets→local';
        } else {
          // Exists in both → use newer based on createdAt timestamp
          if (sheetCookie.createdAt > localCookie.createdAt) {
            cookiesDB.upsert(sheetCookie);
            synced++;
            direction = direction === 'local→sheets' ? 'bidirectional' : 'sheets→local';
          }
        }
      });

      // Local → Sheets (only if newer or missing)
      const sheetsNeedsUpdate: any[] = [];
      localCookiesMap.forEach((localCookie, sessionId) => {
        const sheetCookie = sheetCookiesMap.get(sessionId);

        if (!sheetCookie) {
          // Not in Sheets → add from local
          sheetsNeedsUpdate.push(localCookie);
        } else {
          // Exists in both → use newer based on createdAt timestamp
          if (localCookie.createdAt > sheetCookie.createdAt) {
            sheetsNeedsUpdate.push(localCookie);
          }
        }
      });

      if (sheetsNeedsUpdate.length > 0) {
        const newRows = sheetsNeedsUpdate.map(c => [
          c.sessionId,
          c.userId,
          c.username,
          c.isAdmin ? '1' : '0',
          c.createdAt.toString(),
          c.expiresAt.toString(),
          c.deviceId || '',
          c.deviceName || '',
          c.platform || '',
          c.userAgent || ''
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId: SYSTEM_SHEET_ID,
          range: `${SHEET_NAMES.cookies}!A:J`,
          valueInputOption: 'RAW',
          requestBody: { values: newRows }
        });

        synced += sheetsNeedsUpdate.length;
        direction = direction === 'sheets→local' ? 'bidirectional' : 'local→sheets';
      }

      return { synced, direction };
    } catch (error) {
      console.error('[SystemSync] Error syncing cookies:', error);
      return { synced: 0, direction: 'error' };
    }
  },

  /**
   * Sync Appointments: Local ↔ Sheets (with timestamp-based conflict resolution)
   */
  async syncAppointments(): Promise<{ synced: number; direction: string }> {
    try {
      const auth = await getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${SHEET_NAMES.appointments}!A2:I`
      });

      const sheetRows = response.data.values || [];
      const localAppointments = appointmentsDB.getAll();

      // Build maps for intelligent merging
      const sheetAppointmentsMap = new Map<string, any>();
      for (const row of sheetRows) {
        if (row.length >= 9) {
          sheetAppointmentsMap.set(row[0], {
            id: row[0],
            datasetId: row[1],
            residentName: row[2],
            address: row[3],
            appointmentDate: row[4],
            appointmentTime: row[5],
            notes: row[6] || undefined,
            createdBy: row[7],
            createdAt: row[8]
          });
        }
      }

      const localAppointmentsMap = new Map<string, any>();
      for (const appointment of localAppointments) {
        localAppointmentsMap.set(appointment.id, appointment);
      }

      let synced = 0;
      let direction = 'none';

      // Sheets → Local (only if newer or missing)
      sheetAppointmentsMap.forEach((sheetAppt, id) => {
        const localAppt = localAppointmentsMap.get(id);

        if (!localAppt) {
          // Not in local → add from Sheets
          appointmentsDB.upsert(sheetAppt);
          synced++;
          direction = 'sheets→local';
        } else {
          // Exists in both → use newer based on createdAt timestamp
          if (sheetAppt.createdAt > localAppt.createdAt) {
            appointmentsDB.upsert(sheetAppt);
            synced++;
            direction = direction === 'local→sheets' ? 'bidirectional' : 'sheets→local';
          }
        }
      });

      // Local → Sheets (only if newer or missing)
      const sheetsNeedsUpdate: any[] = [];
      localAppointmentsMap.forEach((localAppt, id) => {
        const sheetAppt = sheetAppointmentsMap.get(id);

        if (!sheetAppt) {
          // Not in Sheets → add from local
          sheetsNeedsUpdate.push(localAppt);
        } else {
          // Exists in both → use newer based on createdAt timestamp
          if (localAppt.createdAt > sheetAppt.createdAt) {
            sheetsNeedsUpdate.push(localAppt);
          }
        }
      });

      if (sheetsNeedsUpdate.length > 0) {
        const newRows = sheetsNeedsUpdate.map(a => [
          a.id,
          a.datasetId,
          a.residentName,
          a.address,
          a.appointmentDate,
          a.appointmentTime,
          a.notes || '',
          a.createdBy,
          a.createdAt
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId: SYSTEM_SHEET_ID,
          range: `${SHEET_NAMES.appointments}!A:I`,
          valueInputOption: 'RAW',
          requestBody: { values: newRows }
        });

        synced += sheetsNeedsUpdate.length;
        direction = direction === 'sheets→local' ? 'bidirectional' : 'local→sheets';
      }

      return { synced, direction };
    } catch (error) {
      console.error('[SystemSync] Error syncing appointments:', error);
      return { synced: 0, direction: 'error' };
    }
  },

  /**
   * Sync PauseLocations: Local ↔ Sheets
   */
  async syncPauseLocations(): Promise<{ synced: number; direction: string }> {
    try {
      const auth = await getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${SHEET_NAMES.pauseLocations}!A2:G`
      });
      
      const sheetRows = response.data.values || [];
      const localLocations = pauseLocationsDB.getAll();

      // Column F contains place_id
      const sheetIds = new Set(sheetRows.map(r => r[5]));
      const localIds = new Set(localLocations.map(l => l.placeId));
      
      let synced = 0;
      let direction = 'none';
      
      // Sheets → Local
      // IMPORTANT: Sheet columns are: lat, lng, name, type, address, placeId, createdAt
      for (const row of sheetRows) {
        const placeId = row[5]; // Column F
        if (!localIds.has(placeId)) {
          pauseLocationsDB.upsert({
            placeId: placeId,
            lat: parseFloat(row[0]) || 0,  // Column A
            lng: parseFloat(row[1]) || 0,  // Column B
            name: row[2],                   // Column C
            type: row[3],                   // Column D
            address: row[4] || undefined,   // Column E
            createdAt: parseInt(row[6]) || Date.now()  // Column G
          });
          synced++;
          direction = 'sheets→local';
        }
      }

      // Local → Sheets
      // Match the column order from pauseLocationCache.ts: lat, lng, name, type, address, placeId, createdAt
      const missingInSheets = localLocations.filter(l => !sheetIds.has(l.placeId));
      if (missingInSheets.length > 0) {
        const newRows = missingInSheets.map(l => [
          l.lat.toString(),         // Column A
          l.lng.toString(),         // Column B
          l.name,                   // Column C
          l.type,                   // Column D
          l.address || '',          // Column E
          l.placeId,                // Column F
          l.createdAt.toString()    // Column G
        ]);
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: SYSTEM_SHEET_ID,
          range: `${SHEET_NAMES.pauseLocations}!A:G`,
          valueInputOption: 'RAW',
          requestBody: { values: newRows }
        });
        
        synced += missingInSheets.length;
        direction = direction === 'sheets→local' ? 'bidirectional' : 'local→sheets';
      }
      
      return { synced, direction };
    } catch (error) {
      console.error('[SystemSync] Error syncing pause locations:', error);
      return { synced: 0, direction: 'error' };
    }
  },

  /**
   * Sync AuthLogs: Local → Sheets (nur Upload, kein Download - Logs sind append-only)
   */
  async syncAuthLogs(): Promise<{ synced: number; direction: string }> {
    try {
      const auth = await getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get latest timestamp from Sheets to avoid duplicates
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${SHEET_NAMES.authLogs}!A2:A`
      });
      
      const sheetTimestamps = new Set((response.data.values || []).map(r => r[0]));
      const localLogs = authLogsDB.getAll(500); // Last 500
      
      // Only upload logs not in Sheets
      const missingInSheets = localLogs.filter(l => !sheetTimestamps.has(l.timestamp));
      
      if (missingInSheets.length > 0) {
        const newRows = missingInSheets.map(l => [
          l.timestamp,
          l.ipAddress,
          l.success ? '1' : '0',
          l.username || '',
          l.userId || '',
          l.reason || ''
        ]);
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: SYSTEM_SHEET_ID,
          range: `${SHEET_NAMES.authLogs}!A:F`,
          valueInputOption: 'RAW',
          requestBody: { values: newRows }
        });
        
        return { synced: missingInSheets.length, direction: 'local→sheets' };
      }
      
      return { synced: 0, direction: 'none' };
    } catch (error) {
      console.error('[SystemSync] Error syncing auth logs:', error);
      return { synced: 0, direction: 'error' };
    }
  },

  /**
   * Sync CategoryChanges: Local → Sheets (nur Upload, kein Download - Changes sind append-only)
   */
  async syncCategoryChanges(): Promise<{ synced: number; direction: string }> {
    try {
      const auth = await getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get latest timestamp from Sheets
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${SHEET_NAMES.categoryChanges}!A2:A`
      });
      
      const sheetTimestamps = new Set((response.data.values || []).map(r => r[0]));
      const localChanges = categoryChangesDB.getAll(500);
      
      const missingInSheets = localChanges.filter(c => !sheetTimestamps.has(c.timestamp));
      
      if (missingInSheets.length > 0) {
        const newRows = missingInSheets.map(c => [
          c.timestamp,
          c.datasetId,
          c.residentOriginalName || '',
          c.residentCurrentName || '',
          c.oldCategory || '',
          c.newCategory || '',
          c.changedBy,
          c.addressSnapshot || ''
        ]);
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: SYSTEM_SHEET_ID,
          range: `${SHEET_NAMES.categoryChanges}!A:H`,
          valueInputOption: 'RAW',
          requestBody: { values: newRows }
        });
        
        return { synced: missingInSheets.length, direction: 'local→sheets' };
      }
      
      return { synced: 0, direction: 'none' };
    } catch (error) {
      console.error('[SystemSync] Error syncing category changes:', error);
      return { synced: 0, direction: 'error' };
    }
  },

  /**
   * Full sync all system databases (with rate limit protection)
   */
  async syncAll(): Promise<Record<string, { synced: number; direction: string }>> {
    console.log('[SystemSync] Starting full system database sync...');

    const results: Record<string, { synced: number; direction: string }> = {};

    try {
      // Import rate limit manager
      const { googleSheetsRateLimitManager } = await import('./googleSheetsRateLimitManager');

      // Check global rate limit before starting
      if (googleSheetsRateLimitManager.isRateLimited()) {
        const remaining = googleSheetsRateLimitManager.getRemainingCooldownSeconds();
        console.warn(`[SystemSync] Rate limited, skipping sync (${remaining}s remaining)`);
        return results;
      }

      results.cookies = await this.syncCookies();
      await new Promise(r => setTimeout(r, 1000));

      if (googleSheetsRateLimitManager.isRateLimited()) {
        console.warn('[SystemSync] Rate limit hit after cookies sync, aborting remaining syncs');
        return results;
      }

      results.appointments = await this.syncAppointments();
      await new Promise(r => setTimeout(r, 1000));

      if (googleSheetsRateLimitManager.isRateLimited()) {
        console.warn('[SystemSync] Rate limit hit after appointments sync, aborting remaining syncs');
        return results;
      }

      results.pauseLocations = await this.syncPauseLocations();
      await new Promise(r => setTimeout(r, 1000));

      if (googleSheetsRateLimitManager.isRateLimited()) {
        console.warn('[SystemSync] Rate limit hit after pauseLocations sync, aborting remaining syncs');
        return results;
      }

      results.authLogs = await this.syncAuthLogs();
      await new Promise(r => setTimeout(r, 1000));

      if (googleSheetsRateLimitManager.isRateLimited()) {
        console.warn('[SystemSync] Rate limit hit after authLogs sync, aborting remaining syncs');
        return results;
      }

      results.categoryChanges = await this.syncCategoryChanges();

      console.log('[SystemSync] Sync complete:', results);
      return results;
    } catch (error: any) {
      // Check if it's a rate limit error
      const { googleSheetsRateLimitManager } = await import('./googleSheetsRateLimitManager');
      if (googleSheetsRateLimitManager.isRateLimitError(error)) {
        googleSheetsRateLimitManager.triggerRateLimit();
        console.warn('[SystemSync] Rate limit error (429), aborting sync');
      } else {
        console.error('[SystemSync] Error during sync:', error);
      }
      return results;
    }
  }
};

// ============================================
// STARTUP SYNC SERVICE
// ============================================

export const systemStartupSync = {
  /**
   * Vollständiger Startup-Sync für alle System-DBs
   * 
   * Reihenfolge:
   * 1. Lokale DBs prüfen/initialisieren
   * 2. Drive-Backups herunterladen (falls lokal fehlt)
   * 3. Bidirektionaler Sheets-Sync
   */
  async performStartupSync(): Promise<{
    driveDownloads: string[];
    sheetsSynced: Record<string, { synced: number; direction: string }>;
    errors: string[];
  }> {
    console.log('\n========================================');
    console.log('🔄 SYSTEM DB STARTUP SYNC');
    console.log('========================================\n');
    
    const results = {
      driveDownloads: [] as string[],
      sheetsSynced: {} as Record<string, { synced: number; direction: string }>,
      errors: [] as string[]
    };
    
    const startTime = Date.now();
    
    try {
      ensureDirectories();
      
      // Phase 1: Check/download from Drive
      console.log('[SystemSync] Phase 1: Checking Drive backups...');
      
      for (const name of Object.keys(DB_FILES) as DBName[]) {
        const localPath = getDBPath(name);
        const localExists = fs.existsSync(localPath);
        
        if (!localExists) {
          console.log(`[SystemSync]   ${name}: Local missing, checking Drive...`);
          const driveExists = await systemDriveBackup.existsInDrive(name);
          
          if (driveExists) {
            const downloaded = await systemDriveBackup.downloadDB(name);
            if (downloaded) {
              results.driveDownloads.push(name);
              console.log(`[SystemSync]   ${name}: ✅ Downloaded from Drive`);
            } else {
              results.errors.push(`Failed to download ${name} from Drive`);
            }
          } else {
            console.log(`[SystemSync]   ${name}: Not in Drive, initializing new...`);
            try {
              initDB(name); // Create new DB with schema
              console.log(`[SystemSync]   ${name}: ✅ Initialized new database`);
            } catch (error) {
              const errorMsg = `Failed to initialize new database ${name}: ${error}`;
              console.error(`[SystemSync]   ${errorMsg}`);
              results.errors.push(errorMsg);
            }
          }
        } else {
          console.log(`[SystemSync]   ${name}: ✓ Local exists`);
        }
        
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Phase 2: Bidirectional Sheets sync
      console.log('\n[SystemSync] Phase 2: Bidirectional Sheets sync...');
      results.sheetsSynced = await systemSheetsSync.syncAll();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log('\n========================================');
      console.log('✅ SYSTEM DB SYNC COMPLETED');
      console.log(`⏱️  Duration: ${duration}s`);
      console.log('========================================\n');
      
      // Log summary
      console.log('📊 System DB Sync Summary:');
      console.log(`   Drive downloads: ${results.driveDownloads.length}`);
      for (const [name, result] of Object.entries(results.sheetsSynced)) {
        console.log(`   ${name}: ${result.synced} synced (${result.direction})`);
      }
      if (results.errors.length > 0) {
        console.log(`   Errors: ${results.errors.length}`);
        results.errors.forEach(e => console.log(`     - ${e}`));
      }
      
      return results;
    } catch (error) {
      console.error('[SystemSync] Critical error during startup sync:', error);
      results.errors.push(`Critical error: ${error}`);
      return results;
    }
  }
};

// ============================================
// EXPORT UTILITIES
// ============================================

export const systemDB = {
  getDBPath,
  getFileChecksum,
  checkpointDB,
  closeDB,
  ensureDirectories,
  
  SYSTEM_SHEET_ID,
  SYSTEM_BACKUP_FOLDER_ID,
  DB_FILES,
  SHEET_NAMES,
  
  // Get all DB names
  getAllDBNames(): DBName[] {
    return Object.keys(DB_FILES) as DBName[];
  },

  // Checkpoint all DBs (vor Backup)
  // Returns true if all checkpoints succeeded
  checkpointAll(): boolean {
    let allSuccess = true;
    for (const name of this.getAllDBNames()) {
      if (fs.existsSync(getDBPath(name))) {
        const success = checkpointDB(name);
        if (!success) {
          console.error(`[SystemDB] Failed to checkpoint ${name}`);
          allSuccess = false;
        }
      }
    }
    return allSuccess;
  },

  // Close all DBs
  closeAll(): void {
    for (const name of this.getAllDBNames()) {
      closeDB(name);
    }
  }
};
