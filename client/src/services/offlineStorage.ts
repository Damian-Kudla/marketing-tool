// IndexedDB service for offline data storage in PWA
export interface OfflineOCRResult {
  id: string;
  timestamp: number;
  imageData: string; // Base64 encoded image
  ocrResults: any;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    latitude?: number;
    longitude?: number;
  };
  syncStatus: 'pending' | 'synced' | 'failed';
  deviceInfo: {
    userAgent: string;
    timestamp: string;
    orientation?: string;
  };
}

export interface OfflineAddress {
  id: string;
  timestamp: number;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  latitude?: number;
  longitude?: number;
  source: 'gps' | 'manual';
  syncStatus: 'pending' | 'synced' | 'failed';
}

export class OfflineStorageService {
  private static instance: OfflineStorageService;
  private db: IDBDatabase | null = null;
  private readonly dbName = 'EnergyScanner';
  private readonly dbVersion = 1;

  private constructor() {
    this.initializeDB();
  }

  public static getInstance(): OfflineStorageService {
    if (!OfflineStorageService.instance) {
      OfflineStorageService.instance = new OfflineStorageService();
    }
    return OfflineStorageService.instance;
  }

  // Initialize IndexedDB database
  private async initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        console.error('IndexedDB not supported');
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createObjectStores(db);
      };
    });
  }

  // Create object stores for offline data
  private createObjectStores(db: IDBDatabase): void {
    // OCR Results store
    if (!db.objectStoreNames.contains('ocrResults')) {
      const ocrStore = db.createObjectStore('ocrResults', { keyPath: 'id' });
      ocrStore.createIndex('timestamp', 'timestamp', { unique: false });
      ocrStore.createIndex('syncStatus', 'syncStatus', { unique: false });
    }

    // Addresses store
    if (!db.objectStoreNames.contains('addresses')) {
      const addressStore = db.createObjectStore('addresses', { keyPath: 'id' });
      addressStore.createIndex('timestamp', 'timestamp', { unique: false });
      addressStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      addressStore.createIndex('location', ['latitude', 'longitude'], { unique: false });
    }

    // App metadata store
    if (!db.objectStoreNames.contains('metadata')) {
      db.createObjectStore('metadata', { keyPath: 'key' });
    }

    console.log('IndexedDB object stores created');
  }

  // Ensure database is ready
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initializeDB();
    }
    if (!this.db) {
      throw new Error('Database not available');
    }
    return this.db;
  }

  // Save OCR result offline
  public async saveOCRResult(result: Omit<OfflineOCRResult, 'id' | 'timestamp' | 'syncStatus'>): Promise<string> {
    const db = await this.ensureDB();
    const id = this.generateId();
    
    const ocrResult: OfflineOCRResult = {
      ...result,
      id,
      timestamp: Date.now(),
      syncStatus: 'pending'
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults'], 'readwrite');
      const store = transaction.objectStore('ocrResults');
      const request = store.add(ocrResult);

      request.onsuccess = () => {
        console.log('OCR result saved offline:', id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('Failed to save OCR result:', request.error);
        reject(request.error);
      };
    });
  }

  // Get all OCR results
  public async getOCRResults(limit?: number): Promise<OfflineOCRResult[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults'], 'readonly');
      const store = transaction.objectStore('ocrResults');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev'); // Most recent first

      const results: OfflineOCRResult[] = [];
      let count = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor && (!limit || count < limit)) {
          results.push(cursor.value);
          count++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        console.error('Failed to get OCR results:', request.error);
        reject(request.error);
      };
    });
  }

  // Get OCR result by ID
  public async getOCRResult(id: string): Promise<OfflineOCRResult | null> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults'], 'readonly');
      const store = transaction.objectStore('ocrResults');
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error('Failed to get OCR result:', request.error);
        reject(request.error);
      };
    });
  }

  // Save address offline
  public async saveAddress(address: Omit<OfflineAddress, 'id' | 'timestamp' | 'syncStatus'>): Promise<string> {
    const db = await this.ensureDB();
    const id = this.generateId();
    
    const offlineAddress: OfflineAddress = {
      ...address,
      id,
      timestamp: Date.now(),
      syncStatus: 'pending'
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['addresses'], 'readwrite');
      const store = transaction.objectStore('addresses');
      const request = store.add(offlineAddress);

      request.onsuccess = () => {
        console.log('Address saved offline:', id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('Failed to save address:', request.error);
        reject(request.error);
      };
    });
  }

  // Get all addresses
  public async getAddresses(limit?: number): Promise<OfflineAddress[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['addresses'], 'readonly');
      const store = transaction.objectStore('addresses');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev'); // Most recent first

      const results: OfflineAddress[] = [];
      let count = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor && (!limit || count < limit)) {
          results.push(cursor.value);
          count++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        console.error('Failed to get addresses:', request.error);
        reject(request.error);
      };
    });
  }

  // Get pending items for sync
  public async getPendingOCRResults(): Promise<OfflineOCRResult[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults'], 'readonly');
      const store = transaction.objectStore('ocrResults');
      const index = store.index('syncStatus');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('Failed to get pending OCR results:', request.error);
        reject(request.error);
      };
    });
  }

  public async getPendingAddresses(): Promise<OfflineAddress[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['addresses'], 'readonly');
      const store = transaction.objectStore('addresses');
      const index = store.index('syncStatus');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('Failed to get pending addresses:', request.error);
        reject(request.error);
      };
    });
  }

  // Update sync status
  public async updateOCRResultSyncStatus(id: string, status: 'pending' | 'synced' | 'failed'): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults'], 'readwrite');
      const store = transaction.objectStore('ocrResults');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result) {
          result.syncStatus = status;
          const putRequest = store.put(result);
          
          putRequest.onsuccess = () => {
            console.log(`OCR result ${id} sync status updated to ${status}`);
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(putRequest.error);
          };
        } else {
          reject(new Error('OCR result not found'));
        }
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  public async updateAddressSyncStatus(id: string, status: 'pending' | 'synced' | 'failed'): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['addresses'], 'readwrite');
      const store = transaction.objectStore('addresses');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result) {
          result.syncStatus = status;
          const putRequest = store.put(result);
          
          putRequest.onsuccess = () => {
            console.log(`Address ${id} sync status updated to ${status}`);
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(putRequest.error);
          };
        } else {
          reject(new Error('Address not found'));
        }
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  // Delete old synced data to manage storage
  public async cleanupSyncedData(olderThanDays: number = 30): Promise<void> {
    const db = await this.ensureDB();
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults', 'addresses'], 'readwrite');
      let completed = 0;
      const total = 2;

      const checkCompletion = () => {
        completed++;
        if (completed === total) {
          console.log('Cleanup completed');
          resolve();
        }
      };

      // Clean OCR results
      const ocrStore = transaction.objectStore('ocrResults');
      const ocrIndex = ocrStore.index('timestamp');
      const ocrRequest = ocrIndex.openCursor(IDBKeyRange.upperBound(cutoffTime));

      ocrRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const result = cursor.value;
          if (result.syncStatus === 'synced') {
            cursor.delete();
          }
          cursor.continue();
        } else {
          checkCompletion();
        }
      };

      ocrRequest.onerror = () => reject(ocrRequest.error);

      // Clean addresses
      const addressStore = transaction.objectStore('addresses');
      const addressIndex = addressStore.index('timestamp');
      const addressRequest = addressIndex.openCursor(IDBKeyRange.upperBound(cutoffTime));

      addressRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const result = cursor.value;
          if (result.syncStatus === 'synced') {
            cursor.delete();
          }
          cursor.continue();
        } else {
          checkCompletion();
        }
      };

      addressRequest.onerror = () => reject(addressRequest.error);
    });
  }

  // Get storage usage statistics
  public async getStorageStats(): Promise<{
    ocrResultsCount: number;
    addressesCount: number;
    pendingOCRCount: number;
    pendingAddressCount: number;
  }> {
    const db = await this.ensureDB();

    const stats = {
      ocrResultsCount: 0,
      addressesCount: 0,
      pendingOCRCount: 0,
      pendingAddressCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['ocrResults', 'addresses'], 'readonly');
      let completed = 0;
      const total = 4;

      const checkCompletion = () => {
        completed++;
        if (completed === total) {
          resolve(stats);
        }
      };

      // Count OCR results
      const ocrStore = transaction.objectStore('ocrResults');
      ocrStore.count().onsuccess = (event) => {
        stats.ocrResultsCount = (event.target as IDBRequest).result;
        checkCompletion();
      };

      // Count addresses
      const addressStore = transaction.objectStore('addresses');
      addressStore.count().onsuccess = (event) => {
        stats.addressesCount = (event.target as IDBRequest).result;
        checkCompletion();
      };

      // Count pending OCR results
      const pendingOCRIndex = ocrStore.index('syncStatus');
      pendingOCRIndex.count('pending').onsuccess = (event) => {
        stats.pendingOCRCount = (event.target as IDBRequest).result;
        checkCompletion();
      };

      // Count pending addresses
      const pendingAddressIndex = addressStore.index('syncStatus');
      pendingAddressIndex.count('pending').onsuccess = (event) => {
        stats.pendingAddressCount = (event.target as IDBRequest).result;
        checkCompletion();
      };
    });
  }

  // Generate unique ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Save app metadata
  public async saveMetadata(key: string, value: any): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readwrite');
      const store = transaction.objectStore('metadata');
      const request = store.put({ key, value, timestamp: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Get app metadata
  public async getMetadata(key: string): Promise<any> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readonly');
      const store = transaction.objectStore('metadata');
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const offlineStorage = OfflineStorageService.getInstance();