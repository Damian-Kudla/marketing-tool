# Sales Acquisition Tool

## Overview

This is a mobile-first web application designed for energy provider sales representatives to capture customer information in the field. The tool combines GPS-based address detection with OCR (Optical Character Recognition) technology to extract names from nameplate photos, helping sales reps quickly identify existing customers versus potential prospects.

The application is optimized for one-handed mobile operation and provides a streamlined workflow for field data capture, similar to professional mobile scanning applications like CamScanner or Adobe Scan.

**Current Status**: Fully functional MVP with GPS geocoding, OCR text extraction, customer database lookup, and bilingual support (German/English).

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes (October 2025)

### Implemented Features
1. **GPS Address Detection**: Real-time geolocation with Google Geocoding API integration for automatic address detection
2. **Photo Capture & OCR**: Mobile camera integration with Tesseract.js for German text extraction from nameplate photos
3. **Customer Database**: In-memory storage with customer lookup to identify existing customers vs prospects
4. **Bilingual Support**: Complete German/English internationalization with i18next
5. **Mobile-Optimized UI**: Single-screen interface with large touch targets, sticky action buttons, and responsive design

### Technical Implementation
- Backend APIs for `/api/geocode` and `/api/ocr` processing
- Real-time customer matching against seeded database
- German name extraction with regex patterns for titles (Herr/Frau) and capitalized names
- Color-coded status badges (green for existing customers, yellow for prospects)
- Complete error handling with toast notifications

## System Architecture

### Frontend Architecture

**Technology Stack:**
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query v5 for server state
- **UI Framework**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens
- **Internationalization**: i18next for English/German language support

**Design Pattern:**
- Mobile-first, single-page application (SPA)
- Component-based architecture with clear separation of concerns
- Utility-first CSS approach with Tailwind
- Design system based on professional mobile scanning apps
- Responsive design optimized for touch interfaces with 44px minimum touch targets

**Key UI Components:**
- `GPSAddressForm`: Handles geolocation detection and address display with Google Geocoding API
- `PhotoCapture`: Camera interface for nameplate photo capture with real-time OCR processing
- `ResultsDisplay`: Shows OCR-extracted customer information with status badges
- `LanguageToggle`: Switches between English and German

**Color System:**
- Primary: Professional Blue (#0066CC / 207 100% 40%) for main actions
- Success: Green (#28A745 / 134 61% 41%) for existing customers
- Warning: Yellow (#FFC107 / 45 100% 51%) for prospects
- Neutral backgrounds with high-contrast text for outdoor readability
- Full dark mode support with CSS custom properties

### Backend Architecture

**Technology Stack:**
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ESNext modules)
- **Database ORM**: Drizzle ORM (configured but using in-memory storage)
- **Database**: PostgreSQL (via Neon serverless) - schema defined, in-memory implementation active
- **File Upload**: Multer for multipart form handling
- **OCR Engine**: Tesseract.js for server-side German text extraction

**API Design:**
- RESTful JSON API structure
- Session-based architecture (connect-pg-simple for session storage)
- Error handling middleware with standardized responses
- Request/response logging for debugging

**Key Endpoints:**
- `POST /api/geocode`: Converts GPS coordinates to physical addresses using Google Geocoding API
- `POST /api/ocr`: Processes nameplate photos and extracts customer names with Tesseract.js
- `GET /api/customers`: Retrieves all customers from storage

**Data Storage Strategy:**
- In-memory storage implementation (`MemStorage`) for development/demo
- Interface-based storage abstraction (`IStorage`) allowing easy swap to PostgreSQL
- Seeded customer data: Max Müller, Anna Schmidt, Thomas Weber, Maria Fischer, Klaus Meyer
- Customer matching: Case-insensitive name lookup with automatic prospect creation

### External Dependencies

**Third-Party Services:**
1. **Google Geocoding API**
   - Purpose: Convert GPS coordinates to structured addresses
   - Configuration: Requires `GOOGLE_GEOCODING_API_KEY` environment variable
   - Language: German locale support (`language=de`)
   - Returns: Street, number, city, postal code, country

2. **Tesseract.js (OCR)**
   - Purpose: Extract German text from nameplate photos
   - Implementation: Server-side text recognition with German language model ('deu')
   - Processing: Multi-pattern name extraction (capitalized names + honorific titles)
   - Returns: Extracted text, identified names, customer match results

**Database:**
- PostgreSQL via Neon serverless driver (schema defined, not actively used)
- Connection: `DATABASE_URL` environment variable available
- Schema management: Drizzle Kit with migrations in `/migrations` directory
- Tables defined:
  - `users`: Authentication (username, hashed password)
  - `customers`: Customer records (name, isExisting flag)

**UI Component Library:**
- Radix UI primitives (headless, accessible components)
- Shadcn/ui pattern (customizable component library)
- Lucide React for icons

**Build Tools:**
- Vite for frontend bundling and development server
- esbuild for backend bundling
- TypeScript compiler for type checking
- PostCSS with Tailwind CSS processing

**Development Tools:**
- Replit-specific plugins for error overlay and dev banner
- Hot Module Replacement (HMR) in development
- Custom Vite middleware integration with Express

**Font Resources:**
- Google Fonts (Inter as primary typeface)
- SF Pro Display fallback for iOS devices

## Data Models

### Customer Schema
```typescript
{
  id: string (UUID)
  name: string
  isExisting: boolean (default: false for new prospects)
}
```

### Address Schema
```typescript
{
  street: string
  number: string
  city: string
  postal: string
  country: string
}
```

## Environment Variables

Required:
- `GOOGLE_GEOCODING_API_KEY`: Google Geocoding API key for address detection
- `SESSION_SECRET`: Express session secret (pre-configured)
- `DATABASE_URL`: PostgreSQL connection string (available, not actively used)

## Known Limitations

1. **Toast Notifications**: Some error messages are hard-coded in English and not fully localized
2. **Safe Area**: Main content could benefit from iOS safe-area padding for devices with notches
3. **OCR Accuracy**: German name extraction relies on regex patterns and may miss non-standard formats
4. **Storage**: Currently using in-memory storage; data resets on server restart

## Future Enhancements

Potential improvements identified:
- Tesseract worker caching/reuse to reduce cold-start latency
- Geocoding response logging for component coverage monitoring
- Extended OCR name parsing tests for diacritics and honorific variations
- Complete toast notification localization
- Persistent database migration from in-memory to PostgreSQL
- Photo history and session management
- Offline mode with data sync
- Sales rep dashboard with statistics
- Batch export for CRM integration
- Geofencing alerts for nearby prospects
