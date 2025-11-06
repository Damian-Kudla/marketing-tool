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
import { logUserActivityWithRetry, logAuthAttemptWithRetry, logCategoryChangeWithRetry } from "./services/enhancedLogging";
import { dailyDataStore } from "./services/dailyDataStore";
import { authRouter } from "./routes/auth";
import addressDatasetsRouter from "./routes/addressDatasets";
import trackingRouter from "./routes/tracking";
import adminRouter from "./routes/admin";
import externalTrackingRouter from "./routes/externalTracking";
import { addressDatasetService, normalizeAddress, appointmentService } from "./services/googleSheets";
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

  // Health check endpoint (no auth required, fast response)
  app.head('/api/health', (req, res) => {
    res.status(200).end();
  });

  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

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

  // Add external tracking routes (NO authentication required - external app)
  app.use("/api/external-tracking", externalTrackingRouter);

  // Category change logging route
    app.post("/api/log-category-change", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      console.log('[API] /api/log-category-change called by user:', req.username);
      
      const validatedData = logCategoryChangeRequestSchema.parse(req.body);
      const username = req.username || "unknown";

      console.log('[API] Logging category change:', {
        datasetId: validatedData.datasetId,
        resident: validatedData.residentCurrentName,
        oldCategory: validatedData.oldCategory,
        newCategory: validatedData.newCategory,
        changedBy: username
      });

      // Use batch logger instead of immediate write
      await logCategoryChangeWithRetry(
        validatedData.datasetId,
        validatedData.residentOriginalName,
        validatedData.residentCurrentName,
        validatedData.oldCategory,
        validatedData.newCategory,
        username,
        validatedData.addressDatasetSnapshot
      );

      console.log('[API] Category change added to batch queue');
      res.json({ success: true });
    } catch (error) {
      console.error("[API] Error logging category change:", error);
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

      // Check if we should include past appointments
      const includePast = req.query.includePast === 'true';
      
      const appointments = includePast 
        ? await appointmentService.getUserAppointments(username)
        : await appointmentService.getUpcomingAppointments(username);
        
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

    // Verwende die Standard-URL ohne zusätzliche Filter, um nur einen Request zu machen und Kosten zu minimieren.
    // Stattdessen wähle das beste Ergebnis aus den zurückgegebenen Results basierend auf einer Heuristik.
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${geocodingKey}&language=de`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({ error: "Geocoding failed" });
    }

    if (!data.results || data.results.length === 0) {
      return res.status(400).json({ error: "No geocoding results found" });
    }

    // Hilfsfunktion zur Bewertung eines Results: Priorisiere Results mit street_number, street_address/premise-Typen und hoher Genauigkeit (ROOFTOP > RANGE_INTERPOLATED > andere).
    const scoreResult = (result: any): number => {
      let score = 0;

      // Hohe Priorität für Presence von street_number in address_components
      if (result.address_components.some((comp: any) => comp.types.includes('street_number'))) {
        score += 50;
      }

      // Priorität für route (Straße)
      if (result.address_components.some((comp: any) => comp.types.includes('route'))) {
        score += 30;
      }

      // Priorität für postal_code und locality
      if (result.address_components.some((comp: any) => comp.types.includes('postal_code'))) {
        score += 10;
      }
      if (result.address_components.some((comp: any) => comp.types.includes('locality'))) {
        score += 10;
      }

      // Priorität für types: street_address oder premise (genaue Adresse)
      if (result.types.includes('street_address') || result.types.includes('premise') || result.types.includes('subpremise')) {
        score += 40;
      } else if (result.types.includes('route')) {
        score += 20;
      }

      // Priorität für geometry.location_type: ROOFTOP ist am besten, dann RANGE_INTERPOLATED, dann andere
      switch (result.geometry.location_type) {
        case 'ROOFTOP':
          score += 30;
          break;
        case 'RANGE_INTERPOLATED':
          score += 20;
          break;
        case 'GEOMETRIC_CENTER':
          score += 10;
          break;
        case 'APPROXIMATE':
          score += 5;
          break;
      }

      return score;
    };

    // Finde das Result mit dem höchsten Score
    const bestResult = data.results.reduce((best: any, current: any) => {
      return scoreResult(current) > scoreResult(best) ? current : best;
    }, data.results[0]);

    // Extrahiere Adresskomponenten aus dem besten Result
    const addressComponents = bestResult.address_components;
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

    // Überprüfung auf Land (Deutschland): Bei Nicht-DE Error zurückgeben (kein country im Response)
    const countryComponent = addressComponents.find((comp: any) => comp.types.includes('country'));
    if (countryComponent && countryComponent.long_name !== 'Deutschland' && countryComponent.long_name !== 'Germany') {
      return res.status(400).json({ error: "Location not in Germany" });
    }

    // Log geocoding activity with GPS coordinates in data field
    const addressString = `${address.street} ${address.number}, ${address.postal} ${address.city}`.trim();
    try {
      await logUserActivityWithRetry(
        req,
        addressString,
        undefined,
        undefined,
        { 
          action: 'geocode',
          gps: {
            latitude,
            longitude
          },
          address: {
            street: address.street,
            number: address.number,
            postal: address.postal,
            city: address.city
          }
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

      // Validate house number format if provided
      if (address.number) {
        try {
          // Try to expand house number - this will throw if invalid format
          storage.validateHouseNumber(address.number);
        } catch (error: any) {
          console.error('[OCR] Invalid house number format:', address.number, error.message);
          return res.status(400).json({ 
            error: error.message || "Ungültige Hausnummer" 
          });
        }
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
        
        // Find related house numbers even when no text detected
        let relatedHouseNumbers: string[] = [];
        if (address.number) {
          relatedHouseNumbers = await storage.findRelatedHouseNumbers(address);
        }
        
        return res.json({
          residentNames: [],
          fullVisionResponse,
          newProspects: [],
          existingCustomers: [],
          allCustomersAtAddress,
          relatedHouseNumbers: relatedHouseNumbers.length > 0 ? relatedHouseNumbers : undefined,
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
      
      // Find related house numbers (always, not just when no customers found)
      let relatedHouseNumbers: string[] = [];
      if (address.number) {
        relatedHouseNumbers = await storage.findRelatedHouseNumbers(address);
      }
      
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
         relatedHouseNumbers: relatedHouseNumbers.length > 0 ? relatedHouseNumbers : undefined,
        // Backend orientation correction disabled - always false
        orientationCorrectionApplied: false,
        backendOrientationInfo: null,
      };

      // Prepare address string for logging
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;

      // Track unique photo submission (deduplicated by prospect data - Column G)
      // Photos with identical prospect data are counted as 1 photo
      if (req.userId && req.username) {
        dailyDataStore.trackOCRPhoto(req.userId, req.username, {
          newProspects,
          existingCustomers: existingCustomers.map(c => ({ id: c.id, name: c.name })),
          address: addressString,
          timestamp: Date.now()
        });
      }

      // Log the OCR request with results
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

      // Prepare address string
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;

      // Track unique photo submission for OCR correction too
      if (req.userId && req.username) {
        dailyDataStore.trackOCRPhoto(req.userId, req.username, {
          newProspects,
          existingCustomers: existingCustomers.map(c => ({ id: c.id, name: c.name })),
          address: addressString,
          timestamp: Date.now()
        });
      }

      // Log the OCR correction request with results
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
      
      // Always find related house numbers (regardless of whether customers were found)
      let relatedHouseNumbers: string[] = [];
      if (address.number) {
        relatedHouseNumbers = await storage.findRelatedHouseNumbers(address);
      }
      
      // Log the address search WITH existing customers in the dedicated column
      const addressString = address ? `${address.street} ${address.number}, ${address.city} ${address.postal}`.trim() : undefined;
      await logUserActivityWithRetry(
        req, 
        addressString, 
        undefined, // No newProspects for address search
        matches    // Pass existing customers to log in dedicated column
      );
      
      // Track action in daily data store for live dashboard
      if (req.userId && req.username) {
        dailyDataStore.addAction(req.userId, req.username, 'search_address');
      }
      
      res.json({ 
        customers: matches,
        relatedHouseNumbers: relatedHouseNumbers.length > 0 ? relatedHouseNumbers : undefined
      });
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
