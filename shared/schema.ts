import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isExisting: boolean("is_existing").notNull().default(false),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

export const geocodingRequestSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export type GeocodingRequest = z.infer<typeof geocodingRequestSchema>;

export const addressSchema = z.object({
  street: z.string(),
  number: z.string(),
  city: z.string(),
  postal: z.string(),
  country: z.string(),
});

export type Address = z.infer<typeof addressSchema>;

export const ocrRequestSchema = z.object({
  imageData: z.string(),
});

export type OCRRequest = z.infer<typeof ocrRequestSchema>;

export const ocrResponseSchema = z.object({
  extractedText: z.string(),
  names: z.array(z.string()),
});

export type OCRResponse = z.infer<typeof ocrResponseSchema>;
