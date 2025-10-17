import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import vision from "@google-cloud/vision";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import { 
  geocodingRequestSchema, 
  addressSchema, 
  ocrCorrectionRequestSchema,
  logCategoryChangeRequestSchema,
  createAppointmentRequestSchema,
  type Address,
  type Customer,
  type OCRResponse
} from "@shared/schema";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { logUserActivityWithRetry, logAuthAttemptWithRetry } from "./services/enhancedLogging";
import { authRouter } from "./routes/auth";
import addressDatasetsRouter from "./routes/addressDatasets";
import trackingRouter from "./routes/tracking";
import adminRouter from "./routes/admin";
import { addressDatasetService, normalizeAddress, categoryChangeLoggingService, appointmentService } from "./services/googleSheets";
import { 
  performOrientationCorrection, 
  checkImageAspectRatio,
  type OrientationAnalysisResult 
} from "./services/imageOrientation";

const upload = multer({ storage: multer.memoryStorage() });

// Initialize Vision client once at startup
let visionClient: any = null;
let visionEnabled = false;

try {
  const visionKey = process.env.GOOGLE_CLOUD_VISION_KEY || '{}';
  
  // Check if it's a valid JSON (service account key)
  if (visionKey.startsWith('{')) {
    const credentials = JSON.parse(visionKey);
    
    // Validate that it's a proper service account key with required fields
    if (!credentials.client_email || !credentials.private_key) {
      console.warn('GOOGLE_CLOUD_VISION_KEY does not contain valid service account credentials (missing client_email or private_key). OCR disabled.');
      console.warn('To enable OCR, provide a complete JSON service account key with Vision API access.');
    } else {
      // Create a JWT auth client to avoid deprecation warnings
      const jwtAuth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      
      // Create a GoogleAuth instance with the JWT client
      const auth = new google.auth.GoogleAuth({
        authClient: jwtAuth,
        projectId: credentials.project_id,
      });
      
      visionClient = new vision.ImageAnnotatorClient({ auth });
      visionEnabled = true;
      console.log('Google Cloud Vision API initialized successfully');
    }
  } else {
    console.warn('GOOGLE_CLOUD_VISION_KEY is not a valid JSON service account key. OCR disabled.');
    console.warn('To enable OCR, provide a JSON service account key with Vision API access.');
  }
} catch (error) {
  console.error('Failed to initialize Google Cloud Vision client:', error);
  console.warn('OCR functionality disabled.');
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Add cookie parser middleware
  app.use(cookieParser());
  
  // Add auth routes (no authentication required for these)
  app.use("/api/auth", authRouter);
  
  // Add address datasets routes (authentication required)
  app.use("/api/address-datasets", requireAuth, addressDatasetsRouter);
  
  // Add tracking routes (authentication required)
  app.use("/api/tracking", requireAuth, trackingRouter);
  
  // Add admin routes (authentication + admin privileges required)
  app.use("/api/admin", adminRouter);
  
  // Category change logging route
    app.post("/api/log-category-change", async (req, res) => {
    try {
      const validatedData = logCategoryChangeRequestSchema.parse(req.body);
      const username = req.cookies.auth_token || "unknown";

      await categoryChangeLoggingService.logCategoryChange(
        validatedData.datasetId,
        validatedData.residentOriginalName,
        validatedData.residentCurrentName,
        validatedData.oldCategory,
        validatedData.newCategory,
        username,
        validatedData.addressDatasetSnapshot
      );

      res.json({ success: true });
    } catch (error) {
      console.error("Error logging category change:", error);
      res.status(500).json({ error: "Failed to log category change" });
    }
  });

  // Call Back endpoints
  app.get("/api/callbacks/today", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const today = new Date();
      const callBacks = await addressDatasetService.getCallBackAddresses(username, today);
      res.json(callBacks);
    } catch (error) {
      console.error("Error getting today's call backs:", error);
      res.status(500).json({ error: "Failed to get call backs" });
    }
  });

  app.get("/api/callbacks/yesterday", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const callBacks = await addressDatasetService.getCallBackAddresses(username, yesterday);
      res.json(callBacks);
    } catch (error) {
      console.error("Error getting yesterday's call backs:", error);
      res.status(500).json({ error: "Failed to get call backs" });
    }
  });

  app.get("/api/callbacks/custom/:date", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      // Parse date from URL parameter (format: YYYY-MM-DD)
      const dateStr = req.params.date;
      const customDate = new Date(dateStr);
      
      // Validate date
      if (isNaN(customDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      const callBacks = await addressDatasetService.getCallBackAddresses(username, customDate);
      res.json(callBacks);
    } catch (error) {
      console.error("Error getting custom date call backs:", error);
      res.status(500).json({ error: "Failed to get call backs" });
    }
  });

  // Appointment endpoints
  app.post("/api/appointments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const validatedData = createAppointmentRequestSchema.parse(req.body);
      const appointment = await appointmentService.createAppointment(
        validatedData.datasetId,
        validatedData.residentName,
        validatedData.address,
        validatedData.appointmentDate,
        validatedData.appointmentTime,
        validatedData.notes || "",
        username
      );

      res.json(appointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      res.status(500).json({ error: "Failed to create appointment" });
    }
  });

  app.get("/api/appointments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const appointments = await appointmentService.getUserAppointments(username);
      res.json(appointments);
    } catch (error) {
      console.error("Error getting appointments:", error);
      res.status(500).json({ error: "Failed to get appointments" });
    }
  });

  app.get("/api/appointments/upcoming", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const appointments = await appointmentService.getUpcomingAppointments(username);
      res.json(appointments);
    } catch (error) {
      console.error("Error getting upcoming appointments:", error);
      res.status(500).json({ error: "Failed to get upcoming appointments" });
    }
  });

  app.delete("/api/appointments/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const username = req.username;
      if (!username) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { id } = req.params;
      await appointmentService.deleteAppointment(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res.status(500).json({ error: "Failed to delete appointment" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  app.post("/api/geocode", requireAuth, rateLimitMiddleware('geocoding'), async (req: AuthenticatedRequest, res) => {
    try {
      const body = geocodingRequestSchema.parse(req.body);
      const { latitude, longitude } = body;

      const geocodingKey = process.env.GOOGLE_GEOCODING_API_KEY;
      if (!geocodingKey) {
        return res.status(503).json({ error: "Geocoding API key not configured" });
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${geocodingKey}&language=de`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK") {
        return res.status(400).json({ error: "Geocoding failed" });
      }

      const result = data.results[0];
      const addressComponents = result.address_components;

      const address: Partial<Address> = {
        street: '',
        number: '',
        postal: '',
        city: ''
      };

      for (const component of addressComponents) {
        if (component.types.includes('route')) {
          address.street = component.long_name;
        } else if (component.types.includes('street_number')) {
          address.number = component.long_name;
        } else if (component.types.includes('postal_code')) {
          address.postal = component.long_name;
        } else if (component.types.includes('locality')) {
          address.city = component.long_name;
        }
      }

      // Log geocoding activity
      const addressString = `${address.street} ${address.number}, ${address.postal} ${address.city}`.trim();
      try {
        await logUserActivityWithRetry(
          req,
          addressString,
          undefined,
          undefined,
          { // Data field
            action: 'geocode',
            latitude,
            longitude,
            street: address.street,
            number: address.number,
            postal: address.postal,
            city: address.city
          }
        );
      } catch (logError) {
        console.error('[POST /api/geocode] Failed to log activity:', logError);
      }

      res.json(address);
    } catch (error) {
      console.error("Geocoding error:", error);
      res.status(400).json({ error: "Invalid request" });
    }
  });  app.post("/api/ocr", requireAuth, rateLimitMiddleware('vision'), upload.single("image"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      // Check if Vision API is enabled
      if (!visionEnabled || !visionClient) {
        return res.status(503).json({ 
          error: "OCR service not available. Google Cloud Vision API requires a valid JSON service account key." 
        });
      }

      // Parse address from request body - REQUIRED
      let address: Address | undefined;
      if (req.body.address) {
        try {
          address = JSON.parse(req.body.address);
        } catch (e) {
          console.error("Failed to parse address:", e);
          return res.status(400).json({ error: "Invalid address format" });
        }
      }
      
      // Address is required for photo upload
      if (!address || (!address.postal && !address.street && !address.number)) {
        return res.status(400).json({ 
          error: "Address is required for photo upload. Please enter at least postal code, street, or house number." 
        });
      }

      // Parse orientation info if provided from frontend
      let frontendOrientationInfo = null;
      if (req.body.orientationInfo) {
        try {
          frontendOrientationInfo = JSON.parse(req.body.orientationInfo);
        } catch (e) {
          console.warn("Failed to parse orientation info:", e);
        }
      }

      let imageBuffer = req.file.buffer;
      let orientationCorrectionApplied = false;
      let backendOrientationInfo: OrientationAnalysisResult | null = null;

      // BACKEND ROTATION DISABLED: Rotating the image without transforming bounding boxes
      // causes misalignment between text overlays and image. Frontend handles rotation.
      // Keeping orientation analysis for logging but not applying corrections.

      // Perform text detection on the original image (no backend rotation)
      const [result] = await visionClient.textDetection({
        image: { content: imageBuffer },
      });

      const detections = result.textAnnotations;
      const fullVisionResponse = result;

      // Even if no text detected, we still want to show customers at the address
      if (!detections || detections.length === 0) {
        const allCustomersAtAddress = await storage.getCustomersByAddress(address);
        return res.json({
          residentNames: [],
          fullVisionResponse,
          newProspects: [],
          existingCustomers: [],
          allCustomersAtAddress,
        } as OCRResponse);
      }

      // Extract full text
      const fullText = detections[0]?.description || '';

      // Split by line breaks and filter for names
      const lines = fullText.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);

      const residentNames: string[] = [];

      // Common words to exclude (not names)
      const excludeWords = ['apt', 'apartment', 'wohnung', 'haus', 'straße', 'strasse', 'str'];

      for (const line of lines) {
        // Replace hyphens, periods, slashes, backslashes, pipes with spaces, then normalize whitespace
        let cleanedLine = line.toLowerCase()
        .replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕ×ØÙÚÛÝÞàáâãåæçèéêëìíîïðñòóôõ÷øùúûýþÿ€‰′″‵‹›⁄⁰¹²³⁴⁵⁶⁷⁸⁹⅓⅔←↑→↓↔∅∞∩∪√≈≠≡≤≥⊂⊃⋂⋃∂∇∏∑−×÷∫∬∮πστφχψωΓΔΘΛΞΠΣΥΦΨΩαβγδεζηθικλμνξοπρςστυφχψω]/g, ' ')
        .replace(/\s+/g, ' ')  // Normalisiert mehrere Leerzeichen
        .trim();  // Entfernt führende/nachfolgende Leerzeichen

        // Skip empty lines or very short lines
        if (cleanedLine.length === 0) continue;

        // More flexible matching - accept various name formats...
        // Check if line contains at least one letter or digit
        if (!/[a-zA-ZäöüÄÖÜß0-9]/.test(cleanedLine)) continue;

        // Check if it's an excluded word
        if (excludeWords.some(word => cleanedLine === word)) continue;

        // Length checks
        if (cleanedLine.length <= 30) {

          // NEW: After standardization, split into words and filter for words with at least 3 letters
          const words = cleanedLine.split(/\s+/);
          const filteredWords = words.filter((word: string) => word.length >= 3);

          // If no words left after filtering, skip this name
          if (filteredWords.length === 0) continue;

          // Join filtered words back to name
          cleanedLine = filteredWords.join(' ');

          // Allow duplicate names (for duplicate detection)
          if (cleanedLine.length >= 1) {
            residentNames.push(cleanedLine);
          }
        }
      }

      // Get all customers at this address first
      const allCustomersAtAddress = await storage.getCustomersByAddress(address);
      
      // Search for matching customers (name matching within address-filtered customers)
      const existingCustomers: Customer[] = [];
      const newProspects: string[] = [];

      for (const residentName of residentNames) {
        const matches = await storage.searchCustomers(residentName, address);
        
        if (matches.length > 0) {
          // Keep the original name from OCR, but use customer data from database
          // This ensures the name on the image matches the displayed name
          for (const match of matches) {
            existingCustomers.push({
              ...match,
              name: residentName, // Use original OCR name, not database name
            });
          }
        } else {
          // No match found - this is a prospect
          newProspects.push(residentName);
        }
      } 

      const response: OCRResponse = {
        residentNames,
        fullVisionResponse,
        newProspects,
        existingCustomers,
        allCustomersAtAddress,
        // Backend orientation correction disabled - always false
        orientationCorrectionApplied: false,
        backendOrientationInfo: null,
      };

      // Log the OCR request with results
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;
      await logUserActivityWithRetry(req, addressString, newProspects, existingCustomers);

      res.json(response);
    } catch (error) {
      console.error("OCR error:", error);
      res.status(500).json({ error: "OCR processing failed" });
    }
  });

  app.post("/api/ocr-correct", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { residentNames, address } = ocrCorrectionRequestSchema.parse(req.body);

      // Address is required
      if (!address || (!address.postal && !address.street && !address.number)) {
        return res.status(400).json({ 
          error: "Address is required. Please enter at least postal code, street, or house number." 
        });
      }

      // Get all customers at this address first
      const allCustomersAtAddress = await storage.getCustomersByAddress(address);

      const existingCustomers: Customer[] = [];
      const newProspects: string[] = [];

      for (const residentName of residentNames) {
        const matches = await storage.searchCustomers(residentName, address);
        
        if (matches.length > 0) {
          // Keep the original name from OCR, but use customer data from database
          for (const match of matches) {
            existingCustomers.push({
              ...match,
              name: residentName, // Use original OCR name, not database name
            });
          }
        } else {
          newProspects.push(residentName);
        }
      }

      const response: OCRResponse = {
        residentNames,
        fullVisionResponse: null,
        newProspects,
        existingCustomers,
        allCustomersAtAddress,
      };

      // Log the OCR correction request with results
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;
      await logUserActivityWithRetry(req, addressString, newProspects, existingCustomers);

      res.json(response);
    } catch (error) {
      console.error("OCR correction error:", error);
      res.status(400).json({ error: "Invalid request" });
    }
  });

  app.post("/api/search-address", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const address = addressSchema.partial().parse(req.body);
      
      // Use the storage method with fuzzy matching
      const matches = await storage.getCustomersByAddress(address);
      
      // Log the address search
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;
      await logUserActivityWithRetry(req, addressString);
      
      res.json(matches);
    } catch (error) {
      console.error("Address search error:", error);
      res.status(400).json({ error: "Invalid request" });
    }
  });

  app.get("/api/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const customers = await storage.getAllCustomers();
      
      // Log the customer list request
      await logUserActivityWithRetry(req);
      
      res.json(customers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
