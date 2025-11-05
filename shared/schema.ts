import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  followMeeDeviceId: text("followmee_device_id"), // FollowMee device ID for GPS tracking
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
  contractType: text("contract_type"), // "Strom", "Gas", or null (backwards compatible)
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
  street: z.string().min(1, 'Straße ist erforderlich').trim(),
  number: z.string().min(1, 'Hausnummer ist erforderlich').trim(),
  city: z.string().optional(),
  postal: z.string().min(1, 'Postleitzahl ist erforderlich').trim(),
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
  // Related house numbers hint
  relatedHouseNumbers: z.array(z.string()).optional(),
  // Orientation correction fields
  orientationCorrectionApplied: z.boolean().optional(),
  backendOrientationInfo: z.object({
    rotation: z.number(),
    confidence: z.number(),
    method: z.enum(['bounding_box_analysis', 'aspect_ratio', 'none']),
    originalDimensions: z.object({
      width: z.number(),
      height: z.number(),
    }),
    suggestedDimensions: z.object({
      width: z.number(),
      height: z.number(),
    }),
  }).nullable().optional(),
});

export type OCRResponse = z.infer<typeof ocrResponseSchema>;

export const ocrCorrectionRequestSchema = z.object({
  residentNames: z.array(z.string()),
  address: addressSchema.optional(),
});

export type OCRCorrectionRequest = z.infer<typeof ocrCorrectionRequestSchema>;

// Resident status enum for new features
export const residentStatusSchema = z.enum(['no_interest', 'not_reached', 'interest_later', 'appointment', 'written']);
export type ResidentStatus = z.infer<typeof residentStatusSchema>;

// Resident category enum
export const residentCategorySchema = z.enum(['existing_customer', 'potential_new_customer', 'duplicate', 'all_existing_customers']);
export type ResidentCategory = z.infer<typeof residentCategorySchema>;

// Extended resident data with editing capabilities
export const editableResidentSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  category: residentCategorySchema,
  status: residentStatusSchema.optional(),
  floor: z.number().min(0).max(100).optional(),
  door: z.string().max(30).optional(),
  notes: z.string().optional(), // General notes for all status types
  isFixed: z.boolean().default(false), // For "All Existing Customers at this Address" entries
  originalName: z.string().optional(), // Original name from OCR for tracking category changes
  originalCategory: residentCategorySchema.optional(), // Original category for tracking changes
});

export type EditableResident = z.infer<typeof editableResidentSchema>;

// Address dataset schema for Google Sheets management
export const addressDatasetSchema = z.object({
  id: z.string(),
  normalizedAddress: z.string(),
  street: z.string(),
  houseNumber: z.string(),
  city: z.string().optional(),
  postalCode: z.string(),
  createdBy: z.string(), // Username
  createdAt: z.date(),
  rawResidentData: z.array(z.string()), // Raw OCR results stored for safety
  editableResidents: z.array(editableResidentSchema),
  fixedCustomers: z.array(editableResidentSchema), // Non-editable customers from database
});

export type AddressDataset = z.infer<typeof addressDatasetSchema>;

// Request to create/update address dataset
export const addressDatasetRequestSchema = z.object({
  address: addressSchema,
  rawResidentData: z.array(z.string()),
  editableResidents: z.array(editableResidentSchema),
});

export type AddressDatasetRequest = z.infer<typeof addressDatasetRequestSchema>;

// Response with existing datasets
export const addressDatasetResponseSchema = z.object({
  datasets: z.array(addressDatasetSchema),
  canCreateNew: z.boolean(),
  existingTodayBy: z.string().optional(), // Username if someone already created today
});

export type AddressDatasetResponse = z.infer<typeof addressDatasetResponseSchema>;

// Request to update a resident in a dataset
export const updateResidentRequestSchema = z.object({
  datasetId: z.string(),
  residentIndex: z.number(),
  residentData: editableResidentSchema.nullable(), // Allow null for deletions
});

export type UpdateResidentRequest = z.infer<typeof updateResidentRequestSchema>;

// Schema for bulk updating all residents in a dataset
export const bulkUpdateResidentsRequestSchema = z.object({
  datasetId: z.string(),
  editableResidents: z.array(editableResidentSchema),
});

export type BulkUpdateResidentsRequest = z.infer<typeof bulkUpdateResidentsRequestSchema>;

// Schema for logging category changes
export const categoryChangeLogSchema = z.object({
  datasetId: z.string(),
  residentOriginalName: z.string(),
  residentCurrentName: z.string(),
  oldCategory: residentCategorySchema,
  newCategory: residentCategorySchema,
  changedBy: z.string(), // Username
  changedAt: z.date(),
  addressDatasetSnapshot: z.string(), // JSON snapshot of the dataset
});

export type CategoryChangeLog = z.infer<typeof categoryChangeLogSchema>;

// Request schema for logging category change
export const logCategoryChangeRequestSchema = z.object({
  datasetId: z.string(),
  residentOriginalName: z.string(),
  residentCurrentName: z.string(),
  oldCategory: residentCategorySchema,
  newCategory: residentCategorySchema,
  addressDatasetSnapshot: z.string(), // JSON string of dataset
});

export type LogCategoryChangeRequest = z.infer<typeof logCategoryChangeRequestSchema>;

// Appointment schemas
export const appointmentSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  residentName: z.string(),
  address: z.string(), // Full address string
  appointmentDate: z.string(), // ISO date string
  appointmentTime: z.string(), // Time in HH:mm format
  notes: z.string().optional(),
  createdBy: z.string(), // Username
  createdAt: z.date(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

// Request schema for creating appointments
export const createAppointmentRequestSchema = z.object({
  datasetId: z.string(),
  residentName: z.string(),
  address: z.string(),
  appointmentDate: z.string(),
  appointmentTime: z.string(),
  notes: z.string().optional(),
});

export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

