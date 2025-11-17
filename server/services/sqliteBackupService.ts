/**
 * SQLite Backup Service für Google Drive
 *
 * Verwaltet Upload/Download von täglichen SQLite-DBs zu/von Google Drive
 * - Komprimiert DBs vor Upload (gzip)
 * - Checksums für Integrität
 * - Atomic Downloads mit temp files
 * - Rate-Limit-Awareness
 */

import { google, drive_v3 } from 'googleapis';
import fs from 'fs';
import { promisify } from 'util';
import { Readable } from 'stream';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { getDBPath, getCETDate, checkDBIntegrity } from './sqliteLogService';
import { pushoverService } from './pushover';
import { getBerlinTimestamp } from '../utils/timezone';

const fsp = {
  access: promisify(fs.access),
  unlink: promisify(fs.unlink),
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  rename: promisify(fs.rename),
  stat: promisify(fs.stat),
  mkdir: promisify(fs.mkdir)
};

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Google Drive Folder für Log-Backups
const LOG_BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_LOG_FOLDER_ID || '';

class SQLiteBackupService {
  private driveClient: drive_v3.Drive | null = null;
  private initialized = false;
  private uploadQueue: Set<string> = new Set(); // Dates to upload
  private downloadCache = new Map<string, string>(); // date -> local path

  async initialize(): Promise<void> {
    try {
      const driveClient = await this.createDriveClient();
      if (!driveClient) {
        console.warn('[SQLiteBackup] Drive credentials missing – backup disabled');
        // No Pushover notification - this is expected during initial setup
        return;
      }

      this.driveClient = driveClient;
      this.initialized = true;

      // Ensure backup folder exists
      await this.ensureBackupFolder();

      console.log('[SQLiteBackup] ✅ Initialized successfully');
    } catch (error) {
      console.error('[SQLiteBackup] ❌ Error initializing:', error);
      // Only send Pushover on unexpected initialization errors
      await pushoverService.sendNotification(
        `Failed to initialize SQLite Backup: ${error}`,
        { title: 'SQLiteBackup Init Error', priority: 2 }
      );
    }
  }

