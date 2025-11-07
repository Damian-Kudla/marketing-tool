# Route-Anzeige im Admin Panel - Technische Dokumentation

## Übersicht
Diese Dokumentation beschreibt, wie die Route-Anzeige im Admin Panel technisch funktioniert. Wenn ein Admin auf den "Route"-Button bei einem User klickt, wird eine interaktive Karte mit GPS-Route-Animation geöffnet.

---

## 1. Architektur-Überblick

### Komponenten-Struktur
```
Admin Dashboard (admin-dashboard.tsx)
├── User-Vergleichstabelle (mit Route-Button)
├── Route-Modal (Fullscreen Overlay)
│   └── RouteReplayMap Component
│       ├── Leaflet Map Container
│       ├── Animation Controls (Play/Pause/Reset)
│       ├── Timeline Scrubber
│       ├── Info Panels (Statistik & Pausen)
│       └── GPS-Punkte mit Markern
└── API-Anbindung (fetchRouteData)
```

### Datenfluss
```
User klickt "Route"-Button
    ↓
handleShowRoute(userId, username)
    ↓
fetchRouteData(userId, date, source)
    ↓
GET /api/admin/dashboard/route?userId=X&date=YYYY-MM-DD&source=all
    ↓
Server lädt GPS-Daten (Live aus RAM oder Historisch aus Google Sheets)
    ↓
Rückgabe: { gpsPoints[], photoTimestamps[], username }
    ↓
RouteReplayMap rendert Karte mit Animation
```

---

## 2. Frontend-Implementierung

### 2.1 Route-Button in der User-Tabelle
**Datei:** `client/src/pages/admin-dashboard.tsx` (Zeile ~864)

```tsx
<td className="p-2 text-center">
  <button
    onClick={() => handleShowRoute(user.userId, user.username)}
    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
    title="Route auf Karte anzeigen"
  >
    <Route className="w-3 h-3" />
    Route
  </button>
</td>
```

**Wichtige Details:**
- Button erscheint in jeder Zeile der User-Vergleichstabelle
- Icon: `<Route>` von `lucide-react`
- Styling: Blauer Button mit Hover-Effekt

---

### 2.2 Click-Handler: handleShowRoute
**Datei:** `client/src/pages/admin-dashboard.tsx` (Zeile ~296)

```tsx
const handleShowRoute = (userId: string, username: string) => {
  setSelectedUserId(userId);
  setSelectedUsername(username);
  setShowRouteReplay(true);
  fetchRouteData(
    userId, 
    mode === 'live' ? format(new Date(), 'yyyy-MM-dd') : selectedDate, 
    gpsSource
  );
};
```

**Funktionsweise:**
1. Speichert `userId` und `username` im State
2. Setzt `showRouteReplay` auf `true` → öffnet Modal
3. Ruft `fetchRouteData()` mit korrektem Datum auf
   - Live-Modus: Heutiges Datum
   - Historisch: Ausgewähltes Datum (`selectedDate`)
4. GPS-Quelle (`gpsSource`): `'all'`, `'native'`, `'followmee'` oder `'external'`

---

### 2.3 API-Aufruf: fetchRouteData
**Datei:** `client/src/pages/admin-dashboard.tsx` (Zeile ~270)

```tsx
const fetchRouteData = async (
  userId: string, 
  date: string, 
  source?: 'all' | 'native' | 'followmee' | 'external'
) => {
  setLoadingRoute(true);
  try {
    const sourceParam = source && source !== 'all' ? `&source=${source}` : '';
    const response = await fetch(
      `/api/admin/dashboard/route?userId=${userId}&date=${date}${sourceParam}`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch route data');
    }

    const result = await response.json();
    setRouteData(result);
  } catch (err: any) {
    alert(err.message || 'Failed to fetch route data');
    console.error('Error fetching route data:', err);
    setRouteData(null);
  } finally {
    setLoadingRoute(false);
  }
};
```

**API-Endpunkt:**
```
GET /api/admin/dashboard/route
```

**Query-Parameter:**
- `userId` (required): User-ID
- `date` (required): `YYYY-MM-DD` Format
- `source` (optional): `'native'` | `'followmee'` | `'external'` | undefined (= all)

