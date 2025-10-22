# Copilot Instructions for EnergyScanCapture

## Project Overview
EnergyScanCapture is a GPS tracking and photo capture application for field workers (energy sector marketing). It consists of:
- **Client**: React + TypeScript (Vite) with Leaflet maps and shadcn/ui components
- **Server**: Node.js/Express API with SQLite database
- **Mobile**: Capacitor-wrapped web app for iOS/Android with background GPS tracking

## Architecture & Data Flow

### GPS Tracking System
- Background location tracking runs every 5 minutes on mobile devices (`mobile/src/services/backgroundGeolocation.ts`)
- GPS points include: `latitude`, `longitude`, `accuracy`, `timestamp`
- Data flows: Mobile → Server API (`/api/location/batch`) → SQLite → Client Dashboard
- Photos are linked to GPS points via timestamps for route interpolation

### Key Components
```
client/src/components/
├── RouteReplayMap.tsx       # Animated route playback with timeline scrubbing
├── LocationTracker.tsx      # Real-time GPS tracking UI
└── ui/                      # shadcn/ui components (button, card, etc.)

server/
├── routes/                  # API endpoints (location, photos, users)
├── db.ts                    # SQLite database initialization
└── middleware/auth.ts       # Authentication logic

mobile/
├── src/services/backgroundGeolocation.ts  # Capacitor Geolocation plugin
└── capacitor.config.ts      # iOS/Android platform config
```

## Development Workflows

### Setup & Running
```bash
# Client (React dev server)
cd client && npm install && npm run dev

# Server (Express API)
cd server && npm install && npm run dev

# Mobile (Capacitor sync + platform builds)
cd mobile && npm install
npm run sync:ios    # Sync to Xcode
npm run sync:android # Sync to Android Studio
```

### Database Schema (SQLite)
```sql
-- Key tables (server/db.ts)
locations (id, username, latitude, longitude, accuracy, timestamp, created_at)
photos (id, username, filepath, timestamp, location_id, created_at)
users (id, username, password_hash, role, created_at)
```

## Project-Specific Conventions

### Component Patterns
1. **Map Components**: Always use Leaflet with custom `L.divIcon` for markers
   - Example: `createAnimatedMarker()`, `createPhotoFlashMarker()` in RouteReplayMap.tsx
   - Use `useMap()` hook for programmatic map control (panning, zooming)
   
2. **GPS Data Handling**: 
   - Always sort by `timestamp` before processing: `[...gpsPoints].sort((a, b) => a.timestamp - b.timestamp)`
   - Interpolate photo positions between GPS points using linear interpolation
   - Display Google Maps links: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

3. **Animation Pattern** (RouteReplayMap.tsx):
   - Use `requestAnimationFrame` for smooth playback
   - Support scrubbing via timeline slider without stopping animation
   - Implement intelligent camera following (pan only when marker approaches edge 30% threshold)

### UI/UX Standards
- Use `shadcn/ui` components (Button, Card, etc.) for consistency
- Date formatting: `date-fns` with `de` locale (German): `format(date, 'dd.MM.yyyy', { locale: de })`
- Icons: `lucide-react` library (Play, Pause, RotateCcw, Zap, etc.)
- Animations: CSS keyframes for markers (`@keyframes pulse`, `@keyframes flash-pulse`)

### API Integration
- Base URL: `http://localhost:3001/api` (development)
- Authentication: Session-based with httpOnly cookies
- Batch uploads: POST `/api/location/batch` with array of GPS points
- Error handling: Always check response status and handle network failures gracefully

### Mobile-Specific (Capacitor)
- Background geolocation requires permissions in `Info.plist` (iOS) and `AndroidManifest.xml`
- Use `@capacitor/geolocation` with `watchPosition()` for continuous tracking
- Store failed uploads locally and retry when connection restored
- Test on actual devices (simulators don't provide realistic GPS data)

## Critical Integration Points

### Photo-to-GPS Linking
Photos don't have GPS metadata. Instead:
1. Photo timestamp is captured on upload
2. Position is interpolated between nearest GPS points: `calculatePhotoPosition(photoTimestamp)`
3. Flash markers appear during route replay when animation reaches photo timestamp (±5s tolerance)

### Route Replay Algorithm
```typescript
// Animation uses progress-based indexing
const progress = elapsed / ANIMATION_DURATION;
const newIndex = startIndex + Math.floor(progress * remainingPoints);

// Camera follows with edge detection (30% threshold)
const threshold = 0.3;
if (targetPoint.x < mapSize.x * threshold) {
  map.panTo([lat, lng], { animate: true, duration: 0.25 });
}
```

### External Dependencies
- **Leaflet**: v1.9+ for map rendering (requires CSS import: `import 'leaflet/dist/leaflet.css'`)
- **date-fns**: Prefer over moment.js (tree-shakeable)
- **@capacitor/geolocation**: Mobile GPS tracking (replaces Cordova plugins)

## Testing & Debugging
- Client runs on `http://localhost:5173` (Vite default)
- Server runs on `http://localhost:3001`
- Check browser console for GPS accuracy warnings
- SQLite database: `server/database.db` (inspect with DB Browser for SQLite)
- Mobile logs: Xcode Console (iOS) or Android Studio Logcat

## Common Pitfalls
- **Leaflet marker icons**: Must define custom `divIcon` HTML (default icons don't load in Vite)
- **GPS timestamp sync**: Client and server must agree on timezone (use UTC timestamps)
- **Animation performance**: Limit visible markers (show every 5th GPS point to avoid lag)
- **Map bounds**: Call `fitBounds()` only on initial load, not during animation