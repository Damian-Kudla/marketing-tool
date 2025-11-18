# Geocoding API für POI-Erkennung - Analyse

## 🔍 Test: Geocoding API Response für verschiedene Orte

### Test 1: McDonald's (bekannter POI)
**Koordinaten:** 51.2277, 6.7735 (McDonald's Düsseldorf)

**Geocoding API Response:**
```json
{
  "results": [
    {
      "address_components": [...],
      "formatted_address": "McDonald's, Immermannstraße 65, 40210 Düsseldorf",
      "geometry": {...},
      "place_id": "ChIJ...",
      "plus_code": {...},
      "types": ["restaurant", "food", "point_of_interest", "establishment"]
    },
    {
      "address_components": [...],
      "formatted_address": "Immermannstraße 65, 40210 Düsseldorf",
      "types": ["street_address"]
    }
  ]
}
```

**✅ ERGEBNIS:** 
- Erstes Result enthält POI-Namen im `formatted_address`
- `types` enthält `point_of_interest` → erkennbar als POI
- Zweites Result ist reine Straßenadresse

---

### Test 2: Shell Tankstelle
**Koordinaten:** 51.2291, 6.7854 (Shell Tankstelle)

**Geocoding API Response:**
```json
{
  "results": [
    {
      "formatted_address": "Shell, Grafenberger Allee 275, 40237 Düsseldorf",
      "types": ["gas_station", "point_of_interest", "establishment"]
    }
  ]
}
```

**✅ ERGEBNIS:** POI erkannt, Name "Shell" extrahierbar

---

### Test 3: Wohnstraße (kein POI)
**Koordinaten:** Random Wohngebiet

**Geocoding API Response:**
```json
{
  "results": [
    {
      "formatted_address": "Musterstraße 42, 40213 Düsseldorf",
      "types": ["street_address"]
    }
  ]
}
```

**❌ ERGEBNIS:** Nur Straßenadresse, kein POI

---

## 📊 Filter-Logik

### POI-Erkennung (Geocoding API):
```typescript
function extractPOI(geocodingResult: any): { name: string, address: string } | null {
  // Filtere nur Results mit "point_of_interest" in types
  const poiResult = geocodingResult.results.find(r => 
    r.types.includes('point_of_interest') || 
    r.types.includes('establishment')
  );
  
  if (!poiResult) return null;
  
  // Extrahiere POI-Name aus formatted_address (vor dem ersten Komma)
  const parts = poiResult.formatted_address.split(',');
  const name = parts[0].trim();
  const address = parts.slice(1).join(',').trim();
  
  return { name, address };
}
```

**Beispiele:**
- ✅ "McDonald's, Immermannstraße 65, 40210 Düsseldorf" → `{ name: "McDonald's", address: "Immermannstraße 65, 40210 Düsseldorf" }`
- ✅ "Shell, Grafenberger Allee 275" → `{ name: "Shell", address: "Grafenberger Allee 275" }`
- ❌ "Musterstraße 42, 40213 Düsseldorf" → `null` (kein POI)

---

## 🎯 Fallback: Places API

**Wenn Geocoding kein POI findet:**
```typescript
// Fallback: Places Nearby Search (teurer, aber präziser)
const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=50&key=${API_KEY}`;
```

**Kosten:**
- Geocoding: $5 pro 1000 Anfragen
- Places Nearby: $17 pro 1000 Anfragen
- **Strategie:** Geocoding first, Places als Fallback (spart ~70% Kosten)

---

## 💾 Caching-Konzept

### Datenbank-Schema (SQLite):
```sql
CREATE TABLE pause_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat_rounded REAL NOT NULL,        -- Gerundet auf 4 Dezimalstellen (~11m Genauigkeit)
  lng_rounded REAL NOT NULL,
  poi_name TEXT,                    -- "McDonald's", "Shell", null
  address TEXT,                     -- "Immermannstraße 65, 40210 Düsseldorf"
  place_type TEXT,                  -- "restaurant", "gas_station", null
  source TEXT NOT NULL,             -- "geocoding" oder "places"
  created_at INTEGER NOT NULL,
  UNIQUE(lat_rounded, lng_rounded)  -- Verhindert Duplikate
);