**Response-Format:**
```typescript
{
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps: number[];
  totalPoints: number;
}

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number; // Unix-Timestamp in Millisekunden
  source?: 'native' | 'followmee' | 'external';
}
```

---

### 2.4 Route-Modal (Fullscreen Overlay)
**Datei:** `client/src/pages/admin-dashboard.tsx` (Zeile ~1237)

```tsx
{showRouteReplay && (
  <div className="fixed top-0 left-0 right-0 bottom-0 z-[9999] bg-background overflow-hidden">
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div>
          <h2 className="text-lg font-bold">Route: {selectedUsername}</h2>
          <p className="text-xs text-muted-foreground">
            {mode === 'live' 
              ? format(new Date(), 'dd.MM.yyyy') 
              : format(new Date(selectedDate), 'dd.MM.yyyy')}
          </p>
        </div>

        {/* GPS Source Filter Buttons */}
        <div className="flex gap-2">
          <button onClick={() => handleGpsSourceChange('all')}>Alle</button>
          <button onClick={() => handleGpsSourceChange('native')}>Native</button>
          <button onClick={() => handleGpsSourceChange('followmee')}>FollowMee</button>
          <button onClick={() => handleGpsSourceChange('external')}>Damians Tracking App</button>
        </div>

        {/* Close Button */}
        <button onClick={() => setShowRouteReplay(false)}>✕</button>
      </div>

      {/* Map Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingRoute ? (
          <div>Loading...</div>
        ) : routeData?.gpsPoints?.length > 0 ? (
          <RouteReplayMap
            username={selectedUsername || 'Unbekannt'}
            gpsPoints={routeData.gpsPoints}
            photoTimestamps={routeData.photoTimestamps || []}
            date={mode === 'live' ? new Date().toISOString().split('T')[0] : selectedDate}
          />
        ) : (
          <div>Keine GPS-Daten verfügbar</div>
        )}
      </div>
    </div>
  </div>
)}
```

**Modal-Features:**
- **Fullscreen**: `fixed top-0 left-0 right-0 bottom-0` mit `z-[9999]`
- **Header**: Username, Datum, GPS-Quellen-Filter
- **Body**: `RouteReplayMap` Component
- **Background Lock**: `document.body.style.overflow = 'hidden'` (via useEffect)

---

## 3. Backend-Implementierung

### 3.1 API-Route: /api/admin/dashboard/route
**Datei:** `server/routes/admin.ts` (Zeile ~427)

```typescript
router.get('/dashboard/route', requireAuth, requireAdmin, async (req, res) => {
  const { userId, date, source } = req.query;

  if (!userId || !date) {
    return res.status(400).json({ error: 'userId and date are required' });
  }

  const dateStr = date as string;
  const userIdStr = userId as string;
  const sourceFilter = source as string | undefined;

  // Prüfe ob es heute ist (Live-Daten) oder historische Daten
  const today = new Date().toISOString().split('T')[0];
  let gpsPoints: any[] = [];
  let photoTimestamps: number[] = [];
  let username = '';

  // Finde Username für userId
  const { googleSheetsService } = await import('../services/googleSheets');
  const allUsers = await googleSheetsService.getAllUsers();
  const user = allUsers.find(u => u.userId === userIdStr);

  if (user) {
    username = user.username;
  }

  // Lade GPS-Daten basierend auf Datum
  if (sourceFilter !== 'external') {
    if (dateStr === today) {
      // LIVE-DATEN aus RAM
      const userData = dailyDataStore.getUserDailyData(userIdStr);
      if (userData) {
        gpsPoints = userData.gpsPoints;
        username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    } else {
      // HISTORISCHE DATEN aus Google Sheets
      const historicalData = await scrapeDayData(dateStr, userIdStr);
      if (historicalData?.length > 0) {
        const userData = historicalData[0];
        gpsPoints = userData.gpsPoints;
        username = userData.username;
        photoTimestamps = userData.photoTimestamps || [];
      }
    }
  }

  // Lade externe Tracking-Daten (falls gewünscht)
  if ((sourceFilter === 'external' || sourceFilter === undefined) && user) {
    const { externalTrackingService } = await import('../services/externalTrackingService');
    const externalData = await externalTrackingService.getExternalTrackingDataFromUserLog(
      user.username,
      new Date(dateStr)
    );

    const externalGpsPoints = externalData.map(point => ({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: 10,
      timestamp: new Date(point.timestamp).getTime(),
      source: 'external' as const
    }));

    if (sourceFilter === 'external') {
      gpsPoints = externalGpsPoints;
    } else {
      gpsPoints = [...gpsPoints, ...externalGpsPoints];
    }
  }

  // Filtere nach Source (falls gewünscht)
  if (sourceFilter === 'native' || sourceFilter === 'followmee') {
    gpsPoints = gpsPoints.filter(p => p.source === sourceFilter);
  }

  // Sortiere nach Timestamp
  gpsPoints.sort((a, b) => a.timestamp - b.timestamp);

  res.json({
    username,
    gpsPoints,
    photoTimestamps,
    totalPoints: gpsPoints.length
  });
});
```

