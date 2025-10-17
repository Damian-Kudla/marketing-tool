import { google } from 'googleapis';
import crypto from 'crypto';
import type { AddressDataset, EditableResident } from '../../shared/schema';
import { checkRateLimit, incrementRateLimit } from '../middleware/rateLimit';

// Helper function to get current time in Berlin timezone (MEZ/MESZ)
function getBerlinTime(): Date {
  // IMPORTANT: Always use UTC Date objects internally
  // This ensures consistent time calculations across different server timezones
  return new Date();
}

// Helper function to format date for Berlin timezone as ISO string
function formatBerlinTimeISO(date: Date): string {
  // Return ISO string in UTC (standardized storage format)
  // This avoids timezone confusion when reading back from Google Sheets
  return date.toISOString();
}

// RAM Cache for Address Datasets
class DatasetCache {
  private cache: Map<string, AddressDataset> = new Map();
  private dirtyDatasets: Set<string> = new Set();
  private syncInterval: NodeJS.Timeout | null = null;
  private sheetsService: AddressDatasetService | null = null;

  // Helper function to extract and normalize house numbers from a string
  private extractHouseNumbers(houseNumberStr: string): string[] {
    // Split by comma and trim whitespace, filter out empty strings
    return houseNumberStr
      .split(',')
      .map(num => num.trim())
      .filter(num => num.length > 0);
  }

  // Helper function to check if address matches considering house numbers
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
      
      // Extract street name (take part before postal code)
      let streetPart = normalizedAddr;
      if (postal) {
        const postalIndex = normalizedAddr.indexOf(postal);
        if (postalIndex > 0) {
          streetPart = normalizedAddr.substring(0, postalIndex);
        }
      }
      
      // Normalize street name: remove numbers, punctuation, and common words
      let street = streetPart
        .replace(/\d+[a-zA-Z]?(?:,?\s*\d+[a-zA-Z]?)*/g, '') // Remove house numbers
        .replace(/[,\.]/g, '') // Remove punctuation
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

