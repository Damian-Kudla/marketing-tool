import { type User, type InsertUser, type Customer, type InsertCustomer } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getCustomer(id: string): Promise<Customer | undefined>;
  getCustomerByName(name: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  getAllCustomers(): Promise<Customer[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private customers: Map<string, Customer>;

  constructor() {
    this.users = new Map();
    this.customers = new Map();
    
    this.seedCustomers();
  }

  private seedCustomers() {
    const sampleCustomers: InsertCustomer[] = [
      { name: "Max Müller", isExisting: true },
      { name: "Anna Schmidt", isExisting: true },
      { name: "Thomas Weber", isExisting: true },
      { name: "Maria Fischer", isExisting: true },
      { name: "Klaus Meyer", isExisting: true },
    ];

    sampleCustomers.forEach(customer => {
      const id = randomUUID();
      const newCustomer: Customer = { 
        id, 
        name: customer.name, 
        isExisting: customer.isExisting ?? true 
      };
      this.customers.set(id, newCustomer);
    });
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
    return this.customers.get(id);
  }

  async getCustomerByName(name: string): Promise<Customer | undefined> {
    const normalizedName = name.toLowerCase().trim();
    return Array.from(this.customers.values()).find(
      (customer) => customer.name.toLowerCase().trim() === normalizedName,
    );
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const customer: Customer = { 
      id, 
      name: insertCustomer.name, 
      isExisting: insertCustomer.isExisting ?? false 
    };
    this.customers.set(id, customer);
    return customer;
  }

  async getAllCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values());
  }
}

export const storage = new MemStorage();