**Wichtige Logik:**
1. **Datums-Check**: Heute = Live-Daten (RAM), sonst = Historische Daten (Google Sheets)
2. **Datenquellen**:
   - **Native**: Von mobiler App (`dailyDataStore`)
   - **FollowMee**: Von FollowMee-API (im `dailyDataStore` mit `source: 'followmee'`)
   - **External**: Von externer Tracking-App (separate Datenbank)
3. **Source-Filter**: Filtert GPS-Punkte nach `source`-Eigenschaft
4. **Sortierung**: Nach `timestamp` aufsteigend

---

### 3.2 Datenquellen

#### Live-Daten (RAM)
**Datei:** `server/services/dailyDataStore.ts`

```typescript
class DailyDataStore {
  private userDataMap: Map<string, DailyUserData>;

  getUserDailyData(userId: string): DailyUserData | undefined {
    return this.userDataMap.get(userId);
  }
}

interface DailyUserData {
  userId: string;
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps: number[];
  // ... weitere Felder
}
```

#### Historische Daten (Google Sheets)
**Datei:** `server/services/historicalDataScraper.ts`

```typescript
async function scrapeDayData(
  date: string, 
  userId?: string
): Promise<DailyUserData[]> {
  // Liest GPS-Daten aus Google Sheets
  // Format: [Worksheet: YYYY-MM-DD]
}
```

#### Externe Tracking-Daten
**Datei:** `server/services/externalTrackingService.ts`

```typescript
class ExternalTrackingService {
  async getExternalTrackingDataFromUserLog(
    username: string,
    date: Date
  ): Promise<ExternalTrackingPoint[]> {
    // Liest aus separater Datenbank
  }
}
```

---

## 4. RouteReplayMap Component

### 4.1 Component-Struktur
**Datei:** `client/src/components/RouteReplayMap.tsx`

```tsx
interface RouteReplayMapProps {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps?: number[];
  date: string;
}

export default function RouteReplayMap({ 
  username, 
  gpsPoints, 
  photoTimestamps = [], 
  date 
}: RouteReplayMapProps) {
  // State Management
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animationDuration, setAnimationDuration] = useState(5);
  
  // Refs
  const animationRef = useRef<number | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Sortiere GPS-Punkte nach Timestamp
  const sortedPoints = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);

  // ...
}
```

---

### 4.2 Leaflet Map Setup