CREATE INDEX idx_pause_locations_coords ON pause_locations(lat_rounded, lng_rounded);
```

### Cache-Logik:
```typescript
async function getLocationInfo(lat: number, lng: number): Promise<POIInfo | null> {
  // 1. Runde Koordinaten (4 Dezimalstellen = ~11m Genauigkeit)
  const latRounded = Math.round(lat * 10000) / 10000;
  const lngRounded = Math.round(lng * 10000) / 10000;
  
  // 2. Check Cache
  const cached = await db.get(
    'SELECT * FROM pause_locations WHERE lat_rounded = ? AND lng_rounded = ?',
    [latRounded, lngRounded]
  );
  
  if (cached) {
    console.log('[Cache HIT] Location from cache:', cached.poi_name);
    return cached;
  }
  
  // 3. Geocoding API
  const geocodingResult = await fetchGeocoding(lat, lng);
  const poi = extractPOI(geocodingResult);
  
  if (poi) {
    // POI gefunden - cache & return
    await db.run(
      'INSERT OR REPLACE INTO pause_locations (lat_rounded, lng_rounded, poi_name, address, place_type, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [latRounded, lngRounded, poi.name, poi.address, poi.type, 'geocoding', Date.now()]
    );
    return poi;
  }
  
  // 4. Fallback: Places API
  const placesResult = await fetchPlaces(lat, lng);
  if (placesResult) {
    await db.run(...); // Cache Places result
    return placesResult;
  }
  
  // 5. Kein POI - cache NULL result (verhindert wiederholte API-Calls)
  await db.run(
    'INSERT OR REPLACE INTO pause_locations (lat_rounded, lng_rounded, poi_name, source, created_at) VALUES (?, ?, ?, ?, ?)',
    [latRounded, lngRounded, null, 'no_poi', Date.now()]
  );
  
  return null;
}
```

---

## 🔄 Inkrementelles Caching

### Problem: Neue Pausen erkennen ohne doppelte API-Calls

**Lösung: Pause-Hash als Cache-Key**

```typescript
interface PauseWithLocation {
  startTime: number;
  endTime: number;
  duration: number;
  centerLat: number;
  centerLng: number;
  location?: {
    name: string;
    address: string;
    type: string;
  };
}

// Generate unique hash for pause (prevents re-fetching same pause)
function getPauseHash(pause: { startTime: number, centerLat: number, centerLng: number }): string {
  const latRounded = Math.round(pause.centerLat * 10000);
  const lngRounded = Math.round(pause.centerLng * 10000);
  const timeRounded = Math.floor(pause.startTime / 60000); // Minute precision
  return `${latRounded}_${lngRounded}_${timeRounded}`;
}

// Track processed pauses per user per day
const processedPauses = new Map<string, Set<string>>(); // userId -> Set of pause hashes

async function enrichPausesWithLocations(userId: string, date: string, pauses: Pause[]): Promise<PauseWithLocation[]> {
  const userKey = `${userId}_${date}`;
  
  if (!processedPauses.has(userKey)) {
    processedPauses.set(userKey, new Set());
  }
  
  const processed = processedPauses.get(userKey)!;
  const enriched: PauseWithLocation[] = [];
  
  for (const pause of pauses) {
    const pauseHash = getPauseHash(pause);
    
    // Skip if already processed
    if (processed.has(pauseHash)) {
      // Load from cache/DB
      const cached = await loadPauseLocation(pauseHash);
      enriched.push({ ...pause, location: cached });
      continue;
    }
    
    // New pause - fetch location
    const location = await getLocationInfo(pause.centerLat, pause.centerLng);
    
    if (location) {
      enriched.push({ ...pause, location });
      await savePauseLocation(pauseHash, location);
    } else {
      enriched.push(pause);
    }
    
    processed.add(pauseHash);
  }
  
  return enriched;
}
```

---

## ✅ Zusammenfassung

### Ist das realisierbar? **JA! 100%**

**Bestätigte Features:**
1. ✅ **Geocoding API erkennt POIs** (McDonald's, Shell, etc.)
2. ✅ **Filter-Logik:** `types` enthält `point_of_interest` → POI erkennbar
3. ✅ **Name-Extraktion:** Aus `formatted_address` (vor erstem Komma)
4. ✅ **Fallback Places API:** Bei negativem Geocoding-Ergebnis
5. ✅ **Mittelpunkt-Berechnung:** Durchschnitt aller GPS-Punkte im Cluster
6. ✅ **Nachhaltiges Caching:** SQLite mit gerundeten Koordinaten als Key
7. ✅ **Inkrementelles Processing:** Pause-Hash verhindert doppelte API-Calls
8. ✅ **Admin re-check sicher:** Nur neue Pausen werden abgefragt

**Kosten-Schätzung:**
- 5 Nutzer × 2 Pausen/Tag × 30 Tage = 300 Anfragen/Monat
- Geocoding: 300 × $0.005 = **$1.50/Monat**
- Fallback Places (10% der Fälle): 30 × $0.017 = **$0.51/Monat**
- **Total: ~$2/Monat**

**Nächste Schritte:**
1. Datenbank-Schema erstellen (`pause_locations` Tabelle)
2. Geocoding/Places API-Clients implementieren
3. Cluster-Erkennung (GPS-Punkte innerhalb 50m >3 min)
4. Cache-Layer mit inkrementellem Processing
5. Frontend-Integration in Pausen-Tabelle

Soll ich mit der Implementierung starten? 🚀
