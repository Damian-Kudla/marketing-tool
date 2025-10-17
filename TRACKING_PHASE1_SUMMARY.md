# Mitarbeiter-Tracking & Admin-Dashboard - Implementierungsfortschritt

## ✅ Phase 1: Tracking-Infrastructure (ABGESCHLOSSEN)

### Client-Side Tracking Services

#### 1. GPS Tracking (`client/src/services/gpsTracking.ts`)
- ✅ Watchposition API für kontinuierliches GPS-Tracking
- ✅ 30-Sekunden-Intervall für Backend-Übermittlung
- ✅ WakeLock API für Background-Tracking (iOS/Safari)
- ✅ High-Accuracy-Modus für Außendienst
- ✅ Automatische Error-Handling bei Permission-Denied
- ✅ Letzte Position im Speicher für sofortigen Zugriff

**Features:**
- Sendet GPS-Koordinaten alle 30 Sekunden ans Backend
- Funktioniert auch wenn App im Hintergrund (Wake Lock)
- Accuracy, Altitude, Speed, Heading werden mitgeloggt
- Automatischer Retry bei Netzwerkfehlern

#### 2. Session Tracking (`client/src/services/sessionTracking.ts`)
- ✅ **Idle Detection API** (Chrome/Edge) für präzise Inaktivitätserkennung
- ✅ Fallback: Manuelle Idle Detection über Activity Events
- ✅ 1-Minute Idle-Threshold (konfigurierbar)
- ✅ Activity Listeners: Mouse, Keyboard, Scroll, Touch
- ✅ Visibility Change Detection (Tab-Wechsel, Minimize)
- ✅ Action Logging mit Typen:
  - `scan` - Foto aufgenommen
  - `edit` - Daten bearbeitet
  - `save` - Gespeichert
  - `delete` - Gelöscht
  - `status_change` - **Wichtigste Metrik!** Status zugewiesen
  - `navigate` - Navigation
- ✅ Automatischer Sync alle 30 Sekunden
- ✅ Buffer für max. 100 Actions (dann sofortiger Sync)

**Tracking-Metriken:**
- Session-Start und -Dauer
- Aktive Zeit vs. Idle Zeit
- Anzahl Page Views
- Alle User-Actions mit Timestamps
- Status-Zuweisungen an Anwohner

#### 3. Device Tracking (`client/src/services/deviceTracking.ts`)
- ✅ Battery Status API (Level + Charging-Status)
- ✅ Network Information API (4G/3G/WiFi/Offline)
- ✅ Screen Orientation
- ✅ Memory Usage (Chrome)
- ✅ Automatischer Sync alle 30 Sekunden
- ✅ Event Listener für Battery-Änderungen

**Device-Metriken:**
- Battery Level (%)
- Is Charging (boolean)
- Connection Type (wifi/4g/3g/offline)
- Effective Type (slow-2g/2g/3g/4g)
- Screen Orientation
- Memory Usage (%)

#### 4. Tracking Manager (`client/src/services/trackingManager.ts`)
- ✅ Zentrale Koordination aller Tracking-Services
- ✅ `initialize(userId, username)` - Start beim Login
- ✅ `shutdown()` - Stop beim Logout
- ✅ `logAction()` - Convenience-Methode für Action-Logging
- ✅ `getStatus()` - Debug-Info über alle Services

**Integration:**
```typescript
// Bei Login:
await trackingManager.initialize(userId, username);

// Bei Logout:
await trackingManager.shutdown();

// Actions loggen:
trackingManager.logAction('status_change', 'Resident 123', 'interessiert');
```

### Backend Tracking Infrastructure

#### 5. TypeScript Types (`shared/trackingTypes.ts`)
- ✅ `GPSCoordinates` - GPS-Daten mit Accuracy
- ✅ `SessionData` - Session-Informationen
- ✅ `ActionLog` - User-Actions mit Types
- ✅ `DeviceStatus` - Gerätestatus
- ✅ `TrackingData` - Kombination aller Daten
- ✅ `DailyUserData` - Aggregierte Tagesdaten
- ✅ `UserReport` - Report-Daten für PDF
- ✅ `DashboardLiveData` - Live-Dashboard-Daten

