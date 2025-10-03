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
  street: text("street"),
  houseNumber: text("house_number"),
  postalCode: text("postal_code"),
  isExisting: boolean("is_existing").notNull().default(true),
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
  city: z.string().optional(),
  postal: z.string(),
  country: z.string().optional(),
});

export type Address = z.infer<typeof addressSchema>;

export const ocrRequestSchema = z.object({
  imageData: z.string(),
});

export type OCRRequest = z.infer<typeof ocrRequestSchema>;

export const ocrResponseSchema = z.object({
  residentNames: z.array(z.string()),
  fullVisionResponse: z.any(),
  newProspects: z.array(z.string()),
  existingCustomers: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    street: z.string().nullable().optional(),
    houseNumber: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    isExisting: z.boolean(),
  })),
  allCustomersAtAddress: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    street: z.string().nullable().optional(),
    houseNumber: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    isExisting: z.boolean(),
  })).optional(),
});

export type OCRResponse = z.infer<typeof ocrResponseSchema>;

export const ocrCorrectionRequestSchema = z.object({
  residentNames: z.array(z.string()),
  address: addressSchema.optional(),
});

export type OCRCorrectionRequest = z.infer<typeof ocrCorrectionRequestSchema>;
