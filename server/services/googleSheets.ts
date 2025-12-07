import { google } from './googleApiWrapper';
import crypto from 'crypto';
import type { AddressDataset, EditableResident } from '../../shared/schema';
import { checkRateLimit, incrementRateLimit } from '../middleware/rateLimit';
import { LOG_CONFIG } from '../config/logConfig';
import { getBerlinDate, getBerlinTimestamp } from '../utils/timezone';
import { appointmentsDB, categoryChangesDB } from './systemDatabaseService';

// Helper function to get current time in Berlin timezone (MEZ/MESZ)
function getBerlinTime(): Date {
  return new Date();
}

// Helper function to format date for Berlin timezone as ISO string
function formatBerlinTimeISO(date: Date): string {
  return getBerlinTimestamp(date);
}

// RAM Cache for Address Datasets
class DatasetCache {
  private cache: Map<string, AddressDataset> = new Map();
  private dirtyDatasets: Set<string> = new Set();
  private syncInterval: NodeJS.Timeout | null = null;
  private sheetsService: AddressDatasetService | null = null;

  // Helper function to normalize house number for consistent matching
  private normalizeHouseNumber(houseNumber: string): string {
    return houseNumber
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ''); // Remove all spaces: "20 A" → "20a"
  }

  // Helper function to expand house number range to individual numbers
  // Examples: "1-3" → ["1", "2", "3"], "1,2,3" → ["1", "2", "3"], "20a-c" → ["20a", "20b", "20c"]
  private expandHouseNumberRange(houseNumber: string): string[] {
    if (!houseNumber) return [];
    
    // Normalize first (lowercase, remove spaces)
    const normalized = this.normalizeHouseNumber(houseNumber);
    
    // Split by comma AND slash (handles "1,2,3" or "23/24" or "1,3-5")
    const parts = normalized.split(/[,\/]/).map(p => p.trim()).filter(p => p.length > 0);
    
    const expanded: string[] = [];
    
    for (const part of parts) {
      // Check for letter range (e.g., "20a-c")
      const letterRangePattern = /^(\d+)([a-z])-([a-z])$/;
      const letterMatch = part.match(letterRangePattern);
      
      if (letterMatch) {
        const number = letterMatch[1];
        const startLetter = letterMatch[2];
        const endLetter = letterMatch[3];
        
        const startCode = startLetter.charCodeAt(0);
        const endCode = endLetter.charCodeAt(0);
        
        // Validate: start must be <= end
        if (startCode > endCode) {
          console.warn(`[HouseNumber] Invalid letter range: ${part} (reversed), treating as literal`);
          expanded.push(part);
          continue;
        }
        
        // Validate: max 30 letters
        const rangeSize = endCode - startCode + 1;
        if (rangeSize > 30) {
          console.warn(`[HouseNumber] Letter range too large: ${part} (${rangeSize} letters), treating as literal`);
          expanded.push(part);
          continue;
        }
        
        // Generate letter range
        for (let code = startCode; code <= endCode; code++) {
          const letter = String.fromCharCode(code);
          expanded.push(number + letter);
        }
        continue;
      }
      
      // Check if this part is a range (contains hyphen)
      if (part.includes('-')) {
        const rangeParts = part.split('-');
        if (rangeParts.length === 2) {
          const start = parseInt(rangeParts[0].trim());
          const end = parseInt(rangeParts[1].trim());
          
          // Check for ambiguous format like "20-22a"
          if (rangeParts[1].match(/[a-z]/)) {
            console.warn(`[HouseNumber] Ambiguous format: ${part}, treating as literal`);
            expanded.push(part);
            continue;
          }
          
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            // Limit to max 50 numbers to prevent abuse
            const rangeSize = end - start + 1;
            if (rangeSize > 50) {
              console.warn(`[HouseNumber] Range too large: ${part} (${rangeSize} numbers), limiting to 50`);
              // Add only start and end as fallback
              expanded.push(start.toString());
              expanded.push(end.toString());
            } else {
              // Generate all numbers in range
              for (let i = start; i <= end; i++) {
                expanded.push(i.toString());
              }
            }
            continue;
          }
        }
        
        // Multiple hyphens or invalid format, treat as literal
        expanded.push(part);
        continue;
      }
      
      // Check for non-latin letters (ä, ö, ü, etc.)
      if (/[äöüßÄÖÜ]/.test(part)) {
        console.warn(`[HouseNumber] Non-latin letters in: ${part}, treating as literal`);
        expanded.push(part);
        continue;
      }
      
      // Single number or letter suffix (e.g., "10a")
      expanded.push(part);
    }
    
    // Remove duplicates and return
    return Array.from(new Set(expanded));
  }

  // Helper function to check if address matches considering house numbers with EXPANSION
  private addressMatches(
    searchNormalizedAddress: string, 
    searchHouseNumbers: string[],
    datasetNormalizedAddress: string,
    datasetHouseNumbers: string[]
  ): boolean {
    // Extract street and postal code from normalized addresses
    // We use postal code as the primary matching criterion (city is optional)
    const extractPostalAndStreet = (normalizedAddr: string): string => {
      // Extract postal code (5 digits in Germany)
      const postalMatch = normalizedAddr.match(/\b\d{5}\b/);
      const postal = postalMatch ? postalMatch[0] : '';

      // IMPROVED: Take only the part BEFORE the postal code as the street
      // This ensures city names (which come AFTER postal) are excluded
      let streetPart = normalizedAddr;
      if (postal) {
        const postalIndex = normalizedAddr.indexOf(postal);
        if (postalIndex > 0) {
          streetPart = normalizedAddr.substring(0, postalIndex);
        }
      }

      // Normalize street name: remove numbers, punctuation
      let street = streetPart
        .replace(/\d+[a-zA-Z]?(?:,?\s*\d+[a-zA-Z]?)*/g, '') // Remove house numbers
        .replace(/[,\.\/]/g, ' ') // Replace punctuation with spaces
        .replace(/straße/gi, 'str') // Normalize street names
        .replace(/strasse/gi, 'str')
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim()
        .toLowerCase();

      return `${street}|${postal}`;
    };

    const searchBase = extractPostalAndStreet(searchNormalizedAddress);
    const datasetBase = extractPostalAndStreet(datasetNormalizedAddress);

    // First check: street + postal must match (city is ignored as it's optional)
    if (searchBase !== datasetBase) {
      return false;
    }

    // Second check: BIDIRECTIONAL matching with overlap detection
    // Check if there's ANY overlap between the two sets of house numbers
    // Examples: "1" matches "1,2" | "1,2" matches "1" | "1" does NOT match "3,4"
    
    for (const searchNum of searchHouseNumbers) {
      if (datasetHouseNumbers.includes(searchNum)) {
        return true;
      }
    }
    
    for (const datasetNum of datasetHouseNumbers) {
      if (searchHouseNumbers.includes(datasetNum)) {
        return true;
      }
    }
    
    // No overlap found
    return false;
  }
  
  // Load all datasets: First from SQLite (PRIMARY), then merge from Sheets (BACKUP)
  async initialize(sheetsService: AddressDatasetService) {
    this.sheetsService = sheetsService;
    console.log('[DatasetCache] === INITIALIZING CACHE (SQLite + Sheets) ===');

    try {
      // Step 1: Load from SQLite (PRIMARY SOURCE)
      try {
        const { addressDatasetsDB } = await import('./systemDatabaseService');
        const sqliteDatasets = addressDatasetsDB.getAll();

        for (const record of sqliteDatasets) {
          // Convert SQLite record to AddressDataset format
          const dataset = {
            id: record.id,
            normalizedAddress: record.normalizedAddress,
            street: record.street,
            houseNumber: record.houseNumber,
            city: record.city,
            postalCode: record.postalCode,
            createdBy: record.createdBy,
            createdAt: new Date(record.createdAt),
            rawResidentData: JSON.parse(record.rawResidentData),
            editableResidents: JSON.parse(record.editableResidents),
            fixedCustomers: JSON.parse(record.fixedCustomers)
          };
          this.cache.set(dataset.id, dataset);
        }

        console.log(`[DatasetCache] ✓ Loaded ${this.cache.size} datasets from SQLite`);
      } catch (error) {
        console.error('[DatasetCache] Error loading from SQLite:', error);
      }

      // Step 2: Merge from Sheets (BACKUP - may have datasets not yet synced to SQLite)
      try {
        const sheetsDatasets = await sheetsService.loadAllDatasetsFromSheets();
        let mergedFromSheets = 0;

        for (const dataset of sheetsDatasets) {
          if (!this.cache.has(dataset.id)) {
            // Dataset in Sheets but not in SQLite → add to cache
            this.cache.set(dataset.id, dataset);
            mergedFromSheets++;
          }
        }

        if (mergedFromSheets > 0) {
          console.log(`[DatasetCache] ✓ Merged ${mergedFromSheets} additional datasets from Sheets`);
        }
      } catch (error) {
        console.warn('[DatasetCache] Could not load from Sheets, using SQLite data only:', error);
      }

      console.log(`[DatasetCache] Total: ${this.cache.size} datasets in RAM cache`);
      console.log(`[DatasetCache] === INITIALIZATION COMPLETE ===`);

      // Start background sync every 60 seconds
      this.startBackgroundSync();
    } catch (error) {
      console.error('[DatasetCache] Failed to initialize cache:', error);
      throw error;
    }
  }

  // Start background job to sync dirty datasets every 60 seconds
  private startBackgroundSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      await this.syncDirtyDatasets();
    }, 60000); // 60 seconds

    console.log('[DatasetCache] Background sync started (every 60 seconds)');
  }

  // Sync all dirty datasets to Google Sheets
  private async syncDirtyDatasets() {
    if (this.dirtyDatasets.size === 0) {
      return;
    }

    const datasetIds = Array.from(this.dirtyDatasets);
    const syncPromises: Promise<void>[] = [];
    let syncedCount = 0;

    for (const datasetId of datasetIds) {
      const dataset = this.cache.get(datasetId);
      if (dataset && this.sheetsService) {
        syncPromises.push(
          this.sheetsService.writeDatasetToSheets(dataset)
            .then(() => {
              this.dirtyDatasets.delete(datasetId);
              syncedCount++;
            })
            .catch((error: any) => {
              console.error(`[DatasetCache] Sync failed for ${datasetId}:`, error.message || error);
            })
        );
      }
    }

    await Promise.allSettled(syncPromises);

    if (syncedCount > 0 && LOG_CONFIG.DATASET_CACHE.logSync) {
      console.log(`[DatasetCache] Synced ${syncedCount} datasets to Sheets`);
    }
  }

  // Get dataset from cache
  get(datasetId: string): AddressDataset | null {
    return this.cache.get(datasetId) || null;
  }

  // Get datasets by normalized address with flexible house number matching
  getByAddress(normalizedAddress: string, limit?: number, houseNumber?: string): AddressDataset[] {
    const searchHouseNumbers = houseNumber ? this.expandHouseNumberRange(houseNumber) : [];

    // Only log if explicitly enabled in config (reduces noise)
    if (LOG_CONFIG.CACHE.logDatasetSearch) {
      console.log('[DatasetCache.getByAddress] 🔎 Search:', normalizedAddress, houseNumber ? `(#${houseNumber})` : '');
    }

    const matchingDatasets = Array.from(this.cache.values())
      .filter(ds => {
        const datasetHouseNumbers = this.expandHouseNumberRange(ds.houseNumber);
        
        // IMPORTANT: Try multiple matching strategies
        // 1. Direct normalized address match (e.g., "Isenburger Kirchweg 6, 51067 Köln, Deutschland")
        const normalizedMatch = ds.normalizedAddress?.toLowerCase() === normalizedAddress.toLowerCase();
        
        // 2. Field-based matching (street + postal + city, for local search without normalization)
        const datasetComparable = `${ds.street || ''} ${ds.postalCode || ''} ${ds.city || ''}`.trim().toLowerCase();
        const searchComparable = normalizedAddress.toLowerCase();
        const fieldMatch = datasetComparable === searchComparable;
        
        // If either match type succeeds, check house numbers
        if (normalizedMatch || fieldMatch) {
          // If house numbers provided, check for overlap
          if (searchHouseNumbers.length > 0 && datasetHouseNumbers.length > 0) {
            // Check for any overlap between house numbers
            for (const searchNum of searchHouseNumbers) {
              if (datasetHouseNumbers.includes(searchNum)) {
                return true;
              }
            }
            for (const datasetNum of datasetHouseNumbers) {
              if (searchHouseNumbers.includes(datasetNum)) {
                return true;
              }
            }
            return false; // No overlap
          }
          // No house numbers to check, address matches
          return true;
        }
        
        // Fallback: Use flexible matching with normalized addresses (for normalized search)
        if (searchHouseNumbers.length > 0 && datasetHouseNumbers.length > 0) {
          return this.addressMatches(
            normalizedAddress,
            searchHouseNumbers,
            ds.normalizedAddress,
            datasetHouseNumbers
          );
        }
        
        // Last resort: exact match on normalized address
        return ds.normalizedAddress === normalizedAddress;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    const result = limit ? matchingDatasets.slice(0, limit) : matchingDatasets;
    
    if (LOG_CONFIG.CACHE.logDatasetSearch) {
      console.log(`[DatasetCache.getByAddress] ✅ Found ${result.length} dataset(s)`);
    }
    
    return result;
  }

  // Get all datasets
  getAll(): AddressDataset[] {
    return Array.from(this.cache.values());
  }

  // Add or update dataset in cache and mark as dirty
  set(dataset: AddressDataset, markDirty: boolean = true) {
    this.cache.set(dataset.id, dataset);
    if (markDirty) {
      this.dirtyDatasets.add(dataset.id);
      if (LOG_CONFIG.DATASET_CACHE.logUpdates) {
        console.log(`[DatasetCache] Dataset ${dataset.id} updated and marked dirty`);
      }
    }
  }

  // Add new dataset to cache without marking dirty (already written to sheets)
  addNew(dataset: AddressDataset) {
    this.set(dataset, false);
  }

  // Force immediate sync of all dirty datasets
  async forceSyncNow(): Promise<void> {
    await this.syncDirtyDatasets();
  }

  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

// Global cache instance
const datasetCache = new DatasetCache();

// ============================================================================
// VALIDATED STREET CACHE - Permanent cache for known valid street names
// ============================================================================
class ValidatedStreetCache {
  // Map für schnelle O(1) Lookups - speichert validierte Adressen mit Stadt
  // Key: "normalizedStreet|postal|normalizedCity" → Value: { street, city }
  private validatedAddresses: Map<string, { street: string; city: string }> = new Map();
  private initialized: boolean = false;

  /**
   * Normalisiert Straßennamen für Cache-Vergleich:
   * - Lowercase
   * - Trimmed
   * - Straßennamen-Varianten standardisiert (str. → strasse, etc.)
   */
  private normalizeStreetName(street: string): string {
    return street
      .toLowerCase()
      .trim()
      .replace(/ß/g, 'ss')
      // Standardisiere alle Varianten zu "strasse"
      .replace(/(str\.|str|straße|strasse)$/i, 'strasse')
      .replace(/[-\s]/g, ''); // Entferne Leerzeichen und Bindestriche für Matching
  }

  /**
   * Normalisiert Stadtnamen für Cache-Vergleich
   */
  private normalizeCityName(city: string): string {
    return city
      .toLowerCase()
      .trim()
      .replace(/ß/g, 'ss')
      .replace(/[-\s]/g, '');
  }

  /**
   * Erstellt Cache-Key aus Straße und PLZ (Stadt wird ignoriert!)
   * Format: "normalizedStreet|postal"
   */
  private getCacheKey(street: string, postal: string): string {
    const normalizedStreet = this.normalizeStreetName(street);
    return `${normalizedStreet}|${postal.trim()}`;
  }

  /**
   * Lädt alle Straßennamen aus dem "Adressen" Sheet in den Cache
   * Wird beim Server-Start aufgerufen
   */
  async initialize(sheetsService: AddressDatasetService): Promise<void> {
    if (this.initialized) {
      console.log('[ValidatedStreetCache] Already initialized, skipping...');
      return;
    }

    try {
      console.log('[ValidatedStreetCache] Initializing address cache from "Adressen" sheet...');
      
      // Alle Datasets laden (enthält alle normalisierten Adressen)
      const allDatasets = await sheetsService.getAllDatasets();
      
      // Adressen extrahieren und normalisieren (nur street + postal)
      for (const dataset of allDatasets) {
        if (dataset.street && dataset.postalCode && dataset.city) {
          const cacheKey = this.getCacheKey(dataset.street, dataset.postalCode);
          this.validatedAddresses.set(cacheKey, {
            street: dataset.street,
            city: dataset.city,
          });
        }
      }

      this.initialized = true;
      console.log(`[ValidatedStreetCache] ✅ Initialized with ${this.validatedAddresses.size} validated addresses`);
      
      // Log erste 5 Adressen für Debugging
      const sample = Array.from(this.validatedAddresses.entries()).slice(0, 5);
      console.log(`[ValidatedStreetCache] Sample addresses:`, sample.map(([key, val]) => `${key} → ${val.street}, ${val.city}`));
    } catch (error) {
      console.error('[ValidatedStreetCache] ❌ Failed to initialize:', error);
      // Nicht werfen - Cache bleibt leer, API Calls werden weiterhin gemacht
    }
  }

  /**
   * Prüft ob eine Adresse bereits validiert wurde (im Cache vorhanden)
   * Cache-Key basiert NUR auf street + postal (Stadt wird ignoriert!)
   * @returns Validierte Adresse wenn bekannt, sonst null
   */
  getValidated(street: string, postal: string): { street: string; city: string } | null {
    const cacheKey = this.getCacheKey(street, postal);
    const cached = this.validatedAddresses.get(cacheKey);
    
    if (cached) {
      console.log(`[ValidatedStreetCache] ✅ HIT: "${street}" (PLZ: ${postal}) → "${cached.street}", "${cached.city}"`);
      return cached;
    }
    
    console.log(`[ValidatedStreetCache] ❌ MISS: "${street}" (PLZ: ${postal}) not in cache, will call API`);
    return null;
  }

  /**
   * Fügt eine validierte Adresse zum Cache hinzu
   * Cache-Key basiert NUR auf street + postal (Stadt wird ignoriert!)
   */
  add(street: string, postal: string, city: string): void {
    const cacheKey = this.getCacheKey(street, postal);
    const wasNew = !this.validatedAddresses.has(cacheKey);
    
    this.validatedAddresses.set(cacheKey, { street, city });
    
    if (wasNew) {
      console.log(`[ValidatedStreetCache] ➕ Added: "${street}", PLZ ${postal} → Stadt: "${city}" (total: ${this.validatedAddresses.size})`);
    }
  }

  /**
   * Gibt Statistiken über den Cache zurück
   */
  getStats(): { totalAddresses: number; initialized: boolean } {
    return {
      totalAddresses: this.validatedAddresses.size,
      initialized: this.initialized,
    };
  }
}

// Global street cache instance (permanent, never cleared)
const validatedStreetCache = new ValidatedStreetCache();

let sheetsClient: any = null;
let sheetsEnabled = false;

try {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
  
  if (sheetsKey.startsWith('{')) {
    const credentials = JSON.parse(sheetsKey);
    
    if (credentials.client_email && credentials.private_key) {
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets'
        ],
      });
      
      sheetsClient = google.sheets({ version: 'v4', auth });
      sheetsEnabled = true;
      console.log('Google Sheets API initialized successfully');
    } else {
      console.warn('Google service account credentials missing required fields for Sheets API');
    }
  } else {
    console.warn('Google Sheets API disabled - invalid credentials format');
  }
} catch (error) {
  console.error('Failed to initialize Google Sheets client:', error);
  console.warn('Google Sheets functionality disabled');
}