```tsx
<MapContainer
  center={[sortedPoints[0].latitude, sortedPoints[0].longitude]}
  zoom={13}
  style={{ height: '100%', width: '100%' }}
  zoomControl={false}
  ref={mapRef}
>
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  />
  <ZoomControl position="topright" />

  {/* Full Route Polyline (grau gestrichelt) */}
  <Polyline
    positions={sortedPoints.map(p => [p.latitude, p.longitude])}
    color="#9ca3af"
    weight={3}
    dashArray="10, 10"
    opacity={0.6}
  />

  {/* Animated Route Polyline (blau) */}
  <Polyline
    positions={sortedPoints.slice(0, currentIndex + 1).map(p => [p.latitude, p.longitude])}
    color="#3b82f6"
    weight={4}
    opacity={0.8}
  />

  {/* Start Marker (grün mit "S") */}
  <Marker
    position={[sortedPoints[0].latitude, sortedPoints[0].longitude]}
    icon={createStartMarker()}
  >
    <Popup>
      <div>
        <strong>Start</strong><br />
        {format(new Date(sortedPoints[0].timestamp), 'HH:mm:ss', { locale: de })}
      </div>
    </Popup>
  </Marker>

  {/* End Marker (rot mit "E") */}
  <Marker
    position={[sortedPoints[sortedPoints.length - 1].latitude, sortedPoints[sortedPoints.length - 1].longitude]}
    icon={createEndMarker()}
  >
    <Popup>
      <div>
        <strong>Ende</strong><br />
        {format(new Date(sortedPoints[sortedPoints.length - 1].timestamp), 'HH:mm:ss', { locale: de })}
      </div>
    </Popup>
  </Marker>

  {/* Current Position Marker (animiert, blau) */}
  {currentIndex < sortedPoints.length && (
    <Marker
      position={[sortedPoints[currentIndex].latitude, sortedPoints[currentIndex].longitude]}
      icon={createAnimatedMarker()}
    />
  )}

  {/* GPS Point Markers (jeder 5. Punkt) */}
  {sortedPoints.filter((_, i) => i % 5 === 0).map((point, i) => (
    <Marker
      key={i}
      position={[point.latitude, point.longitude]}
      icon={createGPSPointMarker(point.source)}
    >
      <Popup>
        <div>
          <strong>GPS-Punkt #{i * 5}</strong><br />
          Zeit: {format(new Date(point.timestamp), 'HH:mm:ss', { locale: de })}<br />
          Genauigkeit: {point.accuracy.toFixed(0)}m<br />
          Quelle: {point.source || 'native'}<br />
          <a href={getGoogleMapsUrl(point.latitude, point.longitude)} target="_blank">
            In Google Maps öffnen
          </a>
        </div>
      </Popup>
    </Marker>
  ))}

  {/* Photo Flash Markers */}
  {photoTimestamps.map((timestamp, i) => {
    const photoPosition = calculatePhotoPosition(timestamp, sortedPoints);
    if (!photoPosition) return null;

    return (
      <Marker
        key={`photo-${i}`}
        position={[photoPosition.latitude, photoPosition.longitude]}
        icon={createPhotoFlashMarker()}
      >
        <Popup>
          <div>
            <strong>📸 Foto #{i + 1}</strong><br />
            {format(new Date(timestamp), 'HH:mm:ss', { locale: de })}
          </div>
        </Popup>
      </Marker>
    );
  })}
</MapContainer>
```

---

### 4.3 Animation-Logik

#### Play/Pause/Reset Controls

```tsx
// Play Animation
const startAnimation = () => {
  if (currentIndex >= sortedPoints.length - 1) {
    setCurrentIndex(0); // Restart wenn am Ende
  }
  setIsPlaying(true);
};

// Pause Animation
const pauseAnimation = () => {
  setIsPlaying(false);
  if (animationRef.current !== null) {
    cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }
};

// Reset Animation
const resetAnimation = () => {
  pauseAnimation();
  setCurrentIndex(0);
};
```

#### Animation Loop (requestAnimationFrame)

```tsx
useEffect(() => {
  if (!isPlaying || currentIndex >= sortedPoints.length - 1) return;

  const startTime = Date.now();
  const startIndex = currentIndex;
  const remainingPoints = sortedPoints.length - startIndex;
  const ANIMATION_DURATION = animationDuration * 1000; // in ms

  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / ANIMATION_DURATION;

    if (progress >= 1) {
      setCurrentIndex(sortedPoints.length - 1);
      setIsPlaying(false);
      return;
    }

    const newIndex = startIndex + Math.floor(progress * remainingPoints);
    setCurrentIndex(newIndex);

    // Intelligente Kamera-Verfolgung (nur wenn Marker am Rand)
    const currentPoint = sortedPoints[newIndex];
    const map = mapRef.current;
    if (map) {
      const bounds = map.getBounds();
      const mapSize = map.getSize();
      const point = map.latLngToContainerPoint([currentPoint.latitude, currentPoint.longitude]);

      const threshold = 0.3; // 30% vom Rand
      if (
        point.x < mapSize.x * threshold ||
        point.x > mapSize.x * (1 - threshold) ||
        point.y < mapSize.y * threshold ||
        point.y > mapSize.y * (1 - threshold)
      ) {
        map.panTo([currentPoint.latitude, currentPoint.longitude], { 
          animate: true, 
          duration: 0.25 
        });
      }
    }

    animationRef.current = requestAnimationFrame(animate);
  };

  animationRef.current = requestAnimationFrame(animate);

  return () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }
  };
}, [isPlaying, currentIndex, sortedPoints, animationDuration]);
```

