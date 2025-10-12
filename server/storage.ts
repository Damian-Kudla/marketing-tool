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
   * Normalize street name by replacing street suffixes at the END with 'strasse' (consistent form for length preservation)
   * - Convert to lowercase
   * - Replace umlauts early
   * - Replace variants ONLY at the end (no \b to allow attached suffixes)
   * - Handle more typos and remove special characters/spaces
   */
  private normalizeStreet(street: string): string {
    return street
      .toLowerCase()
      .trim()
      // Replace umlauts early (ß to ss)
      .replace(/ß/g, 'ss')
      // Replace variants at the END with 'strasse' (no \b, adjusted for ss)
      .replace(/(str(asse|.?|eet)?|strasse|st\.?|st|street|strse|strase|strsse)$/g, 'strasse')  // Removed \b, all variants without ß, added 'strsse' for typos
      // Remove special characters and spaces
      .replace(/[-\.\s]/g, '');
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
      console.log('Google Sheets not initialized, returning empty customer list');
      return [];
    }

    if (this.isCacheValid() && this.cache.customers) {
      console.log(`Using cached customer data (${this.cache.customers.length} customers)`);
      return this.cache.customers;
    }

    try {
      console.log('Fetching customers from Google Sheets...');
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.SHEET_NAME}!A2:D`, // Skip header row, columns: Name, Straße, Hausnummer, Postleitzahl
      });

      const rows = response.data.values || [];
      console.log(`Fetched ${rows.length} rows from Google Sheets`);
      
      const customers: Customer[] = rows
        .filter((row: any[]) => row[0]) // Must have a name
        .map((row: any[]) => ({
          id: randomUUID(),
          name: row[0] || '',
          street: row[1] || null,
          houseNumber: row[2] || null,
          postalCode: row[3] || null,
          isExisting: true, // All customers in the sheet are existing
        }));

      console.log(`Parsed ${customers.length} customers:`, customers.map(c => ({ 
        name: c.name, 
        street: c.street, 
        houseNumber: c.houseNumber, 
        postalCode: c.postalCode 
      })));

      this.cache.customers = customers;
      this.cache.timestamp = Date.now();

      return customers;
    } catch (error) {
      console.error('Failed to fetch customers from Google Sheets:', error);
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
    
    // Filter by street using fuzzy matching (>=95% similarity)
    if (address.street) {
      const searchStreet = address.street;
      matches = matches.filter(customer => {
        if (!customer.street) return false;
        return this.streetsMatch(searchStreet, customer.street);
      });
    }
    
    // Filter by house number (flexible matching - prefix match, improved)
    if (address.number) {
      const normalizeNumber = (num: string) => num.toLowerCase().trim().replace(/[.-]/g, '');  // Remove dots/hyphens for tolerance
      const searchNumber = normalizeNumber(address.number);
      matches = matches.filter(customer => {
        if (!customer.houseNumber) return false;
        const customerNumber = normalizeNumber(customer.houseNumber);
        // Stricter: Exact match or customer starts with search (avoids search longer than customer)
        return customerNumber === searchNumber || customerNumber.startsWith(searchNumber);
      });
    }
    
    return matches;
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
    
    // Now search names ONLY within the address-filtered customers
    const normalizedSearchName = name.toLowerCase().trim();
    const searchWords = normalizedSearchName.split(/\s+/).filter(word => word.length >= 2);

    const matches = customersToSearch.filter(customer => {
      const customerNameWords = customer.name.toLowerCase().trim().split(/\s+/);
      
      // Neu: Exakter Match - prüfe, ob searchWord exakt in customerNameWords vorkommt
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