export interface UserData {
  userId: string;
  username: string;
  password: string;
  postalCodes: string[];
  isAdmin: boolean;
  followMeeDeviceId?: string;
  trackingNames: string[]; // Column F: Tracking names from external API
  resellerName?: string;    // Column G: EGON Reseller Name for contract tracking
}

export interface SheetsService {
  getValidPasswords(): Promise<string[]>;
  getPasswordUserMap(): Promise<Map<string, string>>;
  getUserByPassword(password: string): Promise<string | null>;
  isUserAdmin(password: string): Promise<boolean>;
  getAllUsers(): Promise<UserData[]>;
  getUserByTrackingName(trackingName: string): Promise<UserData | undefined>;
  refreshUserCache(): Promise<void>;
}

export interface AddressSheetsService {
  createAddressDataset(dataset: Omit<AddressDataset, 'id' | 'createdAt'>): Promise<AddressDataset>;
  getAddressDatasets(normalizedAddress: string, limit?: number, houseNumber?: string): Promise<AddressDataset[]>;
  getAllDatasets(): Promise<AddressDataset[]>;
  getDatasetById(datasetId: string): Promise<AddressDataset | null>;
  updateResidentInDataset(datasetId: string, residentIndex: number, resident: EditableResident | null): Promise<void>;
  bulkUpdateResidentsInDataset(datasetId: string, editableResidents: EditableResident[]): Promise<void>;
  getTodaysDatasetByAddress(normalizedAddress: string, houseNumber?: string): Promise<AddressDataset | null>;
  getRecentDatasetByAddress(normalizedAddress: string, houseNumber?: string, daysBack?: number): Promise<AddressDataset | null>;
  getUserDatasetsByDate(username: string, date: Date): Promise<AddressDataset[]>;
}