**Wichtige Details:**
- **Progress-basiert**: `progress = elapsed / ANIMATION_DURATION`
- **Index-Berechnung**: `newIndex = startIndex + floor(progress * remainingPoints)`
- **Kamera-Verfolgung**: Nur pannen wenn Marker 30% vom Rand entfernt ist
- **Cleanup**: `cancelAnimationFrame` in `useEffect` return

---

### 4.4 Timeline Scrubber

```tsx
<input
  type="range"
  min={0}
  max={sortedPoints.length - 1}
  value={currentIndex}
  onChange={(e) => {
    const newIndex = parseInt(e.target.value);
    setCurrentIndex(newIndex);
    
    // Zentriere Karte auf neue Position
    const point = sortedPoints[newIndex];
    if (mapRef.current) {
      mapRef.current.panTo([point.latitude, point.longitude]);
    }
  }}
  className="w-full"
/>

{/* Zeitanzeige */}
<div className="text-sm text-muted-foreground">
  {format(new Date(sortedPoints[currentIndex].timestamp), 'HH:mm:ss', { locale: de })}
</div>
```

---

### 4.5 Custom Leaflet Marker Icons

```tsx
// Animierter blauer Marker (aktuelle Position)
const createAnimatedMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #3b82f6;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        animation: pulse 1.5s ease-in-out infinite;
      "></div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
      </style>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

// Start Marker (grün mit "S")
const createStartMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #22c55e;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: white;
      ">S</div>
    `,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

// End Marker (rot mit "E")
const createEndMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #ef4444;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: white;
      ">E</div>
    `,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

// GPS-Punkt Marker (farbcodiert nach Source)
const createGPSPointMarker = (source?: 'native' | 'followmee' | 'external') => {
  const color = source === 'followmee' ? '#000000' : 
                source === 'external' ? '#ef4444' : 
                '#3b82f6';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: ${color};
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        cursor: pointer;
      "></div>
    `,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
};

// Foto-Blitz Marker (⚡)
const createPhotoFlashMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        font-size: 35px;
        filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.8));
        animation: flash-pulse 1s ease-in-out;
      ">⚡</div>
      <style>
        @keyframes flash-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.2); }
        }
      </style>
    `,
    iconSize: [35, 35],
    iconAnchor: [17, 17],
  });
};
```

**Farb-Schema:**
- **Native GPS**: Blau (`#3b82f6`)
- **FollowMee GPS**: Schwarz (`#000000`)
- **External GPS**: Rot (`#ef4444`)
- **Start**: Grün (`#22c55e`)
- **Ende**: Rot (`#ef4444`)

---

### 4.6 Foto-Position Interpolation

Da Fotos keine GPS-Metadaten haben, wird die Position zwischen GPS-Punkten interpoliert:

```tsx
function calculatePhotoPosition(photoTimestamp: number, gpsPoints: GPSPoint[]): GPSPoint | null {
  if (gpsPoints.length === 0) return null;

  // Finde nächste GPS-Punkte vor und nach Foto
  let before: GPSPoint | null = null;
  let after: GPSPoint | null = null;

  for (let i = 0; i < gpsPoints.length; i++) {
    if (gpsPoints[i].timestamp <= photoTimestamp) {
      before = gpsPoints[i];
    }
    if (gpsPoints[i].timestamp >= photoTimestamp && !after) {
      after = gpsPoints[i];
      break;
    }
  }

  // Foto vor erstem GPS-Punkt → erste Position
  if (!before && after) return after;

  // Foto nach letztem GPS-Punkt → letzte Position
  if (before && !after) return before;

  // Exakter Match
  if (before && after && before.timestamp === after.timestamp) return before;

  // Lineare Interpolation
  if (before && after) {
    const timeDiff = after.timestamp - before.timestamp;
    const photoOffset = photoTimestamp - before.timestamp;
    const ratio = photoOffset / timeDiff;

    return {
      latitude: before.latitude + (after.latitude - before.latitude) * ratio,
      longitude: before.longitude + (after.longitude - before.longitude) * ratio,
      accuracy: Math.min(before.accuracy, after.accuracy),
      timestamp: photoTimestamp,
    };
  }

  return null;
}
```

