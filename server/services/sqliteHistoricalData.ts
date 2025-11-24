/**
 * SQLite Historical Data Service
 *
 * Ersetzt historicalDataScraper.ts für SQLite-basierte Abfragen
 * - Lädt Daten aus lokalen DBs (letzte 7 Tage)
 * - Lädt aus Drive für ältere Daten (mit 1h Cache)
 * - Rekonstruiert DailyUserData aus SQLite-Logs
 */

import { getUserLogs, getCETDate, dbExists, getAllUserIds, cacheOldDB } from './sqliteLogService';
import { sqliteBackupService } from './sqliteBackupService';
import type { DailyUserData, GPSCoordinates, ActionLog, DeviceStatus, SessionData } from '../../shared/trackingTypes';
import crypto from 'crypto';

/**
 * Map legacy English status keys to current German keys
 * (for backward compatibility with old data)
 */
const STATUS_KEY_MAPPING: Record<string, string> = {
  // English → German
  'interest_later': 'interessiert',
  'appointment': 'termin_vereinbart',
  'written': 'geschrieben',
  'no_interest': 'nicht_interessiert',
  'not_reached': 'nicht_angetroffen',
  // German → German (passthrough)
  'interessiert': 'interessiert',
  'termin_vereinbart': 'termin_vereinbart',
  'geschrieben': 'geschrieben',
  'nicht_interessiert': 'nicht_interessiert',
  'nicht_angetroffen': 'nicht_angetroffen',
};

/**
 * Infer action type from endpoint (for historical data without explicit action field)
 */
function inferActionTypeFromEndpoint(endpoint: string, method?: string): string | null {
  // External tracking (never count as action)
  if (endpoint === '/api/external-tracking/location') return null;

  // OCR endpoints
  if (endpoint === '/api/ocr') return 'scan';
  if (endpoint === '/api/ocr-correct') return 'bulk_residents_update';
  
  // Geocoding
  if (endpoint === '/api/geocode') return 'geocode';
  
  // Navigation
  if (endpoint.includes('/api/navigate')) return 'navigate';
  
  // Address datasets
  if (endpoint.startsWith('/api/address-datasets')) {
    if (method === 'POST') return 'dataset_create';
    if (method === 'GET') return null; // Don't count GET requests as actions
    if (method === 'PUT') {
      if (endpoint.includes('/bulk-residents')) return 'bulk_residents_update';
      if (endpoint.includes('/residents')) return 'resident_update';
    }
    if (method === 'DELETE') return 'resident_delete';
  }
  
  // Search address (not counted as action, just a query)
  if (endpoint === '/api/search-address') return null;
  
  // Customers endpoint (not counted as action)
  if (endpoint === '/api/customers') return null;
  
  return null;
}

/**
 * Normalize status key to German format
 */
function normalizeStatusKey(status: string): string {
  return STATUS_KEY_MAPPING[status] || status;
}

/**
 * Lädt User-Daten für einen bestimmten Tag aus SQLite
 * @param date - YYYY-MM-DD
 * @param userId - Optional: Nur Daten für diesen User laden
 */