    return false;
  }

  // Load all datasets from Google Sheets into RAM
  async initialize(sheetsService: AddressDatasetService) {
    this.sheetsService = sheetsService;
    console.log('[DatasetCache] Loading all datasets from Google Sheets into RAM...');
    
    try {
      const allDatasets = await sheetsService.loadAllDatasetsFromSheets();
      for (const dataset of allDatasets) {
        this.cache.set(dataset.id, dataset);
      }
      console.log(`[DatasetCache] Loaded ${this.cache.size} datasets into RAM cache`);
      
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
      console.log('[DatasetCache] No dirty datasets to sync');
      return;
    }

    console.log(`[DatasetCache] Syncing ${this.dirtyDatasets.size} dirty datasets to Google Sheets...`);
    const datasetIds = Array.from(this.dirtyDatasets);
    const syncPromises: Promise<void>[] = [];

    for (const datasetId of datasetIds) {
      const dataset = this.cache.get(datasetId);
      if (dataset && this.sheetsService) {
        syncPromises.push(
          this.sheetsService.writeDatasetToSheets(dataset)
            .then(() => {
              this.dirtyDatasets.delete(datasetId);
              console.log(`[DatasetCache] Synced dataset ${datasetId}`);
            })
            .catch((error: any) => {
              console.error(`[DatasetCache] Failed to sync dataset ${datasetId}:`, error);
            })
        );
      }
    }

    await Promise.allSettled(syncPromises);
    console.log('[DatasetCache] Sync complete');
  }

  // Get dataset from cache
  get(datasetId: string): AddressDataset | null {
    return this.cache.get(datasetId) || null;
  }

  // Get datasets by normalized address with flexible house number matching
  getByAddress(normalizedAddress: string, limit?: number, houseNumber?: string): AddressDataset[] {
    const searchHouseNumbers = houseNumber ? this.extractHouseNumbers(houseNumber) : [];

    const matchingDatasets = Array.from(this.cache.values())
      .filter(ds => {
        const datasetHouseNumbers = this.extractHouseNumbers(ds.houseNumber);
        
        // Use flexible matching if house numbers are provided
        if (searchHouseNumbers.length > 0 && datasetHouseNumbers.length > 0) {
          return this.addressMatches(
            normalizedAddress,
            searchHouseNumbers,
            ds.normalizedAddress,
            datasetHouseNumbers
          );
        }
        
        // Fallback to exact match if no house numbers provided
        return ds.normalizedAddress === normalizedAddress;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    console.log(`[DatasetCache.getByAddress] Found ${matchingDatasets.length} matching dataset(s)`);
    
    const result = limit ? matchingDatasets.slice(0, limit) : matchingDatasets;
    
    if (result.length > 0) {
      console.log('[DatasetCache.getByAddress] Returning datasets:', 
        result.map(ds => ({
          id: ds.id,
          address: ds.normalizedAddress,
          houseNumber: ds.houseNumber,
          createdAt: ds.createdAt,
          createdBy: ds.createdBy
        }))
      );
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
      console.log(`[DatasetCache] Dataset ${dataset.id} updated in cache and marked dirty`);
    } else {
      console.log(`[DatasetCache] Dataset ${dataset.id} added to cache (already in sheets)`);
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
          'https://www.googleapis.com/auth/spreadsheets.readonly',
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

export interface SheetsService {
  getValidPasswords(): Promise<string[]>;
  getPasswordUserMap(): Promise<Map<string, string>>;
  getUserByPassword(password: string): Promise<string | null>;
  isUserAdmin(password: string): Promise<boolean>;
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

class GoogleSheetsService implements SheetsService {
  private readonly SHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
  private readonly WORKSHEET_NAME = 'Zugangsdaten';
  private readonly RANGE = 'A2:B'; // Both columns A and B starting from row 2

  async getValidPasswords(): Promise<string[]> {
    const passwordUserMap = await this.getPasswordUserMap();
    return Array.from(passwordUserMap.keys());
  }

  async getPasswordUserMap(): Promise<Map<string, string>> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available - authentication will fail');
      return new Map();
    }

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A2:D`, // Extended to column D for admin role
      });

      const rows = response.data.values || [];
      const passwordUserMap = new Map<string, string>();
      
      // Process each row to extract password and username
      for (const row of rows) {
        const password = row[0]?.trim();
        const username = row[1]?.trim();
        
        if (password && username) {
          passwordUserMap.set(password, username);
        }
      }

      console.log(`Loaded ${passwordUserMap.size} valid password-username pairs from Google Sheets`);
      return passwordUserMap;
    } catch (error) {
      console.error('Error fetching password-username data from Google Sheets:', error);
      throw new Error('Failed to load authentication data');
    }
  }

  async isUserAdmin(password: string): Promise<boolean> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available');
      return false;
    }

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A2:D`,
      });

      const rows = response.data.values || [];
      
      // Find the user's row by password
      for (const row of rows) {
        const rowPassword = row[0]?.trim();
        const adminRole = row[3]?.trim().toLowerCase(); // Column D
        
        if (rowPassword === password.trim()) {
          const isAdmin = adminRole === 'admin';
          console.log(`[Auth] User with password ${password.substring(0, 3)}... is ${isAdmin ? 'ADMIN' : 'REGULAR USER'}`);
          return isAdmin;
        }
      }

      console.log(`[Auth] Password not found in sheet`);
      return false;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  async getUserPostalCodes(username: string): Promise<string[]> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available');
      return [];
    }

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A2:C`,
      });

      const rows = response.data.values || [];
      
      // Find the user's row
      for (const row of rows) {
        const rowUsername = row[1]?.trim();
        const postalCodesString = row[2]?.trim();
        
        if (rowUsername === username && postalCodesString) {
          // Split by comma and clean up
          const postalCodes = postalCodesString
            .split(',')
            .map((code: string) => code.trim())
            .filter((code: string) => code.length > 0);
          
          console.log(`[PLZ-Check] User ${username} has postal codes: ${postalCodes.join(', ')}`);
          return postalCodes;
        }
      }

      console.log(`[PLZ-Check] User ${username} has no postal code restrictions`);
      return []; // No postal codes = no restriction
    } catch (error) {
      console.error('Error fetching user postal codes:', error);
      return []; // On error, allow all
    }
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
    const passwordUserMap = await this.getPasswordUserMap();
    return passwordUserMap.get(password.trim()) || null;
  }
}

class AddressDatasetService implements AddressSheetsService {
  private readonly ADDRESSES_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
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
    await this.ensureAddressesSheetExists();

    const id = this.generateDatasetId();
    const createdAt = getBerlinTime(); // Use Berlin timezone
    const fullDataset: AddressDataset = {
      ...dataset,
      id,
      createdAt,
    };

    const rowData = [
      id,
      dataset.normalizedAddress,
      dataset.street,
      dataset.houseNumber,
      dataset.city || '',
      dataset.postalCode,
      dataset.createdBy,
      formatBerlinTimeISO(createdAt), // Format in Berlin timezone
      JSON.stringify(dataset.rawResidentData),
      this.serializeResidents([...dataset.editableResidents, ...dataset.fixedCustomers])
    ];

    try {
      // Write to Google Sheets immediately (new dataset)
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.ADDRESSES_WORKSHEET_NAME}!A:J`,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      // Add to cache WITHOUT marking dirty (already written to sheets)
      datasetCache.addNew(fullDataset);

      console.log(`Created address dataset ${id} for ${dataset.normalizedAddress}`);
      return fullDataset;
    } catch (error) {
      console.error('Error creating address dataset:', error);
      throw new Error('Failed to create address dataset');
    }
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
    
    if (dataset) {
      console.log(`[getDatasetById] Found dataset ${datasetId} in cache:`, {
        residentsCount: dataset.editableResidents.length,
        residents: JSON.stringify(dataset.editableResidents)
      });
    } else {
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

    // Update cache and mark as dirty (will sync to sheets in background)
    datasetCache.set(dataset);
    console.log(`[updateResidentInDataset] Cache updated for dataset ${datasetId} (will sync to sheets in next batch)`);
  }

  async bulkUpdateResidentsInDataset(datasetId: string, editableResidents: EditableResident[]): Promise<void> {
    // Get dataset from cache
    const dataset = datasetCache.get(datasetId);
    if (!dataset) {
      console.error(`[bulkUpdateResidentsInDataset] ERROR: Dataset ${datasetId} not found in cache!`);
      console.error(`[bulkUpdateResidentsInDataset] Cache has ${datasetCache.getAll().length} datasets`);
      throw new Error(`Dataset ${datasetId} not found in cache`);
    }

    console.log(`[bulkUpdateResidentsInDataset] BEFORE update:`, {
      datasetId,
      currentResidentsCount: dataset.editableResidents.length,
      newResidentsCount: editableResidents.length,
      currentResidents: JSON.stringify(dataset.editableResidents),
      newResidents: JSON.stringify(editableResidents)
    });

    // Update residents in cache
    dataset.editableResidents = editableResidents;

    // Update cache and mark as dirty (will sync to sheets in background)
    datasetCache.set(dataset);

    // Verify the update
    const verifyDataset = datasetCache.get(datasetId);
    console.log(`[bulkUpdateResidentsInDataset] AFTER update - Verification:`, {
      datasetId,
      residentsCount: verifyDataset?.editableResidents.length,
      residents: JSON.stringify(verifyDataset?.editableResidents),
      markedDirty: true
    });

    console.log(`[bulkUpdateResidentsInDataset] Updated ${editableResidents.length} residents in cache for dataset ${datasetId} (will sync to sheets in next batch)`);
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

    console.log('[getUserDatasetsByDate] Searching cache for:', { username, date, dayStart, dayEnd });

    // Filter from cache
    const datasets = datasetCache.getAll().filter(dataset => {
      const createdAt = new Date(dataset.createdAt);
      return dataset.createdBy === username && createdAt >= dayStart && createdAt < dayEnd;
    });

    console.log(`[getUserDatasetsByDate] Found ${datasets.length} datasets in cache`);
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
          return {
            datasetId: dataset.id,
            address: dataset.normalizedAddress,
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
          const createdAtStr = row[7] || new Date().toISOString();
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

// Initialize cache on startup
if (sheetsEnabled) {
  datasetCache.initialize(addressDatasetService)
    .then(() => console.log('[DatasetCache] Cache initialization complete'))
    .catch((error) => console.error('[DatasetCache] Cache initialization failed:', error));
}

// Category Change Logging Service
class CategoryChangeLoggingService {
  private readonly SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
  private readonly WORKSHEET_NAME = 'Log_Änderung_Kategorie';

  // Get Sheets client dynamically to avoid initialization issues
  private get sheetsAPI() {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY || '{}'),
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
    await this.ensureSheetExists();

    const id = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const changedAt = formatBerlinTimeISO(getBerlinTime());

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

    try {
      const client = this.sheetsAPI;
      await client.spreadsheets.values.append({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!A:I`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData]
        }
      });

      console.log(`[CategoryChangeLogging] Logged category change: ${oldCategory} → ${newCategory} for ${residentOriginalName} by ${changedBy}`);
    } catch (error) {
      console.error('[CategoryChangeLogging] Error logging category change:', error);
      throw error;
    }
  }
}

export const categoryChangeLoggingService = new CategoryChangeLoggingService();

// Appointment Service with RAM cache
class AppointmentService {
  private appointmentsCache: Map<string, any> = new Map();
  private lastSync: Date | null = null;
  private readonly SHEET_NAME = "Termine";
  private readonly SYNC_INTERVAL = 60000; // 60 seconds
  private readonly ADDRESSES_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';

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

  // Sync appointments from Google Sheets to RAM cache
  async syncFromSheets(): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    console.log(`[AppointmentService] === SYNC FROM SHEETS START ===`);
    
    try {
      await this.ensureSheetExists();

      const sheets = sheetsClient.spreadsheets;
      const response = await sheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.SHEET_NAME}!A2:I`,
      });

      const rows = response.data.values || [];
      console.log(`[AppointmentService] Retrieved ${rows.length} data rows from Google Sheets`);
      
      const previousCacheSize = this.appointmentsCache.size;
      this.appointmentsCache.clear();

      let validCount = 0;
      for (const row of rows) {
        if (row.length >= 9) { // Need 9 columns (0-8) to include createdAt
          const appointment = {
            id: row[0],
            datasetId: row[1],
            residentName: row[2],
            address: row[3],
            appointmentDate: row[4],
            appointmentTime: row[5],
            notes: row[6] || "",
            createdBy: row[7],
            createdAt: new Date(row[8]),
          };
          this.appointmentsCache.set(appointment.id, appointment);
          validCount++;
        } else {
          console.log(`[AppointmentService] Skipping invalid row (length: ${row.length}): [${row.join(', ')}]`);
        }
      }

      this.lastSync = new Date();
      console.log(`[AppointmentService] ✓ Synced ${validCount} valid appointments from Sheets`);
      console.log(`[AppointmentService] Cache: ${previousCacheSize} → ${this.appointmentsCache.size} appointments`);
      console.log(`[AppointmentService] === SYNC FROM SHEETS END ===`);
    } catch (error) {
      console.error("[AppointmentService] ✗ Error syncing from Sheets:", error);
      throw error;
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
      await this.ensureSheetExists();

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

      // Write to Sheets first
      if (!sheetsEnabled || !sheetsClient) {
        throw new Error('Google Sheets API not available');
      }
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
    
    // Sync if cache is stale
    const cacheAge = this.lastSync ? Date.now() - this.lastSync.getTime() : Infinity;
    const needsSync = !this.lastSync || cacheAge > this.SYNC_INTERVAL;
    
    console.log(`[AppointmentService] Cache age: ${cacheAge}ms, Needs sync: ${needsSync}`);
    
    if (needsSync) {
      console.log(`[AppointmentService] Cache stale, syncing from sheets...`);
      await this.syncFromSheets();
    }

    const allAppointments = Array.from(this.appointmentsCache.values());
    console.log(`[AppointmentService] Total appointments in cache: ${allAppointments.length}`);
    
    const userAppointments = allAppointments
      .filter(apt => {
        const matches = apt.createdBy === username;
        if (!matches) {
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

    console.log(`[AppointmentService] User appointments found: ${userAppointments.length}`);
    return userAppointments;
  }

  // Get upcoming appointments for a user
  async getUpcomingAppointments(username: string): Promise<any[]> {
    // Always sync fresh data to prevent showing wrong user's appointments
    await this.syncFromSheets();
    
    const allAppointments = await this.getUserAppointments(username);
    const today = new Date().toISOString().split('T')[0];

    return allAppointments.filter(apt => apt.appointmentDate >= today);
  }

  // Delete appointment from "Termine" sheet only
  // Note: This keeps the resident's status as "appointment" and their floor data intact
  // It only removes the specific appointment entry (date, time, notes) from the calendar
  async deleteAppointment(id: string): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    console.log(`[AppointmentService] === DELETE APPOINTMENT START === ID: ${id}`);

    try {
      // First, get the sheet ID
      const sheetId = await this.getSheetId();
      console.log(`[AppointmentService] Sheet ID for "${this.SHEET_NAME}": ${sheetId}`);

      // Get all rows to find the appointment
      const sheets = sheetsClient.spreadsheets;
      const response = await sheets.values.get({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.SHEET_NAME}!A:I`, // Get full row to verify data
      });

      const rows = response.data.values || [];
      console.log(`[AppointmentService] Total rows in sheet (including header): ${rows.length}`);
      
      // Find the row with matching ID (skip header row 0)
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
        console.log(`[AppointmentService] ERROR: Appointment ${id} not found in sheet!`);
        console.log(`[AppointmentService] Searched through ${rows.length} rows`);
        console.log(`[AppointmentService] First few IDs in sheet: ${rows.slice(1, 4).map((r: any) => r[0]).join(', ')}`);
        
        // Remove from cache anyway
        this.appointmentsCache.delete(id);
        return;
      }

      console.log(`[AppointmentService] Found appointment at rowIndex: ${rowIndex} (0-based)`);
      console.log(`[AppointmentService] Row content: [${rows[rowIndex].join(', ')}]`);

      // For deletion: rowIndex is 0-based
      // Row 0 = header
      // Row 1 = first data row (index 1)
      // To delete row at index N, we use startIndex: N, endIndex: N+1
      
      const startIndex = rowIndex;
      const endIndex = rowIndex + 1;
      
      console.log(`[AppointmentService] Deleting with startIndex: ${startIndex}, endIndex: ${endIndex}`);

      // Delete the row
      await sheets.batchUpdate({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: startIndex,
                endIndex: endIndex,
              },
            },
          }],
        },
      });

      console.log(`[AppointmentService] ✓ Successfully sent delete request to Google Sheets API`);
      
      // Remove from cache
      this.appointmentsCache.delete(id);
      console.log(`[AppointmentService] ✓ Removed from cache`);
      
      // Force a sync to verify deletion
      console.log(`[AppointmentService] Forcing cache sync to verify deletion...`);
      await this.syncFromSheets();
      
      if (this.appointmentsCache.has(id)) {
        console.error(`[AppointmentService] ✗ ERROR: Appointment ${id} still in cache after sync!`);
      } else {
        console.log(`[AppointmentService] ✓ Verified: Appointment ${id} successfully deleted`);
      }
      
      console.log(`[AppointmentService] === DELETE APPOINTMENT END ===`);
    } catch (error) {
      console.error("[AppointmentService] ✗ Error deleting appointment:", error);
      console.log(`[AppointmentService] === DELETE APPOINTMENT FAILED ===`);
      throw error;
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

    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      console.warn('Google Geocoding API key not configured - address validation disabled');
      // Without API key, we can't validate the address properly
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

    // Construct address string for geocoding
    // We validate street name and postal code with Google, but keep the user's house number
    const addressString = `${street} ${number}, ${postal} ${city || ''}, Deutschland`.trim();
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}&language=de`;
    
    console.log('[normalizeAddress] Validating:', addressString);
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
      
      // Check location_type for precision
      const locationType = result.geometry?.location_type;
      
      console.log('[normalizeAddress] Validation result:', {
        hasRoute,
        hasStreetNumber,
        locationType,
        formatted: result.formatted_address
      });
      
      // If we have high precision (ROOFTOP or RANGE_INTERPOLATED), always accept it
      if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') {
        console.log('[normalizeAddress] Accepted: High precision location type');
        return extractAddressComponents(result, number);
      }
      
      // For lower precision: Check if the formatted address contains the street name
      const formattedLower = result.formatted_address.toLowerCase();
      const streetLower = street.toLowerCase();
      const postalStr = postal?.toString() || '';
      
      // Accept if formatted address contains street name and postal code
      // Note: Some addresses don't include house number in formatted_address (e.g., "Neusser Weyhe")
      if (formattedLower.includes(streetLower) && formattedLower.includes(postalStr)) {
        console.log('[normalizeAddress] Accepted: Formatted address contains street and postal code');
        return extractAddressComponents(result, number);
      }
      
      // Fallback: If route component exists, accept it
      if (hasRoute) {
        console.log('[normalizeAddress] Accepted: Has route component');
        return extractAddressComponents(result, number);
      }
      
      // Last resort: Check if postal code matches and location is reasonably close
      // This handles edge cases where street names are formatted differently
      if (formattedLower.includes(postalStr)) {
        console.log('[normalizeAddress] Accepted: Postal code matches (last resort)');
        return extractAddressComponents(result, number);
      }
      
      // Reject if we can't verify the address
      console.warn('[normalizeAddress] Invalid: Cannot verify address from geocoding result');
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