---

### 4.7 Pausen-Erkennung

```tsx
function detectStationaryPeriods(points: GPSPoint[]): StationaryPeriod[] {
  const MIN_BREAK_MS = 20 * 60 * 1000; // 20 Minuten
  const breaks: StationaryPeriod[] = [];

  if (points.length < 2) return breaks;

  // Nur native App-Punkte für Pausen-Erkennung
  const nativePoints = points.filter(p => p.source === 'native' || !p.source);

  if (nativePoints.length < 2) return breaks;

  for (let i = 0; i < nativePoints.length - 1; i++) {
    const current = nativePoints[i];
    const next = nativePoints[i + 1];
    const gap = next.timestamp - current.timestamp;

    if (gap >= MIN_BREAK_MS) {
      breaks.push({
        startIndex: i,
        endIndex: i + 1,
        startTime: current.timestamp,
        endTime: next.timestamp,
        durationMs: gap,
        centerLat: (current.latitude + next.latitude) / 2,
        centerLng: (current.longitude + next.longitude) / 2,
      });
    }
  }

  return breaks;
}
```

---

### 4.8 Info-Panels (Statistik & Pausen)

**Left Panel - Statistik:**
```tsx
<div className="absolute z-[1000] bg-background/95 rounded-lg shadow-xl border"
     style={{ left: '10px', top: '70px' }}>
  <div className="p-3 space-y-2 text-sm">
    <div>
      <span className="font-semibold">Start:</span> {format(startTime, 'HH:mm:ss')}
    </div>
    <div>
      <span className="font-semibold">Ende:</span> {format(endTime, 'HH:mm:ss')}
    </div>
    <div>
      <span className="font-semibold">Gesamt-Distanz:</span> {totalDistance.toFixed(2)} km
    </div>
    <div>
      <span className="font-semibold">GPS-Punkte:</span> {sortedPoints.length}
    </div>
    <div>
      <span className="font-semibold">Fotos:</span> {photoTimestamps.length}
    </div>
  </div>
</div>
```

**Right Panel - Pausen:**
```tsx
<div className="absolute z-[1000] bg-background/95 rounded-lg shadow-xl border"
     style={{ right: '10px', top: '70px' }}>
  <div className="p-3 space-y-2 text-sm max-h-[400px] overflow-y-auto">
    <h4 className="font-semibold">Pausen (≥20 Min):</h4>
    {stationaryPeriods.length > 0 ? (
      stationaryPeriods.map((period, i) => (
        <div key={i} className="border-b pb-2">
          <div className="font-medium">Pause #{i + 1}</div>
          <div>{format(new Date(period.startTime), 'HH:mm')} - {format(new Date(period.endTime), 'HH:mm')}</div>
          <div>Dauer: {formatDuration(period.durationMs)}</div>
        </div>
      ))
    ) : (
      <div className="text-muted-foreground">Keine Pausen erkannt</div>
    )}
  </div>
</div>
```

---

## 5. Wichtige Helpers & Utilities

### 5.1 Distanz-Berechnung (Haversine)

```tsx
function calculateDistance(point1: GPSPoint, point2: GPSPoint): number {
  const R = 6371e3; // Erdradius in Metern
  const φ1 = (point1.latitude * Math.PI) / 180;
  const φ2 = (point2.latitude * Math.PI) / 180;
  const Δφ = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const Δλ = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distanz in Metern
}

// Gesamt-Distanz
const totalDistance = sortedPoints.reduce((sum, point, i) => {
  if (i === 0) return 0;
  return sum + calculateDistance(sortedPoints[i - 1], point);
}, 0) / 1000; // in km
```

---

### 5.2 Google Maps URL Generator

