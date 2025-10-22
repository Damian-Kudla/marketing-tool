import { type User, type InsertUser, type Customer, type InsertCustomer, type Address } from "@shared/schema";
import { randomUUID } from "crypto";
import { google } from "googleapis";
import leven from "leven";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getCustomer(id: string): Promise<Customer | undefined>;
  getCustomerByName(name: string, address?: Partial<Address>): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  getAllCustomers(): Promise<Customer[]>;
  searchCustomers(name: string, address?: Partial<Address>): Promise<Customer[]>;
  getCustomersByAddress(address: Partial<Address>): Promise<Customer[]>;
}

export class GoogleSheetsStorage implements IStorage {
  private users: Map<string, User>;
  private sheetsClient: any;
  private cache: { customers: Customer[] | null; timestamp: number | null };
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly SPREADSHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
  private readonly SHEET_NAME = 'Customers';
  private initialized: boolean = false;

  constructor() {
    this.users = new Map();
    this.cache = { customers: null, timestamp: null };
    this.initializeSheets();
  }

  /**
   * Expand house number range to individual numbers
   * Examples:
   * - "1-3" → ["1", "2", "3"]
   * - "1,2,3" → ["1", "2", "3"]
   * - "1,3-5" → ["1", "3", "4", "5"]
   * - "23/24" → ["23", "24"]  (Slash-Notation from Google)
   * - "2" → ["2"]
   */
  private expandHouseNumberRange(houseNumber: string): string[] {
    if (!houseNumber) return [];
    
    // Split by comma AND slash (handles "1,2,3" or "23/24" or "1,3-5")
    const parts = houseNumber.split(/[,\/]/).map(p => p.trim()).filter(p => p.length > 0);
    
    const expanded: string[] = [];
    
    for (const part of parts) {
      // Check if this part is a range (contains hyphen)
      if (part.includes('-')) {
        const rangeParts = part.split('-');
        if (rangeParts.length === 2) {
          const start = parseInt(rangeParts[0].trim());
          const end = parseInt(rangeParts[1].trim());
          
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
          } else {
            // Invalid range, treat as literal
            expanded.push(part);
          }
        } else {
          // Multiple hyphens, treat as literal
          expanded.push(part);
        }
      } else {
        // Single number or letter suffix (e.g., "10a")
        expanded.push(part);
      }
    }
    
