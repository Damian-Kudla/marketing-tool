/**
 * Historical Data Scraper
 * 
 * Scrapt historische Tracking-Daten aus Google Sheets und rekonstruiert
 * DailyUserData für vergangene Tage. Daten werden aus RAM gelöscht nach Verwendung.
 */

import { google, sheets_v4 } from 'googleapis';
import crypto from 'crypto';
import type { DailyUserData, GPSCoordinates, ActionLog, DeviceStatus } from '../../shared/trackingTypes';

// Google Sheets Configuration - Uses individual user worksheets in LOG_SHEET_ID
const LOG_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw'; // Same as GoogleSheetsLoggingService

// Cache für gescrapte Daten (wird nach Verwendung gelöscht)
const historicalCache = new Map<string, DailyUserData[]>();

/**
 * Initialisiert Google Sheets API
 * Verwendet GOOGLE_SHEETS_KEY (gleiche Env-Variable wie Live-Logging)
 */
function getGoogleSheets(): sheets_v4.Sheets {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
  
  if (!sheetsKey.startsWith('{')) {
    console.error('[HistoricalDataScraper] ❌ GOOGLE_SHEETS_KEY not set or invalid format');
    throw new Error('Google Sheets credentials not configured. Please set GOOGLE_SHEETS_KEY environment variable with valid JSON.');
  }

  let credentials: any;
  try {
    credentials = JSON.parse(sheetsKey);
  } catch (error) {
    console.error('[HistoricalDataScraper] ❌ Failed to parse GOOGLE_SHEETS_KEY:', error);
    throw new Error('Invalid Google Sheets credentials format. Must be valid JSON.');
  }
  
  if (!credentials.client_email || !credentials.private_key) {
    console.error('[HistoricalDataScraper] ❌ Missing client_email or private_key in credentials');
    throw new Error('Google Sheets credentials incomplete. Missing client_email or private_key.');
  }

  console.log('[HistoricalDataScraper] ✅ Credentials loaded, email:', credentials.client_email);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Berechnet Distanz zwischen zwei GPS-Koordinaten (Haversine-Formel)
 */
function calculateDistance(coord1: GPSCoordinates, coord2: GPSCoordinates): number {
  const R = 6371000; // Erdradius in Metern
  const dLat = (coord2.latitude - coord1.latitude) * Math.PI / 180;
  const dLon = (coord2.longitude - coord1.longitude) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.latitude * Math.PI / 180) * Math.cos(coord2.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * Berechnet Activity Score (0-100) basierend auf KPIs
 */
function calculateActivityScore(data: DailyUserData): number {
  let score = 0;
  
  // 30% - Status Changes (wichtigster KPI!)
  const totalStatusChanges = Array.from(data.statusChanges.values()).reduce((sum, count) => sum + count, 0);
  const statusChangeScore = Math.min(totalStatusChanges * 5, 30);
  score += statusChangeScore;
  
  // 30% - Active Time (min 4 Stunden = volle Punkte)
  const activeTimeScore = Math.min((data.activeTime / (4 * 60 * 60 * 1000)) * 30, 30);
  score += activeTimeScore;
  
  // 25% - Actions (min 50 = volle Punkte)
  const actionsScore = Math.min((data.totalActions / 50) * 25, 25);
  score += actionsScore;
  
  // 10% - Distance (min 5km = volle Punkte)
  const distanceScore = Math.min((data.totalDistance / 5000) * 10, 10);
  score += distanceScore;
  
  // 5% - GPS Points (min 100 = volle Punkte)
  const gpsScore = Math.min((data.gpsPoints.length / 100) * 5, 5);
  score += gpsScore;
  
  // Abzüge:
  // -10% wenn mehr als 2 Stunden idle
  if (data.totalIdleTime > 2 * 60 * 60 * 1000) {
    score -= 10;
  }
  
  // -5% wenn mehr als 5 offline events
  if (data.offlineEvents > 5) {
    score -= 5;
  }
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Parsed einen Log-Eintrag aus Google Sheets
 * 
 * Sheet Columns:
 * A: Timestamp
 * B: User ID
 * C: Username
 * D: Endpoint
 * E: Method
 * F: Address
 * G: New Prospects
 * H: Existing Customers
 * I: User Agent
 * J: Data (JSON with action, gps coords, etc.)
 */
interface ParsedLog {
  timestamp: Date;
  userId: string;
  username: string;
  type: 'gps' | 'session' | 'device' | 'action' | 'photo';
  endpoint?: string;
  newProspects?: string;
  existingCustomers?: string;
  address?: string;
  data: any;
}

function parseLogEntry(row: any[]): ParsedLog | null {
  try {
    const timestamp = new Date(row[0]); // Column A: Timestamp
    const userId = row[1]; // Column B: User ID
    const username = row[2]; // Column C: Username
    const endpoint = row[3]; // Column D: Endpoint
    const method = row[4]; // Column E: Method
    const address = row[5]; // Column F: Address
    const newProspects = row[6]; // Column G: New Prospects
    const existingCustomers = row[7]; // Column H: Existing Customers
    const dataString = row[9]; // Column J: Data (JSON)
    
    if (!userId || !username) {
      return null;
    }

    // Parse Data JSON (enthält action, GPS coordinates, etc.)
    let parsedData: any = {};
    try {
      parsedData = JSON.parse(dataString || '{}');
    } catch {
      parsedData = {};
    }

    // Bestimme Log-Typ basierend auf action im data field oder endpoint
    let type: 'gps' | 'session' | 'device' | 'action' | 'photo' = 'action';
    const action = parsedData.action || '';
    
    if (action === 'gps_update' || endpoint === '/api/tracking/gps') {
      type = 'gps';
    } else if (action === 'session_start' || action === 'session_end' || action === 'idle_detected' || action === 'active_resumed' || action === 'session_update' || endpoint === '/api/tracking/session') {
      type = 'session';
    } else if (action === 'device_update' || endpoint === '/api/tracking/device') {
      type = 'device';
    } else if (endpoint === '/api/ocr' || endpoint === '/api/ocr-correct') {
      type = 'photo';
    }

    return {
      timestamp,
      userId,
      username,
      type,
      endpoint,
      newProspects,
      existingCustomers,
      address,
      data: parsedData,
    };
  } catch (error) {
    console.error('[HistoricalDataScraper] Error parsing log entry:', error);
    return null;
  }
}

/**
 * Scrapt Daten für einen bestimmten Tag aus Google Sheets
 * @param date - Datum im Format YYYY-MM-DD
 * @param userId - Optional: Nur Daten für bestimmten User
 * @returns Array von DailyUserData
 */
export async function scrapeDayData(date: string, userId?: string): Promise<DailyUserData[]> {
  console.log(`[HistoricalDataScraper] Scraping data for ${date}${userId ? ` (user: ${userId})` : ''}`);
  
  // Cache-Key
  const cacheKey = `${date}${userId ? `-${userId}` : ''}`;
  
  // Prüfe Cache
  if (historicalCache.has(cacheKey)) {
    console.log('[HistoricalDataScraper] Returning cached data');
    return historicalCache.get(cacheKey)!;
  }

  try {
    const sheets = getGoogleSheets();
    
    // Get all worksheets in the spreadsheet
    console.log(`[HistoricalDataScraper] Fetching worksheet list from Google Sheets (${LOG_SHEET_ID})`);
    
    const spreadsheetResponse = await sheets.spreadsheets.get({
      spreadsheetId: LOG_SHEET_ID,
    });

    const allSheets = spreadsheetResponse.data.sheets || [];
    console.log(`[HistoricalDataScraper] Found ${allSheets.length} worksheets`);

    // Filter to user worksheets (format: username_userId) and optionally by specific user
    let targetSheets = allSheets
      .map((sheet: any) => sheet.properties.title as string)
      .filter((title: string) => title !== 'AuthLogs' && title.includes('_')); // Exclude AuthLogs and other system sheets

    if (userId) {
      // Filter to specific user's worksheet
      targetSheets = targetSheets.filter((title: string) => title.endsWith(`_${userId}`));
      console.log(`[HistoricalDataScraper] Filtered to user ${userId}: ${targetSheets.length} worksheets`);
    }

    if (targetSheets.length === 0) {
      console.log('[HistoricalDataScraper] ⚠️ No user worksheets found');
      return [];
    }

    // Fetch data from all target worksheets
    console.log(`[HistoricalDataScraper] Fetching data from ${targetSheets.length} worksheets...`);
    
    const fetchPromises = targetSheets.map(async (sheetName) => {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: LOG_SHEET_ID,
          range: `${sheetName}!A:J`, // A:Timestamp, B:UserID, C:Username, D:Endpoint, E:Method, F:Address, G:NewProspects, H:ExistingCustomers, I:UserAgent, J:Data
        });
        return response.data.values || [];
      } catch (error) {
        console.error(`[HistoricalDataScraper] Error fetching worksheet ${sheetName}:`, error);
        return [];
      }
    });

    const allSheetData = await Promise.all(fetchPromises);
    
    // Combine all rows from all sheets (skip header row from each)
    const rows: any[][] = [];
    allSheetData.forEach((sheetRows) => {
      if (sheetRows.length > 1) { // Skip if only header or empty
        rows.push(...sheetRows.slice(1)); // Skip header row
      }
    });

    console.log(`[HistoricalDataScraper] ✅ Fetched ${rows.length} total rows from ${targetSheets.length} worksheets`);
    
    if (rows.length === 0) {
      console.log('[HistoricalDataScraper] ⚠️ No log entries found');
      return [];
    }

    // Parse Logs
    const logs: ParsedLog[] = rows
      .map(parseLogEntry)
      .filter((log): log is ParsedLog => log !== null);

    // Filter nach Datum
    const targetDate = new Date(date);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayLogs = logs.filter(log => {
      return log.timestamp >= targetDate && log.timestamp < nextDate;
    });

    // Optional: Filter nach User
    const filteredLogs = userId 
      ? dayLogs.filter(log => log.userId === userId)
      : dayLogs;

    console.log(`[HistoricalDataScraper] Found ${filteredLogs.length} logs for ${date}`);

    // Gruppiere nach User
    const userLogsMap = new Map<string, ParsedLog[]>();
    
    filteredLogs.forEach(log => {
      if (!userLogsMap.has(log.userId)) {
        userLogsMap.set(log.userId, []);
      }
      userLogsMap.get(log.userId)!.push(log);
    });

    // Rekonstruiere DailyUserData für jeden User
    const dailyDataArray: DailyUserData[] = [];

    userLogsMap.forEach((userLogs, uid) => {
      const userData = reconstructDailyData(uid, userLogs);
      dailyDataArray.push(userData);
    });

    // In Cache speichern
    historicalCache.set(cacheKey, dailyDataArray);

    console.log(`[HistoricalDataScraper] Reconstructed data for ${dailyDataArray.length} users`);

    return dailyDataArray;
  } catch (error: any) {
    console.error('[HistoricalDataScraper] ❌ Error scraping historical data:', error);
    
    // Detaillierte Fehlerausgabe für verschiedene Fehlertypen
    if (error.code === 'ENOTFOUND') {
      console.error('[HistoricalDataScraper] ❌ Network error: Cannot reach Google Sheets API');
      throw new Error('Network error: Cannot connect to Google Sheets. Check internet connection.');
    } else if (error.code === 403 || error.message?.includes('permission')) {
      console.error('[HistoricalDataScraper] ❌ Permission error: No access to spreadsheet');
      throw new Error('Permission denied: Service account needs access to the spreadsheet.');
    } else if (error.code === 404) {
      console.error('[HistoricalDataScraper] ❌ Spreadsheet not found');
      throw new Error(`Spreadsheet not found: ${LOG_SHEET_ID}`);
    } else if (error.message?.includes('credentials')) {
      // Credentials-Fehler bereits in getGoogleSheets() behandelt
      throw error;
    } else {
      console.error('[HistoricalDataScraper] ❌ Unexpected error:', error.message || error);
      throw new Error(`Failed to scrape historical data: ${error.message || 'Unknown error'}`);
    }
  }
}