```tsx
const getGoogleMapsUrl = (lat: number, lng: number): string => {
  // Zeigt Pin-Marker an exakter Position
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
};
```

---

### 5.3 Zeit-Formatierung

```tsx
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Zeit: "14:35:22"
format(new Date(timestamp), 'HH:mm:ss', { locale: de })

// Datum: "07.11.2025"
format(new Date(timestamp), 'dd.MM.yyyy', { locale: de })

// Dauer formatieren
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}
```

---

## 6. State Management

### Admin Dashboard State
```tsx
const [showRouteReplay, setShowRouteReplay] = useState(false);
const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
const [routeData, setRouteData] = useState<any>(null);
const [loadingRoute, setLoadingRoute] = useState(false);
const [gpsSource, setGpsSource] = useState<'all' | 'native' | 'followmee' | 'external'>('all');
```

### RouteReplayMap State
```tsx
const [isPlaying, setIsPlaying] = useState(false);
const [currentIndex, setCurrentIndex] = useState(0);
const [animationDuration, setAnimationDuration] = useState(5); // Sekunden
const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

const animationRef = useRef<number | null>(null);
const mapRef = useRef<L.Map | null>(null);
```

---

## 7. Performance-Optimierungen

### 7.1 Marker-Reduktion
```tsx
// Zeige nur jeden 5. GPS-Punkt als Marker
{sortedPoints.filter((_, i) => i % 5 === 0).map((point, i) => (
  <Marker key={i} position={[point.latitude, point.longitude]} />
))}
```

### 7.2 Memo & UseMemo
```tsx
const sortedPoints = useMemo(() => {
  return [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);
}, [gpsPoints]);

const stationaryPeriods = useMemo(() => {
  return detectStationaryPeriods(sortedPoints);
}, [sortedPoints]);
```

### 7.3 RequestAnimationFrame statt setInterval
```tsx
// ❌ Schlecht: setInterval
setInterval(() => setCurrentIndex(i => i + 1), 100);

// ✅ Gut: requestAnimationFrame
const animate = () => {
  // ... update logic
  animationRef.current = requestAnimationFrame(animate);
};
animationRef.current = requestAnimationFrame(animate);
```

---

## 8. Zusammenfassung: Implementierungs-Checkliste

### Frontend
- [ ] User-Tabelle mit "Route"-Button
- [ ] Click-Handler `handleShowRoute(userId, username)`
- [ ] API-Call `fetchRouteData()` mit Loading-State
- [ ] Fullscreen Modal mit Header (Username, Datum, Close-Button)
- [ ] GPS-Quellen-Filter (Native, FollowMee, External)
- [ ] RouteReplayMap Component mit Props
- [ ] Background-Lock (`document.body.style.overflow = 'hidden'`)

### Backend
- [ ] API-Route: `GET /api/admin/dashboard/route`
- [ ] Query-Parameter: `userId`, `date`, `source`
- [ ] Auth-Middleware: `requireAuth`, `requireAdmin`
- [ ] Live-Daten aus RAM (`dailyDataStore`)
- [ ] Historische Daten aus Google Sheets (`scrapeDayData`)
- [ ] Externe Daten aus Tracking-Service
- [ ] Source-Filter & Sortierung
- [ ] Response: `{ username, gpsPoints, photoTimestamps, totalPoints }`

### RouteReplayMap Component
- [ ] Leaflet MapContainer mit TileLayer
- [ ] Full Route Polyline (grau gestrichelt)
- [ ] Animated Route Polyline (blau)
- [ ] Start/End Marker (grün "S", rot "E")
- [ ] Current Position Marker (animiert, blau)
- [ ] GPS-Punkt Marker (farbcodiert, jeder 5.)
- [ ] Foto-Blitz Marker (⚡)
- [ ] Play/Pause/Reset Controls
- [ ] Timeline Scrubber (Range Slider)
- [ ] Animation Loop (requestAnimationFrame)
- [ ] Intelligente Kamera-Verfolgung (30% Threshold)
- [ ] Info-Panels (Statistik & Pausen)
- [ ] Distanz-Berechnung (Haversine)
- [ ] Foto-Position Interpolation
- [ ] Pausen-Erkennung (≥20 Min)

---

## 9. Beispiel-Flow (End-to-End)