export interface UserCredentials {
  password: string;
  username: string;
}

// RAM Cache for User Auth Data
class UserAuthCache {
  private usersCache: UserData[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private sheetsService: GoogleSheetsService | null = null;

  // Initialize cache with GoogleSheetsService reference
  async initialize(service: GoogleSheetsService) {
    this.sheetsService = service;
    console.log('[UserAuthCache] Initializing user auth cache...');

    try {
      await this.loadUsersFromSheets();
      console.log(`[UserAuthCache] Loaded ${this.usersCache.length} users into RAM cache`);

      // Start background sync every 5 minutes
      this.startBackgroundSync();
    } catch (error) {
      console.error('[UserAuthCache] Failed to initialize cache:', error);
      throw error;
    }
  }

  // Start background job to sync user data every 5 minutes
  private startBackgroundSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      await this.loadUsersFromSheets();
    }, this.CACHE_TTL);

    console.log('[UserAuthCache] Background sync started (every 5 minutes)');
  }

  // Load user data from Google Sheets
  private async loadUsersFromSheets(): Promise<void> {
    if (!this.sheetsService) {
      console.error('[UserAuthCache] No sheets service available');
      return;
    }

    try {
      console.log('[UserAuthCache] Syncing user data from Google Sheets...');
      const users = await this.sheetsService.loadAllUsersFromSheets();
      this.usersCache = users;
      console.log(`[UserAuthCache] Synced ${this.usersCache.length} users (${users.filter(u => u.followMeeDeviceId).length} with FollowMee devices)`);
    } catch (error) {
      console.error('[UserAuthCache] Failed to sync user data:', error);
      // Keep existing cache on error
    }
  }

  // Get user by password from cache
  getUserByPassword(password: string): UserData | undefined {
    return this.usersCache.find(u => u.password === password.trim());
  }

  // Get user by username from cache
  getUserByUsername(username: string): UserData | undefined {
    return this.usersCache.find(u => u.username === username);
  }

  // Get all users from cache
  getAllUsers(): UserData[] {
    return [...this.usersCache];
  }

  // Get user by tracking name from cache
  getUserByTrackingName(trackingName: string): UserData | undefined {
    return this.usersCache.find(u =>
      u.trackingNames.some(name => name.toLowerCase() === trackingName.toLowerCase())
    );
  }

  // Check if user is admin from cache
  isUserAdmin(password: string): boolean {
    const user = this.getUserByPassword(password);
    return user?.isAdmin || false;
  }

  // Get user postal codes from cache
  getUserPostalCodes(username: string): string[] {
    const user = this.getUserByUsername(username);
    return user?.postalCodes || [];
  }

  // Get password-user map from cache
  getPasswordUserMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const user of this.usersCache) {
      map.set(user.password, user.username);
    }
    return map;
  }

  // Force immediate refresh of user data (for admin operations)
  async forceRefresh(): Promise<void> {
    console.log('[UserAuthCache] Force refresh requested');
    await this.loadUsersFromSheets();
  }

  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

// Global user auth cache instance
const userAuthCache = new UserAuthCache();

class GoogleSheetsService implements SheetsService {
  private readonly SHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
  private readonly WORKSHEET_NAME = 'Zugangsdaten';

  async getValidPasswords(): Promise<string[]> {
    const passwordUserMap = await this.getPasswordUserMap();
    return Array.from(passwordUserMap.keys());
  }

  async getPasswordUserMap(): Promise<Map<string, string>> {
    // Use cache instead of direct API call
    return userAuthCache.getPasswordUserMap();
  }

  async isUserAdmin(password: string): Promise<boolean> {
    // Use cache instead of direct API call
    const isAdmin = userAuthCache.isUserAdmin(password);
    if (isAdmin) {
      console.log(`[Auth] User with password ${password.substring(0, 3)}... is ADMIN`);
    }
    return isAdmin;
  }

  async getUserPostalCodes(username: string): Promise<string[]> {
    // Use cache instead of direct API call
    const postalCodes = userAuthCache.getUserPostalCodes(username);

    if (postalCodes.length > 0) {
      console.log(`[PLZ-Check] User ${username} has postal codes: ${postalCodes.join(', ')}`);
    } else {
      console.log(`[PLZ-Check] User ${username} has no postal code restrictions`);
    }

    return postalCodes;
  }

  async validatePostalCodeForUser(username: string, postalCode: string): Promise<boolean> {
    const allowedCodes = await this.getUserPostalCodes(username);

    // No postal codes assigned = no restriction
    if (allowedCodes.length === 0) {
      return true;
    }

    // Check if postal code is in allowed list
    const normalizedSearch = postalCode.trim();
    const isAllowed = allowedCodes.includes(normalizedSearch);

    console.log(`[PLZ-Check] Postal code ${normalizedSearch} for user ${username}: ${isAllowed ? 'ALLOWED' : 'DENIED'}`);
    return isAllowed;
  }

  async getUserByPassword(password: string): Promise<string | null> {
    // Use cache instead of direct API call
    const user = userAuthCache.getUserByPassword(password);
    return user?.username || null;
  }

  async getAllUsers(): Promise<UserData[]> {
    // Use cache instead of direct API call
    return userAuthCache.getAllUsers();
  }

  async getUserByTrackingName(trackingName: string): Promise<UserData | undefined> {
    // Use cache instead of direct API call
    return userAuthCache.getUserByTrackingName(trackingName);
  }

  async refreshUserCache(): Promise<void> {
    // Force immediate refresh of user cache
    await userAuthCache.forceRefresh();
  }