#### 6. Daily Data Store (`server/services/dailyDataStore.ts`)
- ✅ In-Memory Map<userId, DailyUserData>
- ✅ **Automatischer Reset um Mitternacht**
- ✅ GPS-Distanz-Berechnung (Haversine-Formel)
- ✅ Unique Addresses Tracking
- ✅ Action-Counting nach Typ
- ✅ Status-Changes Tracking (**wichtigste KPI**)
- ✅ Battery & Offline Event Tracking
- ✅ KPI-Berechnung:
  - Scans pro Stunde
  - Durchschnittliche Zeit pro Adresse
  - Conversion Rate (Interessiert / Gesamt)
  - **Activity Score (0-100)**

**Activity Score Algorithmus:**
```
Max 100 Punkte:
- Aktive Zeit (30 Punkte): 6+ Stunden = volle Punkte
- Actions (25 Punkte): 50+ Actions = volle Punkte
- Status-Änderungen (30 Punkte): 30+ = volle Punkte ⭐ WICHTIGSTE METRIK
- Distanz (10 Punkte): 10+ km = volle Punkte
- Strafen:
  * Idle > 50%: bis zu -5 Punkte
  * Offline Events: -0.5 pro Event (max -5)
```

**Memory Management:**
- Midnight-Reset-Timer scheduled automatisch
- Store-Size-Monitoring (Users, Total Logs, Memory Estimate)
- Cleanup on shutdown
- Max. ~10 MB für 20 User/Tag

#### 7. Tracking API Routes (`server/routes/tracking.ts`)
- ✅ `POST /api/tracking/gps` - GPS-Koordinaten empfangen
- ✅ `POST /api/tracking/session` - Session-Daten empfangen
- ✅ `POST /api/tracking/device` - Device-Status empfangen
- ✅ `GET /api/tracking/status` - Debug-Status abrufen
- ✅ Authentication required (requireAuth middleware)
- ✅ Speichert in dailyDataStore (RAM)
- ✅ Loggt zu Google Sheets via enhancedLogging (Batch + Fallback)
- ✅ Recalculates KPIs nach jedem Update

**Integriert in:** `server/routes.ts`
```typescript
app.use("/api/tracking", requireAuth, trackingRouter);
```

### Admin-Authentifizierung

#### 8. Google Sheets Service Erweiterung
- ✅ `isUserAdmin(password)` - Liest Spalte D aus Zugangsdaten-Sheet
- ✅ Sheet-ID: `1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s`
- ✅ Spalte D: "admin" = Admin-Rolle, leer = Regular User
- ✅ Case-insensitive Check

#### 9. Auth Middleware Erweiterung (`server/middleware/auth.ts`)
- ✅ `isAdmin` Flag in Session-Token
- ✅ `AuthenticatedRequest.isAdmin` Interface-Erweiterung
- ✅ `generateSessionToken()` akzeptiert isAdmin-Parameter
- ✅ `validateSessionToken()` gibt isAdmin zurück
- ✅ **NEU:** `requireAdmin` Middleware für Admin-Only-Routes

#### 10. Login Route Anpassung (`server/routes/auth.ts`)
- ✅ Prüft `isUserAdmin()` bei jedem Login
- ✅ Setzt `isAdmin` im Session-Token
- ✅ Response enthält `isAdmin: boolean`
- ✅ `/auth/check` gibt `isAdmin` zurück

### Integration & Routes

- ✅ Tracking-Routes in `server/routes.ts` registriert
- ✅ AuthenticatedRequest in tracking.ts verwendet
- ✅ requireAuth Middleware auf alle Tracking-Endpunkte
- ✅ TypeScript kompiliert ohne Fehler ✨

## 📋 Phase 2: PDF-Report-Generator (AUSSTEHEND)

### Was fehlt noch:

**Datei:** `server/services/reportGenerator.ts`

**Dependencies:**
```bash
npm install pdfkit @types/pdfkit
npm install pdfkit-table
```

**Features:**
- Titelseite mit User-Ranking (niedrigster Score zuerst!)
- User-Detail-Seiten mit allen KPIs
- Klickbare Hyperlinks zwischen Seiten
- Status-Changes-Breakdown
- Zeitstrahl (erste/letzte Aktivität, Peak Hours)
- Gerätestatus-Zusammenfassung
- PDF-Speicherung in `/reports` Ordner

**Cron-Job:**
- Täglich um 20:00 Uhr
- Nur User mit min. 10 Log-Einträgen
- Scheduled in `cronJobService.ts`

## 📋 Phase 3: Admin-Dashboard Backend (AUSSTEHEND)

**Datei:** `server/routes/admin.ts`

