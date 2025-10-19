/**
 * Nominatim (OpenStreetMap) Geocoding Service
 * 
 * Kostenlose Alternative zu Google Geocoding API
 * - Bessere Ergebnisse für echte Straßenadressen
 * - Keine API-Kosten
 * - Rate Limit: 1 Request/Sekunde (wird automatisch eingehalten)
 */

interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: NominatimAddress;
  type: string;
  class: string;
  importance: number;
}

interface NormalizedNominatimAddress {
  formattedAddress: string;
  street: string;
  number: string;
  city: string;
  postal: string;
  lat: number;
  lon: number;
}

// ============================================================================
// QUEUE-BASED RATE LIMITING
// ============================================================================
// Nominatim requires max 1 request per second
// With 15-20 concurrent users, we need a queue to prevent rate limit violations

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  timestamp: number;
}

class NominatimQueue {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private readonly INTERVAL = 1000; // 1 request per second
  private lastRequestTime = 0;

  /**
   * Add a request to the queue and return a Promise that resolves when the request completes
   */
  async enqueue<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedRequest: QueuedRequest<T> = {
        execute: requestFn,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.queue.push(queuedRequest);
      
      const queueLength = this.queue.length;
      if (queueLength > 1) {
        console.log(`[Nominatim Queue] Request queued. Position: ${queueLength}/${queueLength}`);
      }

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process requests from the queue at 1 request per second
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return; // Already processing
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      
      try {
        // Enforce rate limit: wait until 1 second has passed since last request
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.INTERVAL) {
          const waitTime = this.INTERVAL - timeSinceLastRequest;
          console.log(`[Nominatim Queue] Rate limit: waiting ${waitTime}ms (${this.queue.length} requests in queue)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Execute the request
        this.lastRequestTime = Date.now();
        const queueTime = this.lastRequestTime - request.timestamp;
        
        if (queueTime > 100) {
          console.log(`[Nominatim Queue] Processing request (queued for ${queueTime}ms)`);
        }
        
        const result = await request.execute();
        request.resolve(result);
        
      } catch (error) {
        console.error('[Nominatim Queue] Request failed:', error);
        request.reject(error);
      }
    }

    this.processing = false;
  }

  /**
   * Get current queue status (for monitoring)
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      lastRequestTime: this.lastRequestTime,
    };
  }
}

// Global queue instance
const nominatimQueue = new NominatimQueue();

/**
 * Geocode an address using Nominatim (OpenStreetMap)
 * 
 * @param street - Street name (e.g., "Neusser Weyhe")
 * @param number - House number (e.g., "39")
 * @param postal - Postal code (e.g., "41462")
 * @param city - City name (e.g., "Neuss")
 * @returns Normalized address or null if not found
 */
export async function geocodeWithNominatim(
  street: string,
  number: string,
  postal?: string,
  city?: string
): Promise<NormalizedNominatimAddress | null> {
  // Validate required fields BEFORE queueing
  if (!street || !street.trim()) {
    console.warn('[Nominatim] Street is required');
    return null;
  }
  if (!number || !number.trim()) {
    console.warn('[Nominatim] House number is required');
    return null;
  }

  // Enqueue the request - it will be processed at 1 req/sec automatically
  return nominatimQueue.enqueue(async () => {
    try {
      // Construct address query WITH house number first
      const addressParts = [
        `${street} ${number}`,
        postal,
        city,
        'Deutschland'
      ].filter(Boolean);
      const addressQuery = addressParts.join(', ');

      // Make request to Nominatim
      let url = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(addressQuery)}&` +
        `format=json&` +
        `addressdetails=1&` +
        `limit=1`;

      console.log('[Nominatim] Geocoding:', addressQuery);

      let response = await fetch(url, {
        headers: {
          'User-Agent': 'EnergyScanCapture/1.0 (Energy scanning application)',
          'Accept-Language': 'de',
        },
      });

      if (!response.ok) {
        console.warn('[Nominatim] HTTP error:', response.status, response.statusText);
        return null;
      }

      let results: NominatimResult[] = await response.json();

      // FALLBACK: If no results with house number, try WITHOUT house number (street only)
      if (!results || results.length === 0) {
        console.log('[Nominatim] No results with house number, trying street only...');
        
        // IMPORTANT: Wait 1 second to respect Nominatim rate limit (1 req/sec)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const streetOnlyParts = [
          street,
          postal,
          city,
          'Deutschland'
        ].filter(Boolean);
        const streetOnlyQuery = streetOnlyParts.join(', ');

        url = `https://nominatim.openstreetmap.org/search?` +
          `q=${encodeURIComponent(streetOnlyQuery)}&` +
          `format=json&` +
          `addressdetails=1&` +
          `limit=1`;

        console.log('[Nominatim] Trying street-only search:', streetOnlyQuery);

        response = await fetch(url, {
          headers: {
            'User-Agent': 'EnergyScanCapture/1.0 (Energy scanning application)',
            'Accept-Language': 'de',
          },
        });

        if (!response.ok) {
          console.warn('[Nominatim] HTTP error on street-only search:', response.status, response.statusText);
          return null;
        }

        results = await response.json();
      }

      if (!results || results.length === 0) {
        console.warn('[Nominatim] No results found for street:', street);
        return null;
      }

      const result = results[0];
      const address = result.address;

      // Validate that we have a street (road)
      if (!address.road) {
        console.warn('[Nominatim] No street (road) found in result');
        console.warn('[Nominatim] Result type:', result.type, 'class:', result.class);
        return null;
      }

      // IMPROVED: Accept street even if house number not found by Nominatim
      // This allows for any house number on existing streets (e.g., new buildings)
      if (!address.house_number) {
        console.log('[Nominatim] ⚠️ Street found, but house number not in OSM database');
        console.log('[Nominatim] ✅ Accepting street and using user-provided house number:', number);
        
        // Use user's original house number since Nominatim doesn't have it
        return {
          formattedAddress: `${address.road} ${number}, ${address.postcode || postal} ${address.city || address.county || city}, Deutschland`,
          street: address.road,
          number: number, // Use original user input for house number
          city: address.city || address.county || city || '',
          postal: address.postcode || postal || '',
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon),
        };
      }

      // Validate that result is a building/residential address (not a POI or area)
      // Only check this if we found an exact house number match
      const validTypes = ['building', 'residential', 'house', 'apartments'];
      if (!validTypes.includes(result.type)) {
        console.warn('[Nominatim] Invalid result type:', result.type);
        console.warn('[Nominatim] Expected one of:', validTypes.join(', '));
        return null;
      }

      console.log('[Nominatim] ✅ Valid address found:', result.display_name);
      console.log('[Nominatim] Street:', address.road, 'Number:', address.house_number);

      return {
        formattedAddress: result.display_name,
        street: address.road,
        number: address.house_number, // Use Nominatim's validated house number
        city: address.city || address.county || '',
        postal: address.postcode || postal || '',
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
      };
    } catch (error: any) {
      console.error('[Nominatim] Error during geocoding:', error.message);
      return null;
    }
  });
}

