/**
 * Pause Location Cache Service
 * 
 * Manages POI (Point of Interest) data for pause locations:
 * - RAM cache for fast lookups
 * - Google Sheets persistence (PauseLocations sheet)
 * - 50m radius matching for cached locations
 * - Google Places API integration
 */

import { google } from 'googleapis';

const SHEET_ID = process.env.PAUSE_LOCATIONS_SHEET_ID || '';
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

  /**
   * Initialize cache by loading from Google Sheets
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[PauseLocationCache] Initializing cache from Google Sheets...');

    try {
      const auth = getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      // Check if sheet exists, create if not
      await this.ensureSheetExists(sheets);

      // Load data from sheet
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:G`, // Skip header row
      });

      const rows = response.data.values || [];
      
      for (const row of rows) {
        if (row.length < 7) continue; // Skip incomplete rows

        const [lat, lng, name, type, address, placeId, createdAt] = row;
        const key = this.getCacheKey(parseFloat(lat), parseFloat(lng));

        this.cache.set(key, {
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          name,
          type,
          address,
          placeId,
          createdAt: parseInt(createdAt, 10),
        });
      }

      this.initialized = true;
      console.log(`[PauseLocationCache] Loaded ${this.cache.size} locations from sheet`);
    } catch (error) {
      console.error('[PauseLocationCache] Failed to initialize:', error);
      throw error;
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

  /**
   * Generate cache key from coordinates (rounded to 6 decimals ~0.11m precision)
   */
  private getCacheKey(lat: number, lng: number): string {
    const latRounded = Math.round(lat * 1000000) / 1000000;
    const lngRounded = Math.round(lng * 1000000) / 1000000;
    return `${latRounded},${lngRounded}`;
  }

  /**
   * Find cached location within 50m radius
   */
  findNearby(lat: number, lng: number, radiusMeters: number = 50): POIInfo | null {
    const entries = Array.from(this.cache.values());
    for (const poi of entries) {
      const distance = calculateDistance(lat, lng, poi.lat, poi.lng);
      if (distance <= radiusMeters) {
        return { ...poi, distance: Math.round(distance) };
      }
    }
    return null;
  }

  /**
   * Fetch POI from Google Places API
   */
  private async fetchFromPlacesAPI(lat: number, lng: number): Promise<POIInfo[]> {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=50&key=${API_KEY}&language=de`;

    console.log(`[PauseLocationCache] Places API request for ${lat}, ${lng}`);

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
   * Save POI to cache and Google Sheets
   */
  private async savePOI(poi: POIInfo): Promise<void> {
    const key = this.getCacheKey(poi.lat, poi.lng);

    // Save to RAM cache
    this.cache.set(key, poi);

    // Save to Google Sheets
    try {
      const auth = getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:G`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            poi.lat,
            poi.lng,
            poi.name,
            poi.type,
            poi.address,
            poi.placeId,
            poi.createdAt,
          ]],
        },
      });

      console.log(`[PauseLocationCache] Saved POI to sheet: ${poi.name}`);
    } catch (error) {
      console.error('[PauseLocationCache] Failed to save POI to sheet:', error);
      // Continue anyway - at least it's in RAM cache
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
      console.log(`[PauseLocationCache] Cache HIT: ${cached.name} (${cached.distance}m away)`);
      return [cached];
    }

    // Cache miss - fetch from Places API
    console.log(`[PauseLocationCache] Cache MISS - fetching from Places API`);
    const pois = await this.fetchFromPlacesAPI(lat, lng);

    if (pois.length === 0) {
      console.log('[PauseLocationCache] No POIs found for location');
      return [];
    }

    // Save all POIs to cache (they might be useful for nearby queries)
    for (const poi of pois) {
      await this.savePOI(poi);
    }

    return pois;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      initialized: this.initialized,
    };
  }
}

// Singleton instance
export const pauseLocationCache = new PauseLocationCacheService();