  private async createDriveClient(): Promise<drive_v3.Drive | null> {
    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    if (!sheetsKey) {
      console.error('[SQLiteBackup] GOOGLE_SHEETS_KEY not set');
      return null;
    }

    try {
      const credentials = JSON.parse(sheetsKey);

      if (!credentials.client_email || !credentials.private_key) {
        console.error('[SQLiteBackup] Invalid credentials format');
        return null;
      }

      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file'
        ]
      });

      return google.drive({ version: 'v3', auth });
    } catch (error) {
      console.error('[SQLiteBackup] Error parsing credentials:', error);
      return null;
    }
  }

  private async ensureBackupFolder(): Promise<void> {
    if (!this.driveClient) return;

    try {
      // Check if folder exists
      if (LOG_BACKUP_FOLDER_ID) {
        const response = await this.driveClient.files.get({
          fileId: LOG_BACKUP_FOLDER_ID,
          fields: 'id, name'
        });

        console.log(`[SQLiteBackup] Using backup folder: ${response.data.name}`);
        return;
      }

      // Create folder if no ID provided
      console.warn('[SQLiteBackup] GOOGLE_DRIVE_LOG_FOLDER_ID not set, creating new folder...');

      const folderMetadata = {
        name: 'EnergyScanCapture-Logs',
        mimeType: 'application/vnd.google-apps.folder'
      };

      const folder = await this.driveClient.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      console.log(`[SQLiteBackup] Created backup folder with ID: ${folder.data.id}`);
      console.log('⚠️  Add this to .env: GOOGLE_DRIVE_LOG_FOLDER_ID=' + folder.data.id);
    } catch (error) {
      console.error('[SQLiteBackup] Error ensuring backup folder:', error);
    }
  }

  /**
   * Upload DB zu Google Drive (komprimiert)
   */
  async uploadDB(date: string): Promise<boolean> {
    if (!this.driveClient) {
      console.warn('[SQLiteBackup] Upload skipped – Drive not initialized');
      return false;
    }

    try {
      const dbPath = getDBPath(date);

      // Check if DB exists
      try {
        await fsp.access(dbPath, fs.constants.F_OK);
      } catch {
        console.warn(`[SQLiteBackup] DB not found for upload: ${date}`);
        return false;
      }

      // Integrity check
      if (!checkDBIntegrity(date)) {
        console.error(`[SQLiteBackup] ❌ DB ${date} failed integrity check, aborting upload`);
        await pushoverService.sendNotification(
          `DB ${date} is corrupted, not uploading to Drive`,
          { title: 'SQLite Integrity Error', priority: 2 }
        );
        return false;
      }

      console.log(`[SQLiteBackup] Uploading ${date}...`);

      // Read and compress
      const dbBuffer = await fsp.readFile(dbPath);
      
      // Skip upload if DB is too small (likely empty or near-empty)
      const MIN_DB_SIZE = 8192; // 8 KB minimum (SQLite header + minimal data)
      if (dbBuffer.length < MIN_DB_SIZE) {
        console.log(`[SQLiteBackup] Skipping upload of ${date} - too small (${dbBuffer.length} bytes, likely empty)`);
        return true; // Return true to avoid error handling
      }

      const compressed = await gzip(dbBuffer);

      // Calculate checksum (before compression)
      const checksum = crypto.createHash('sha256').update(dbBuffer).digest('hex');

      const filename = `logs-${date}.db.gz`;
      const metadataFilename = `logs-${date}.meta.json`;

      // Check if file exists in Drive
      const existing = await this.findFileInDrive(filename);

      // Upload compressed DB (convert Buffer to Stream)
      const compressedStream = Readable.from(compressed);

      if (existing) {
        await this.driveClient.files.update({
          fileId: existing.id!,
          media: {
            mimeType: 'application/gzip',
            body: compressedStream
          }
        });
        console.log(`[SQLiteBackup] Updated ${filename} in Drive`);
      } else {
        if (!LOG_BACKUP_FOLDER_ID) {
          console.error('[SQLiteBackup] Cannot upload without folder ID');
          return false;
        }

        await this.driveClient.files.create({
          requestBody: {
            name: filename,
            parents: [LOG_BACKUP_FOLDER_ID],
            mimeType: 'application/gzip'
          },
          media: {
            mimeType: 'application/gzip',
            body: compressedStream
          },
          supportsAllDrives: true
        });
        console.log(`[SQLiteBackup] Created ${filename} in Drive`);
      }

      // Upload metadata (checksum, size, timestamp)
      const metadata = {
        date,
        checksum,
        originalSize: dbBuffer.length,
        compressedSize: compressed.length,
        uploadedAt: getBerlinTimestamp()
      };

      const existingMeta = await this.findFileInDrive(metadataFilename);
      const metadataStream = Readable.from(JSON.stringify(metadata, null, 2));

      if (existingMeta) {
        await this.driveClient.files.update({
          fileId: existingMeta.id!,
          media: {
            mimeType: 'application/json',
            body: metadataStream
          }
        });
      } else {
        if (!LOG_BACKUP_FOLDER_ID) return false;

        await this.driveClient.files.create({
          requestBody: {
            name: metadataFilename,
            parents: [LOG_BACKUP_FOLDER_ID],
            mimeType: 'application/json'
          },
          media: {
            mimeType: 'application/json',
            body: metadataStream
          },
          supportsAllDrives: true
        });
      }

      console.log(`[SQLiteBackup] ✅ Uploaded ${date} (${(compressed.length / 1024).toFixed(2)} KB)`);
      return true;
    } catch (error) {
      console.error(`[SQLiteBackup] ❌ Error uploading ${date}:`, error);
      await pushoverService.sendNotification(
        `Failed to upload ${date}: ${error}`,
        { title: 'SQLite Upload Error', priority: 1 }
      );
      return false;
    }
  }

  /**
   * Download DB von Google Drive
   */
  async downloadDB(date: string, targetPath?: string): Promise<string | null> {
    if (!this.driveClient) {
      console.error('[SQLiteBackup] Download skipped – Drive not initialized');
      console.error('[SQLiteBackup] Make sure GOOGLE_SHEETS_KEY and GOOGLE_DRIVE_LOG_FOLDER_ID are set');
      console.error('[SQLiteBackup] initialized:', this.initialized);
      return null;
    }

    try {
      console.log(`[SQLiteBackup] Downloading ${date}...`);

      const filename = `logs-${date}.db.gz`;
      const metadataFilename = `logs-${date}.meta.json`;

      // Find files in Drive
      const dbFile = await this.findFileInDrive(filename);
      const metaFile = await this.findFileInDrive(metadataFilename);

      if (!dbFile?.id) {
        console.warn(`[SQLiteBackup] DB not found in Drive: ${date}`);
        return null;
      }

      // Download metadata first
      let expectedChecksum: string | null = null;
      if (metaFile?.id) {
        const metaResponse = await this.driveClient.files.get(
          { fileId: metaFile.id, alt: 'media' },
          { responseType: 'json' }
        );

        const metadata = metaResponse.data as any;
        expectedChecksum = metadata.checksum;
        console.log(`[SQLiteBackup] Metadata loaded, expected checksum: ${expectedChecksum?.substring(0, 8)}...`);
      }

      // Download compressed DB
      const response = await this.driveClient.files.get(
        { fileId: dbFile.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const compressedBuffer = Buffer.from(response.data as ArrayBuffer);

      // Decompress
      const decompressed = await gunzip(compressedBuffer);

      // Verify checksum
      if (expectedChecksum) {
        const actualChecksum = crypto.createHash('sha256').update(decompressed).digest('hex');

        if (actualChecksum !== expectedChecksum) {
          console.error(`[SQLiteBackup] ❌ Checksum mismatch for ${date}!`);
          console.error(`  Expected: ${expectedChecksum}`);
          console.error(`  Actual:   ${actualChecksum}`);

          await pushoverService.sendNotification(
            `Checksum mismatch for ${date}. DB may be corrupted!`,
            { title: 'SQLite Download Error', priority: 2 }
          );

          return null;
        }

        console.log(`[SQLiteBackup] ✅ Checksum verified for ${date}`);
      }

      // Write to temp file first (atomic)
      const finalPath = targetPath || getDBPath(date);
      const tempPath = finalPath + '.tmp';

      await fsp.writeFile(tempPath, decompressed);

      // Verify integrity before renaming
      const tempDbPath = tempPath;
      // Quick integrity check (we can't use checkDBIntegrity as it expects final path)
      // Just check if file is valid SQLite
      try {
        const Database = (await import('better-sqlite3')).default;
        const testDb = new Database(tempPath, { readonly: true });
        
        // Run comprehensive integrity check
        const integrityResult = testDb.pragma('integrity_check');
        testDb.close();

        if (integrityResult.length !== 1 || integrityResult[0].integrity_check !== 'ok') {
          throw new Error(`Integrity check failed: ${JSON.stringify(integrityResult)}`);
        }

        console.log(`[SQLiteBackup] ✅ Integrity check passed for ${date}`);
      } catch (error) {
        await fsp.unlink(tempPath);
        console.error(`[SQLiteBackup] ❌ Downloaded DB failed integrity check: ${date}`, error);
        
        // Try to repair by re-downloading
        console.log(`[SQLiteBackup] 🔄 Attempting to delete corrupted file from Drive for ${date}`);
        const dbFile = await this.findFileInDrive(filename);
        if (dbFile?.id) {
          console.warn(`[SQLiteBackup] ⚠️  Corrupted file found in Drive: ${filename} (${dbFile.id})`);
          console.warn(`[SQLiteBackup] ⚠️  Consider manually re-uploading ${date} from a backup`);
        }
        
        await pushoverService.sendNotification(
          `Downloaded DB ${date} is corrupted. Please re-upload from local backup.`,
          { title: 'SQLite Download Error', priority: 2 }
        );
        return null;
      }

      // Atomic rename
      await fsp.rename(tempPath, finalPath);

      console.log(`[SQLiteBackup] ✅ Downloaded ${date} (${(decompressed.length / 1024).toFixed(2)} KB)`);

      return finalPath;
    } catch (error) {
      console.error(`[SQLiteBackup] ❌ Error downloading ${date}:`, error);
      return null;
    }
  }

  /**
   * Prüft ob DB in Drive existiert
   */
  async existsInDrive(date: string): Promise<boolean> {
    if (!this.driveClient) return false;

    const filename = `logs-${date}.db.gz`;
    const file = await this.findFileInDrive(filename);
    return !!file;
  }

  /**
   * Vergleicht lokale DB mit Drive (via Checksum)
   */
  async compareWithDrive(date: string): Promise<{
    inSync: boolean;
    localChecksum: string | null;
    driveChecksum: string | null;
    action: 'upload' | 'download' | 'none' | 'conflict';
  }> {
    if (!this.driveClient) {
      return { inSync: false, localChecksum: null, driveChecksum: null, action: 'none' };
    }

    try {
      const dbPath = getDBPath(date);
      let localChecksum: string | null = null;

      // Get local checksum
      try {
        const localBuffer = await fsp.readFile(dbPath);
        localChecksum = crypto.createHash('sha256').update(localBuffer).digest('hex');
      } catch {
        // Local file doesn't exist
      }

      // Get Drive checksum
      const metadataFilename = `logs-${date}.meta.json`;
      const metaFile = await this.findFileInDrive(metadataFilename);

      let driveChecksum: string | null = null;

      if (metaFile?.id) {
        const response = await this.driveClient.files.get(
          { fileId: metaFile.id, alt: 'media' },
          { responseType: 'json' }
        );

        driveChecksum = (response.data as any).checksum || null;
      }

      // Determine action
      let action: 'upload' | 'download' | 'none' | 'conflict' = 'none';

      if (localChecksum && driveChecksum) {
        if (localChecksum === driveChecksum) {
          action = 'none'; // in sync
        } else {
          action = 'conflict'; // different versions
        }
      } else if (localChecksum && !driveChecksum) {
        action = 'upload';
      } else if (!localChecksum && driveChecksum) {
        action = 'download';
      }

      return {
        inSync: action === 'none',
        localChecksum,
        driveChecksum,
        action
      };
    } catch (error) {
      console.error(`[SQLiteBackup] Error comparing ${date}:`, error);
      return { inSync: false, localChecksum: null, driveChecksum: null, action: 'none' };
    }
  }

  /**
   * Batch-Upload mehrerer DBs
   */
  async uploadBatch(dates: string[]): Promise<number> {
    if (dates.length === 0) return 0;

    console.log(`[SQLiteBackup] Batch uploading ${dates.length} DBs...`);

    let successful = 0;

    for (const date of dates) {
      const success = await this.uploadDB(date);
      if (success) successful++;

      // Rate limiting: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[SQLiteBackup] ✅ Batch upload: ${successful}/${dates.length} successful`);

    return successful;
  }

  /**
   * Hilfsfunktion: Finde Datei in Drive
   */
  private async findFileInDrive(name: string): Promise<drive_v3.Schema$File | null> {
    if (!this.driveClient || !LOG_BACKUP_FOLDER_ID) return null;

    try {
      const response = await this.driveClient.files.list({
        q: `name='${name}' and '${LOG_BACKUP_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name, modifiedTime, size)',
        spaces: 'drive',
        supportsAllDrives: true
      });

      const files = response.data.files;
      return files && files.length > 0 ? files[0] : null;
    } catch (error) {
      console.error('[SQLiteBackup] Error finding file:', error);
      return null;
    }
  }

  /**
   * Liste alle verfügbaren Backups in Drive
   */
  async listBackups(): Promise<string[]> {
    if (!this.driveClient || !LOG_BACKUP_FOLDER_ID) return [];

    try {
      const response = await this.driveClient.files.list({
        q: `'${LOG_BACKUP_FOLDER_ID}' in parents and name contains 'logs-' and name contains '.db.gz' and trashed=false`,
        fields: 'files(name)',
        orderBy: 'name desc',
        pageSize: 1000
      });

      const files = response.data.files || [];

      // Extract dates from filenames
      const dates = files
        .map(file => {
          const match = file.name?.match(/logs-(\d{4}-\d{2}-\d{2})\.db\.gz/);
          return match ? match[1] : null;
        })
        .filter(Boolean) as string[];

      console.log(`[SQLiteBackup] Found ${dates.length} backups in Drive`);

      return dates;
    } catch (error) {
      console.error('[SQLiteBackup] Error listing backups:', error);
      return [];
    }
  }

  isReady(): boolean {
    return this.initialized && !!this.driveClient;
  }
}

export const sqliteBackupService = new SQLiteBackupService();