  // Internal method: Load all users from Google Sheets (used by cache)
  async loadAllUsersFromSheets(): Promise<UserData[]> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available');
      return [];
    }

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A2:G`, // Extended to column G for EGON reseller name
      });

      const rows = response.data.values || [];
      const users: UserData[] = [];

      for (const row of rows) {
        const password = row[0]?.trim();
        const username = row[1]?.trim();
        const postalCodesString = row[2]?.trim();
        const adminRole = row[3]?.trim().toLowerCase();
        const followMeeDeviceId = row[4]?.trim();
        const trackingNamesString = row[5]?.trim(); // Column F: tracking names
        const resellerName = row[6]?.trim();        // Column G: EGON reseller name

        if (password && username) {
          const postalCodes = postalCodesString
            ? postalCodesString.split(',').map((code: string) => code.trim()).filter((code: string) => code.length > 0)
            : [];

          // Parse tracking names (comma-separated list)
          const trackingNames = trackingNamesString
            ? trackingNamesString.split(',').map((name: string) => name.trim()).filter((name: string) => name.length > 0)
            : [];

          // Generate user ID from password hash (stable, only changes if password changes)
          // This matches the original system in auth.ts
          const userId = crypto.createHash('sha256').update(password).digest('hex').substring(0, 8);

          users.push({
            userId: userId,
            username,
            password,
            postalCodes,
            isAdmin: adminRole === 'admin',
            followMeeDeviceId: followMeeDeviceId || undefined,
            trackingNames: trackingNames,
            resellerName: resellerName || undefined
          });
        }
      }

      return users;
    } catch (error) {
      console.error('Error fetching user data from Google Sheets:', error);
      return [];
    }
  }
}

class AddressDatasetService implements AddressSheetsService {
  // IMPORTANT: Use SYSTEM_SHEET for Adressen (separate from user logs to avoid 10M limit)
  private readonly ADDRESSES_SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';
  private readonly ADDRESSES_WORKSHEET_NAME = 'Adressen';

  private async ensureAddressesSheetExists(): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      // Check if sheet exists
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
      });

      const sheetExists = response.data.sheets?.some(
        (sheet: any) => sheet.properties?.title === this.ADDRESSES_WORKSHEET_NAME
      );

      if (!sheetExists) {
        // Create the sheet with headers
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: this.ADDRESSES_WORKSHEET_NAME,
                }
              }
            }]
          }
        });

        // Add headers
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          range: `${this.ADDRESSES_WORKSHEET_NAME}!A1:J1`,
          valueInputOption: 'RAW',
          resource: {
            values: [[
              'ID', 'Normalized Address', 'Street', 'House Number', 'City', 
              'Postal Code', 'Created By', 'Created At', 'Raw Data', 'Resident Data'
            ]]
          }
        });

        console.log('Created Addresses sheet with headers');
      }
    } catch (error) {
      console.error('Error ensuring Addresses sheet exists:', error);
      throw error;
    }
  }

  private generateDatasetId(): string {
    return `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private serializeResidents(residents: EditableResident[]): string {
    return JSON.stringify(residents);
  }

  private deserializeResidents(data: string): EditableResident[] {
    try {
      return JSON.parse(data || '[]');
    } catch {
      return [];
    }
  }

  async createAddressDataset(dataset: Omit<AddressDataset, 'id' | 'createdAt'>): Promise<AddressDataset> {
    const id = this.generateDatasetId();
    const createdAt = getBerlinTime(); // Use Berlin timezone
    const fullDataset: AddressDataset = {
      ...dataset,
      id,
      createdAt,
    };

    // Step 1: Save to SQLite (PRIMARY - CRITICAL!)
    try {
      const { addressDatasetsDB } = await import('./systemDatabaseService');
      addressDatasetsDB.upsert({
        id,
        normalizedAddress: dataset.normalizedAddress,
        street: dataset.street,
        houseNumber: dataset.houseNumber,
        city: dataset.city,
        postalCode: dataset.postalCode,
        createdBy: dataset.createdBy,
        createdAt: formatBerlinTimeISO(createdAt),
        rawResidentData: JSON.stringify(dataset.rawResidentData),
        editableResidents: this.serializeResidents(dataset.editableResidents),
        fixedCustomers: this.serializeResidents(dataset.fixedCustomers)
      });
      console.log(`[createAddressDataset] ✅ Saved to SQLite: ${id}`);
    } catch (error) {
      console.error(`[createAddressDataset] ❌ CRITICAL: Failed to save to SQLite, aborting:`, error);
      throw new Error(`Failed to persist dataset: ${error}`);
    }

    // Step 2: Add to RAM cache (for fast access)
    datasetCache.addNew(fullDataset);

    // Step 3: Save to Sheets (BACKUP - non-blocking)
    try {
      await this.ensureAddressesSheetExists();

      const rowData = [
        id,
        dataset.normalizedAddress,
        dataset.street,
        dataset.houseNumber,
        dataset.city || '',
        dataset.postalCode,
        dataset.createdBy,
        formatBerlinTimeISO(createdAt),
        JSON.stringify(dataset.rawResidentData),
        this.serializeResidents([...dataset.editableResidents, ...dataset.fixedCustomers])
      ];

      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.ADDRESSES_WORKSHEET_NAME}!A:J`,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      console.log(`[createAddressDataset] ✅ Backed up to Sheets: ${id}`);
    } catch (error) {
      console.warn(`[createAddressDataset] ⚠️ Failed to backup to Sheets (SQLite backup exists):`, error);
      // Mark as dirty for background sync to retry
      datasetCache.set(fullDataset, true);
    }

    console.log(`[createAddressDataset] Created dataset ${id} for ${dataset.normalizedAddress}`);
    return fullDataset;
  }

  async getAddressDatasets(normalizedAddress: string, limit: number = 5, houseNumber?: string): Promise<AddressDataset[]> {
    // Use cache instead of reading from sheets, pass house number for flexible matching
    return datasetCache.getByAddress(normalizedAddress, limit, houseNumber);
  }

  async getAllDatasets(): Promise<AddressDataset[]> {
    // Return all datasets from cache
    return datasetCache.getAll();
  }

  async getDatasetById(datasetId: string): Promise<AddressDataset | null> {
    // Use cache instead of reading from sheets
    const dataset = datasetCache.get(datasetId);
    
    // Only log if dataset NOT found (error case)
    if (!dataset) {
      console.log(`[getDatasetById] Dataset ${datasetId} NOT found in cache`);
    }
    
    return dataset;
  }

  async updateResidentInDataset(datasetId: string, residentIndex: number, resident: EditableResident | null): Promise<void> {
    // Get dataset from cache
    const dataset = datasetCache.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found in cache`);
    }

    // Handle update/delete/add in cache
    if (resident === null) {
      // Delete: remove resident at index
      if (residentIndex < dataset.editableResidents.length) {
        dataset.editableResidents.splice(residentIndex, 1);
        console.log(`[updateResidentInDataset] Deleted resident at index ${residentIndex} in dataset ${datasetId}`);
      }
    } else if (residentIndex < dataset.editableResidents.length) {
      // Update: replace existing resident
      dataset.editableResidents[residentIndex] = resident;
      console.log(`[updateResidentInDataset] Updated resident ${residentIndex} in dataset ${datasetId}`);
    } else {
      // Add: append new resident
      dataset.editableResidents.push(resident);
      console.log(`[updateResidentInDataset] Added new resident to dataset ${datasetId}`);
    }

    // Step 1: Save to SQLite (PRIMARY)
    try {
      const { addressDatasetsDB } = await import('./systemDatabaseService');
      addressDatasetsDB.upsert({
        id: dataset.id,
        normalizedAddress: dataset.normalizedAddress,
        street: dataset.street,
        houseNumber: dataset.houseNumber,
        city: dataset.city,
        postalCode: dataset.postalCode,
        createdBy: dataset.createdBy,
        createdAt: formatBerlinTimeISO(dataset.createdAt),
        rawResidentData: JSON.stringify(dataset.rawResidentData),
        editableResidents: this.serializeResidents(dataset.editableResidents),
        fixedCustomers: this.serializeResidents(dataset.fixedCustomers)
      });
      console.log(`[updateResidentInDataset] ✅ Updated in SQLite: ${datasetId}`);
    } catch (error) {
      console.error(`[updateResidentInDataset] ❌ Failed to update SQLite:`, error);
    }

    // Step 2: Update cache and mark as dirty (will sync to sheets in background)
    datasetCache.set(dataset);
  }

  async bulkUpdateResidentsInDataset(datasetId: string, editableResidents: EditableResident[]): Promise<void> {
    // Get dataset from cache
    const dataset = datasetCache.get(datasetId);
    if (!dataset) {
      console.error(`[bulkUpdateResidentsInDataset] Dataset ${datasetId} not found in cache`);
      throw new Error(`Dataset ${datasetId} not found in cache`);
    }

    if (LOG_CONFIG.BULK_UPDATES.logBeforeAfter) {
      console.log(`[bulkUpdateResidentsInDataset] BEFORE:`, {
        datasetId,
        currentCount: dataset.editableResidents.length,
        newCount: editableResidents.length
      });
    }

    // Update residents in cache
    dataset.editableResidents = editableResidents;

    // Step 1: Save to SQLite (PRIMARY)
    try {
      const { addressDatasetsDB } = await import('./systemDatabaseService');
      addressDatasetsDB.upsert({
        id: dataset.id,
        normalizedAddress: dataset.normalizedAddress,
        street: dataset.street,
        houseNumber: dataset.houseNumber,
        city: dataset.city,
        postalCode: dataset.postalCode,
        createdBy: dataset.createdBy,
        createdAt: formatBerlinTimeISO(dataset.createdAt),
        rawResidentData: JSON.stringify(dataset.rawResidentData),
        editableResidents: this.serializeResidents(dataset.editableResidents),
        fixedCustomers: this.serializeResidents(dataset.fixedCustomers)
      });
    } catch (error) {
      console.error(`[bulkUpdateResidentsInDataset] SQLite error:`, error);
    }

    // Step 2: Update cache and mark as dirty (will sync to sheets in background)
    datasetCache.set(dataset);

    if (LOG_CONFIG.BULK_UPDATES.logSuccess) {
      console.log(`[bulkUpdate] ${datasetId}: ${editableResidents.length} residents updated`);
    }
  }

  async getTodaysDatasetByAddress(normalizedAddress: string, houseNumber?: string): Promise<AddressDataset | null> {
    const today = getBerlinTime();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Use flexible house number matching when searching for today's dataset
    const datasets = await this.getAddressDatasets(normalizedAddress, 50, houseNumber);
    
    for (const dataset of datasets) {
      if (dataset.createdAt >= todayStart && dataset.createdAt < todayEnd) {
        return dataset;
      }
    }

    return null;
  }

  async getRecentDatasetByAddress(normalizedAddress: string, houseNumber?: string, daysBack: number = 30): Promise<AddressDataset | null> {
    const now = getBerlinTime();
    const cutoffDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    // Use flexible house number matching when searching for recent dataset
    const datasets = await this.getAddressDatasets(normalizedAddress, 50, houseNumber);
    
    for (const dataset of datasets) {
      if (dataset.createdAt >= cutoffDate && dataset.createdAt <= now) {
        return dataset;
      }
    }

    return null;
  }

  async getUserDatasetsByDate(username: string, date: Date): Promise<AddressDataset[]> {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Filter from cache
    const datasets = datasetCache.getAll().filter(dataset => {
      const createdAt = new Date(dataset.createdAt);
      return dataset.createdBy === username && createdAt >= dayStart && createdAt < dayEnd;
    });

    // Only log if no datasets found (potential issue) or many datasets (interesting)
    if (datasets.length === 0 || datasets.length > 50) {
      console.log(`[getUserDatasetsByDate] ${username}: ${datasets.length} datasets`);
    }
    return datasets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getCallBackAddresses(username: string, date: Date): Promise<Array<{
    datasetId: string;
    address: string;
    notReachedCount: number;
    interestLaterCount: number;
    createdAt: Date;
  }>> {
    const datasets = await this.getUserDatasetsByDate(username, date);
    
    const callBacks = datasets
      .map(dataset => {
        // Count residents with "not_reached" and "interest_later" status
        const notReachedCount = dataset.editableResidents.filter(r => r.status === 'not_reached').length;
        const interestLaterCount = dataset.editableResidents.filter(r => r.status === 'interest_later').length;
        
        // Only include datasets with at least one call back status
        if (notReachedCount > 0 || interestLaterCount > 0) {
          // ✅ FIX: Build address from individual fields instead of normalized address
          // Format: "Straße Hausnummer, PLZ Stadt" (like in Verlauf/History)
          const addressParts = [
            dataset.street,
            dataset.houseNumber,
          ].filter(Boolean).join(' ');
          
          const locationParts = [
            dataset.postalCode,
            dataset.city,
          ].filter(Boolean).join(' ');
          
          const displayAddress = [addressParts, locationParts].filter(Boolean).join(', ');
          
          return {
            datasetId: dataset.id,
            address: displayAddress,
            notReachedCount,
            interestLaterCount,
            createdAt: dataset.createdAt
          };
        }
        return null;
      })
      .filter(cb => cb !== null)
      // Sort by createdAt descending (newest first) - this is the default display order
      .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime()) as Array<{
        datasetId: string;
        address: string;
        notReachedCount: number;
        interestLaterCount: number;
        createdAt: Date;
      }>;
    
    console.log(`[getCallBackAddresses] Found ${callBacks.length} call back addresses for ${username}`);
    return callBacks;
  }

  // Load all datasets from Google Sheets (for cache initialization)
  async loadAllDatasetsFromSheets(): Promise<AddressDataset[]> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available - returning empty array');
      return [];
    }

    await this.ensureAddressesSheetExists();

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.ADDRESSES_WORKSHEET_NAME}!A2:J`,
      });

      const rows = response.data.values || [];
      const datasets: AddressDataset[] = [];

      for (const row of rows) {
        if (row[0]) { // Has ID
          // Parse createdAt: The ISO string in Sheets is Berlin time, but we store it as Date object
          // We need to parse it correctly to avoid timezone issues
          const createdAtStr = row[7] || getBerlinTimestamp();
          const createdAtDate = new Date(createdAtStr);
          
          const dataset: AddressDataset = {
            id: row[0],
            normalizedAddress: row[1] || '',
            street: row[2] || '',
            houseNumber: row[3] || '',
            city: row[4] || '',
            postalCode: row[5] || '',
            createdBy: row[6] || '',
            createdAt: createdAtDate,
            rawResidentData: JSON.parse(row[8] || '[]'),
            editableResidents: this.deserializeResidents(row[9] || '[]'),
            fixedCustomers: [],
          };
          datasets.push(dataset);
        }
      }

      console.log(`[loadAllDatasetsFromSheets] Loaded ${datasets.length} datasets from sheets`);
      return datasets;
    } catch (error) {
      console.error('[loadAllDatasetsFromSheets] Error loading datasets:', error);
      throw error;
    }
  }

  // Write single dataset to Google Sheets (for background sync)
  async writeDatasetToSheets(dataset: AddressDataset): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    await this.ensureAddressesSheetExists();

    try {
      // Find the row with this dataset ID
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.ADDRESSES_WORKSHEET_NAME}!A2:A`,
      });

      const rows = response.data.values || [];
      const rowIndex = rows.findIndex((row: any[]) => row[0] === dataset.id);

      const rowData = [
        dataset.id,
        dataset.normalizedAddress,
        dataset.street,
        dataset.houseNumber,
        dataset.city || '',
        dataset.postalCode,
        dataset.createdBy,
        formatBerlinTimeISO(dataset.createdAt),
        JSON.stringify(dataset.rawResidentData),
        this.serializeResidents(dataset.editableResidents),
      ];

      if (rowIndex === -1) {
        // Dataset not found - create it instead of throwing error
        console.log(`[writeDatasetToSheets] Dataset ${dataset.id} not found in sheets - creating new row`);
        await sheetsClient.spreadsheets.values.append({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          range: `${this.ADDRESSES_WORKSHEET_NAME}!A:J`,
          valueInputOption: 'RAW',
          resource: {
            values: [rowData]
          }
        });
        console.log(`[writeDatasetToSheets] Successfully created dataset ${dataset.id} in sheets`);
      } else {
        // Update existing row (row index + 2 because: 0-indexed + header row + 1)
        const sheetRow = rowIndex + 2;
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          range: `${this.ADDRESSES_WORKSHEET_NAME}!A${sheetRow}:J${sheetRow}`,
          valueInputOption: 'RAW',
          resource: {
            values: [rowData]
          }
        });
        console.log(`[writeDatasetToSheets] Successfully updated dataset ${dataset.id} at row ${sheetRow}`);
      }
    } catch (error) {
      console.error(`[writeDatasetToSheets] Error writing dataset ${dataset.id}:`, error);
      throw error;
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();
export const addressDatasetService = new AddressDatasetService();

// Export initialization functions for controlled startup sequence
export async function initializeGoogleSheetsCaches(): Promise<void> {
  if (!sheetsEnabled) {
    console.warn('[GoogleSheets] Sheets API disabled, skipping cache initialization');
    return;
  }

  // Initialize user auth cache (FIRST - required for authentication)
  await userAuthCache.initialize(googleSheetsService);
  console.log('[UserAuthCache] ✅ Cache initialization complete');

  // Initialize dataset cache
  await datasetCache.initialize(addressDatasetService);
  console.log('[DatasetCache] ✅ Cache initialization complete');

  // Initialize validated street cache (loads all street names from "Adressen" sheet)
  await validatedStreetCache.initialize(addressDatasetService);
  const stats = validatedStreetCache.getStats();
  console.log(`[ValidatedStreetCache] ✅ Initialization complete - ${stats.totalAddresses} validated addresses loaded`);
}

// Category Change Logging Service
class CategoryChangeLoggingService {
  // NOTE: Using SYSTEM_SHEET_ID for category changes (separate from user logs to avoid 10M cell limit)
  private readonly SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';
  private readonly WORKSHEET_NAME = 'Log_Änderung_Kategorie';

  // Get Sheets client dynamically to avoid initialization issues
  private get sheetsAPI() {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY || '{}');
    
    // Use JWT constructor directly instead of deprecated GoogleAuth with credentials option
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    return google.sheets({ version: 'v4', auth });
  }

  private async ensureSheetExists(): Promise<void> {
    try {
      const client = this.sheetsAPI;
      const response = await client.spreadsheets.get({
        spreadsheetId: this.SHEET_ID,
      });

      const sheetExists = response.data.sheets?.some(
        (sheet: any) => sheet.properties?.title === this.WORKSHEET_NAME
      );

      if (!sheetExists) {
        // Create the sheet
        const client = this.sheetsAPI;
        await client.spreadsheets.batchUpdate({
          spreadsheetId: this.SHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: this.WORKSHEET_NAME,
                }
              }
            }]
          }
        });

        // Add headers
        await client.spreadsheets.values.update({
          spreadsheetId: this.SHEET_ID,
          range: `${this.WORKSHEET_NAME}!A1:I1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              'ID', 'Dataset-ID', 'Original Name', 'Current Name', 
              'Old Category', 'New Category', 'Changed By', 'Changed At', 'Dataset Snapshot'
            ]]
          }
        });

        console.log(`[CategoryChangeLogging] Created sheet "${this.WORKSHEET_NAME}" with headers`);
      }
    } catch (error) {
      console.error('[CategoryChangeLogging] Error ensuring sheet exists:', error);
      throw error;
    }
  }

  async logCategoryChange(
    datasetId: string,
    residentOriginalName: string,
    residentCurrentName: string,
    oldCategory: string,
    newCategory: string,
    changedBy: string,
    addressDatasetSnapshot: string
  ): Promise<void> {
    const id = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const changedAt = formatBerlinTimeISO(getBerlinTime());

    // 1. Save to SQLite FIRST (primary storage - reliable, local)
    try {
      categoryChangesDB.insert({
        timestamp: changedAt,
        datasetId: datasetId,
        residentOriginalName: residentOriginalName,
        residentCurrentName: residentCurrentName,
        oldCategory: oldCategory,
        newCategory: newCategory,
        changedBy: changedBy,
        addressSnapshot: addressDatasetSnapshot
      });
      console.log(`[CategoryChangeLogging] Saved to SQLite: ${oldCategory} → ${newCategory} for ${residentOriginalName}`);
    } catch (sqliteError) {
      console.error('[CategoryChangeLogging] SQLite save error:', sqliteError);
      // Continue to Sheets anyway as backup
    }

    // 2. Then sync to Google Sheets (backup - can fail gracefully)
    try {
      await this.ensureSheetExists();

      const rowData = [
        id,
        datasetId,
        residentOriginalName,
        residentCurrentName,
        oldCategory,
        newCategory,
        changedBy,
        changedAt,
        addressDatasetSnapshot
      ];

      const client = this.sheetsAPI;
      await client.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A:I`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData]
        }
      });

      console.log(`[CategoryChangeLogging] Logged to Sheets: ${oldCategory} → ${newCategory} for ${residentOriginalName} by ${changedBy}`);
    } catch (error) {
      console.error('[CategoryChangeLogging] Error logging to Google Sheets (SQLite backup exists):', error);
      // Don't throw - SQLite has the data
    }
  }
}