export async function scrapeDayDataFromSQLite(date: string, userId?: string): Promise<DailyUserData[]> {
  console.log(`[SQLiteHistorical] Loading data for ${date}${userId ? ` (user: ${userId})` : ''}...`);

  try {
    // Check if DB exists locally
    const exists = await dbExists(date);

    if (!exists) {
      // Check if >7 days old
      const today = getCETDate();
      const daysAgo = Math.floor(
        (new Date(today).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysAgo > 7) {
        console.log(`[SQLiteHistorical] ${date} is >7 days old, downloading from Drive...`);

        // Check if backup service is ready
        if (!sqliteBackupService.isReady()) {
          console.error(`[SQLiteHistorical] Backup service not ready - cannot download ${date}`);
          console.error(`[SQLiteHistorical] This usually means GOOGLE_DRIVE_LOG_FOLDER_ID is not set or Drive initialization failed`);
          return [];
        }

        // Download from Drive
        const downloaded = await sqliteBackupService.downloadDB(date);

        if (!downloaded) {
          console.warn(`[SQLiteHistorical] Could not download ${date} from Drive`);
          return [];
        }

        // Cache for 1 hour
        cacheOldDB(date, downloaded);
      } else {
        console.warn(`[SQLiteHistorical] DB not found for ${date}`);
        return [];
      }
    }

    // Get all user IDs in this DB (or filter to specific user)
    let userIds: string[];

    if (userId) {
      // Specific user requested
      userIds = [userId];
    } else {
      // All users
      userIds = getAllUserIds(date);
    }

    if (userIds.length === 0) {
      console.log(`[SQLiteHistorical] No users found for ${date}`);
      return [];
    }

    console.log(`[SQLiteHistorical] Found ${userIds.length} user(s) for ${date}`);

    // Reconstruct DailyUserData for each user
    const results: DailyUserData[] = [];

    for (const uid of userIds) {
      const userData = await reconstructDailyUserData(date, uid);

      if (userData) {
        results.push(userData);
      }
    }

    console.log(`[SQLiteHistorical] ✅ Loaded ${results.length} users for ${date}`);

    return results;
  } catch (error) {
    console.error(`[SQLiteHistorical] Error loading ${date}:`, error);
    return [];
  }
}

/**
 * Rekonstruiert DailyUserData aus SQLite-Logs
 */
async function reconstructDailyUserData(date: string, userId: string): Promise<DailyUserData | null> {
  try {
    const logs = getUserLogs(date, userId);

    if (logs.length === 0) {
      return null;
    }

    const username = logs[0].username;

    const userData: DailyUserData = {
      userId,
      username,
      date,
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
      photoTimestamps: [],
      uniquePhotos: 0 // Initialize with 0, will be set later
    };

    // Track unique photo hashes for deduplication (based on address)
    const seenPhotoHashes = new Set<string>();

    // Process logs
    for (const log of logs) {
      // Extract nested data structure (data.data contains actual log data)
      // WICHTIG: userAgent steht im Top-Level log.data (von enhancedLogging), nicht zwingend im inneren data-Objekt!
      const topLevelData = log.data as any;
      const logData = topLevelData.data || topLevelData;
      
      const trackingData: any = {
        userId,
        username,
        timestamp: log.timestamp
      };

      switch (log.logType) {
        case 'gps':
          // GPS data structure:
          // - New format: log.data = {endpoint, method, address, userAgent, data: {latitude, longitude, source}}
          // - Old format: log.data = {latitude, longitude, source}
          let gpsData = logData;
          
          // Check if data is nested (new format from enhancedLogging)
          if (logData.data && logData.data.latitude !== undefined) {
            gpsData = logData.data;
          }
          
          // Validate GPS coordinates
          if (gpsData.latitude !== undefined && gpsData.longitude !== undefined &&
              !isNaN(gpsData.latitude) && !isNaN(gpsData.longitude)) {
            // Use timestamp from data payload if available (especially for FollowMee/External), otherwise use log timestamp
            // This fixes the issue where FollowMee points use the fetch time instead of the device time
            let gpsTimestamp = log.timestamp;
            if (gpsData.timestamp) {
              const ts = new Date(gpsData.timestamp).getTime();
              if (!isNaN(ts)) {
                gpsTimestamp = ts;
              }
            }

            const gps: GPSCoordinates = {
              latitude: gpsData.latitude,
              longitude: gpsData.longitude,
              accuracy: gpsData.accuracy || 0,
              timestamp: gpsTimestamp,
              source: gpsData.source || 'native', // Default to 'native' if not specified
              // Extract User-Agent from top-level data (preferred) or inner data
              userAgent: topLevelData.userAgent || logData.userAgent || undefined 
            };
            
            userData.gpsPoints.push(gps);
            trackingData.gps = gps;

            // Distance calculation moved to after active time calculation
            // (needs to filter by walking speed and active periods)
          }
          break;

        case 'session':
          // Session data structure
          const sessionData = logData.session || logData;
          trackingData.session = sessionData;

          if (sessionData.sessionDuration !== undefined) {
            userData.totalSessionTime = sessionData.sessionDuration;
          }

          if (sessionData.idleTime !== undefined) {
            userData.totalIdleTime = sessionData.idleTime;
            // NOTE: activeTime wird am Ende aus nativen GPS-Punkten berechnet, nicht hier!
          }

          if (sessionData.actions && Array.isArray(sessionData.actions)) {
            sessionData.actions.forEach((action: ActionLog) => {
              userData.totalActions++;

              const count = userData.actionsByType.get(action.action) || 0;
              userData.actionsByType.set(action.action, count + 1);

              // Status changes
              if (action.action === 'status_change' && action.residentStatus) {
                if (action.previousStatus !== undefined) {
                  if (action.previousStatus !== action.residentStatus) {
                    const statusCount = userData.statusChanges.get(action.residentStatus) || 0;
                    userData.statusChanges.set(action.residentStatus, statusCount + 1);
                  }
                } else {
                  const statusCount = userData.statusChanges.get(action.residentStatus) || 0;
                  userData.statusChanges.set(action.residentStatus, statusCount + 1);
                }
              }
            });
          }
          break;

        case 'device':
          const deviceData = logData.device || logData;
          trackingData.device = deviceData;

          if (deviceData.batteryLevel !== undefined) {
            const totalPoints = userData.gpsPoints.length || 1;
            userData.avgBatteryLevel =
              (userData.avgBatteryLevel * (totalPoints - 1) + deviceData.batteryLevel) / totalPoints;

            if (deviceData.batteryLevel < 20 && !deviceData.isCharging) {
              userData.lowBatteryEvents++;
            }
          }

          if (deviceData.connectionType === 'offline') {
            userData.offlineEvents++;
          }
          break;

        case 'action':
          // SPECIAL CASE: External tracking might be misclassified as 'action'
          // If endpoint is external tracking OR if data contains GPS coordinates, treat as GPS and SKIP action counting
          const actionEndpoint = logData.endpoint || (log.data as any).endpoint || '';
          const hasGpsData = (logData.latitude !== undefined && logData.longitude !== undefined) ||
                             (logData.data?.latitude !== undefined && logData.data?.longitude !== undefined);

          if (actionEndpoint === '/api/external-tracking/location' || hasGpsData) {
             // Extract GPS data
             const lat = logData.data?.latitude || logData.latitude;
             const lon = logData.data?.longitude || logData.longitude;
             
             if (lat !== undefined && lon !== undefined) {
                const gps: GPSCoordinates = {
                  latitude: lat,
                  longitude: lon,
                  accuracy: logData.data?.accuracy || logData.accuracy || 0,
                  timestamp: log.timestamp,
                  source: logData.data?.source || logData.source || 'external_app'
                };
                userData.gpsPoints.push(gps);
                trackingData.gps = gps;
             }
             
             // Skip action counting
             break; 
          }

          // Action data from endpoints (address operations, photos, etc.)
          const actionData = logData;
          trackingData.action = actionData;
          
          // Extract action type from nested data structure OR infer from endpoint
          let actionType = actionData.data?.action || actionData.action;
          
          // If no explicit action, infer from endpoint (for historical data)
          if (!actionType && actionData.endpoint) {
            actionType = inferActionTypeFromEndpoint(actionData.endpoint, actionData.method);
          }
          
          // Only count if it's a real action (not just metadata)
          if (actionType && actionType !== 'unknown' && actionType !== 'gps_update' && actionType !== 'external_app') {
            userData.totalActions++;
            const count = userData.actionsByType.get(actionType) || 0;
            userData.actionsByType.set(actionType, count + 1);
          }
          
          // === PHOTO EXTRACTION ===
          // Only /api/ocr endpoint indicates a NEW photo upload
          // /api/ocr-correct is just text correction, NOT a new photo!
          // WICHTIG: endpoint kann in logData ODER in log.data sein (nested structure)
          const endpoint = logData.endpoint || (log.data as any).endpoint || '';
          const isPhotoUpload = endpoint === '/api/ocr';
          
          // DEBUG: Log first OCR request to see structure
          if (isPhotoUpload && seenPhotoHashes.size === 0) {
            console.log(`[Photo Debug] First /api/ocr found for ${username}:`);
            console.log(`  - endpoint from logData: "${logData.endpoint}"`);
            console.log(`  - endpoint from log.data: "${(log.data as any).endpoint}"`);
            console.log(`  - newProspects from logData: ${JSON.stringify(logData.newProspects)}`);
            console.log(`  - newProspects from log.data: ${JSON.stringify((log.data as any).newProspects)}`);
            console.log(`  - existingCustomers from logData: ${JSON.stringify(logData.existingCustomers)}`);
            console.log(`  - existingCustomers from log.data: ${JSON.stringify((log.data as any).existingCustomers)}`);
            console.log(`  - Full logData keys: ${Object.keys(logData).join(', ')}`);
            console.log(`  - Full log.data keys: ${Object.keys(log.data as any).join(', ')}`);
          }
          
          if (isPhotoUpload) {
            // Always track photo timestamp
            if (userData.photoTimestamps) {
              userData.photoTimestamps.push(log.timestamp);
            }
            
            // Deduplicate based on OCR extracted data (Column G + H)
            // newProspects (Column G) = ausgelesene neue Namen vom Foto
            // existingCustomers (Column H) = ausgelesene bekannte Kunden vom Foto
            // WICHTIG: Adresse NICHT im Hash - User könnte Adresse ändern und dasselbe Foto nochmal hochladen!
            // WICHTIG: Daten können in logData ODER in log.data sein (nested structure)
            const newProspects = logData.newProspects || (log.data as any).newProspects || [];
            const existingCustomers = logData.existingCustomers || (log.data as any).existingCustomers || [];
            
            // Generate hash ONLY from extracted names (Column G + H), NOT address!
            const prospectData = {
              newProspects,
              existingCustomers
            };
            const photoHash = generatePhotoHash(prospectData);
            
            // Only count unique photos (same extracted data = same photo)
            if (!seenPhotoHashes.has(photoHash)) {
              seenPhotoHashes.add(photoHash);
            }
          }
          
          // === ADDRESS EXTRACTION ===
          // WICHTIG: address kann in logData, actionData ODER log.data sein
          const address = logData.address || (log.data as any).address || actionData.address || actionData.normalizedAddress;
          if (address && typeof address === 'string') {
            userData.uniqueAddresses.add(address);
          }
          
          // === STATUS CHANGES EXTRACTION ===
          // 1. Direct status field (single resident update: resident_update action)
          const status = actionData.residentStatus || actionData.newCategory || actionData.status;
          if (status && typeof status === 'string') {
            const normalizedStatus = normalizeStatusKey(status);
            const statusCount = userData.statusChanges.get(normalizedStatus) || 0;
            userData.statusChanges.set(normalizedStatus, statusCount + 1);
          }
          
          // 2. Bulk updates - residents array contains all status changes
          // NOTE: These are NOT counted as separate 'status_change' actions!
          // They are part of the bulk_residents_update action itself
          if (actionType === 'bulk_residents_update' && actionData.residents && Array.isArray(actionData.residents)) {
            actionData.residents.forEach((resident: any) => {
              if (resident.status && typeof resident.status === 'string') {
                const normalizedStatus = normalizeStatusKey(resident.status);
                const statusCount = userData.statusChanges.get(normalizedStatus) || 0;
                userData.statusChanges.set(normalizedStatus, statusCount + 1);
              }
            });
          }
          
          // 3. Legacy newProspects/existingCustomers fields (from Google Sheets era)
          // WICHTIG: Daten können in logData ODER log.data sein
          const newProspectsLegacy = logData.newProspects || (log.data as any).newProspects || actionData.newProspects;
          const existingCustomersLegacy = logData.existingCustomers || (log.data as any).existingCustomers || actionData.existingCustomers;
          
          if (newProspectsLegacy && Array.isArray(newProspectsLegacy) && newProspectsLegacy.length > 0) {
            const interestCount = userData.statusChanges.get('interessiert') || 0;
            userData.statusChanges.set('interessiert', interestCount + newProspectsLegacy.length);
          }
          
          if (existingCustomersLegacy && Array.isArray(existingCustomersLegacy) && existingCustomersLegacy.length > 0) {
            // Legacy: existingCustomers → 'geschrieben' status (normalized from 'written')
            const writtenCount = userData.statusChanges.get('geschrieben') || 0;
            userData.statusChanges.set('geschrieben', writtenCount + existingCustomersLegacy.length);
          }
          break;
      }

      userData.rawLogs.push(trackingData);
    }

    // Calculate KPIs
    const hoursActive = userData.activeTime / (1000 * 60 * 60);
    userData.scansPerHour = hoursActive > 0 ? userData.totalActions / hoursActive : 0;

    const scanCount = userData.actionsByType.get('scan') || 0;
    userData.avgTimePerAddress = scanCount > 0 ? userData.activeTime / scanCount : 0;

    const interested = userData.statusChanges.get('interessiert') || 0;
    const totalStatusChanges = Array.from(userData.statusChanges.values()).reduce((a, b) => a + b, 0);
    userData.conversionRate = totalStatusChanges > 0 ? (interested / totalStatusChanges) * 100 : 0;

    // Set uniquePhotos from deduplicated hashes (not photoTimestamps.length!)
    userData.uniquePhotos = seenPhotoHashes.size;
    
    // DEBUG: Log final photo count
    console.log(`[Photo Count] ${username}: ${seenPhotoHashes.size} unique photos (from ${userData.photoTimestamps?.length || 0} total OCR uploads)`);

    // === CALCULATE FINAL STATUSES ===
    // finalStatuses = LETZTER Status pro Anwohner (datasetId + residentName)
    // Baue Timeline aller Status-Änderungen, gruppiert nach Anwohner
    const residentStatusTimeline = new Map<string, Array<{ status: string; timestamp: number }>>();
    
    // Durchlaufe alle Logs und sammle Status-Änderungen
    for (const log of logs) {
      const logData = (log.data as any).data || log.data;
      
      if (log.logType === 'session' && logData.session?.actions) {
        logData.session.actions.forEach((action: any) => {
          if (action.residentStatus && action.details) {
            // Extrahiere Anwohner-Identifikation aus details
            // Format: "Resident: Max Mustermann" oder "Dataset: ds_123, Resident: Max"
            const residentMatch = action.details.match(/Resident:\s*(.+?)(?:,|$)/);
            const datasetMatch = action.details.match(/Dataset:\s*([^,]+)/);
            
            if (residentMatch) {
              const residentName = residentMatch[1].trim();
              const datasetId = datasetMatch ? datasetMatch[1].trim() : 'unknown';
              const key = `${datasetId}::${residentName}`;
              
              if (!residentStatusTimeline.has(key)) {
                residentStatusTimeline.set(key, []);
              }
              
              residentStatusTimeline.get(key)!.push({
                status: normalizeStatusKey(action.residentStatus),
                timestamp: log.timestamp
              });
            }
          }
        });
      } else if (log.logType === 'action') {
        const actionData = logData;
        const actionType = actionData.action || 'unknown';
        
        // Bulk updates: Jeder Resident mit Status wird getrackt
        if (actionType === 'bulk_residents_update' && actionData.residents && Array.isArray(actionData.residents)) {
          const datasetId = actionData.datasetId || 'unknown';
          
          actionData.residents.forEach((resident: any) => {
            if (resident.status && resident.name) {
              const key = `${datasetId}::${resident.name}`;
              
              if (!residentStatusTimeline.has(key)) {
                residentStatusTimeline.set(key, []);
              }
              
              residentStatusTimeline.get(key)!.push({
                status: normalizeStatusKey(resident.status),
                timestamp: log.timestamp
              });
            }
          });
        }
        
        // Einzelne Resident Updates
        if (actionData.residentStatus && actionData.residentName) {
          const datasetId = actionData.datasetId || 'unknown';
          const key = `${datasetId}::${actionData.residentName}`;
          
          if (!residentStatusTimeline.has(key)) {
            residentStatusTimeline.set(key, []);
          }
          
          residentStatusTimeline.get(key)!.push({
            status: normalizeStatusKey(actionData.residentStatus),
            timestamp: log.timestamp
          });
        }
      }
    }
    
    // Berechne finalStatuses: Nimm LETZTEN Status pro Anwohner
    const finalStatuses = new Map<string, number>();
    
    residentStatusTimeline.forEach((timeline, residentKey) => {
      if (timeline.length > 0) {
        // Sortiere nach timestamp (chronologisch)
        timeline.sort((a, b) => a.timestamp - b.timestamp);
        
        // Letzter Status = finaler Status für diesen Anwohner
        const finalStatus = timeline[timeline.length - 1].status;
        
        const count = finalStatuses.get(finalStatus) || 0;
        finalStatuses.set(finalStatus, count + 1);
      }
    });
    
    userData.finalStatuses = finalStatuses;
    
    // === CALCULATE CONVERSION RATES ===
    // Finde interessiert → geschrieben/termin_vereinbart/nicht_interessiert/nicht_angetroffen Übergänge
    const conversionRates = {
      interest_later_to_written: 0,
      interest_later_to_no_interest: 0,
      interest_later_to_appointment: 0,
      interest_later_to_not_reached: 0,
      interest_later_total: 0
    };
    
    residentStatusTimeline.forEach((timeline) => {
      if (timeline.length > 1) {
        // Sortiere nach timestamp
        timeline.sort((a, b) => a.timestamp - b.timestamp);
        
        // Durchlaufe Timeline und finde interessiert → X Übergänge (normalized keys!)
        for (let i = 0; i < timeline.length - 1; i++) {
          const currentStatus = timeline[i].status;
          const nextStatus = timeline[i + 1].status;
          
          if (currentStatus === 'interessiert') {
            conversionRates.interest_later_total++;
            
            if (nextStatus === 'geschrieben') {
              conversionRates.interest_later_to_written++;
            } else if (nextStatus === 'nicht_interessiert') {
              conversionRates.interest_later_to_no_interest++;
            } else if (nextStatus === 'termin_vereinbart') {
              conversionRates.interest_later_to_appointment++;
            } else if (nextStatus === 'nicht_angetroffen') {
              conversionRates.interest_later_to_not_reached++;
            }
          }
        }
      }
    });
    
    userData.conversionRates = conversionRates;
    
    // Debug log final statuses and conversions
    if (finalStatuses.size > 0) {
      console.log(`[SQLiteHistorical] ${username} finalStatuses:`, Array.from(finalStatuses.entries()));
    }
    if (conversionRates.interest_later_total > 0) {
      console.log(`[SQLiteHistorical] ${username} conversions:`, conversionRates);
    }

    // Sort GPS points by timestamp to ensure correct route order
    userData.gpsPoints.sort((a, b) => a.timestamp - b.timestamp);
    
    // Sort photoTimestamps
    if (userData.photoTimestamps) {
      userData.photoTimestamps.sort((a, b) => a - b);
    }
    
    // Sort rawLogs by timestamp
    userData.rawLogs.sort((a, b) => a.timestamp - b.timestamp);

    // === CALCULATE DISTANCE (with walking speed filter) ===
    // Recalculate distance using only GPS points during active periods and walking speed
    const WALKING_SPEED_KMH = 8;
    const nativeGpsPoints = userData.gpsPoints.filter(p => p.source === 'native' || !p.source);
    
    let totalDistance = 0;
    for (let i = 1; i < nativeGpsPoints.length; i++) {
      const prevPoint = nativeGpsPoints[i - 1];
      const currPoint = nativeGpsPoints[i];
      const gap = currPoint.timestamp - prevPoint.timestamp;
      
      const distance = calculateDistance(
        { latitude: prevPoint.latitude, longitude: prevPoint.longitude, accuracy: 0, timestamp: 0 },
        { latitude: currPoint.latitude, longitude: currPoint.longitude, accuracy: 0, timestamp: 0 }
      );
      
      // Calculate speed in km/h
      const timeDiffHours = gap / (1000 * 60 * 60);
      const speedKmh = timeDiffHours > 0 ? (distance / 1000) / timeDiffHours : 0;
      
      // Only count distance if walking speed (< 8 km/h)
      if (speedKmh < WALKING_SPEED_KMH) {
        totalDistance += distance;
      }
    }
    userData.totalDistance = totalDistance;

    // === CALCULATE ACTIVE TIME ===
    // Aktive Zeit = Zeitspanne zwischen frühester und spätester NATIVER App-Statusmeldung - Pausezeiten
    // Pausen = Lücken zwischen nativen GPS-Punkten > 20 Minuten
    
    if (nativeGpsPoints.length >= 2) {
      // 2. Zeitspanne zwischen erstem und letztem nativen Punkt
      const firstNativeTimestamp = nativeGpsPoints[0].timestamp;
      const lastNativeTimestamp = nativeGpsPoints[nativeGpsPoints.length - 1].timestamp;
      const totalTimeSpan = lastNativeTimestamp - firstNativeTimestamp;
      
      // 3. Berechne Pausen (Lücken > 20 Minuten zwischen nativen Punkten)
      const MIN_BREAK_MS = 20 * 60 * 1000; // 20 Minuten
      let totalBreakTime = 0;
      
      for (let i = 1; i < nativeGpsPoints.length; i++) {
        const gap = nativeGpsPoints[i].timestamp - nativeGpsPoints[i - 1].timestamp;
        if (gap >= MIN_BREAK_MS) {
          totalBreakTime += gap;
        }
      }
      
      // 4. Aktive Zeit = Gesamtzeitspanne - Pausezeiten
      userData.activeTime = totalTimeSpan - totalBreakTime;
      
      console.log(`[SQLiteHistorical] ${username} activeTime: ${Math.round(userData.activeTime / 60000)}min (total span: ${Math.round(totalTimeSpan / 60000)}min, breaks: ${Math.round(totalBreakTime / 60000)}min from ${nativeGpsPoints.length} native GPS points)`);
    } else if (nativeGpsPoints.length === 1) {
      // Nur ein nativer Punkt - keine Zeitspanne berechenbar
      userData.activeTime = 0;
      console.log(`[SQLiteHistorical] ${username} activeTime: 0min (only 1 native GPS point)`);
    } else {
      // Keine nativen GPS-Punkte - fallback auf session data falls vorhanden
      if (userData.totalSessionTime > 0) {
        userData.activeTime = userData.totalSessionTime - userData.totalIdleTime;
        console.log(`[SQLiteHistorical] ${username} activeTime: ${Math.round(userData.activeTime / 60000)}min (from session data, no native GPS)`);
      } else {
        userData.activeTime = 0;
        console.log(`[SQLiteHistorical] ${username} activeTime: 0min (no native GPS or session data)`);
      }
    }

    // Debug log with status changes count
    console.log(`[SQLiteHistorical] Reconstructed ${username}: ${userData.totalActions} actions, ${userData.gpsPoints.length} GPS (${nativeGpsPoints.length} native), ${userData.photoTimestamps?.length || 0} photos, ${totalStatusChanges} status changes, ${(userData.totalDistance / 1000).toFixed(2)}km, ${Math.round(userData.activeTime / 60000)}min active`);

    return userData;
  } catch (error) {
    console.error(`[SQLiteHistorical] Error reconstructing data for user ${userId}:`, error);
    return null;
  }
}

/**
 * Generiert Hash für Photo-Duplikats-Erkennung aus OCR-Daten
 * Nutzt dieselbe Logik wie dailyDataStore.trackOCRPhoto()
 * Hash basiert ONLY auf OCR-extrahierten Daten (newProspects + existingCustomers)
 * NICHT auf Adresse (user könnte Adresse ändern) oder Timestamp!
 */
function generatePhotoHash(prospectData: any): string {
  const dataString = JSON.stringify(prospectData);
  return crypto.createHash('md5').update(dataString).digest('hex');
}

/**
 * Berechnet Distanz zwischen zwei GPS-Punkten (Haversine)
 */
function calculateDistance(coord1: GPSCoordinates, coord2: GPSCoordinates): number {
  const R = 6371000; // Erdradius in Metern
  const dLat = (coord2.latitude - coord1.latitude) * Math.PI / 180;
  const dLon = (coord2.longitude - coord1.longitude) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.latitude * Math.PI / 180) *
      Math.cos(coord2.latitude * Math.PI / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Cache für historische Daten (kompatibel mit altem System)
 */
const historicalCache = new Map<string, DailyUserData[]>();

/**
 * Löscht den historischen Cache
 * @param date - Optional: Nur Cache für dieses Datum löschen
 * @param userId - Optional: Nur Cache für diesen User löschen (wird ignoriert, da nicht implementiert)
 */
export function clearHistoricalCache(date?: string, userId?: string): void {
  if (date) {
    historicalCache.delete(date);
    console.log(`[SQLiteHistorical] Cache cleared for ${date}`);
  } else {
    historicalCache.clear();
    console.log('[SQLiteHistorical] Cache cleared');
  }
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: historicalCache.size,
    keys: Array.from(historicalCache.keys())
  };
}
