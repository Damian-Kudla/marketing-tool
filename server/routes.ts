import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { createWorker } from "tesseract.js";
import { 
  geocodingRequestSchema, 
  addressSchema, 
  type Address,
  type Customer 
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

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

      const worker = await createWorker("deu");
      const { data } = await worker.recognize(req.file.buffer);
      await worker.terminate();

      const extractedText = data.text;
      
      const namePatterns = [
        /([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)+)/g,
        /(?:Herr|Frau|Hr\.|Fr\.)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*)/gi
      ];

      const foundNames = new Set<string>();
      
      for (const pattern of namePatterns) {
        const matches = Array.from(extractedText.matchAll(pattern));
        for (const match of matches) {
          const name = (match[1] || match[0]).trim();
          if (name.length > 3 && name.split(/\s+/).length >= 2) {
            foundNames.add(name);
          }
        }
      }

      const names = Array.from(foundNames);

      const customers = await storage.getAllCustomers();
      const results: Customer[] = [];

      for (const name of names) {
        const existingCustomer = await storage.getCustomerByName(name);
        if (existingCustomer) {
          results.push(existingCustomer);
        } else {
          const newCustomer = await storage.createCustomer({
            name,
            isExisting: false
          });
          results.push(newCustomer);
        }
      }

      res.json({
        extractedText,
        names,
        results
      });
    } catch (error) {
      console.error("OCR error:", error);
      res.status(500).json({ error: "OCR processing failed" });
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
