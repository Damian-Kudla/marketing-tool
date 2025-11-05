# Admin Dashboard GPS Routes Architecture

## Overview

The admin dashboard has a complete GPS route tracking and display system that currently handles **two sources of GPS data**:
1. **Native GPS**: Collected directly from the webapp via geolocation API
2. **FollowMee GPS**: From external FollowMee GPS tracker devices (newly integrated)

The system displays animated route replays with photo markers, shows live locations on maps, and allows filtering by source.

---

## 1. Components & UI

### Admin Dashboard Page
**File:** `client/src/pages/admin-dashboard.tsx` (Lines 1-1283)

**Key Features:**
- Live map with current user positions (markers on OpenStreetMap)
- Route button in user comparison table (Line 839-848)
- Modal overlay for detailed route replay
- Tabs for "Live Ansicht" and "Historisch" views

### RouteReplayMap Component
**File:** `client/src/components/RouteReplayMap.tsx` (Lines 1-727)

**Core Functionality:**
- Leaflet-based interactive map
- Play/Pause/Reset animation controls
- Timeline scrubber slider
- Zoom control
- Speed control (1-30 seconds animation duration)
- Photo flash markers showing where photos were taken
- Start (green S) and End (red E) markers
- GPS point markers (every 5th point to avoid clutter)
- Full route polyline (grayed out, dashed)
- Animated route polyline (blue)

---

## 2. GPS Data Sources

### Source 1: Native GPS (Webapp Collection)
- **Endpoint:** `POST /api/tracking/gps`
- **Storage:** `DailyUserData.gpsPoints[]` in dailyDataStore (RAM)
- **Also logged:** To Google Sheets via GoogleSheetsLoggingService
- **Date validation:** Only accepts GPS points from TODAY
- **Distance calculation:** Haversine formula between consecutive points

### Source 2: FollowMee GPS (External Devices)
- **API:** FollowMee API (https://www.followmee.com/api/tracks.aspx)
- **Sync interval:** Every 5 minutes
- **User mapping:** Via `users.followMeeDeviceId` in database
- **Storage:** Merged chronologically into Google Sheets activity logs
- **De-duplication:** Tracks processed locations to avoid duplicates
- **Logged with metadata:** `{"source":"followmee", "deviceId": "...", ...}`

---

## 3. Data Structure

### GPSCoordinates Interface
```typescript
interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp: number;  // milliseconds since epoch
}
```

### Route Response Format
```typescript
{
  gpsPoints: GPSCoordinates[],
  photoTimestamps: number[],
  username: string,
  date: string,        // YYYY-MM-DD
  totalPoints: number,
  totalPhotos: number
}
```

---

## 4. API Endpoints

### GET /api/admin/dashboard/route
**Query params:**
- `userId` (required): User ID
- `date` (required): YYYY-MM-DD format

**Logic:**
- If date === today: Fetch from dailyDataStore (RAM)
- If date < today: Fetch from Google Sheets via historicalDataScraper

**Response:** Route data with gpsPoints and photoTimestamps arrays

### GET /api/admin/dashboard/live
**Response includes:** Latest GPS location for each user + distance metrics

### GET /api/admin/dashboard/historical
**Query params:**
- `date` (required): YYYY-MM-DD
- `userId` (optional): Filter single user

**Source:** Google Sheets historical data scraper

---

## 5. Key Files

| File | Purpose |
|------|---------|
| `client/src/pages/admin-dashboard.tsx` | Main dashboard page with Route button |
| `client/src/components/RouteReplayMap.tsx` | Map display & animation component |
| `server/routes/admin.ts` | API endpoints for route & dashboard data |
| `server/routes/tracking.ts` | GPS data ingestion endpoint |
| `server/services/dailyDataStore.ts` | In-memory storage for today's GPS data |
| `server/services/followMeeApi.ts` | FollowMee API integration |
| `server/services/followMeeSyncScheduler.ts` | Automatic sync scheduler (5 min interval) |
| `server/services/historicalDataScraper.ts` | Parses historical GPS from Google Sheets |
| `shared/trackingTypes.ts` | Type definitions (GPSCoordinates, DailyUserData) |
| `shared/schema.ts` | DB schema (followMeeDeviceId field) |

---

## 6. Data Flow Diagram

### Live Routes (Today)
Native GPS → POST /api/tracking/gps → dailyDataStore → RouteReplayMap

### Historical Routes (Past Days)
Google Sheets ← (initial insert) ← dailyDataStore (midnight save)
Google Sheets → historicalDataScraper → RouteReplayMap

### FollowMee Integration
FollowMee Devices → API → followMeeApiService (every 5 min) → Google Sheets
Google Sheets → historicalDataScraper (when route loaded) → RouteReplayMap

---

## 7. Data Source Information

### Native GPS Log Entry
```
Address: "GPS: 51.234567, 10.123456"
User Agent: "Chrome/..."
Data: {"action":"gps_update","latitude":51.234567,"longitude":10.123456,"accuracy":10}
```

### FollowMee GPS Log Entry
```
Address: "GPS: 51.234567, 10.123456 [FollowMee]"
User Agent: "FollowMee GPS Tracker"
Data: {
  "source":"followmee",
  "deviceId":"DEV123",
  "latitude":51.234567,
  "longitude":10.123456,
  "accuracy":15,
  "battery":"45%",
  "speedKmh":25
}
```

---

## 8. Implementation Notes for Dual-Source Feature

### Required Changes
1. **Add source metadata to GPSCoordinates**
   - Currently: Native GPS has no source field
   - Solution: Add `source?: 'native' | 'followmee'` to interface

2. **Modify route endpoint**
   - When returning live data: Mark native points with `source: 'native'`
   - When scraping historical: Extract source from log data field

3. **Update RouteReplayMap component**
   - Add props: `gpsSource: 'native' | 'followmee' | 'both'`
   - Filter gpsPoints array before rendering
   - Show legend with source colors/icons

4. **Update admin dashboard**
   - Add radio buttons or dropdown: "GPS Source" filter
   - Pass selection to route modal
   - Default to 'both' for backward compatibility

### Where to Add UI Controls
- In the admin dashboard, just before/after date picker for historical view
- In route modal header, before play controls
- Show legend with source indicators (colors or icons)

---

## 9. Limitations & Opportunities

### Current State
- Routes show combined GPS points from both sources
- No UI filter for source selection
- No visual distinction between native and FollowMee points
- No accuracy comparison between sources

### Future Enhancements
1. Dual-source comparison view (side-by-side maps)
2. Accuracy heatmap visualization
3. Speed analysis along route
4. Resident interaction overlay (status changes at locations)
5. Route export (KML/GPX format)
6. Real-time accuracy metrics

