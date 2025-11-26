/**
 * EGON Scraper Service
 * 
 * Scrapes order data from EGON portal and stores it in:
 * 1. SQLite (primary storage)
 * 2. Google Sheets (backup - SYSTEM_SHEET_ID)
 * 3. Google Drive (midnight backup)
 * 
 * Runs hourly via cron job.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { google } from './googleApiWrapper';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = 'https://egon9118.eg-on.com';
const USERNAME = 'Damian';
const PASSWORD = '2ecryryza';
const CUTOFF_DATE = '25.11.2025'; // Orders older than this are ignored

// Google Sheets/Drive IDs
const SYSTEM_SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';
const DRIVE_BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || '1Vhe5gnGCr8s_9xeXq71RHp5ucfhAPjxu';
const WORKSHEET_NAME = 'EGON_Orders';

// Database path
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'system-dbs')
  : path.join(process.cwd(), 'data', 'system-dbs');

const DB_PATH = path.join(DATA_DIR, 'egon_orders.db');
const DB_FILENAME = 'egon_orders.db';

// =============================================================================
// Database Setup
// =============================================================================

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS egon_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_name TEXT NOT NULL,
    timestamp TEXT NOT NULL UNIQUE,
    order_no TEXT,
    contract_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    synced_to_sheets INTEGER DEFAULT 0
  )
`);

// Create index for faster lookups
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_egon_orders_timestamp ON egon_orders(timestamp)
`);

// =============================================================================
// Database Operations
// =============================================================================

export const egonOrdersDB = {
  insert: (order: { reseller_name: string; timestamp: string; order_no?: string; contract_date?: string }) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO egon_orders (reseller_name, timestamp, order_no, contract_date)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(order.reseller_name, order.timestamp, order.order_no || null, order.contract_date || null);
  },

  insertBatch: (orders: Array<{ reseller_name: string; timestamp: string; order_no?: string; contract_date?: string }>) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO egon_orders (reseller_name, timestamp, order_no, contract_date)
      VALUES (?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items: typeof orders) => {
      let inserted = 0;
      for (const item of items) {
        const result = stmt.run(item.reseller_name, item.timestamp, item.order_no || null, item.contract_date || null);
        if (result.changes > 0) inserted++;
      }
      return inserted;
    });
    return insertMany(orders);
  },

  getAll: () => {
    return db.prepare('SELECT * FROM egon_orders ORDER BY id DESC').all() as Array<{
      id: number;
      reseller_name: string;
      timestamp: string;
      order_no: string | null;
      contract_date: string | null;
      created_at: string;
      synced_to_sheets: number;
    }>;
  },

  getUnsynced: () => {
    return db.prepare('SELECT * FROM egon_orders WHERE synced_to_sheets = 0 ORDER BY id').all() as Array<{
      id: number;
      reseller_name: string;
      timestamp: string;
      order_no: string | null;
      contract_date: string | null;
      created_at: string;
    }>;
  },

  markAsSynced: (ids: number[]) => {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE egon_orders SET synced_to_sheets = 1 WHERE id IN (${placeholders})`).run(...ids);
  },

  existsTimestamp: (timestamp: string): boolean => {
    const result = db.prepare('SELECT 1 FROM egon_orders WHERE timestamp = ?').get(timestamp);
    return !!result;
  },

  count: (): number => {
    const result = db.prepare('SELECT COUNT(*) as count FROM egon_orders').get() as { count: number };
    return result.count;
  },

  checkpoint: () => {
    db.pragma('wal_checkpoint(TRUNCATE)');
  },

  close: () => {
    db.close();
  }
};

// =============================================================================
// EGON Scraper Class
// =============================================================================

interface EgonSession {
  cookies: Map<string, string>;
}

class EgonScraper {
  private session: EgonSession = { cookies: new Map() };

  private async fetchWithCookies(url: string, options: RequestInit = {}): Promise<Response> {
    const cookieHeader = Array.from(this.session.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    const headers = new Headers(options.headers || {});
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
    headers.set('Accept-Language', 'de,de-DE;q=0.9,en;q=0.8');
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    const response = await fetch(url, { ...options, headers });

    // Extract cookies from response
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookieMatch = setCookieHeader.match(/PHPSESSID=([^;]+)/);
      if (cookieMatch) {
        this.session.cookies.set('PHPSESSID', cookieMatch[1]);
      }
    }

    return response;
  }

  async getSessionCookie(): Promise<boolean> {
    console.log('[EgonScraper] Getting session cookie...');
    
    try {
      const response = await this.fetchWithCookies(`${BASE_URL}/`, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });

      if (this.session.cookies.has('PHPSESSID')) {
        console.log(`[EgonScraper] Session cookie received: ${this.session.cookies.get('PHPSESSID')}`);
        return true;
      }

      console.error('[EgonScraper] No PHPSESSID cookie received');
      return false;
    } catch (error) {
      console.error('[EgonScraper] Error getting session cookie:', error);
      return false;
    }
  }

  async login(): Promise<boolean> {
    console.log('[EgonScraper] Performing login...');

    try {
      const response = await this.fetchWithCookies(`${BASE_URL}/index.php`, {
        method: 'POST',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/index.php`,
        },
        body: new URLSearchParams({
          username: USERNAME,
          password: PASSWORD
        }).toString()
      });

      if (response.ok) {
        console.log('[EgonScraper] Login successful');
        return true;
      }

      console.error(`[EgonScraper] Login failed: Status ${response.status}`);
      return false;
    } catch (error) {
      console.error('[EgonScraper] Login error:', error);
      return false;
    }
  }

  async getOrderOverview(orderNo: string): Promise<any | null> {
    try {
      const response = await this.fetchWithCookies(`${BASE_URL}/php-bin/orderData/getOrderInfo.php`, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/index.php`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          todo: 'getOrderOverView',
          order_no: orderNo,
          ai_check: '0',
          ai_index: '0'
        }).toString()
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          return result.getOrderOverView || {};
        }
      }
      return null;
    } catch (error) {
      console.error(`[EgonScraper] Error getting order overview for ${orderNo}:`, error);
      return null;
    }
  }

  async getOrderComment(orderNo: string): Promise<any[]> {
    try {
      const timestamp = Date.now();
      const response = await this.fetchWithCookies(`${BASE_URL}/php-bin/orderData/getOrderInfo.php?_dc=${timestamp}`, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/index.php`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          todo: 'getOrderComment',
          order_no: orderNo,
          page: '1',
          start: '0',
          limit: '25'
        }).toString()
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          return result.getOrderComment || [];
        }
      }
      return [];
    } catch (error) {
      console.error(`[EgonScraper] Error getting order comments for ${orderNo}:`, error);
      return [];
    }
  }

  private parseDate(dateString: string): Date | null {
    try {
      const [day, month, year] = dateString.split('.').map(Number);
      return new Date(year, month - 1, day);
    } catch {
      return null;
    }
  }

  async scrapeAll(): Promise<{ newOrders: number; totalOrders: number }> {
    console.log('[EgonScraper] === Starting EGON Scraper ===');

    // Initialize session
    if (!await this.getSessionCookie()) {
      throw new Error('Failed to get session cookie');
    }

    // Login
    if (!await this.login()) {
      throw new Error('Login failed');
    }

    // Parse cutoff date
    const cutoffDate = this.parseDate(CUTOFF_DATE);
    if (!cutoffDate) {
      throw new Error(`Invalid cutoff date: ${CUTOFF_DATE}`);
    }

    console.log(`[EgonScraper] Searching for orders since ${CUTOFF_DATE}...`);

    const newResults: Array<{ reseller_name: string; timestamp: string; order_no: string; contract_date: string }> = [];
    let page = 1;
    const limit = 50;
    let totalProcessed = 0;
    let shouldStop = false;

    while (!shouldStop) {
      const start = (page - 1) * limit;
      const timestamp = Date.now();

      console.log(`[EgonScraper] Loading page ${page} (start: ${start})...`);

      try {
        const response = await this.fetchWithCookies(`${BASE_URL}/php-bin/orderData/getOrderInfo.php?_dc=${timestamp}`, {
          method: 'POST',
          headers: {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': BASE_URL,
            'Referer': `${BASE_URL}/index.php`,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams({
            todo: 'getOrderAll',
            limit: String(limit),
            page: String(page),
            start: String(start)
          }).toString()
        });

        if (!response.ok) {
          console.error(`[EgonScraper] Error fetching orders: Status ${response.status}`);
          break;
        }

        const result = await response.json();
        if (!result.success) {
          console.error('[EgonScraper] Error: success=false in response');
          break;
        }

        const orders = result.getOrderAll || [];
        if (orders.length === 0) {
          console.log(`[EgonScraper] No more orders on page ${page}`);
          break;
        }

        console.log(`[EgonScraper] Found ${orders.length} orders on page ${page}`);

        // Process each order
        for (const order of orders) {
          const orderNo = order.order_no;
          const contractDateStr = order.contract_date || '';

          // Check order date
          const contractDate = this.parseDate(contractDateStr);
          if (contractDate && contractDate < cutoffDate) {
            console.log(`[EgonScraper] Order ${orderNo} from ${contractDateStr} is older than ${CUTOFF_DATE}, stopping`);
            shouldStop = true;
            break;
          }

          totalProcessed++;
          console.log(`[EgonScraper] [${totalProcessed}] Processing order ${orderNo} from ${contractDateStr}...`);

          // Get overview
          const overview = await this.getOrderOverview(orderNo);
          if (!overview) {
            console.log(`[EgonScraper]   Warning: Could not get overview for ${orderNo}`);
            continue;
          }

          // Extract reseller name
          const resellerInfo = overview.reseller || {};
          const firstName = resellerInfo.first_name || '';
          const lastName = resellerInfo.last_name || '';
          const resellerName = `${firstName} ${lastName}`.trim();

          // Get comments
          const comments = await this.getOrderComment(orderNo);

          // Find oldest timestamp (last element in array)
          let orderTimestamp = '';
          if (comments.length > 0) {
            orderTimestamp = comments[comments.length - 1].notice_time || '';
          }

          // Check if this timestamp already exists in database
          if (orderTimestamp && egonOrdersDB.existsTimestamp(orderTimestamp)) {
            console.log(`[EgonScraper]   -> Order already exists (timestamp: ${orderTimestamp})`);
            console.log('[EgonScraper] Stopping - no more new orders');
            shouldStop = true;
            break;
          }

          // Add new order
          if (orderTimestamp) {
            newResults.push({
              reseller_name: resellerName,
              timestamp: orderTimestamp,
              order_no: orderNo,
              contract_date: contractDateStr
            });
            console.log(`[EgonScraper]   -> Added as new`);
          }

          // Small delay between requests
          await this.sleep(500);
        }

        if (shouldStop) break;

        page++;
        await this.sleep(300);
      } catch (error) {
        console.error(`[EgonScraper] Error on page ${page}:`, error);
        break;
      }
    }

    // Save to database
    if (newResults.length > 0) {
      console.log(`[EgonScraper] Saving ${newResults.length} new orders to database...`);
      const inserted = egonOrdersDB.insertBatch(newResults);
      console.log(`[EgonScraper] Inserted ${inserted} orders`);
    } else {
      console.log('[EgonScraper] No new orders found');
    }

    const totalOrders = egonOrdersDB.count();
    console.log(`[EgonScraper] === Scraping complete. New: ${newResults.length}, Total: ${totalOrders} ===`);

    return { newOrders: newResults.length, totalOrders };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Google Sheets Sync
// =============================================================================

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY || '{}');
  
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

async function ensureWorksheetExists(): Promise<void> {
  try {
    const sheetsClient = await getSheetsClient();
    
    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId: SYSTEM_SHEET_ID,
    });

    const sheetExists = response.data.sheets?.some(
      (sheet: any) => sheet.properties?.title === WORKSHEET_NAME
    );

    if (!sheetExists) {
      // Create the sheet
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: SYSTEM_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: WORKSHEET_NAME,
              }
            }
          }]
        }
      });

      // Add headers
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: SYSTEM_SHEET_ID,
        range: `${WORKSHEET_NAME}!A1:E1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Reseller Name', 'Timestamp', 'Order No', 'Contract Date', 'Created At']]
        }
      });

      console.log(`[EgonScraper] Created worksheet "${WORKSHEET_NAME}" with headers`);
    }
  } catch (error) {
    console.error('[EgonScraper] Error ensuring worksheet exists:', error);
    throw error;
  }
}

export async function syncToGoogleSheets(): Promise<number> {
  try {
    await ensureWorksheetExists();

    const unsyncedOrders = egonOrdersDB.getUnsynced();
    if (unsyncedOrders.length === 0) {
      console.log('[EgonScraper] No unsynced orders to send to Sheets');
      return 0;
    }

    console.log(`[EgonScraper] Syncing ${unsyncedOrders.length} orders to Google Sheets...`);

    const sheetsClient = await getSheetsClient();

    const rows = unsyncedOrders.map(order => [
      order.reseller_name,
      order.timestamp,
      order.order_no || '',
      order.contract_date || '',
      order.created_at
    ]);

    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SYSTEM_SHEET_ID,
      range: `${WORKSHEET_NAME}!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows
      }
    });

    // Mark as synced
    const ids = unsyncedOrders.map(o => o.id);
    egonOrdersDB.markAsSynced(ids);

    console.log(`[EgonScraper] Synced ${unsyncedOrders.length} orders to Sheets`);
    return unsyncedOrders.length;
  } catch (error) {
    console.error('[EgonScraper] Error syncing to Google Sheets:', error);
    return 0;
  }
}

// =============================================================================
// Google Drive Backup
// =============================================================================

async function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY || '{}');
  
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

export async function backupToDrive(): Promise<boolean> {
  try {
    // Checkpoint the database first
    egonOrdersDB.checkpoint();

    const driveClient = await getDriveClient();

    // Check if backup file already exists
    const listResponse = await driveClient.files.list({
      q: `name='${DB_FILENAME}' and '${DRIVE_BACKUP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });

    const existingFile = listResponse.data.files?.[0];

    // Read the database file
    const fileContent = fs.readFileSync(DB_PATH);
    const fileStream = require('stream').Readable.from(fileContent);

    if (existingFile?.id) {
      // Update existing file
      await driveClient.files.update({
        fileId: existingFile.id,
        media: {
          mimeType: 'application/x-sqlite3',
          body: fileStream,
        },
      });
      console.log(`[EgonScraper] Updated Drive backup: ${DB_FILENAME}`);
    } else {
      // Create new file
      await driveClient.files.create({
        requestBody: {
          name: DB_FILENAME,
          parents: [DRIVE_BACKUP_FOLDER_ID],
        },
        media: {
          mimeType: 'application/x-sqlite3',
          body: fileStream,
        },
      });
      console.log(`[EgonScraper] Created Drive backup: ${DB_FILENAME}`);
    }

    return true;
  } catch (error) {
    console.error('[EgonScraper] Error backing up to Drive:', error);
    return false;
  }
}

// =============================================================================
// Startup Sync (Load from Drive/Sheets if local is empty)
// =============================================================================

export async function performStartupSync(): Promise<void> {
  console.log('[EgonScraper] Performing startup sync...');

  const localCount = egonOrdersDB.count();
  console.log(`[EgonScraper] Local database has ${localCount} orders`);

  if (localCount === 0) {
    // Try to restore from Drive first
    console.log('[EgonScraper] Local DB empty, attempting to restore from Drive...');
    
    try {
      const driveClient = await getDriveClient();
      
      const listResponse = await driveClient.files.list({
        q: `name='${DB_FILENAME}' and '${DRIVE_BACKUP_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name)',
      });

      const backupFile = listResponse.data.files?.[0];

      if (backupFile?.id) {
        const response = await driveClient.files.get(
          { fileId: backupFile.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );

        fs.writeFileSync(DB_PATH, Buffer.from(response.data as ArrayBuffer));
        console.log(`[EgonScraper] Restored ${DB_FILENAME} from Drive`);

        // Reinitialize database connection
        // Note: In production, you might need to handle this differently
      }
    } catch (error) {
      console.error('[EgonScraper] Error restoring from Drive:', error);
    }
  }

  // Also try to merge any data from Sheets that might not be in local DB
  try {
    const sheetsClient = await getSheetsClient();
    
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SYSTEM_SHEET_ID,
      range: `${WORKSHEET_NAME}!A2:E`,
    });

    const rows = response.data.values || [];
    if (rows.length > 0) {
      console.log(`[EgonScraper] Found ${rows.length} rows in Sheets, merging...`);

      const ordersFromSheets = rows.map(row => ({
        reseller_name: row[0] || '',
        timestamp: row[1] || '',
        order_no: row[2] || undefined,
        contract_date: row[3] || undefined
      })).filter(o => o.timestamp); // Only items with timestamp

      const inserted = egonOrdersDB.insertBatch(ordersFromSheets);
      console.log(`[EgonScraper] Merged ${inserted} new orders from Sheets`);

      // Mark all as synced (they came from Sheets)
      const allOrders = egonOrdersDB.getAll();
      const allIds = allOrders.map(o => o.id);
      egonOrdersDB.markAsSynced(allIds);
    }
  } catch (error) {
    // Worksheet might not exist yet, that's OK
    console.log('[EgonScraper] Could not read from Sheets (may not exist yet):', (error as Error).message);
  }

  const finalCount = egonOrdersDB.count();
  console.log(`[EgonScraper] Startup sync complete. Total orders: ${finalCount}`);
}

// =============================================================================
// Main Scraper Function (called by cron job)
// =============================================================================

export async function runEgonScraper(): Promise<{ newOrders: number; totalOrders: number; syncedToSheets: number }> {
  console.log('[EgonScraper] === Running hourly scrape ===');

  const scraper = new EgonScraper();
  
  try {
    // Scrape new orders
    const { newOrders, totalOrders } = await scraper.scrapeAll();

    // Sync to Google Sheets
    const syncedToSheets = await syncToGoogleSheets();

    console.log(`[EgonScraper] === Hourly scrape complete. New: ${newOrders}, Synced: ${syncedToSheets}, Total: ${totalOrders} ===`);

    return { newOrders, totalOrders, syncedToSheets };
  } catch (error) {
    console.error('[EgonScraper] Error during scrape:', error);
    throw error;
  }
}

// =============================================================================
// Export for external use
// =============================================================================

export const egonScraperService = {
  runScraper: runEgonScraper,
  syncToSheets: syncToGoogleSheets,
  backupToDrive,
  performStartupSync,
  getOrders: egonOrdersDB.getAll,
  getOrderCount: egonOrdersDB.count,
  checkpoint: egonOrdersDB.checkpoint,
  close: egonOrdersDB.close
};

export default egonScraperService;