export const categoryChangeLoggingService = new CategoryChangeLoggingService();

// Appointment Service with RAM cache
class AppointmentService {
  private appointmentsCache: Map<string, any> = new Map();
  private lastSync: Date | null = null;
  private cacheInitialized: boolean = false;
  private cacheLoadPromise: Promise<void> | null = null;
  private readonly SHEET_NAME = "Termine";
  // NOTE: Using SYSTEM_SHEET_ID for appointments now (separate from user logs)
  private readonly ADDRESSES_SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';

  // Ensure "Termine" sheet exists with proper headers
  async ensureSheetExists(): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      const sheets = sheetsClient.spreadsheets;
      
      // Get all sheets
      const response = await sheets.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
      });

      const sheetExists = response.data.sheets?.some(
        (sheet: any) => sheet.properties?.title === this.SHEET_NAME
      );

      if (!sheetExists) {
        // Create the sheet
        await sheets.batchUpdate({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.SHEET_NAME,
                  },
                },
              },
            ],
          },
        });

        // Add headers
        const headers = [
          "ID",
          "Dataset-ID",
          "Resident Name",
          "Address",
          "Appointment Date",
          "Appointment Time",
          "Notes",
          "Created By",
          "Created At",
        ];

        await sheets.values.update({
          spreadsheetId: this.ADDRESSES_SHEET_ID,
          range: `${this.SHEET_NAME}!A1:I1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [headers],
          },
        });

        console.log(`[AppointmentService] Created sheet: ${this.SHEET_NAME}`);
      }
    } catch (error) {
      console.error("[AppointmentService] Error ensuring sheet exists:", error);
      throw error;
    }
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheInitialized) {
      return;
    }

    if (!this.cacheLoadPromise) {
      this.cacheLoadPromise = this.syncFromSheets()
        .then(() => {
          this.cacheInitialized = true;
        })
        .finally(() => {
          this.cacheLoadPromise = null;
        });
    }

    await this.cacheLoadPromise;
  }

  // Sync appointments: First load from SQLite, then merge from Google Sheets
  async syncFromSheets(): Promise<void> {
    console.log(`[AppointmentService] === SYNC START (SQLite + Sheets) ===`);
    
    try {
      const previousCacheSize = this.appointmentsCache.size;
      this.appointmentsCache.clear();

      // Step 1: Load from local SQLite (PRIMARY SOURCE)
      try {
        const sqliteAppointments = appointmentsDB.getAll();
        let loadedFromSQLite = 0;
        
        for (const apt of sqliteAppointments) {
          const appointment = {
            id: apt.id,
            datasetId: apt.datasetId,
            residentName: apt.residentName,
            address: apt.address,
            appointmentDate: apt.appointmentDate,
            appointmentTime: apt.appointmentTime,
            notes: apt.notes || "",
            createdBy: apt.createdBy,
            createdAt: new Date(apt.createdAt),
          };
          this.appointmentsCache.set(apt.id, appointment);
          loadedFromSQLite++;
        }
        
        console.log(`[AppointmentService] ✓ Loaded ${loadedFromSQLite} appointments from SQLite`);
      } catch (error) {
        console.error('[AppointmentService] Error loading from SQLite:', error);
      }

      // Step 2: Merge from Sheets (if available)
      if (!sheetsEnabled || !sheetsClient) {
        console.log('[AppointmentService] Google Sheets not available, using SQLite data only');
        this.lastSync = new Date();
        this.cacheInitialized = true;
        return;
      }

      await this.ensureSheetExists();

      const sheets = sheetsClient.spreadsheets;
      const response = await sheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.SHEET_NAME}!A2:I`,
      });

      const rows = response.data.values || [];
      console.log(`[AppointmentService] Retrieved ${rows.length} rows from Google Sheets`);
      
      let mergedFromSheets = 0;
      for (const row of rows) {
        if (row.length >= 9) {
          const id = row[0];
          
          // Only add if not already in cache (from SQLite)
          if (!this.appointmentsCache.has(id)) {
            const appointment = {
              id,
              datasetId: row[1],
              residentName: row[2],
              address: row[3],
              appointmentDate: row[4],
              appointmentTime: row[5],
              notes: row[6] || "",
              createdBy: row[7],
              createdAt: new Date(row[8]),
            };
            this.appointmentsCache.set(id, appointment);
            
            // Also persist to SQLite
            try {
              appointmentsDB.upsert({
                id,
                datasetId: appointment.datasetId,
                residentName: appointment.residentName,
                address: appointment.address,
                appointmentDate: appointment.appointmentDate,
                appointmentTime: appointment.appointmentTime,
                notes: appointment.notes,
                createdBy: appointment.createdBy,
                createdAt: row[8]
              });
            } catch (e) {
              // Ignore SQLite errors during merge
            }
            
            mergedFromSheets++;
          }
        }
      }

      this.lastSync = new Date();
      this.cacheInitialized = true;
      console.log(`[AppointmentService] ✓ Merged ${mergedFromSheets} additional appointments from Sheets`);
      console.log(`[AppointmentService] Cache: ${previousCacheSize} → ${this.appointmentsCache.size} appointments`);
      console.log(`[AppointmentService] === SYNC END ===`);
    } catch (error) {
      console.error("[AppointmentService] ✗ Error syncing:", error);
      // If Sheets fails, we still have SQLite data
      if (this.appointmentsCache.size > 0) {
        this.lastSync = new Date();
        this.cacheInitialized = true;
        console.log('[AppointmentService] Using SQLite data despite Sheets error');
      } else {
        throw error;
      }
    }
  }

  // Create new appointment
  async createAppointment(
    datasetId: string,
    residentName: string,
    address: string,
    appointmentDate: string,
    appointmentTime: string,
    notes: string,
    createdBy: string
  ): Promise<any> {
    console.log(`[AppointmentService] === CREATE APPOINTMENT START ===`);
    console.log(`[AppointmentService] Resident: ${residentName}, Date: ${appointmentDate}, Time: ${appointmentTime}`);
    
    try {
      if (!this.cacheInitialized) {
        try {
          await this.ensureCacheLoaded();
        } catch (error) {
          console.warn('[AppointmentService] Failed to warm cache before create, continuing with in-memory data:', error);
        }
      }

      const id = crypto.randomUUID();
      const createdAt = formatBerlinTimeISO(getBerlinTime());

      const appointment = {
        id,
        datasetId,
        residentName,
        address,
        appointmentDate,
        appointmentTime,
        notes: notes || "",
        createdBy,
        createdAt: new Date(createdAt),
      };

      console.log(`[AppointmentService] Generated appointment ID: ${id}`);

      // Step 1: Write to SQLite FIRST (PRIMARY)
      try {
        appointmentsDB.upsert({
          id,
          datasetId,
          residentName,
          address,
          appointmentDate,
          appointmentTime,
          notes: notes || "",
          createdBy,
          createdAt
        });
        console.log(`[AppointmentService] ✓ Saved to SQLite`);
      } catch (error) {
        console.error(`[AppointmentService] ✗ Error saving to SQLite:`, error);
        // Continue anyway - we'll try Sheets
      }

      // Step 2: Write to Sheets (BACKUP)
      try {
        await this.ensureSheetExists();
        
        if (sheetsEnabled && sheetsClient) {
          const sheets = sheetsClient.spreadsheets;
          const appendResult = await sheets.values.append({
            spreadsheetId: this.ADDRESSES_SHEET_ID,
            range: `${this.SHEET_NAME}!A:I`,
            valueInputOption: "RAW",
            requestBody: {
              values: [[
                id,
                datasetId,
                residentName,
                address,
                appointmentDate,
                appointmentTime,
                notes || "",
                createdBy,
                createdAt,
              ]],
            },
          });

          console.log(`[AppointmentService] ✓ Written to Google Sheets at range: ${appendResult.data.updates?.updatedRange}`);
        }
      } catch (error) {
        console.warn('[AppointmentService] Failed to write to Sheets (SQLite backup exists):', error);
      }

      // Add to cache
      this.appointmentsCache.set(id, appointment);
      console.log(`[AppointmentService] ✓ Added to cache. Cache size: ${this.appointmentsCache.size}`);
      
      // Update lastSync to prevent immediate re-sync
      this.lastSync = new Date();
      
      console.log(`[AppointmentService] ✓ Successfully created appointment: ${id}`);
      console.log(`[AppointmentService] === CREATE APPOINTMENT END ===`);
      
      return appointment;
    } catch (error) {
      console.error("[AppointmentService] Error creating appointment:", error);
      throw error;
    }
  }

  // Get appointments for a user
  async getUserAppointments(username: string): Promise<any[]> {
    console.log(`[AppointmentService] Getting appointments for user: ${username}`);

    await this.ensureCacheLoaded();

    const allAppointments = Array.from(this.appointmentsCache.values());
    console.log(`[AppointmentService] Total appointments in cache: ${allAppointments.length}`);
    
    const userAppointments = allAppointments
      .filter(apt => {
        const matches = apt.createdBy === username;
        // Only log if explicitly enabled (reduces noise with 40+ appointments)
        if (!matches && LOG_CONFIG.APPOINTMENTS.logEachFilter) {
          console.log(`[AppointmentService] Filtering out appointment created by: ${apt.createdBy}`);
        }
        return matches;
      })
      .sort((a, b) => {
        // Sort by date and time
        const dateCompare = a.appointmentDate.localeCompare(b.appointmentDate);
        if (dateCompare !== 0) return dateCompare;
        return a.appointmentTime.localeCompare(b.appointmentTime);
      });

    if (LOG_CONFIG.APPOINTMENTS.logSummary) {
      console.log(`[AppointmentService] User appointments found: ${userAppointments.length}`);
    }
    return userAppointments;
  }

  // Get upcoming appointments for a user
  async getUpcomingAppointments(username: string): Promise<any[]> {
    const allAppointments = await this.getUserAppointments(username);
    const today = getBerlinDate();

    return allAppointments.filter(apt => apt.appointmentDate >= today);
  }

  // Delete appointment from SQLite and "Termine" sheet
  // Note: This keeps the resident's status as "appointment" and their floor data intact
  // It only removes the specific appointment entry (date, time, notes) from the calendar
  async deleteAppointment(id: string): Promise<void> {
    console.log(`[AppointmentService] === DELETE APPOINTMENT START === ID: ${id}`);

    try {
      // Step 1: Delete from SQLite FIRST (PRIMARY)
      try {
        appointmentsDB.delete(id);
        console.log(`[AppointmentService] ✓ Deleted from SQLite`);
      } catch (error) {
        console.error(`[AppointmentService] Error deleting from SQLite:`, error);
      }

      // Remove from cache
      this.appointmentsCache.delete(id);
      console.log(`[AppointmentService] ✓ Removed from cache`);

      // Step 2: Delete from Sheets (BACKUP)
      if (!sheetsEnabled || !sheetsClient) {
        console.log('[AppointmentService] Google Sheets not available, only deleted from SQLite');
        console.log(`[AppointmentService] === DELETE APPOINTMENT END ===`);
        return;
      }

      const sheetId = await this.getSheetId();
      console.log(`[AppointmentService] Sheet ID for "${this.SHEET_NAME}": ${sheetId}`);

      const sheets = sheetsClient.spreadsheets;
      const response = await sheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.SHEET_NAME}!A:I`,
      });

      const rows = response.data.values || [];
      console.log(`[AppointmentService] Total rows in sheet (including header): ${rows.length}`);

      const rowIndex = rows.findIndex((row: any, index: number) => {
        const matches = row[0] === id;
        if (index === 0) {
          console.log(`[AppointmentService] Row 0 (header): [${row.join(', ')}]`);
        } else if (matches) {
          console.log(`[AppointmentService] Found matching row at index ${index}: [${row.join(', ')}]`);
        }
        return matches;
      });

      if (rowIndex === -1) {
        console.log(`[AppointmentService] Appointment ${id} not found in sheet (already deleted or only in SQLite)`);
        console.log(`[AppointmentService] === DELETE APPOINTMENT END ===`);
        return;
      }

      const startIndex = rowIndex;
      const endIndex = rowIndex + 1;

      console.log(`[AppointmentService] Deleting with startIndex: ${startIndex}, endIndex: ${endIndex}`);

      await sheets.batchUpdate({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex,
                endIndex,
              },
            },
          }],
        },
      });

      console.log(`[AppointmentService] ✓ Successfully deleted from Google Sheets`);
      console.log(`[AppointmentService] === DELETE APPOINTMENT END ===`);
    } catch (error) {
      console.error("[AppointmentService] Error deleting appointment:", error);
      console.log(`[AppointmentService] === DELETE APPOINTMENT FAILED ===`);
      // Don't throw - we already deleted from SQLite
    }
  }
  // Helper to get sheet ID
  private async getSheetId(): Promise<number> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }
    const sheets = sheetsClient.spreadsheets;
    const response = await sheets.get({
      spreadsheetId: this.ADDRESSES_SHEET_ID,
    });

    const sheet = response.data.sheets?.find(
      (s: any) => s.properties?.title === this.SHEET_NAME
    );

    return sheet?.properties?.sheetId || 0;
  }
}

export const appointmentService = new AppointmentService();

// Address normalization function using Google Geocoding API
export interface NormalizedAddress {
  formattedAddress: string;
  street: string;
  number: string;
  city: string;
  postal: string;
}

// Helper function to extract address components from Google Geocoding API result
// Note: The house number parameter is the user's input, not from Google
function extractAddressComponents(geocodingResult: any, userHouseNumber: string): NormalizedAddress {
  const addressComponents = geocodingResult.address_components;
  const formattedAddress = geocodingResult.formatted_address;
  
  let street = '';
  let city = '';
  let postal = '';
  
  // Extract components from Google's address_components array
  // We only use street name, city, and postal from Google
  // House number comes from user input
  for (const component of addressComponents) {
    const types = component.types;
    
    if (types.includes('route')) {
      street = component.long_name;
    } else if (types.includes('locality')) {
      city = component.long_name;
    } else if (types.includes('postal_code')) {
      postal = component.long_name;
    }
  }
  
  return {
    formattedAddress,
    street,
    number: userHouseNumber, // Always use the user's house number
    city,
    postal,
  };
}

export async function normalizeAddress(
  street: string,
  number: string,
  city?: string,
  postal?: string,
  username?: string // Added username parameter for rate limiting
): Promise<NormalizedAddress | null> {
  try {
    // VALIDATION: Street, number, and postal are REQUIRED
    if (!street || !street.trim()) {
      console.warn('[normalizeAddress] Validation failed: Street is required');
      throw new Error('Straße muss angegeben werden');
    }
    if (!number || !number.trim()) {
      console.warn('[normalizeAddress] Validation failed: House number is required');
      throw new Error('Hausnummer muss angegeben werden');
    }
    if (!postal || !postal.trim()) {
      console.warn('[normalizeAddress] Validation failed: Postal code is required');
      throw new Error('Postleitzahl muss angegeben werden');
    }

    // STEP 0: Check validated address cache BEFORE making any API calls
    // Cache search uses ONLY street + postal (city is ignored for lookup!)
    // If found, we use the normalized street and city from the cache
    const cached = validatedStreetCache.getValidated(street, postal);
    
    if (cached) {
      console.log('[normalizeAddress] ⚡ CACHE HIT - Address is validated, skipping ALL API calls');
      console.log(`[normalizeAddress] Using cached data: Street="${cached.street}", City="${cached.city}"`);
      
      // Build normalized address using cached validated data
      const formattedAddress = `${cached.street} ${postal} ${cached.city}`.trim().toLowerCase();
      
      return {
        formattedAddress,
        street: cached.street,
        number: number.trim(),
        city: cached.city, // Use city from cache (already normalized)
        postal: postal.trim(),
      };
    }

    // STEP 1: Try Nominatim (OpenStreetMap) first - FREE and better for real street addresses!
    console.log('[normalizeAddress] Step 1: Street not in cache, trying Nominatim (OSM)...');
    const { geocodeWithNominatim } = await import('./nominatim');
    
    try {
      // Extract only the FIRST house number for Nominatim (it can't handle "23/24" or "23,24")
      // Examples: "23/24" → "23", "23,24" → "23", "1-3" → "1"
      let firstNumber = number;
      if (number.includes('/')) {
        firstNumber = number.split('/')[0].trim();
        console.log(`[normalizeAddress] Multiple numbers detected (slash), using first: "${number}" → "${firstNumber}"`);
      } else if (number.includes(',')) {
        firstNumber = number.split(',')[0].trim();
        console.log(`[normalizeAddress] Multiple numbers detected (comma), using first: "${number}" → "${firstNumber}"`);
      } else if (number.includes('-')) {
        firstNumber = number.split('-')[0].trim();
        console.log(`[normalizeAddress] Range detected (hyphen), using first: "${number}" → "${firstNumber}"`);
      }
      
      const nominatimResult = await geocodeWithNominatim(street, firstNumber, postal, city);
      
      if (nominatimResult && nominatimResult.street && nominatimResult.number) {
        console.log('[normalizeAddress] ✅ SUCCESS with Nominatim!');
        console.log('[normalizeAddress] Normalized:', nominatimResult.formattedAddress);
        
        // Add validated address to cache for future use (street + postal + city)
        validatedStreetCache.add(nominatimResult.street, nominatimResult.postal, nominatimResult.city);
        
        return {
          formattedAddress: nominatimResult.formattedAddress,
          street: nominatimResult.street,
          number: number, // Keep user's house number input
          city: nominatimResult.city,
          postal: nominatimResult.postal,
        };
      } else {
        console.warn('[normalizeAddress] Nominatim returned incomplete data, falling back to Google...');
      }
    } catch (nominatimError: any) {
      // Check if queue is too long - this is expected and we just skip to Google
      if (nominatimError.message === 'QUEUE_TOO_LONG') {
        console.log('[normalizeAddress] Nominatim queue too long, skipping to Google Geocoding...');
      } else {
        console.warn('[normalizeAddress] Nominatim error:', nominatimError.message);
        console.warn('[normalizeAddress] Falling back to Google Geocoding...');
      }
    }

    // STEP 2: Fallback to Google Geocoding API
    console.log('[normalizeAddress] Step 2: Trying Google Geocoding API...');
    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      console.warn('[normalizeAddress] Google Geocoding API key not configured');
      console.warn('[normalizeAddress] Nominatim failed and no Google fallback available');
      return null;
    }

    // Check rate limit if username is provided
    if (username) {
      const rateLimitCheck = checkRateLimit(username, 'geocoding');
      if (rateLimitCheck.limited) {
        console.warn(`[normalizeAddress] Rate limit exceeded for user: ${username}`);
        throw new Error(rateLimitCheck.message);
      }
      // Increment counter before making API call
      incrementRateLimit(username, 'geocoding');
    }

    // Extract only the FIRST house number for Google (same logic as Nominatim)
    // Examples: "23/24" → "23", "23,24" → "23", "1-3" → "1"
    let firstNumberForGoogle = number;
    if (number.includes('/')) {
      firstNumberForGoogle = number.split('/')[0].trim();
      console.log(`[normalizeAddress] Google: Multiple numbers detected (slash), using first: "${number}" → "${firstNumberForGoogle}"`);
    } else if (number.includes(',')) {
      firstNumberForGoogle = number.split(',')[0].trim();
      console.log(`[normalizeAddress] Google: Multiple numbers detected (comma), using first: "${number}" → "${firstNumberForGoogle}"`);
    } else if (number.includes('-')) {
      firstNumberForGoogle = number.split('-')[0].trim();
      console.log(`[normalizeAddress] Google: Range detected (hyphen), using first: "${number}" → "${firstNumberForGoogle}"`);
    }

    // Construct address string for geocoding
    const addressString = `${street} ${firstNumberForGoogle}, ${postal} ${city || ''}, Deutschland`.trim();
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}&language=de`;
    
    console.log('[normalizeAddress] Validating with Google:', addressString);
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.results && data.results.length > 0) {
      const result = data.results[0];
      const addressComponents = result.address_components;
      
      // Validate that the result contains a street (route) component
      const hasRoute = addressComponents.some((component: any) => 
        component.types.includes('route')
      );
      
      // Validate that the result contains a street number
      const hasStreetNumber = addressComponents.some((component: any) => 
        component.types.includes('street_number')
      );
      
      // Check if result is a POI/transit station (not a real street address)
      const isPOI = result.types?.some((type: string) => 
        ['point_of_interest', 'transit_station', 'establishment'].includes(type)
      ) && !result.types?.includes('street_address') && !result.types?.includes('premise');
      
      // INTELLIGENT PARTIAL_MATCH VALIDATION:
      // partial_match can mean different things:
      // 1. Street name typo correction (mengerlberg → Mengelberg) → ACCEPT ✅
      // 2. POI/transit station instead of address → REJECT ❌
      // 3. Missing house number or incomplete address → REJECT ❌
      if (result.partial_match === true) {
        console.log('[normalizeAddress] ⚠️ Partial match detected - analyzing...');
        
        // REJECT if it's a POI/transit station
        if (isPOI) {
          console.warn('[normalizeAddress] ❌ Rejected: Partial match is a POI/transit station');
          console.warn('[normalizeAddress] Input:', addressString);
          console.warn('[normalizeAddress] Google returned:', result.formatted_address);
          console.warn('[normalizeAddress] Types:', result.types?.join(', '));
          return null;
        }
        
        // REJECT if missing critical components (street or street number)
        if (!hasRoute || !hasStreetNumber) {
          console.warn('[normalizeAddress] ❌ Rejected: Partial match missing route or street_number');
          console.warn('[normalizeAddress] Input:', addressString);
          console.warn('[normalizeAddress] Google returned:', result.formatted_address);
          console.warn('[normalizeAddress] Has route:', hasRoute, '| Has street_number:', hasStreetNumber);
          return null;
        }
        
        // ACCEPT if it's a valid street address (likely just a typo correction)
        if ((result.types?.includes('street_address') || result.types?.includes('premise')) && 
            hasRoute && hasStreetNumber) {
          console.log('[normalizeAddress] ✅ Accepted: Partial match is valid street address (likely typo correction)');
          console.log('[normalizeAddress] Input:', addressString);
          console.log('[normalizeAddress] Google corrected to:', result.formatted_address);
        }
      }
      
      // FIX 2: Route component is REQUIRED for all addresses
      // This ensures we only accept real streets, not POIs or transit stations
      if (!hasRoute) {
        console.warn('[normalizeAddress] Rejected: No street (route) component found');
        console.warn('[normalizeAddress] This indicates a POI, transit station, or area name - not a street address');
        console.warn('[normalizeAddress] Formatted:', result.formatted_address);
        console.warn('[normalizeAddress] Types:', result.types?.join(', '));
        return null;
      }
      
      // Check location_type for precision
      const locationType = result.geometry?.location_type;
      
      console.log('[normalizeAddress] ✅ Validation passed:', {
        hasRoute,
        hasStreetNumber,
        locationType,
        partialMatch: result.partial_match || false,
        isPOI,
        types: result.types?.join(', '),
        formatted: result.formatted_address
      });
      
      // If we have high precision (ROOFTOP or RANGE_INTERPOLATED), always accept it
      if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') {
        console.log('[normalizeAddress] Accepted: High precision location type');
        const normalized = extractAddressComponents(result, number);
        
        // Add validated address to cache for future use (street + postal + city)
        if (normalized && normalized.street && normalized.postal && normalized.city) {
          validatedStreetCache.add(normalized.street, normalized.postal, normalized.city);
        }
        
        return normalized;
      }
      
      // For lower precision: Check if the formatted address contains the street name
      const formattedLower = result.formatted_address.toLowerCase();
      const streetLower = street.toLowerCase();
      const postalStr = postal?.toString() || '';
      
      // Accept if formatted address contains street name and postal code
      // (route component already validated above)
      if (formattedLower.includes(streetLower) && formattedLower.includes(postalStr)) {
        console.log('[normalizeAddress] Accepted: Formatted address contains street and postal code');
        const normalized = extractAddressComponents(result, number);
        
        // Add validated address to cache for future use (street + postal + city)
        if (normalized && normalized.street && normalized.postal && normalized.city) {
          validatedStreetCache.add(normalized.street, normalized.postal, normalized.city);
        }
        
        return normalized;
      }
      
      // Fallback: If postal code matches, accept it
      // (route component already validated, so we know it's a real street)
      if (formattedLower.includes(postalStr)) {
        console.log('[normalizeAddress] Accepted: Route component exists and postal code matches');
        const normalized = extractAddressComponents(result, number);
        
        // Add validated address to cache for future use (street + postal + city)
        if (normalized && normalized.street && normalized.postal && normalized.city) {
          validatedStreetCache.add(normalized.street, normalized.postal, normalized.city);
        }
        
        return normalized;
      }
      
      // Reject if we can't verify the address
      console.warn('[normalizeAddress] Rejected: Cannot verify address from geocoding result');
      console.warn('[normalizeAddress] Street name mismatch or postal code not found in formatted address');
      console.warn('[normalizeAddress] Input street:', street);
      console.warn('[normalizeAddress] Google formatted:', result.formatted_address);
      return null;
    }
    
    console.warn('[normalizeAddress] Invalid: Geocoding returned no results for:', addressString);
    return null;
  } catch (error: any) {
    console.error('[normalizeAddress] Error during address validation:', error);
    // Re-throw validation errors with the original message
    if (error.message && (error.message.includes('muss angegeben werden') || error.message.includes('Rate limit'))) {
      throw error;
    }
    return null;
  }
}