/**
 * Reverse geocode coordinates using Nominatim
 * 
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns Normalized address or null if not found
 */
export async function reverseGeocodeWithNominatim(
  lat: number,
  lon: number
): Promise<NormalizedNominatimAddress | null> {
  // Enqueue the request - it will be processed at 1 req/sec automatically
  return nominatimQueue.enqueue(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${lat}&` +
        `lon=${lon}&` +
        `format=json&` +
        `addressdetails=1`;

      console.log('[Nominatim] Reverse geocoding:', lat, lon);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EnergyScanCapture/1.0 (Energy scanning application)',
          'Accept-Language': 'de',
        },
      });

      if (!response.ok) {
        console.warn('[Nominatim] HTTP error:', response.status, response.statusText);
        return null;
      }

      const result: NominatimResult = await response.json();
      const address = result.address;

      // Validate that we have a street
      if (!address.road) {
        console.warn('[Nominatim] No street found in reverse geocoding result');
        return null;
      }

      console.log('[Nominatim] ✅ Reverse geocoded:', result.display_name);

      return {
        formattedAddress: result.display_name,
        street: address.road,
        number: address.house_number || '',
        city: address.city || address.county || '',
        postal: address.postcode || '',
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
      };
    } catch (error: any) {
      console.error('[Nominatim] Error during reverse geocoding:', error.message);
      return null;
    }
  });
}

/**
 * Get current queue status (for monitoring/debugging)
 * Useful to check if queue is building up under heavy load
 */
export function getNominatimQueueStatus() {
  return nominatimQueue.getStatus();
}
