/**
 * Historical Data Scraper
 * 
 * Scrapt historische Tracking-Daten aus Google Sheets und rekonstruiert
 * DailyUserData für vergangene Tage. Daten werden aus RAM gelöscht nach Verwendung.
 */

import { google, sheets_v4 } from 'googleapis';
import type { DailyUserData, GPSCoordinates, ActionLog, DeviceStatus } from '../../shared/trackingTypes';

// Google Sheets Configuration (same as googleSheets.ts)
const SPREADSHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
const SHEET_NAME = 'Logs';

// Cache für gescrapte Daten (wird nach Verwendung gelöscht)
const historicalCache = new Map<string, DailyUserData[]>();

/**
 * Initialisiert Google Sheets API
 */
function getGoogleSheets(): sheets_v4.Sheets {
  const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS || '{}');
  
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Sheets credentials not configured');
  }

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
 */
interface ParsedLog {
  timestamp: Date;
  userId: string;
  username: string;
  type: 'gps' | 'session' | 'device' | 'action';
  data: any;
}

function parseLogEntry(row: any[]): ParsedLog | null {
  try {
    const timestamp = new Date(row[0]); // Column A: Timestamp
    const userId = row[1]; // Column B: User ID
    const username = row[2]; // Column C: Username
    const action = row[3]; // Column D: Action
    const details = row[4]; // Column E: Details (JSON)
    
    if (!userId || !username || !action) {
      return null;
    }

    let parsedDetails: any = {};
    try {
      parsedDetails = JSON.parse(details || '{}');
    } catch {
      parsedDetails = {};
    }

    // Bestimme Log-Typ basierend auf Action
    let type: 'gps' | 'session' | 'device' | 'action' = 'action';
    
    if (action === 'gps_update') {
      type = 'gps';
    } else if (action === 'session_start' || action === 'session_end' || action === 'idle_detected' || action === 'active_resumed') {
      type = 'session';
    } else if (action === 'device_update') {
      type = 'device';
    }

    return {
      timestamp,
      userId,
      username,
      type,
      data: parsedDetails,
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
    
    // Alle Logs für den Tag abrufen
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`, // Timestamp, UserID, Username, Action, Details
    });

    const rows = response.data.values || [];
    
    if (rows.length === 0) {
      console.log('[HistoricalDataScraper] No logs found in Google Sheets');
      return [];
    }

    // Parse Logs (skip header row)
    const logs: ParsedLog[] = rows
      .slice(1)
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
  } catch (error) {
    console.error('[HistoricalDataScraper] Error scraping historical data:', error);
    throw new Error('Failed to scrape historical data from Google Sheets');
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

  // Verarbeite jeden Log
  logs.forEach((log, index) => {
    const timestamp = log.timestamp.getTime();

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
        residentStatus: log.data.status || log.data.context?.status,
      };

      data.totalActions++;

      // Count by type
      const count = data.actionsByType.get(actionLog.action) || 0;
      data.actionsByType.set(actionLog.action, count + 1);

      // Zähle Status Changes (wichtigster KPI!)
      if (actionLog.action === 'status_change' && actionLog.residentStatus) {
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
