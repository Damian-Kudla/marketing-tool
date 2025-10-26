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
 * Berechnet finalStatuses und conversionRates aus historischen Daten
 */
async function calculateFinalStatusesAndConversions(
  data: DailyUserData, 
  username: string, 
  date: string
): Promise<void> {
  try {
    // Import addressDatasetService
    const { addressDatasetService } = await import('./googleSheets');

    // Get datasets for this user on this date
    const dateObj = new Date(date);
    const datasets = await addressDatasetService.getUserDatasetsByDate(username, dateObj);

    // Calculate final statuses from resident data
    const finalStatuses = new Map<string, number>();
    
    datasets.forEach((dataset: any) => {
      dataset.editableResidents.forEach((resident: any) => {
        if (resident.status) {
          const count = finalStatuses.get(resident.status) || 0;
          finalStatuses.set(resident.status, count + 1);
        }
      });
    });

    data.finalStatuses = finalStatuses;

    // Calculate conversion rates from rawLogs
    const conversionRates = {
      interest_later_to_written: 0,
      interest_later_to_no_interest: 0,
      interest_later_to_appointment: 0,
      interest_later_to_not_reached: 0,
      interest_later_total: 0
    };

    // Track status change sequences
    const residentStatusHistory = new Map<string, string[]>();

    // Build status history from action logs
    data.rawLogs.forEach(log => {
      if (log.session?.actions) {
        log.session.actions.forEach((action: ActionLog) => {
          if (action.residentStatus && action.details) {
            const match = action.details.match(/Resident:\s*(.+)/);
            if (match) {
              const residentName = match[1].trim();
              if (!residentStatusHistory.has(residentName)) {
                residentStatusHistory.set(residentName, []);
              }
              residentStatusHistory.get(residentName)!.push(action.residentStatus);
            }
          }
        });
      }
    });

    // Analyze conversions from interest_later
    residentStatusHistory.forEach((history) => {
      for (let i = 0; i < history.length - 1; i++) {
        const currentStatus = history[i];
        const nextStatus = history[i + 1];

        if (currentStatus === 'interest_later') {
          conversionRates.interest_later_total++;

          if (nextStatus === 'written') {
            conversionRates.interest_later_to_written++;
          } else if (nextStatus === 'no_interest') {
            conversionRates.interest_later_to_no_interest++;
          } else if (nextStatus === 'appointment') {
            conversionRates.interest_later_to_appointment++;
          } else if (nextStatus === 'not_reached') {
            conversionRates.interest_later_to_not_reached++;
          }
        }
      }
    });

    data.conversionRates = conversionRates;

    console.log(`[HistoricalDataScraper] Calculated final statuses and conversions for ${username}:`, {
      finalStatuses: Array.from(finalStatuses.entries()),
      conversionRates
    });
  } catch (error) {
    console.error('[HistoricalDataScraper] Error calculating final statuses and conversions:', error);
    // Set empty values on error
    data.finalStatuses = new Map();
    data.conversionRates = {
      interest_later_to_written: 0,
      interest_later_to_no_interest: 0,
      interest_later_to_appointment: 0,
      interest_later_to_not_reached: 0,
      interest_later_total: 0
    };
  }
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
    
    // IMPORTANT: Check for status_change FIRST (before endpoint matching)
    // status_change can come from /api/tracking/session but must be treated as 'action'
    if (action === 'status_change') {
      type = 'action';
    } else if (action === 'gps_update' || endpoint === '/api/tracking/gps') {
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

    // Filter to user TRACKING worksheets (format: username_shortUserId with 8-char hex ID)
    // Examples: Damian_6b86b273, Daniel_4fc82b26, Ljubo Radulovic_lqj1hc0r5
    // Exclude: AuthLogs, Log_Änderung_Kategorie, Termine, Adressen, and dataset sheets (just username)
    let targetSheets = allSheets
      .map((sheet: any) => sheet.properties.title as string)
      .filter((title: string) => {
        // Must contain underscore
        if (!title.includes('_')) return false;
        
        // Exclude known system sheets
        if (title === 'AuthLogs' || title.startsWith('Log_')) return false;
        
        // Extract part after last underscore (should be short user ID)
        const parts = title.split('_');
        const lastPart = parts[parts.length - 1];
        
        // Short user IDs are typically 8-10 alphanumeric characters
        // Examples: 6b86b273, 4fc82b26, lqj1hc0r5
        const isTrackingSheet = lastPart.length >= 8 && lastPart.length <= 10 && /^[a-z0-9]+$/i.test(lastPart);
        
        return isTrackingSheet;
      });

    if (userId) {
      // Filter to specific user's worksheet
      targetSheets = targetSheets.filter((title: string) => title.endsWith(`_${userId}`));
      console.log(`[HistoricalDataScraper] Filtered to user ${userId}: ${targetSheets.length} worksheets`);
    }

    if (targetSheets.length === 0) {
      console.log('[HistoricalDataScraper] ⚠️ No user worksheets found');
      return [];
    }

    // Fetch data from all target worksheets using BATCH API (1 request instead of N)
    console.log(`[HistoricalDataScraper] Fetching data from ${targetSheets.length} TRACKING worksheets using Batch API...`);
    
    let allSheetData: any[][] = [];
    
    try {
      // Use batchGet to fetch all worksheets in a single API request
      const batchResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: LOG_SHEET_ID,
        ranges: targetSheets.map(sheetName => `${sheetName}!A:J`), // A:Timestamp, B:UserID, C:Username, D:Endpoint, E:Method, F:Address, G:NewProspects, H:ExistingCustomers, I:UserAgent, J:Data
      });

      // Extract values from batch response
      allSheetData = (batchResponse.data.valueRanges || []).map(range => range.values || []);
      
      console.log(`[HistoricalDataScraper] ✅ Batch API request completed successfully (1 request for ${targetSheets.length} worksheets)`);
    } catch (error) {
      console.error(`[HistoricalDataScraper] Error with Batch API, falling back to individual requests:`, error);
      
      // Fallback: Individual requests if batch fails
      const fetchPromises = targetSheets.map(async (sheetName) => {
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: LOG_SHEET_ID,
            range: `${sheetName}!A:J`,
          });
          return response.data.values || [];
        } catch (error) {
          console.error(`[HistoricalDataScraper] Error fetching worksheet ${sheetName}:`, error);
          return [];
        }
      });

      allSheetData = await Promise.all(fetchPromises);
    }
    
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

    for (const uid of Array.from(userLogsMap.keys())) {
      const userLogs = userLogsMap.get(uid)!;
      const userData = reconstructDailyData(uid, userLogs);
      
      // Calculate final statuses and conversions
      await calculateFinalStatusesAndConversions(userData, userData.username, date);
      
      dailyDataArray.push(userData);
    }

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
    finalStatuses: new Map(),
    conversionRates: {
      interest_later_to_written: 0,
      interest_later_to_no_interest: 0,
      interest_later_to_appointment: 0,
      interest_later_to_not_reached: 0,
      interest_later_total: 0
    },
    avgBatteryLevel: 0,
    lowBatteryEvents: 0,
    offlineEvents: 0,
    scansPerHour: 0,
    avgTimePerAddress: 0,
    conversionRate: 0,
    rawLogs: [],
    photoTimestamps: []
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
  
  // Action deduplication by timestamp (same logic as dailyDataStore)
  const processedActionTimestamps = new Set<number>();

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
        
        // Track photo timestamp for route replay
        if (!data.photoTimestamps) {
          data.photoTimestamps = [];
        }
        data.photoTimestamps.push(timestamp);
      }
      
      // Count as 'scan' action (every /api/ocr request = 1 photo uploaded)
      if (!processedActionTimestamps.has(timestamp)) {
        processedActionTimestamps.add(timestamp);
        
        data.totalActions++;
        const scanCount = data.actionsByType.get('scan') || 0;
        data.actionsByType.set('scan', scanCount + 1);
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
        // Don't override activeTime here - it's calculated incrementally and at the end
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
      const actionType = log.data.action || log.data.type;
      
      // Skip actions without explicit type
      if (!actionType) {
        return;
      }
      
      const actionLog: ActionLog = {
        timestamp: timestamp,
        action: actionType,
        details: log.data.context ? JSON.stringify(log.data.context) : log.data.details,
        residentStatus: log.data.residentStatus || log.data.status || log.data.context?.status,
        previousStatus: log.data.previousStatus, // May be undefined for old logs
      };

      // Deduplicate actions by timestamp (same logic as dailyDataStore)
      if (!processedActionTimestamps.has(timestamp)) {
        processedActionTimestamps.add(timestamp);
        
        data.totalActions++;

        // Count by type
        const count = data.actionsByType.get(actionLog.action) || 0;
        data.actionsByType.set(actionLog.action, count + 1);

        // Track STATUS CHANGES with backward compatibility
        if (actionLog.action === 'status_change' && actionLog.residentStatus) {
          // NEW LOGS (with previousStatus): Only count actual changes
          if (actionLog.previousStatus !== undefined) {
            if (actionLog.previousStatus !== actionLog.residentStatus) {
              const statusCount = data.statusChanges.get(actionLog.residentStatus) || 0;
              data.statusChanges.set(actionLog.residentStatus, statusCount + 1);
            }
          }
          // OLD LOGS (without previousStatus): Count all status_change actions
          else {
            const statusCount = data.statusChanges.get(actionLog.residentStatus) || 0;
            data.statusChanges.set(actionLog.residentStatus, statusCount + 1);
          }
        }
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

  // Calculate activeTime if not set
  if (data.activeTime === 0) {
    if (data.totalSessionTime > 0) {
      // Use session time minus idle time
      data.activeTime = data.totalSessionTime - data.totalIdleTime;
      console.log(`[HistoricalDataScraper] ⏱️ ActiveTime calculated from session: ${data.activeTime}ms (${(data.activeTime/1000/60).toFixed(1)}min)`);
    } else if (logs.length > 1) {
      // Fallback: Calculate from first to last log timestamp (for old logs without session events)
      const firstLog = logs[0].timestamp.getTime();
      const lastLog = logs[logs.length - 1].timestamp.getTime();
      const totalTime = lastLog - firstLog;
      data.activeTime = totalTime - data.totalIdleTime;
      data.totalSessionTime = totalTime; // Also set totalSessionTime for consistency
      console.log(`[HistoricalDataScraper] ⏱️ ActiveTime calculated from log span: ${data.activeTime}ms (${(data.activeTime/1000/60).toFixed(1)}min)`);
    } else {
      console.log(`[HistoricalDataScraper] ⚠️ No activeTime data - only ${logs.length} log(s)`);
    }
  }

  console.log(`[HistoricalDataScraper] 📊 Final stats: ${data.totalActions} actions, ${Array.from(data.statusChanges.values()).reduce((s,c) => s+c, 0)} status changes, ${(data.activeTime/1000/60).toFixed(1)}min active`);

  // Berechne KPIs
  const totalStatusChangesCount = Array.from(data.statusChanges.values()).reduce((sum, count) => sum + count, 0);
  const sessionHours = data.totalSessionTime / (1000 * 60 * 60);
  data.scansPerHour = sessionHours > 0 ? data.totalActions / sessionHours : 0;

  // Set unique photos count
  data.uniquePhotos = uniquePhotoHashes.size;

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