    // Remove duplicates and return
    return Array.from(new Set(expanded));
  }

  /**
   * Check if two house numbers match using expansion logic
   * Examples:
   * - matchesHouseNumber("2", "1-3") → true
   * - matchesHouseNumber("4", "1-3") → false
   * - matchesHouseNumber("1,2", "1-3") → true
   * - matchesHouseNumber("1-3", "2") → true
   */
  private matchesHouseNumber(searchNumber: string, customerNumber: string): boolean {
    const searchExpanded = this.expandHouseNumberRange(searchNumber);
    const customerExpanded = this.expandHouseNumberRange(customerNumber);
    
    // Check if ANY number overlaps
    return searchExpanded.some(s => customerExpanded.includes(s));
  }

  /**
   * Normalize street name by replacing street suffixes at the END with 'strasse' (consistent form for length preservation)
   * - Convert to lowercase
   * - Replace umlauts early
   * - Replace variants ONLY at the end (no \b to allow attached suffixes)
   * - Handle more typos and remove special characters/spaces
   * - Remove problematic characters that cause matching issues (apostrophes, special chars)
   */
  private normalizeStreet(street: string): string {
    return street
      .toLowerCase()
      .trim()
      // Replace umlauts early (ß to ss)
      .replace(/ß/g, 'ss')
      // Remove problematic characters BEFORE other normalization (apostrophes, backticks, quotes, etc.)
      // This handles cases like "Auf'm Kamp" vs "Aufm Kamp" vs "Auf`m Kamp"
      .replace(/['`´!"§$%&/()=?\\}\][{#*~^°]/g, '')
      // Replace variants at the END with 'strasse' (no \b, adjusted for ss)
      .replace(/(str(asse|.?|eet)?|strasse|st\.?|st|street|strse|strase|strsse)$/g, 'strasse')  // Removed \b, all variants without ß, added 'strsse' for typos
      // Remove remaining special characters and spaces
      .replace(/[-\.\s]/g, '');
  }

  /**
   * ✅ NEW: Clean and normalize street data from Google Sheets
   * - Remove problematic special characters
   * - Extract house number from street if present and houseNumber is empty
   * - Remove all numbers from street field
   * Returns: { street: string, houseNumber: string | null, shouldSkip: boolean }
   */
  private cleanStreetData(street: string | null, houseNumber: string | null): { 
    street: string | null; 
    houseNumber: string | null; 
    shouldSkip: boolean;
  } {
    if (!street || !street.trim()) {
      return { street: null, houseNumber: null, shouldSkip: true };
    }

    let cleanedStreet = street.trim();
    let cleanedHouseNumber = houseNumber?.trim() || null;

    // Remove problematic characters from street name
    cleanedStreet = cleanedStreet.replace(/['`´!"§$%&/()=?\\}\][{#*~^°]/g, '');

    // If house number is empty, check if street contains numbers
    if (!cleanedHouseNumber || cleanedHouseNumber === '') {
      // Look for numbers in the street name
      const numberMatch = cleanedStreet.match(/\d+.*$/);
      
      if (numberMatch) {
        // Extract numbers and everything after as house number
        cleanedHouseNumber = numberMatch[0].trim();
        // Remove the house number part from street
        cleanedStreet = cleanedStreet.substring(0, numberMatch.index).trim();
        
        console.log(`[cleanStreetData] Extracted house number from street: "${street}" → street="${cleanedStreet}", number="${cleanedHouseNumber}"`);
      } else {
        // No house number in street and houseNumber field is empty → Skip this row
        console.warn(`[cleanStreetData] ⚠️ Skipping row: No house number found in "${street}"`);
        return { street: null, houseNumber: null, shouldSkip: true };
      }
    }

    // Remove ALL remaining numbers from street (after extraction or if houseNumber was provided)
    cleanedStreet = cleanedStreet.replace(/\d+/g, '').trim();

    // Final cleanup: remove double spaces
    cleanedStreet = cleanedStreet.replace(/\s+/g, ' ').trim();

    if (!cleanedStreet) {
      return { street: null, houseNumber: null, shouldSkip: true };
    }

    return { 
      street: cleanedStreet, 
      houseNumber: cleanedHouseNumber, 
      shouldSkip: false 
    };
  }

  /**
   * Calculate similarity between two streets using Levenshtein distance
   * Returns similarity percentage (0-100)
   * Added min length check
   */
  private calculateStreetSimilarity(street1: string, street2: string): number {
    const normalized1 = this.normalizeStreet(street1);
    const normalized2 = this.normalizeStreet(street2);

    // Min length check: If both < 3 chars, require exact match
    if (normalized1.length < 3 && normalized2.length < 3) {
      return normalized1 === normalized2 ? 100 : 0;
    }

    const maxLength = Math.max(normalized1.length, normalized2.length);
    if (maxLength === 0) return 100;

    const distance = leven(normalized1, normalized2);
    const similarity = (1 - distance / maxLength) * 100;

    return similarity;
  }

  /**
   * Check if two streets match using fuzzy matching
   * Returns true if similarity >= 90% (for typo tolerance)
   */
  private streetsMatch(street1: string, street2: string): boolean {
    const similarity = this.calculateStreetSimilarity(street1, street2);
    return similarity >= 90;
  }

  private initializeSheets() {
    try {
      const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
      
      // Check if it's a valid JSON (service account key)
      if (!sheetsKey.startsWith('{')) {
        console.warn('GOOGLE_SHEETS_KEY is not a valid JSON service account key. Google Sheets integration disabled.');
        console.warn('To enable Google Sheets, provide a JSON service account key with Sheets API access.');
        this.initialized = false;
        return;
      }

      const credentials = JSON.parse(sheetsKey);
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      this.sheetsClient = google.sheets({ version: 'v4', auth });
      this.initialized = true;
      console.log('Google Sheets integration initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Google Sheets client:', error);
      console.warn('Google Sheets integration disabled. Using in-memory storage fallback.');
      this.initialized = false;
    }
  }

  private isCacheValid(): boolean {
    if (!this.cache.customers || !this.cache.timestamp) return false;
    return Date.now() - this.cache.timestamp < this.CACHE_TTL;
  }

  private async fetchCustomersFromSheet(): Promise<Customer[]> {
    if (!this.initialized) {
      console.log('[CustomerCache] Google Sheets not initialized, returning empty customer list');
      return [];
    }

    if (this.isCacheValid() && this.cache.customers) {
      const cacheAge = Math.round((Date.now() - (this.cache.timestamp || 0)) / 1000);
      console.log(`✅ [CustomerCache] Cache HIT - Using cached customer data (${this.cache.customers.length} customers, age: ${cacheAge}s/${this.CACHE_TTL/1000}s)`);
      return this.cache.customers;
    }

    try {
      console.log('🔄 [CustomerCache] Cache MISS - Fetching customers from Google Sheets API...');
      const startTime = Date.now();
      
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.SHEET_NAME}!A2:D`, // Skip header row, columns: Name, Straße, Hausnummer, Postleitzahl
      });

      const fetchTime = Date.now() - startTime;
      const rows = response.data.values || [];
      console.log(`📊 [CustomerCache] Fetched ${rows.length} rows from Google Sheets in ${fetchTime}ms`);
      
      let skippedRows = 0;
      const customers: Customer[] = [];
      
      for (const row of rows) {
        // Must have a name
        if (!row[0]) {
          skippedRows++;
          continue;
        }

        // Clean and normalize street data
        const cleaned = this.cleanStreetData(row[1] || null, row[2] || null);
        
        if (cleaned.shouldSkip) {
          skippedRows++;
          continue;
        }

        customers.push({
          id: randomUUID(),
          name: row[0] || '',
          street: cleaned.street,
          houseNumber: cleaned.houseNumber,
          postalCode: row[3] || null,
          isExisting: true, // All customers in the sheet are existing
        });
      }

      if (skippedRows > 0) {
        console.warn(`⚠️ [CustomerCache] Skipped ${skippedRows} rows (missing name or invalid street/house number)`);
      }

      console.log(`✅ [CustomerCache] Parsed ${customers.length} valid customers and stored in cache`);

      this.cache.customers = customers;
      this.cache.timestamp = Date.now();

      return customers;
    } catch (error) {
      console.error('❌ [CustomerCache] Failed to fetch customers from Google Sheets:', error);
      return [];
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const customers = await this.fetchCustomersFromSheet();
    return customers.find(c => c.id === id);
  }

  async getCustomerByName(name: string, address?: Partial<Address>): Promise<Customer | undefined> {
    const customers = await this.searchCustomers(name, address);
    return customers[0];
  }

  async getCustomersByAddress(address: Partial<Address>): Promise<Customer[]> {
    const customers = await this.fetchCustomersFromSheet();
    
    let matches = customers;
    
    // Filter by postal code (most important and most unique) - EXACT match
    if (address.postal) {
      const searchPostal = address.postal.toLowerCase().trim();
      matches = matches.filter(customer => 
        customer.postalCode?.toLowerCase().trim() === searchPostal
      );
    }
    
    // Filter by street using fuzzy matching (>=90% similarity)
    // Clean the input street name to remove problematic characters (same as Google Sheets data)
    if (address.street) {
      const searchStreet = address.street.replace(/['`´!"§$%&/()=?\\}\][{#*~^°]/g, '');
      matches = matches.filter(customer => {
        if (!customer.street) return false;
        return this.streetsMatch(searchStreet, customer.street);
      });
    }
    
    // Filter by house number with EXPANSION and DEDUPLICATION
    // Handle multiple house numbers (comma or hyphen separated): "1,2,3" or "1-3"
    if (address.number) {
      const searchNumber = address.number;
      
      // Track customer IDs to avoid duplicates
      const uniqueCustomerIds = new Set<string>();
      const uniqueMatches: Customer[] = [];
      
      for (const customer of matches) {
        if (!customer.houseNumber) continue;
        
        // Check if house numbers match using expansion logic
        if (this.matchesHouseNumber(searchNumber, customer.houseNumber)) {
          // Only add if not already in result set
          if (!uniqueCustomerIds.has(customer.id)) {
            uniqueCustomerIds.add(customer.id);
            uniqueMatches.push(customer);
          }
        }
      }
      
      matches = uniqueMatches;
    }
    
    return matches;
  }

  /**
   * Normalize name for matching by handling German special characters
   * ß → ss, ä → ae, ö → oe, ü → ue
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/\s+/g, ' '); // Normalize multiple spaces
  }

  async searchCustomers(name: string, address?: Partial<Address>): Promise<Customer[]> {
    // If address is provided, FIRST filter customers by address
    let customersToSearch: Customer[];
    
    if (address && (address.postal || address.street || address.number)) {
      // Filter by address FIRST
      customersToSearch = await this.getCustomersByAddress(address);
    } else {
      // No address provided, search all customers
      customersToSearch = await this.fetchCustomersFromSheet();
    }
    
    // Normalize search name for special character matching
    const normalizedSearchName = this.normalizeName(name);
    const searchWords = normalizedSearchName.split(/\s+/).filter(word => word.length >= 2);

    const matches = customersToSearch.filter(customer => {
      // Normalize customer name as well
      const normalizedCustomerName = this.normalizeName(customer.name);
      const customerNameWords = normalizedCustomerName.split(/\s+/);
      
      // Check if any search word matches any customer name word exactly
      // This handles ß↔ss, ä↔ae, ö↔oe, ü↔ue matching
      return searchWords.some(searchWord => 
        customerNameWords.includes(searchWord)
      );
    });
    
    return matches;
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    if (!this.initialized) {
      // If Sheets is not initialized, just return the customer without saving
      const customer: Customer = {
        id: randomUUID(),
        name: insertCustomer.name,
        street: insertCustomer.street || null,
        houseNumber: insertCustomer.houseNumber || null,
        postalCode: insertCustomer.postalCode || null,
        isExisting: insertCustomer.isExisting ?? true,
      };
      return customer;
    }

    try {
      const values = [[
        insertCustomer.name,
        insertCustomer.street || '',
        insertCustomer.houseNumber || '',
        insertCustomer.postalCode || '',
      ]];

      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.SHEET_NAME}!A:D`,
        valueInputOption: 'RAW',
        resource: { values },
      });

      // Invalidate cache
      console.log('🗑️ [CustomerCache] Cache invalidated after new customer creation');
      this.cache.customers = null;
      this.cache.timestamp = null;

      const customer: Customer = {
        id: randomUUID(),
        name: insertCustomer.name,
        street: insertCustomer.street || null,
        houseNumber: insertCustomer.houseNumber || null,
        postalCode: insertCustomer.postalCode || null,
        isExisting: insertCustomer.isExisting ?? true,
      };

      return customer;
    } catch (error) {
      console.error('Failed to create customer in Google Sheets:', error);
      throw new Error('Failed to create customer in Google Sheets');
    }
  }

  async getAllCustomers(): Promise<Customer[]> {
    return this.fetchCustomersFromSheet();
  }
}

export const storage = new GoogleSheetsStorage();
