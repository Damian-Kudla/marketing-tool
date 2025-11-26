import { type User, type InsertUser, type Customer, type InsertCustomer, type Address } from "@shared/schema";
import { randomUUID } from "crypto";
import { google } from "./services/googleApiWrapper";
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
   * Public method to validate house number format
   * Throws error if house number is invalid
   */
  public validateHouseNumber(houseNumber: string): void {
    this.expandHouseNumberRange(houseNumber);
  }

    /**
   * Normalize house number for consistent matching:
   * - Lowercase
   * - Remove spaces
   * - Preserve separators: comma, slash, hyphen
   */
  private normalizeHouseNumber(houseNumber: string): string {
    return houseNumber
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ''); // Remove all spaces: "20 A" → "20a"
  }

  /**
   * Expand house number range to individual numbers
   * Examples:
   * - "1-3" → ["1", "2", "3"]
   * - "1,2,3" → ["1", "2", "3"]
   * - "20a-c" → ["20a", "20b", "20c"]
   * - "20/21" → ["20", "21"]
   * - "20 A" → ["20a"] (normalized)
   * 
   * Throws error for invalid formats:
   * - "20-22a" (ambiguous)
   * - "20ä-ö" (non-latin letters)
   */
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
          throw new Error(`Ungültige Hausnummer: "${houseNumber}" - Der Buchstaben-Bereich ist umgekehrt (${startLetter} > ${endLetter})`);
        }
        
        // Validate: max 30 letters
        const rangeSize = endCode - startCode + 1;
        if (rangeSize > 30) {
          throw new Error(`Ungültige Hausnummer: "${houseNumber}" - Der Buchstaben-Bereich ist zu groß (${rangeSize} Buchstaben, max. 30 erlaubt)`);
        }
        
        // Generate letter range
        for (let code = startCode; code <= endCode; code++) {
          const letter = String.fromCharCode(code);
          expanded.push(number + letter);
        }
        continue;
      }
      
      // Check for number range (e.g., "20-30")
      if (part.includes('-')) {
        const rangeParts = part.split('-');
        
        if (rangeParts.length === 2) {
          const start = parseInt(rangeParts[0].trim());
          const end = parseInt(rangeParts[1].trim());
          
          // Check for ambiguous format like "20-22a"
          if (rangeParts[1].match(/[a-z]/)) {
            throw new Error(`Ungültige Hausnummer: "${houseNumber}" - Mehrdeutige Schreibweise (z.B. "20-22a"). Bitte entweder Zahlen-Bereich "20-22" oder Buchstaben-Bereich "20a-c" verwenden.`);
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
        throw new Error(`Ungültige Hausnummer: "${houseNumber}" - Umlaute (ä, ö, ü) sind nicht erlaubt. Bitte nur lateinische Buchstaben (a-z) verwenden.`);
      }
      
      // Single number or letter suffix (e.g., "10a", "20")
      expanded.push(part);
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
    try {
      const searchExpanded = this.expandHouseNumberRange(searchNumber);
      const customerExpanded = this.expandHouseNumberRange(customerNumber);

      // Check if ANY number overlaps
      return searchExpanded.some(s => customerExpanded.includes(s));
    } catch (error) {
      // If customer's house number is invalid (e.g., "26- 26A"), log warning and skip
      console.warn(`[Storage] Invalid house number in database: "${customerNumber}" - skipping. Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
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
        // console.warn(`[cleanStreetData] ⚠️ Skipping row: No house number found in "${street}"`);
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
        range: `${this.SHEET_NAME}!A2:E`, // Skip header row, columns: Name, Straße, Hausnummer, Postleitzahl, Vertragsart
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

        // Parse contract type from column E (Strom/Gas)
        const contractType = row[4] ? row[4].trim() : null;
        // Validate: only allow "Strom" or "Gas", otherwise null
        const validContractType = contractType === 'Strom' || contractType === 'Gas' ? contractType : null;

        customers.push({
          id: randomUUID(),
          name: row[0] || '',
          street: cleaned.street,
          houseNumber: cleaned.houseNumber,
          postalCode: row[3] || null,
          isExisting: true, // All customers in the sheet are existing
          contractType: validContractType as string | null, // "Strom", "Gas", or null (backwards compatible)
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
    const user: User = { ...insertUser, id, followMeeDeviceId: null };
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
   * Find related house numbers with existing customer data
   * Returns house numbers that share the base number but have different suffixes
   * Example: Searching "1" finds "1a", "1b"; Searching "1a" finds "1", "1b"
   */
  async findRelatedHouseNumbers(address: Partial<Address>): Promise<string[]> {
    if (!address.number) return [];

    const customers = await this.fetchCustomersFromSheet();
    let potentialMatches = customers;
    
    // Filter by postal code and street first (same as main search)
    if (address.postal) {
      const searchPostal = address.postal.toLowerCase().trim();
      potentialMatches = potentialMatches.filter(customer => 
        customer.postalCode?.toLowerCase().trim() === searchPostal
      );
    }
    
    if (address.street) {
      const searchStreet = address.street.replace(/['`´!"§$%&/()=?\\}\][{#*~^°]/g, '');
      potentialMatches = potentialMatches.filter(customer => {
        if (!customer.street) return false;
        return this.streetsMatch(searchStreet, customer.street);
      });
    }

    // Extract base number from search (e.g., "1a" → "1", "23b" → "23")
    const searchNumber = address.number.toLowerCase().trim();
    const baseNumberMatch = searchNumber.match(/^(\d+)/);
    if (!baseNumberMatch) return [];
    
    const baseNumber = baseNumberMatch[1];
    const searchSuffix = searchNumber.substring(baseNumber.length).trim();

    // Find all house numbers with same base but different suffix
    const relatedNumbers = new Set<string>();
    
    for (const customer of potentialMatches) {
      if (!customer.houseNumber) continue;
      
      const customerNumber = customer.houseNumber.toLowerCase().trim();
      const customerBaseMatch = customerNumber.match(/^(\d+)/);
      
      if (customerBaseMatch && customerBaseMatch[1] === baseNumber) {
        const customerSuffix = customerNumber.substring(baseNumber.length).trim();
        
        // Only add if suffix is different (or one has suffix, other doesn't)
        if (customerSuffix !== searchSuffix) {
          relatedNumbers.add(customer.houseNumber);
        }
      }
    }

    return Array.from(relatedNumbers).sort();
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
        contractType: null, // New customers don't have a contract type yet
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
        contractType: null, // New customers don't have a contract type yet
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