**Endpoints:**
- `GET /api/admin/dashboard/live` - Live-Daten aus RAM
- `GET /api/admin/dashboard/historical?date=YYYY-MM-DD` - Historische Daten aus Sheets
- `GET /api/admin/reports/:date` - Report-Info
- `GET /api/admin/reports/:date/download` - PDF-Download

**Datei:** `server/services/historicalDataScraper.ts`
- Scraped Logs aus Google Sheets für vergangene Tage
- Rekonstruiert DailyUserData
- Löscht aus RAM nach Response

## 📋 Phase 4: Admin-Dashboard Frontend (AUSSTEHEND)

**Route:** `/admin/dashboard`
**Komponente:** `client/src/pages/admin-dashboard.tsx`

**Dependencies:**
```bash
npm install leaflet react-leaflet @types/leaflet
npm install recharts date-fns
```

**Features:**
- Live-Karte mit Leaflet (User-Marker nach Score eingefärbt)
- KPI-Summary-Cards
- User-Vergleich-Tabelle (sortierbar, filterbar)
- Status-Changes-Chart (Stacked Bar)
- Historischer Modus mit Date-Picker
- Report-Download-Button
- **Nicht in PWA gecacht** (Service Worker Exclusion)
- **Lazy-loaded** (React.lazy)

## 📝 Nächste Schritte für Sie

### 1. Tracking aktivieren (nach lokalem Test):

**In `client/src/contexts/AuthContext.tsx`:**
```typescript
import { trackingManager } from '../services/trackingManager';

const login = async (password: string) => {
  const response = await api.login(password);
  
  if (response.success) {
    setUser({
      id: response.userId,
      username: response.username,
      isAdmin: response.isAdmin
    });
    
    // Tracking NUR für non-admin users
    if (!response.isAdmin) {
      await trackingManager.initialize(response.userId, response.username);
    }
  }
};

const logout = async () => {
  await trackingManager.shutdown();
  await api.logout();
  setUser(null);
};
```

### 2. Action-Logging in Komponenten:

**In `client/src/components/ResultsDisplay.tsx`:**
```typescript
import { trackingManager } from '../services/trackingManager';

const handleStatusChange = (residentId: string, status: string) => {
  // ... existing logic
  trackingManager.logAction('status_change', `Resident ${residentId}`, status);
};
```

**In `client/src/components/PhotoCapture.tsx`:**
```typescript
const handleScan = async () => {
  // ... existing logic
  trackingManager.logAction('scan', 'Photo captured');
};
```

### 3. Lokales Testing:

```bash
# 1. Server starten
npm run dev

# 2. Als Regular User einloggen (ohne "admin" in Spalte D)
# 3. Browser DevTools öffnen
# 4. Console-Logs überprüfen:
#    [GPS] GPS tracking started
#    [Session] Session started for user: ...
#    [Device] Device status tracking started
# 5. Nach 30 Sekunden sollten Tracking-Daten gesendet werden

# 6. Tracking-Status abrufen:
curl -b cookies.txt http://localhost:5000/api/tracking/status

# Response sollte zeigen:
# {
#   "store": { "users": 1, "totalLogs": 3, "memoryEstimate": "0.00 MB" },
#   "user": { "totalActions": 0, "totalDistance": 0, "activityScore": 0, ... }
# }
```

### 4. Admin-Zugriff testen:

```bash
# 1. In Google Sheets (1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s)
#    Spalte D für Admin-User auf "admin" setzen

# 2. Als Admin einloggen

# 3. Response prüfen:
# { "success": true, "isAdmin": true, ... }

# 4. Auth-Check:
curl -b cookies.txt http://localhost:5000/api/auth/check
# Response: { "authenticated": true, "isAdmin": true, ... }
```

## 📊 Implementierte Files (Phase 1)

### Client-Side (5 Files):
1. `client/src/services/gpsTracking.ts` (175 Zeilen)
2. `client/src/services/sessionTracking.ts` (301 Zeilen)
3. `client/src/services/deviceTracking.ts` (168 Zeilen)
4. `client/src/services/trackingManager.ts` (109 Zeilen)
5. `shared/trackingTypes.ts` (135 Zeilen)

### Backend (4 Files):
6. `server/services/dailyDataStore.ts` (370 Zeilen)
7. `server/routes/tracking.ts` (140 Zeilen)
8. `server/services/googleSheets.ts` - erweitert (+35 Zeilen)
9. `server/middleware/auth.ts` - erweitert (+38 Zeilen)
10. `server/routes/auth.ts` - erweitert (+3 Zeilen)
11. `server/routes.ts` - erweitert (+2 Zeilen)