1. **User klickt auf "Route"-Button**
   ```tsx
   <button onClick={() => handleShowRoute('user123', 'Max Mustermann')}>
     Route
   </button>
   ```

2. **State wird gesetzt**
   ```tsx
   setSelectedUserId('user123');
   setSelectedUsername('Max Mustermann');
   setShowRouteReplay(true);
   ```

3. **API-Call wird ausgelöst**
   ```tsx
   fetchRouteData('user123', '2025-11-07', 'all');
   ```

4. **Server lädt GPS-Daten**
   ```typescript
   // Live: dailyDataStore.getUserDailyData('user123')
   // Historisch: scrapeDayData('2025-11-07', 'user123')
   ```

5. **Response wird zurückgegeben**
   ```json
   {
     "username": "Max Mustermann",
     "gpsPoints": [
       { "latitude": 51.165, "longitude": 10.451, "accuracy": 15, "timestamp": 1699344000000, "source": "native" },
       ...
     ],
     "photoTimestamps": [1699344300000, 1699345200000],
     "totalPoints": 152
   }
   ```

6. **Modal öffnet sich mit Karte**
   ```tsx
   <div className="fixed top-0 left-0 right-0 bottom-0 z-[9999]">
     <RouteReplayMap
       username="Max Mustermann"
       gpsPoints={routeData.gpsPoints}
       photoTimestamps={routeData.photoTimestamps}
       date="2025-11-07"
     />
   </div>
   ```

7. **Karte rendert mit allen Elementen**
   - Leaflet Map mit OpenStreetMap-Tiles
   - Grau gestrichelte Gesamt-Route
   - Start/End Marker
   - Animation-Controls
   - Info-Panels

8. **User klickt "Play"**
   ```tsx
   startAnimation() → setIsPlaying(true)
   ```

9. **Animation startet**
   ```tsx
   useEffect(() => {
     const animate = () => {
       const progress = elapsed / ANIMATION_DURATION;
       const newIndex = startIndex + floor(progress * remainingPoints);
       setCurrentIndex(newIndex);
       animationRef.current = requestAnimationFrame(animate);
     };
     animationRef.current = requestAnimationFrame(animate);
   }, [isPlaying]);
   ```

10. **Blaue Route wächst, Marker bewegt sich, Kamera folgt**

11. **User kann scrubben, pausieren, resetten**

12. **Close Button schließt Modal**
    ```tsx
    onClick={() => setShowRouteReplay(false)}
    ```

---

## 10. Wichtige Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-leaflet": "^4.2.1",
    "leaflet": "^1.9.4",
    "date-fns": "^2.30.0",
    "lucide-react": "^0.263.1"
  }
}
```

**CSS-Import (wichtig!):**
```tsx
import 'leaflet/dist/leaflet.css';
```

---

## 11. Typendefinitionen

```typescript
// GPS-Punkt
interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number; // Unix-Timestamp in ms
  source?: 'native' | 'followmee' | 'external';
}

// Route-Daten
interface RouteData {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps: number[];
  totalPoints: number;
}

// Pause/Stationäre Periode
interface StationaryPeriod {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  centerLat: number;
  centerLng: number;
}

// Component Props
interface RouteReplayMapProps {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps?: number[];
  date: string;
}
```

---

## 12. Troubleshooting

### Problem: Karte wird nicht angezeigt
- **Lösung**: CSS importieren: `import 'leaflet/dist/leaflet.css'`

### Problem: Marker werden nicht angezeigt
- **Lösung**: Custom `divIcon` verwenden (siehe 4.5)

### Problem: Animation ruckelt
- **Lösung**: `requestAnimationFrame` statt `setInterval` verwenden

### Problem: Kamera folgt nicht
- **Lösung**: Edge-Threshold prüfen (30%) und `panTo()` nutzen

### Problem: Foto-Positionen fehlen
- **Lösung**: Interpolation implementieren (siehe 4.6)

### Problem: GPS-Punkte unsortiert
- **Lösung**: Immer nach `timestamp` sortieren:
  ```tsx
  const sorted = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);
  ```

---

**Diese Dokumentation enthält alle technischen Details, um die Route-Anzeige in einem anderen Projekt nachzubauen!** 🚀
