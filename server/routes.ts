import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import vision from "@google-cloud/vision";
import { 
  geocodingRequestSchema, 
  addressSchema, 
  ocrCorrectionRequestSchema,
  type Address,
  type Customer,
  type OCRResponse
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

// Initialize Vision client once at startup
let visionClient: any = null;
let visionEnabled = false;

try {
  const visionKey = process.env.GOOGLE_CLOUD_VISION_KEY || '{}';
  
  // Check if it's a valid JSON (service account key)
  if (visionKey.startsWith('{')) {
    const credentials = JSON.parse(visionKey);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
    visionEnabled = true;
    console.log('Google Cloud Vision API initialized successfully');
  } else {
    console.warn('GOOGLE_CLOUD_VISION_KEY is not a valid JSON service account key. OCR disabled.');
    console.warn('To enable OCR, provide a JSON service account key with Vision API access.');
  }
} catch (error) {
  console.error('Failed to initialize Google Cloud Vision client:', error);
  console.warn('OCR functionality disabled.');
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  app.post("/api/geocode", async (req, res) => {
    try {
      const { latitude, longitude } = geocodingRequestSchema.parse(req.body);
      
      const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Geocoding API key not configured" });
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&language=de`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK" || !data.results || data.results.length === 0) {
        return res.status(400).json({ error: "Unable to geocode location" });
      }

      const result = data.results[0];
      const components = result.address_components;

      const getComponent = (types: string[]) => {
        const component = components.find((c: any) => 
          types.some(type => c.types.includes(type))
        );
        return component?.long_name || "";
      };

      const address: Address = {
        street: getComponent(["route"]),
        number: getComponent(["street_number"]),
        city: getComponent(["locality", "postal_town"]),
        postal: getComponent(["postal_code"]),
        country: getComponent(["country"])
      };

      res.json(address);
    } catch (error) {
      console.error("Geocoding error:", error);
      res.status(400).json({ error: "Invalid request" });
    }
  });

  app.post("/api/ocr", upload.single("image"), async (req, res) => {
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

      // Parse address from request body if provided
      let address: Address | undefined;
      if (req.body.address) {
        try {
          address = JSON.parse(req.body.address);
        } catch (e) {
          console.error("Failed to parse address:", e);
        }
      }

      // Perform text detection
      const [result] = await visionClient.textDetection({
        image: { content: req.file.buffer },
      });

      const detections = result.textAnnotations;
      const fullVisionResponse = result;

      if (!detections || detections.length === 0) {
        return res.json({
          residentNames: [],
          fullVisionResponse,
          newProspects: [],
          existingCustomers: [],
        } as OCRResponse);
      }

      // Extract full text
      const fullText = detections[0]?.description || '';

      // Parse resident names from text
      // Split by line breaks and filter for names
      const lines = fullText.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
      
      const residentNames: string[] = [];
      const namePatterns = [
        // Match full names with capitalized words (2+ words)
        /^([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)+)$/,
        // Match names with titles
        /^(?:Herr|Frau|Hr\.|Fr\.)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*)$/i,
      ];

      for (const line of lines) {
        // Replace hyphens with spaces for better matching
        const cleanedLine = line.replace(/-/g, ' ').trim();
        
        for (const pattern of namePatterns) {
          const match = cleanedLine.match(pattern);
          if (match) {
            // Normalize name: convert to lowercase
            const name = (match[1] || match[0]).trim().toLowerCase();
            if (name.length > 3 && !residentNames.includes(name)) {
              residentNames.push(name);
            }
            break;
          }
        }
      }

      // Search for matching customers
      const existingCustomers: Customer[] = [];
      const newProspects: string[] = [];

      for (const residentName of residentNames) {
        const matches = await storage.searchCustomers(residentName, address);
        
        if (matches.length > 0) {
          // Add all matches to existing customers
          existingCustomers.push(...matches);
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
      };

      res.json(response);
    } catch (error) {
      console.error("OCR error:", error);
      res.status(500).json({ error: "OCR processing failed" });
    }
  });

  app.post("/api/ocr-correct", async (req, res) => {
    try {
      const { residentNames, address } = ocrCorrectionRequestSchema.parse(req.body);

      const existingCustomers: Customer[] = [];
      const newProspects: string[] = [];

      for (const residentName of residentNames) {
        const matches = await storage.searchCustomers(residentName, address);
        
        if (matches.length > 0) {
          existingCustomers.push(...matches);
        } else {
          newProspects.push(residentName);
        }
      }

      const response: OCRResponse = {
        residentNames,
        fullVisionResponse: null,
        newProspects,
        existingCustomers,
      };

      res.json(response);
    } catch (error) {
      console.error("OCR correction error:", error);
      res.status(400).json({ error: "Invalid request" });
    }
  });

  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      res.json(customers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
