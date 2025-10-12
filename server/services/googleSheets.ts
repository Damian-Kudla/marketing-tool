import { google } from 'googleapis';
import type { AddressDataset, EditableResident } from '../../shared/schema';

// Helper function to get current time in Berlin timezone (MEZ/MESZ)
function getBerlinTime(): Date {
  // Create date in Berlin timezone
  const berlinTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  return berlinTime;
}

// Helper function to format date for Berlin timezone as ISO string
function formatBerlinTimeISO(date: Date): string {
  // Convert to Berlin timezone and format as ISO string
  const berlinDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  return berlinDate.toISOString();
}

// RAM Cache for Address Datasets
class DatasetCache {
  private cache: Map<string, AddressDataset> = new Map();
  private dirtyDatasets: Set<string> = new Set();
  private syncInterval: NodeJS.Timeout | null = null;
  private sheetsService: AddressDatasetService | null = null;

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
    const dataset = this.cache.get(datasetId) || null;
    console.log(`[DatasetCache.get] Retrieving dataset ${datasetId}:`, dataset ? 'FOUND' : 'NOT FOUND');
    return dataset;
  }

  // Get datasets by normalized address
  getByAddress(normalizedAddress: string, limit?: number): AddressDataset[] {
    const datasets = Array.from(this.cache.values())
      .filter(ds => ds.normalizedAddress === normalizedAddress)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return limit ? datasets.slice(0, limit) : datasets;
  }

  // Get all datasets
  getAll(): AddressDataset[] {
    return Array.from(this.cache.values());
  }

  // Add or update dataset in cache and mark as dirty
  set(dataset: AddressDataset) {
    this.cache.set(dataset.id, dataset);
    this.dirtyDatasets.add(dataset.id);
    console.log(`[DatasetCache] Dataset ${dataset.id} updated in cache and marked dirty`);
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
}

export interface AddressSheetsService {
  createAddressDataset(dataset: Omit<AddressDataset, 'id' | 'createdAt'>): Promise<AddressDataset>;
  getAddressDatasets(normalizedAddress: string, limit?: number): Promise<AddressDataset[]>;
  getDatasetById(datasetId: string): Promise<AddressDataset | null>;
  updateResidentInDataset(datasetId: string, residentIndex: number, resident: EditableResident | null): Promise<void>;
  bulkUpdateResidentsInDataset(datasetId: string, editableResidents: EditableResident[]): Promise<void>;
  getTodaysDatasetByAddress(normalizedAddress: string): Promise<AddressDataset | null>;
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
        range: `${this.WORKSHEET_NAME}!${this.RANGE}`,
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

      // Add to cache
      datasetCache.set(fullDataset);

      console.log(`Created address dataset ${id} for ${dataset.normalizedAddress}`);
      return fullDataset;
    } catch (error) {
      console.error('Error creating address dataset:', error);
      throw new Error('Failed to create address dataset');
    }
  }

  async getAddressDatasets(normalizedAddress: string, limit: number = 5): Promise<AddressDataset[]> {
    // Use cache instead of reading from sheets
    return datasetCache.getByAddress(normalizedAddress, limit);
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

  async getTodaysDatasetByAddress(normalizedAddress: string): Promise<AddressDataset | null> {
    const today = getBerlinTime(); // Use Berlin timezone
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const datasets = await this.getAddressDatasets(normalizedAddress, 50); // Get more to check dates
    
    for (const dataset of datasets) {
      if (dataset.createdAt >= todayStart && dataset.createdAt < todayEnd) {
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
          const dataset: AddressDataset = {
            id: row[0],
            normalizedAddress: row[1] || '',
            street: row[2] || '',
            houseNumber: row[3] || '',
            city: row[4] || '',
            postalCode: row[5] || '',
            createdBy: row[6] || '',
            createdAt: new Date(row[7] || Date.now()),
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

      if (rowIndex === -1) {
        throw new Error(`Dataset ${dataset.id} not found in sheets`);
      }

      // Update the row (row index + 2 because: 0-indexed + header row + 1)
      const sheetRow = rowIndex + 2;
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.ADDRESSES_SHEET_ID,
        range: `${this.ADDRESSES_WORKSHEET_NAME}!A${sheetRow}:J${sheetRow}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[
            dataset.id,
            dataset.normalizedAddress,
            dataset.street,
            dataset.houseNumber,
            dataset.city,
            dataset.postalCode,
            dataset.createdBy,
            formatBerlinTimeISO(dataset.createdAt),
            JSON.stringify(dataset.rawResidentData),
            this.serializeResidents(dataset.editableResidents),
          ]]
        }
      });

      console.log(`[writeDatasetToSheets] Successfully wrote dataset ${dataset.id} to row ${sheetRow}`);
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

// Address normalization function using Google Geocoding API
export async function normalizeAddress(
  street: string,
  number: string,
  city?: string,
  postal?: string
): Promise<string> {
  try {
    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      // Fallback to simple concatenation if no API key
      return `${street} ${number}, ${postal} ${city || ''}`.trim();
    }

    // Construct address string for geocoding
    const addressString = `${street} ${number}, ${postal} ${city || ''}, Deutschland`.trim();
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}&language=de`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.results && data.results.length > 0) {
      // Use the formatted address from Google
      return data.results[0].formatted_address;
    }
    
    // Fallback to simple concatenation
    return `${street} ${number}, ${postal} ${city || ''}`.trim();
  } catch (error) {
    console.error('Address normalization failed:', error);
    // Fallback to simple concatenation
    return `${street} ${number}, ${postal} ${city || ''}`.trim();
  }
}