/**
 * Rekonstruiert DailyUserData aus Logs
 */
function reconstructDailyData(userId: string, logs: ParsedLog[]): DailyUserData {
  const username = logs[0]?.username || 'Unknown';
  
  // Initialisiere DailyUserData
  const data: DailyUserData = {
    userId,
    username,
    date: new Date().toISOString().split('T')[0], // Wird vom ersten Log überschrieben
    gpsPoints: [],
    totalDistance: 0,
    uniqueAddresses: new Set(),
    totalSessionTime: 0,
    totalIdleTime: 0,
    activeTime: 0,
    sessionCount: 0,
    totalActions: 0,
    actionsByType: new Map(),
    statusChanges: new Map(),
    avgBatteryLevel: 0,
    lowBatteryEvents: 0,
    offlineEvents: 0,
    scansPerHour: 0,
    avgTimePerAddress: 0,
    conversionRate: 0,
    activityScore: 0,
    rawLogs: [],
  };

  // Sortiere Logs nach Timestamp
  logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Tracking-Variablen
  let lastGpsCoord: GPSCoordinates | null = null;
  let sessionStartTime: number | null = null;
  let lastActiveTime: number | null = null;
  let batterySum = 0;
  let batteryCount = 0;
  let isIdle = false;
  
  // Photo tracking with deduplication (same logic as dailyDataStore)
  const uniquePhotoHashes = new Set<string>();

  // Verarbeite jeden Log
  logs.forEach((log, index) => {
    const timestamp = log.timestamp.getTime();
    
    // Photo Tracking (OCR requests)
    if (log.type === 'photo') {
      // Create hash from prospect data (Column G + Column H)
      const prospectData = {
        newProspects: log.newProspects || '',
        existingCustomers: log.existingCustomers || '',
        address: log.address || '',
      };
      
      const dataString = JSON.stringify(prospectData);
      const hash = crypto.createHash('md5').update(dataString).digest('hex');
      
      // Only count unique photos (deduplicated by prospect data)
      if (!uniquePhotoHashes.has(hash)) {
        uniquePhotoHashes.add(hash);
      }
    }

    // GPS Updates
    if (log.type === 'gps' && log.data.latitude && log.data.longitude) {
      const coord: GPSCoordinates = {
        latitude: log.data.latitude,
        longitude: log.data.longitude,
        accuracy: log.data.accuracy || 0,
        timestamp: timestamp,
      };

      data.gpsPoints.push(coord);

      // Berechne Distanz
      if (lastGpsCoord) {
        const distance = calculateDistance(lastGpsCoord, coord);
        data.totalDistance += distance;
      }

      lastGpsCoord = coord;

      // Store raw log
      data.rawLogs.push({
        userId,
        username,
        timestamp: timestamp,
        gps: coord,
      });
    }

    // Session Events
    if (log.type === 'session') {
      const action = log.data.action || log.data.type;
      
      if (action === 'session_start') {
        sessionStartTime = timestamp;
        lastActiveTime = timestamp;
        isIdle = false;
        data.sessionCount++;
      } else if (action === 'session_end' && sessionStartTime) {
        const duration = timestamp - sessionStartTime;
        data.totalSessionTime += duration;
        data.activeTime = data.totalSessionTime - data.totalIdleTime;
        sessionStartTime = null;
        lastActiveTime = null;
      } else if (action === 'idle_detected') {
        isIdle = true;
        if (lastActiveTime) {
          const activeDuration = timestamp - lastActiveTime;
          data.activeTime += activeDuration;
          lastActiveTime = null;
        }
      } else if (action === 'active_resumed') {
        isIdle = false;
        lastActiveTime = timestamp;
      }

      // Store raw log
      data.rawLogs.push({
        userId,
        username,
        timestamp: timestamp,
        session: {
          userId,
          username,
          startTime: sessionStartTime || timestamp,
          lastActivity: timestamp,
          isActive: !isIdle,
          idleTime: data.totalIdleTime,
          sessionDuration: data.totalSessionTime,
          pageViews: 0,
          actions: [],
        },
      });
    }

    // Device Status
    if (log.type === 'device') {
      const deviceStatus: DeviceStatus = {
        batteryLevel: log.data.batteryLevel,
        isCharging: log.data.isCharging || false,
        connectionType: log.data.connectionType || 'unknown',
        effectiveType: log.data.effectiveType,
        screenOrientation: log.data.orientation || log.data.screenOrientation,
        memoryUsage: log.data.memoryUsage,
        timestamp: timestamp,
      };

      // Track battery stats
      if (deviceStatus.batteryLevel !== undefined) {
        batterySum += deviceStatus.batteryLevel;
        batteryCount++;

        if (deviceStatus.batteryLevel < 0.2) {
          data.lowBatteryEvents++;
        }
      }

      // Track offline events
      if (deviceStatus.connectionType === 'offline' || deviceStatus.effectiveType === 'offline') {
        data.offlineEvents++;
      }

      // Store raw log
      data.rawLogs.push({
        userId,
        username,
        timestamp: timestamp,
        device: deviceStatus,
      });
    }

    // Actions
    if (log.type === 'action') {
      const actionType = log.data.action || log.data.type || 'scan';
      const actionLog: ActionLog = {
        timestamp: timestamp,
        action: actionType,
        details: log.data.context ? JSON.stringify(log.data.context) : log.data.details,
        residentStatus: log.data.residentStatus || log.data.status || log.data.context?.status,
      };

      data.totalActions++;

      // Count by type
      const count = data.actionsByType.get(actionLog.action) || 0;
      data.actionsByType.set(actionLog.action, count + 1);

      // Zähle Status Changes (wichtigster KPI!)
      // Für bulk_residents_update: Durchlaufe alle Residents im Array
      if (actionType === 'bulk_residents_update' && log.data.residents && Array.isArray(log.data.residents)) {
        log.data.residents.forEach((resident: any) => {
          if (resident.status) {
            const statusCount = data.statusChanges.get(resident.status) || 0;
            data.statusChanges.set(resident.status, statusCount + 1);
          }
        });
      }
      // Für einzelne Updates (resident_update) oder andere Actions mit residentStatus
      else if (actionLog.residentStatus) {
        const statusCount = data.statusChanges.get(actionLog.residentStatus) || 0;
        data.statusChanges.set(actionLog.residentStatus, statusCount + 1);
      }

      // Store raw log
      data.rawLogs.push({
        userId,
        username,
        timestamp: timestamp,
        session: {
          userId,
          username,
          startTime: sessionStartTime || timestamp,
          lastActivity: timestamp,
          isActive: !isIdle,
          idleTime: data.totalIdleTime,
          sessionDuration: data.totalSessionTime,
          pageViews: 0,
          actions: [actionLog],
        },
      });
    }
  });

  // Berechne finale Active Time wenn Session noch läuft
  if (sessionStartTime && lastActiveTime) {
    const finalDuration = Date.now() - lastActiveTime;
    data.activeTime += finalDuration;
  }

  // Schätze Idle Time (basierend auf Gaps zwischen Logs)
  for (let i = 1; i < logs.length; i++) {
    const gap = logs[i].timestamp.getTime() - logs[i - 1].timestamp.getTime();
    
    // Gaps > 5 Minuten = Idle Time
    if (gap > 5 * 60 * 1000) {
      data.totalIdleTime += gap;
    }
  }

  // Berechne durchschnittlichen Battery Level
  if (batteryCount > 0) {
    data.avgBatteryLevel = batterySum / batteryCount;
  }

  // Berechne KPIs
  const totalStatusChangesCount = Array.from(data.statusChanges.values()).reduce((sum, count) => sum + count, 0);
  const sessionHours = data.totalSessionTime / (1000 * 60 * 60);
  data.scansPerHour = sessionHours > 0 ? data.totalActions / sessionHours : 0;

  // Set unique photos count
  data.uniquePhotos = uniquePhotoHashes.size;

  // Berechne Activity Score
  data.activityScore = calculateActivityScore(data);

  // Set date from first log
  if (logs.length > 0) {
    data.date = logs[0].timestamp.toISOString().split('T')[0];
  }

  return data;
}

/**
 * Löscht Cache für bestimmten Tag/User
 */
export function clearHistoricalCache(date?: string, userId?: string): void {
  if (date) {
    const cacheKey = `${date}${userId ? `-${userId}` : ''}`;
    historicalCache.delete(cacheKey);
    console.log(`[HistoricalDataScraper] Cleared cache for ${cacheKey}`);
  } else {
    historicalCache.clear();
    console.log('[HistoricalDataScraper] Cleared all historical cache');
  }
}

/**
 * Gibt Cache-Statistiken zurück
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: historicalCache.size,
    keys: Array.from(historicalCache.keys()),
  };
}
