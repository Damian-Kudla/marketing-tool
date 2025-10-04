# Sales Acquisition Tool

## Overview

This mobile-first web application helps energy provider sales representatives capture customer information in the field. It uses GPS to detect addresses and OCR to extract names from nameplate photos, distinguishing between existing customers and potential prospects. The tool is optimized for one-handed mobile operation and offers a streamlined workflow with manual correction capabilities. Its primary purpose is to enhance efficiency in field data capture and lead generation.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application is built as a mobile-first web application with a focus on a single-screen, intuitive user experience.

### Frontend
- **Technology Stack**: React 18, TypeScript, Wouter for routing, TanStack React Query for state, Shadcn/ui (Radix UI) for components, Tailwind CSS for styling, i18next for German/English internationalization.
- **UI/UX Decisions**: Optimized for one-handed mobile use with large touch targets. Features a professional blue primary color, green for existing customers, yellow for prospects, and high-contrast text for outdoor readability. Full dark mode support is included.
- **Address Form**: Simplified to show only Street (Straße), Number (Nummer), and Postal Code (Postleitzahl) fields. City and Country are handled automatically by GPS detection but are not shown to users.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript.
- **API Design**: RESTful JSON API with comprehensive error handling.
- **Key Endpoints**:
    - `POST /api/geocode`: Converts GPS coordinates to physical addresses using Google Geocoding API. **Validates that addresses are in Germany** (returns 400 for non-German locations).
    - `POST /api/ocr`: Processes nameplate photos with Google Cloud Vision API for German text extraction, parses names (handling periods, hyphens, and short names/initials), and matches against the customer database.
    - `POST /api/ocr-correct`: Resubmits manually corrected names for customer lookup.
    - `POST /api/search-address`: **Address-only search** - searches customer database by address without requiring photo upload. Supports partial street matching with German character normalization (ß/ss) and flexible house number matching.
    - `GET /api/customers`: Fetches all customers from Google Sheets.
- **Data Storage**: Google Sheets serves as the primary customer database with a 5-minute in-memory cache. The system is designed with an interface-based storage abstraction for potential migration to PostgreSQL.
- **Customer Matching Logic**: Employs word-level, case-insensitive matching for names (with period/hyphen normalization to spaces), with optional address filtering (street, house number, postal code) to categorize existing customers versus new prospects.
- **Duplicate Detection Logic**: Uses word-based matching to identify duplicates. Names are normalized (periods removed, split on spaces/hyphens/slashes, single characters ignored) to extract words. Names sharing any common word are marked as duplicates and displayed with blue overlays and listed under "Duplicate Names" (e.g., "L.Schmidt" and "E.Schmidt" both share "schmidt" and are marked as duplicates).
- **Germany-Only Service**: Both frontend and backend enforce that this service is only available for German addresses. Frontend displays error message; backend validates and rejects non-German GPS coordinates.

## External Dependencies

1.  **Google Geocoding API**: Used for converting GPS coordinates to structured addresses.
2.  **Google Cloud Vision API**: Utilized for highly accurate German text extraction from nameplate photos (OCR). Requires a JSON service account key.
3.  **Google Sheets API**: Integrates with Google Sheets as the customer database, enabling real-time syncing and data storage. Requires a JSON service account key and sharing the sheet with the service account.
4.  **Radix UI / Shadcn/ui**: Component libraries for building the user interface.
5.  **Lucide React**: Icon library.
6.  **Vite**: Frontend bundling.
7.  **esbuild**: Backend bundling.
8.  **i18next**: Internationalization library for English and German.