### Dokumentation (2 Files):
12. `TRACKING_IMPLEMENTATION_ROADMAP.md` (750+ Zeilen)
13. `TRACKING_PHASE1_SUMMARY.md` (diese Datei)

**Gesamt:** ~1.800 Zeilen neuer Code + ~80 Zeilen Anpassungen

## ✅ Erfolgskriterien Phase 1:

- ✅ GPS-Tracking alle 30 Sekunden
- ✅ Idle Detection für präzise Session-Dauer
- ✅ Device-Status-Tracking
- ✅ RAM-basierte Tages-Speicherung
- ✅ Automatischer Midnight-Reset
- ✅ Activity-Score-Algorithmus (0-100)
- ✅ Admin-Authentifizierung über Spalte D
- ✅ Tracking-API-Endpunkte
- ✅ Integration in bestehende Auth
- ✅ TypeScript-Kompilierung ohne Fehler
- ✅ Kein Git-Push (wie gewünscht)

## 🎯 KPIs die getrackt werden:

### Pro User & Tag:
1. **GPS-Daten:**
   - Alle GPS-Punkte mit Timestamp
   - Gesamtdistanz (Haversine-Formel)
   - Eindeutige Adressen

2. **Session-Daten:**
   - Gesamtsitzungszeit
   - Aktive Zeit (ohne Idle)
   - Idle Zeit
   - Anzahl Page Views
   - Session Count

3. **Actions:**
   - Gesamt Actions
   - Actions nach Typ (scan, edit, save, delete, status_change, navigate)
   - **Status-Zuweisungen nach Kategorie** (interessiert, nicht_interessiert, nicht_angetroffen, termin_vereinbart)

4. **Device-Status:**
   - Durchschnittlicher Battery-Level
   - Low Battery Events (< 20%)
   - Offline Events

5. **Berechnete KPIs:**
   - Scans pro Stunde
   - Ø Zeit pro Adresse
   - Conversion Rate (Interessiert / Gesamt)
   - **Activity Score (0-100)**

## 💡 Besonderheiten der Implementierung:

### Datenschutz & Performance:
- ✅ **iPads werden nicht belastet**: Admin-Dashboard kommt in Phase 4 als Lazy-Load, nicht in PWA gecacht
- ✅ **RAM ist kein Problem**: 20 User × ~500 KB/Tag = max. 10 MB
- ✅ **Automatischer Midnight-Reset**: Kein manuelles Cleanup nötig
- ✅ **Batch-Logging zu Google Sheets**: Via enhancedLogging (bereits implementiert)
- ✅ **Tracking nur für Regular Users**: Admins werden nicht getrackt

### Intelligente Datenübermittlung:
- ✅ GPS/Device/Session alle 30 Sekunden
- ✅ Actions werden gebuffert (max. 100)
- ✅ Batch-Write zu Google Sheets alle 15 Sekunden (enhancedLogging)
- ✅ Fallback bei Netzwerkfehlern (enhancedLogging)
- ✅ Retry mit exponentieller Verzögerung (enhancedLogging)

### Activity Score Gewichtung:
- ✅ **Status-Änderungen: 30%** (wichtigste Metrik!)
- ✅ Aktive Zeit: 30%
- ✅ Actions: 25%
- ✅ Distanz: 10%
- ✅ Strafen für Idle & Offline: bis -10%

## 🚀 Ready für Phase 2:

Die komplette Tracking-Infrastructure ist implementiert und funktionsbereit. Sie können jetzt:

1. **Lokal testen** (siehe "Lokales Testing" oben)
2. **Tracking aktivieren** (siehe "Tracking aktivieren" oben)
3. **Monitoring**: `GET /api/tracking/status` zeigt Store-Status
4. **Weiterentwicklung**: Phase 2 (PDF-Reports) & Phase 3 (Admin-Dashboard)

## 📞 Support

Bei Fragen zur Implementierung siehe:
- `TRACKING_IMPLEMENTATION_ROADMAP.md` - Detaillierte Roadmap für Phase 2-5
- Console-Logs im Browser - Alle Tracking-Services loggen ausführlich
- TypeScript-Typen in `shared/trackingTypes.ts` - Vollständige Typdefinitionen

**Viel Erfolg beim Testing! 🎉**
