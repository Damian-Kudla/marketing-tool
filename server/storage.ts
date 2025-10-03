import { type User, type InsertUser, type Customer, type InsertCustomer, type Address } from "@shared/schema";
import { randomUUID } from "crypto";
import { google } from "googleapis";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getCustomer(id: string): Promise<Customer | undefined>;
  getCustomerByName(name: string, address?: Partial<Address>): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  getAllCustomers(): Promise<Customer[]>;
  searchCustomers(name: string, address?: Partial<Address>): Promise<Customer[]>;
}

export class GoogleSheetsStorage implements IStorage {
  private users: Map<string, User>;
  private sheetsClient: any;
  private cache: { customers: Customer[] | null; timestamp: number | null };
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly SPREADSHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
  private readonly SHEET_NAME = 'Customers';

  constructor() {
    this.users = new Map();
    this.cache = { customers: null, timestamp: null };
    this.initializeSheets();
  }

  private async initializeSheets() {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SHEETS_KEY || '{}');
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      this.sheetsClient = google.sheets({ version: 'v4', auth });
    } catch (error) {
      console.error('Failed to initialize Google Sheets client:', error);
      throw new Error('Google Sheets initialization failed');
    }
  }

  private isCacheValid(): boolean {
    if (!this.cache.customers || !this.cache.timestamp) return false;
    return Date.now() - this.cache.timestamp < this.CACHE_TTL;
  }

  private async fetchCustomersFromSheet(): Promise<Customer[]> {
    if (this.isCacheValid() && this.cache.customers) {
      return this.cache.customers;
    }

    try {
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.SHEET_NAME}!A2:D`, // Skip header row, columns: Name, Straße, Hausnummer, Postleitzahl
      });

      const rows = response.data.values || [];
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

      this.cache.customers = customers;
      this.cache.timestamp = Date.now();

      return customers;
    } catch (error) {
      console.error('Failed to fetch customers from Google Sheets:', error);
      throw new Error('Failed to fetch customers from Google Sheets');
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

  async searchCustomers(name: string, address?: Partial<Address>): Promise<Customer[]> {
    const customers = await this.fetchCustomersFromSheet();
    const normalizedSearchName = name.toLowerCase().trim();
    const searchWords = normalizedSearchName.split(/\s+/);

    let matches = customers.filter(customer => {
      const customerNameWords = customer.name.toLowerCase().trim().split(/\s+/);
      
      // Check if any word in the search name matches any word in the customer name
      return searchWords.some(searchWord => 
        customerNameWords.some(customerWord => 
          customerWord.includes(searchWord) || searchWord.includes(customerWord)
        )
      );
    });

    // If address is provided, filter by address fields
    if (address) {
      matches = matches.filter(customer => {
        let addressMatch = true;

        if (address.street && customer.street) {
          const normalizedStreet = address.street.toLowerCase().trim();
          const customerStreet = customer.street.toLowerCase().trim();
          addressMatch = addressMatch && customerStreet.includes(normalizedStreet);
        }

        if (address.number && customer.houseNumber) {
          const normalizedNumber = address.number.toLowerCase().trim();
          const customerNumber = customer.houseNumber.toLowerCase().trim();
          addressMatch = addressMatch && customerNumber === normalizedNumber;
        }

        if (address.postal && customer.postalCode) {
          const normalizedPostal = address.postal.toLowerCase().trim();
          const customerPostal = customer.postalCode.toLowerCase().trim();
          addressMatch = addressMatch && customerPostal === normalizedPostal;
        }

        return addressMatch;
      });
    }

    return matches;
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
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
