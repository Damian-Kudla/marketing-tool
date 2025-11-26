/**
 * Pause Location Cache Service
 * 
 * Manages POI (Point of Interest) data for pause locations:
 * - RAM cache for fast lookups
 * - Local SQLite persistence (PRIMARY)
 * - Google Sheets persistence (PauseLocations sheet) - BACKUP
 * - 50m radius matching for cached locations
 * - Google Places API integration
 */

import { google } from './googleApiWrapper';
import { pauseLocationsDB } from './systemDatabaseService';

// NOTE: Using SYSTEM_SHEET_ID now (separate from user logs)
const SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';
const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY || '';
const SHEET_NAME = 'PauseLocations';

// Get Google Sheets credentials
const getGoogleAuth = () => {
  try {
    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    if (!sheetsKey) throw new Error('GOOGLE_SHEETS_KEY not found');
    
    const credentials = JSON.parse(sheetsKey);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch (error) {
    console.error('[PauseLocationCache] Failed to initialize Google Auth:', error);
    throw error;
  }
};

export interface POIInfo {
  lat: number;
  lng: number;
  name: string;
  type: string;
  address: string;
  placeId: string;
  distance?: number; // Distance from query point in meters
  createdAt: number;
}

/**
 * Calculate distance between two points using Haversine formula (meters)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

class PauseLocationCacheService {
  private cache: Map<string, POIInfo> = new Map();
  private initialized = false;
  
  // Cache statistics
  private stats = {
    hits: 0,
    misses: 0,
    apiCalls: 0,
    savedPOIs: 0,
  };

  /**
   * Initialize cache: First from SQLite, then merge from Google Sheets
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[PauseLocationCache] Initializing cache (SQLite + Sheets)...');

    try {
      // Step 1: Load from SQLite (PRIMARY SOURCE)
      const sqliteLocations = pauseLocationsDB.getAll();
      const seenPlaceIds = new Set<string>();
      
      for (const loc of sqliteLocations) {
        if (seenPlaceIds.has(loc.placeId)) continue;
        seenPlaceIds.add(loc.placeId);
        
        this.cache.set(loc.placeId, {
          lat: loc.lat,
          lng: loc.lng,
          name: loc.name,
          type: loc.type,
          address: loc.address || '',
          placeId: loc.placeId,
          createdAt: loc.createdAt,
        });
      }
      
      console.log(`[PauseLocationCache] Loaded ${this.cache.size} locations from SQLite`);

      // Step 2: Merge from Sheets (if available)
      try {
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        await this.ensureSheetExists(sheets);

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A2:G`,
        });

        const rows = response.data.values || [];
        let mergedFromSheets = 0;
        
        for (const row of rows) {
          if (row.length < 6) continue;

          const [latStr, lngStr, name, type, address, placeId, createdAt] = row;
          
          // Skip if already in cache
          if (seenPlaceIds.has(placeId)) continue;
          seenPlaceIds.add(placeId);
          
          const lat = parseFloat(latStr.toString().replace(',', '.'));
          const lng = parseFloat(lngStr.toString().replace(',', '.'));
          const timestamp = parseInt(createdAt, 10) || Date.now();
          
          this.cache.set(placeId, {
            lat,
            lng,
            name,
            type,
            address: address || '',
            placeId,
            createdAt: timestamp,
          });
          
          // Also persist to SQLite
          try {
            pauseLocationsDB.upsert({
              placeId,
              lat,
              lng,
              name,
              type,
              address: address || undefined,
              createdAt: timestamp,
            });
          } catch (e) {
            // Ignore SQLite errors during merge
          }
          
          mergedFromSheets++;
        }

        console.log(`[PauseLocationCache] Merged ${mergedFromSheets} additional locations from Sheets`);
      } catch (error) {
        console.warn('[PauseLocationCache] Could not load from Sheets, using SQLite data only:', error);
      }

      this.initialized = true;
      console.log(`[PauseLocationCache] Total: ${this.cache.size} unique locations`);
    } catch (error) {
      console.error('[PauseLocationCache] Failed to initialize:', error);
      // Still mark as initialized if we have any data
      if (this.cache.size > 0) {
        this.initialized = true;
        console.log(`[PauseLocationCache] Using ${this.cache.size} locations from partial load`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Ensure PauseLocations sheet exists, create if not
   */
  private async ensureSheetExists(sheets: any): Promise<void> {
    try {
      // Get spreadsheet metadata
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
      });

      const sheetExists = metadata.data.sheets?.some(
        (s: any) => s.properties.title === SHEET_NAME
      );

      if (!sheetExists) {
        console.log('[PauseLocationCache] Creating PauseLocations sheet...');

        // Create sheet
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: SHEET_NAME,
                  },
                },
              },
            ],
          },
        });

        // Add header row
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A1:G1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['lat', 'lng', 'poi_name', 'poi_type', 'address', 'place_id', 'created_at']],
          },
        });

        console.log('[PauseLocationCache] Sheet created with headers');
      }
    } catch (error) {
      console.error('[PauseLocationCache] Error ensuring sheet exists:', error);
      throw error;
    }
  }

  // Cache key is now place_id (removed getCacheKey method)

  /**
   * Find cached location within 50m radius
   * Returns the CLOSEST POI within radius (not just first match)
   */
  findNearby(lat: number, lng: number, radiusMeters: number = 50): POIInfo | null {
    const entries = Array.from(this.cache.values());
    let closestPOI: POIInfo | null = null;
    let closestDistance = Infinity;
    
    for (const poi of entries) {
      const distance = calculateDistance(lat, lng, poi.lat, poi.lng);
      if (distance <= radiusMeters && distance < closestDistance) {
        closestDistance = distance;
        closestPOI = { ...poi, distance: Math.round(distance) };
      }
    }
    
    if (closestPOI) {
      console.log(`[PauseLocationCache] Found nearby POI: ${closestPOI.name} at ${closestPOI.distance}m`);
    }
    
    return closestPOI;
  }

  /**
   * Fetch POI from Google Places API
   */
  private async fetchFromPlacesAPI(lat: number, lng: number): Promise<POIInfo[]> {
    this.stats.apiCalls++;
    
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=50&key=${API_KEY}&language=de`;

    console.log(`[PauseLocationCache] Places API request for ${lat}, ${lng} (Total: ${this.stats.apiCalls})`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${data.status} - ${data.error_message || 'Unknown'}`);
    }

    if (!data.results || data.results.length === 0) {
      console.log('[PauseLocationCache] No places found');
      return [];
    }

    // Filter out irrelevant types
    const filtered = data.results.filter((p: any) =>
      !p.types.includes('route') &&
      !p.types.includes('locality') &&
      !p.types.includes('political')
    );

    if (filtered.length === 0) return [];

    // Calculate distances and select relevant POIs (20% tolerance + parking rule)
    const withDistance = filtered.map((p: any) => ({
      ...p,
      distance: calculateDistance(lat, lng, p.geometry.location.lat, p.geometry.location.lng),
    }));

    withDistance.sort((a: any, b: any) => a.distance - b.distance);

    const closest = withDistance[0];
    const maxDistance = closest.distance * 1.2; // 20% tolerance

    // Get all within tolerance
    let candidates = withDistance.filter((p: any) => p.distance <= maxDistance);

    // Special rule: Always include parking if present
    const parking = withDistance.find((p: any) => p.types.includes('parking'));
    if (parking && !candidates.includes(parking)) {
      candidates.push(parking);
    }

    // Convert to POIInfo format
    return candidates.map((p: any) => ({
      lat: p.geometry.location.lat,
      lng: p.geometry.location.lng,
      name: p.name,
      type: p.types[0],
      address: p.vicinity || '',
      placeId: p.place_id,
      distance: Math.round(p.distance),
      createdAt: Date.now(),
    }));
  }

  /**
   * Save multiple POIs to SQLite, cache and Google Sheets (batch)
   * Checks for duplicate place_id to prevent redundant saves
   */
  private async savePOIs(pois: POIInfo[]): Promise<void> {
    if (pois.length === 0) return;

    // Filter out duplicates (already in cache)
    const newPOIs = pois.filter(poi => !this.cache.has(poi.placeId));
    
    if (newPOIs.length === 0) {
      console.log(`[PauseLocationCache] All ${pois.length} POIs already in cache, skipping save`);
      return;
    }
    
    this.stats.savedPOIs += newPOIs.length;
    console.log(`[PauseLocationCache] Saving ${newPOIs.length}/${pois.length} new POIs (${pois.length - newPOIs.length} duplicates skipped)`);

    // Save to RAM cache using place_id as key
    for (const poi of newPOIs) {
      this.cache.set(poi.placeId, poi);
    }

    // Step 1: Save to SQLite (PRIMARY)
    try {
      const inserted = pauseLocationsDB.upsertBatch(newPOIs.map(poi => ({
        placeId: poi.placeId,
        lat: poi.lat,
        lng: poi.lng,
        name: poi.name,
        type: poi.type,
        address: poi.address || undefined,
        createdAt: poi.createdAt,
      })));
      console.log(`[PauseLocationCache] Saved ${inserted} POIs to SQLite`);
    } catch (error) {
      console.error('[PauseLocationCache] Failed to save POIs to SQLite:', error);
    }

    // Step 2: Save to Google Sheets (BACKUP) - with duplicate prevention
    try {
      const auth = getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      // Get existing placeIds from Sheets to prevent duplicates
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!F2:F`, // Column F = place_id
      });

      const existingPlaceIds = new Set((response.data.values || []).map(row => row[0]));

      // Filter out POIs that already exist in Sheets
      const poisToAdd = newPOIs.filter(poi => !existingPlaceIds.has(poi.placeId));

      if (poisToAdd.length === 0) {
        console.log(`[PauseLocationCache] All ${newPOIs.length} POIs already in Sheets, skipping append`);
        return;
      }

      const rows = poisToAdd.map(poi => [
        poi.lat,
        poi.lng,
        poi.name,
        poi.type,
        poi.address,
        poi.placeId,
        poi.createdAt,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:G`,
        valueInputOption: 'RAW',
        requestBody: {
          values: rows,
        },
      });

      console.log(`[PauseLocationCache] Saved ${poisToAdd.length}/${newPOIs.length} new POIs to Sheets (${newPOIs.length - poisToAdd.length} duplicates skipped)`);
    } catch (error) {
      console.warn('[PauseLocationCache] Failed to save POIs to Sheets (SQLite backup exists):', error);
    }
  }

  /**
   * Get POI information for a location (cache-first, then API)
   * Returns array of POIs (may be multiple within 20% distance tolerance)
   */
  async getPOIInfo(lat: number, lng: number): Promise<POIInfo[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache first
    const cached = this.findNearby(lat, lng);
    if (cached) {
      this.stats.hits++;
      const hitRate = ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1);
      console.log(`[PauseLocationCache] Cache HIT: ${cached.name} (${cached.distance}m) | Hit rate: ${hitRate}%`);
      return [cached];
    }

    // Cache miss - fetch from Places API
    this.stats.misses++;
    const hitRate = ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1);
    console.log(`[PauseLocationCache] Cache MISS (${this.stats.misses}) | Hit rate: ${hitRate}%`);
    
    const pois = await this.fetchFromPlacesAPI(lat, lng);

    if (pois.length === 0) {
      console.log('[PauseLocationCache] No POIs found for location');
      return [];
    }

    // Batch save all POIs to cache
    await this.savePOIs(pois);

    return pois;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1)
      : '0.0';

    return {
      cacheSize: this.cache.size,
      initialized: this.initialized,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      apiCalls: this.stats.apiCalls,
      savedPOIs: this.stats.savedPOIs,
      estimatedCost: `$${(this.stats.apiCalls * 0.017).toFixed(2)}`,
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      apiCalls: 0,
      savedPOIs: 0,
    };
  }
}

// Singleton instance
export const pauseLocationCache = new PauseLocationCacheService();
