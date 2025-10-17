# Tracking & Admin Dashboard - Implementierungs-Roadmap

## ✅ Abgeschlossen (Phase 1)

### Client-Side Tracking Services
- ✅ `client/src/services/gpsTracking.ts` - GPS alle 30s, Background mit WakeLock
- ✅ `client/src/services/sessionTracking.ts` - Idle Detection, Action Logging
- ✅ `client/src/services/deviceTracking.ts` - Battery, Network, Orientation
- ✅ `client/src/services/trackingManager.ts` - Zentraler Koordinator

### Backend Tracking Infrastructure  
- ✅ `shared/trackingTypes.ts` - Alle TypeScript-Typen
- ✅ `server/services/dailyDataStore.ts` - RAM-basierte Speicherung, Reset um 0 Uhr, Activity Score Algorithmus
- ✅ `server/routes/tracking.ts` - POST /gps, /session, /device APIs
- ✅ Admin-Authentifizierung: Spalte D aus Google Sheets, isAdmin in JWT

## 🚧 In Arbeit (Phase 2)

### PDF-Report-Generator
**Datei:** `server/services/reportGenerator.ts`

**Dependencies installieren:**
```bash
npm install pdfkit @types/pdfkit
npm install pdfkit-table  # für Tabellen
```

**Funktionen:**
1. `generateDailyReport(date: string)` - Hauptfunktion
   - Holt DailyUserData für alle User mit min. 10 logs
   - Sortiert nach Activity Score (niedrigste zuerst!)
   - Erstellt PDF mit PDFKit

2. Seite 1: Titelseite mit Ranking-Tabelle
   - Header: "Tagesbericht - [Datum]"
   - Tabelle: Rank, Username, Activity Score, Actions, Status Changes
   - Klickbare Links zu User-Seiten (#user-[userId])

3. Seiten 2-N: User-Detail-Seiten
   - Anchor: #user-[userId]
   - Header mit Username + Zurück-Link (#page-1)
   - KPI-Grid:
     * Activity Score (groß, hervorgehoben)
     * Gesamtdistanz (km)
     * Eindeutige Adressen
     * Aktive Zeit / Idle Zeit
     * Gesamt Actions
     * Scans pro Stunde
     * Conversion Rate
   - Status Changes Breakdown:
     * Interessiert: X
     * Nicht interessiert: Y
     * Nicht angetroffen: Z
     * Termin vereinbart: W
   - Zeitstrahl:
     * Erste Aktivität: HH:MM
     * Letzte Aktivität: HH:MM
     * Peak Hours: [9-10, 14-15]
   - Gerätestatus:
     * Ø Batterie: 75%
     * Low Battery Events: 2
     * Offline Events: 0

4. PDF speichern in: `reports/daily-report-[YYYY-MM-DD].pdf`

**Cron-Job:**
```typescript
// In server/services/cronJobService.ts hinzufügen
import { generateDailyReport } from './reportGenerator';

// Jeden Tag um 20:00 Uhr
scheduleDailyReport() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  
  const msUntilTarget = target.getTime() - now.getTime();
  
  setTimeout(() => {
    generateDailyReport(getCurrentDate());
    // Schedule next day
    setInterval(() => {
      generateDailyReport(getCurrentDate());
    }, 24 * 60 * 60 * 1000);
  }, msUntilTarget);
}
```

## 📋 Ausstehend (Phase 3)

### Admin-Dashboard Backend API
**Datei:** `server/routes/admin.ts`

**Middleware:** `requireAdmin` aus auth.ts

**Endpoints:**

1. `GET /api/admin/dashboard/live`
   - Response: DashboardLiveData
   - Holt alle DailyUserData aus RAM
   - Inkl. aktuelle GPS-Position (letzter Punkt)
   - isActive = lastActivity < 5 Minuten
   ```typescript
   {
     timestamp: 1234567890,
     users: [{
       userId: "abc123",
       username: "Max Mustermann",
       currentLocation: { lat: 52.52, lng: 13.40, ... },
       isActive: true,
       lastSeen: 1234567800,
       todayStats: {
         activityScore: 85,
         totalActions: 45,
         statusChanges: { interessiert: 12, ... },
         activeTime: 21600000, // ms
         distance: 8500 // meters
       }
     }]
   }
   ```

2. `GET /api/admin/dashboard/historical?date=YYYY-MM-DD&userId=X` (optional userId)
   - Scraped Daten aus Google Sheets
   - Parse alle Logs für den Tag
   - Rekonstruiert DailyUserData
   - Löscht aus RAM nach Response

3. `GET /api/admin/reports/:date`
   - Listet PDF-Report für Datum
   - Wenn nicht existiert: generiert on-demand
   - Response: PDF-Datei oder {available: false}

4. `GET /api/admin/reports/:date/download`
   - Download PDF-Report
   - Content-Type: application/pdf
   - Content-Disposition: attachment

### Google Sheets Historical Scraping
**Datei:** `server/services/historicalDataScraper.ts`

**Funktion:**
```typescript
async scrapeDayData(date: string, userId?: string): Promise<DailyUserData[]> {
  // 1. Alle User-Worksheets finden (oder nur eines bei userId filter)
  // 2. Datum-Filter: Logs von 00:00 bis 23:59
  // 3. Parse GPS, Session, Device logs
  // 4. Rekonstruiere DailyUserData
  // 5. Calc KPIs mit dailyDataStore.calculateKPIs()
  // 6. Return Array
}
```

## 📋 Ausstehend (Phase 4)

### Frontend: Admin-Dashboard UI

**Route:** `/admin/dashboard`
**Komponente:** `client/src/pages/admin-dashboard.tsx`

**Requirements:**
- Nur für isAdmin=true sichtbar
- NICHT in PWA-Cache (service worker exclude pattern)
- Lazy-loaded (React.lazy)

**Dependencies:**
```bash
npm install leaflet react-leaflet @types/leaflet
npm install recharts date-fns
```

**Layout:**

```
┌────────────────────────────────────────────────┐
│ Header: Admin Dashboard | User: X | Logout    │
├────────────────────────────────────────────────┤
│ [Live] [Historisch: YYYY-MM-DD] [Report DL]   │
├────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌───────────────────┐ │
│ │                     │ │ KPI Summary       │ │
│ │                     │ │                   │ │
│ │   Live Map          │ │ Active Users: 12  │ │
│ │   (Leaflet)         │ │ Avg Score: 78     │ │
│ │   - User Markers    │ │ Total Actions: 342│ │
│ │   - Color by Score  │ │ Total Distance    │ │
│ │                     │ │                   │ │
│ └─────────────────────┘ └───────────────────┘ │
├────────────────────────────────────────────────┤
│ User List & Comparison                         │
│ ┌────────────────────────────────────────────┐ │
│ │ Username │ Score │ Actions │ Status Chg │ │ │
│ ├────────────────────────────────────────────┤ │
│ │ User 1   │  45   │   12    │  ⚠️        │ │ │
│ │ User 2   │  78   │   34    │  ✅        │ │ │
│ │ ...                                        │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

**Features:**
1. **Live-Modus** (Default)
   - WebSocket oder Polling (alle 10s)
   - Live-Karte mit User-Positionen
   - Marker-Farben nach Score:
     * Rot: < 50
     * Gelb: 50-75
     * Grün: > 75
   - Klick auf Marker = User-Details-Panel

2. **Historischer Modus**
   - Date-Picker
   - Lädt historische Daten via API
   - Karte zeigt letzte bekannte Positionen
   - Warnung: "Daten aus Vergangenheit"

3. **Report-Download**
   - Button: "Tagesbericht herunterladen"
   - Download PDF für aktuellen/gewählten Tag

4. **User-Vergleich-Tabelle**
   - Sortierbar nach allen Spalten
   - Filter: Active/Inactive
   - Highlight: Top 3 / Bottom 3

5. **Status-Changes-Chart**
   - Stacked Bar Chart (Recharts)
   - X-Achse: User
   - Y-Achse: Anzahl
   - Farben: Grün (interessiert), Rot (nicht), Gelb (nicht angetroffen), Blau (Termin)

**Service Worker Exclusion:**
```typescript
// In client/public/sw.js
const ADMIN_ROUTES = ['/admin'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Don't cache admin routes
  if (ADMIN_ROUTES.some(route => url.pathname.startsWith(route))) {
    return; // Let it pass through to network
  }
  
  // ... rest of caching logic
});
```

## 📋 Ausstehend (Phase 5)

### Integration & Aktivierung

**1. Tracking in AuthContext aktivieren:**
```typescript
// client/src/contexts/AuthContext.tsx
import { trackingManager } from '../services/trackingManager';

const login = async (password: string) => {
  const response = await api.login(password);
  
  if (response.success) {
    setUser({
      id: response.userId,
      username: response.username,
      isAdmin: response.isAdmin
    });
    
    // Start tracking für non-admin users
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

**2. Action Logging in Komponenten:**
```typescript
// client/src/components/PhotoCapture.tsx
import { trackingManager } from '../services/trackingManager';

const handleScan = async () => {
  // ... scan logic
  trackingManager.logAction('scan', 'Photo captured');
};

// client/src/components/ResultsDisplay.tsx
const handleStatusChange = (residentId: string, status: string) => {
  // ... status change logic
  trackingManager.logAction('status_change', `Resident ${residentId}`, status);
};
```

**3. Routes registrieren:**
```typescript
// server/routes.ts
import trackingRouter from './routes/tracking';
import adminRouter from './routes/admin';
import { requireAdmin } from './middleware/auth';

// Tracking routes (authenticated users)
app.use('/api/tracking', requireAuth, trackingRouter);

// Admin routes (admin only)
app.use('/api/admin', requireAdmin, adminRouter);
```

**4. Cron-Jobs starten:**
```typescript
// server/index.ts
import { cronJobService } from './services/cronJobService';

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  cronJobService.start(); // Enhanced logging retries
  cronJobService.scheduleDailyReport(); // NEU: 20 Uhr Reports
});
```

**5. Admin-Route in Frontend:**
```typescript
// client/src/App.tsx
import { lazy, Suspense } from 'react';

const AdminDashboard = lazy(() => import('./pages/admin-dashboard'));

<Route path="/admin/dashboard" element={
  <ProtectedRoute requireAdmin>
    <Suspense fallback={<div>Loading...</div>}>
      <AdminDashboard />
    </Suspense>
  </ProtectedRoute>
} />
```

**6. ProtectedRoute erweitern:**
```typescript
// client/src/components/ProtectedRoute.tsx
interface Props {
  children: ReactNode;
  requireAdmin?: boolean;
}

const ProtectedRoute = ({ children, requireAdmin = false }: Props) => {
  const { user } = useAuth();
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  if (requireAdmin && !user.isAdmin) {
    return <Navigate to="/scanner" />;
  }
  
  return <>{children}</>;
};
```

## 🎯 Testing-Checkliste

### GPS Tracking
- [ ] GPS-Koordinaten werden alle 30s gesendet
- [ ] WakeLock funktioniert (App bleibt aktiv im Hintergrund)
- [ ] Distanz-Berechnung korrekt
- [ ] GPS-Daten in RAM gespeichert

### Session Tracking
- [ ] Idle Detection funktioniert (1 Minute Inaktivität)
- [ ] Session-Dauer korrekt berechnet
- [ ] Actions werden geloggt
- [ ] Status-Änderungen getrackt

### Device Tracking
- [ ] Battery Level korrekt
- [ ] Network Type erkannt
- [ ] Low Battery Events gezählt
- [ ] Offline Events gezählt

### RAM-Speicherung
- [ ] Daten für alle User im RAM
- [ ] Reset um Mitternacht funktioniert
- [ ] KPI-Berechnung korrekt
- [ ] Activity Score Algorithmus

### Admin Auth
- [ ] Spalte D aus Google Sheets gelesen
- [ ] isAdmin korrekt im JWT
- [ ] Admin-Routes nur für Admins
- [ ] Regular User haben keinen Zugriff

### PDF-Reports
- [ ] Titelseite mit Ranking
- [ ] User-Seiten mit allen KPIs
- [ ] Hyperlinks funktionieren
- [ ] Reports um 20 Uhr generiert
- [ ] PDF im /reports Ordner

### Admin Dashboard
- [ ] Nur für Admins sichtbar
- [ ] Live-Karte zeigt alle User
- [ ] Marker-Farben nach Score
- [ ] User-Vergleich-Tabelle
- [ ] Historische Daten abrufbar
- [ ] Report-Download funktioniert
- [ ] NICHT in PWA gecacht

### Performance
- [ ] RAM-Usage < 100 MB für 20 User
- [ ] API-Calls batch-optimiert
- [ ] Dashboard lädt < 2 Sekunden
- [ ] Keine Memory Leaks

## 📊 Activity Score Algorithmus (Implementiert)

```
Max Score: 100 Punkte

1. Aktive Zeit (30 Punkte)
   - 6+ Stunden = 30 Punkte
   - Linear skaliert

2. Gesamt Actions (25 Punkte)
   - 50+ Actions = 25 Punkte
   - Linear skaliert

3. Status-Änderungen (30 Punkte) ⭐ WICHTIGSTE METRIK
   - 30+ Status Changes = 30 Punkte
   - Linear skaliert

4. Zurückgelegte Distanz (10 Punkte)
   - 10+ km = 10 Punkte
   - Linear skaliert

5. Strafen:
   - Idle Time > 50%: bis zu -5 Punkte
   - Offline Events: -0.5 pro Event (max -5)

Beispiel:
- 5 Stunden aktiv: 25 Punkte
- 40 Actions: 20 Punkte
- 25 Status Changes: 25 Punkte
- 8 km Distanz: 8 Punkte
- 30% Idle Time: 0 Strafe
- 1 Offline Event: -0.5 Punkte
= 77.5 ≈ 78 Punkte Activity Score
```

## 🔧 Nächste Schritte

1. **PDF-Generator implementieren** (Phase 2)
   - pdfkit installieren
   - reportGenerator.ts erstellen
   - Cron-Job hinzufügen

2. **Admin-Dashboard Backend** (Phase 3)
   - admin.ts routes erstellen
   - historicalDataScraper.ts implementieren

3. **Admin-Dashboard Frontend** (Phase 4)
   - Leaflet & Recharts installieren
   - admin-dashboard.tsx erstellen
   - Service Worker exclusion

4. **Integration** (Phase 5)
   - Tracking aktivieren
   - Routes registrieren
   - Testing

## 💡 Hinweise

- **iPads sollen nicht belastet werden**: Admin-Dashboard ist lazy-loaded und nicht in PWA gecacht
- **RAM ist kein Problem**: 20 User × ~500 KB/Tag = max. 10 MB
- **Reports täglich um 20 Uhr**: Cron-Job mit scheduleDailyReport()
- **Historische Daten**: Nur on-demand aus Sheets scrapen, sofort wieder aus RAM löschen
- **Status-Änderungen sind wichtigste KPI**: 30% des Activity Scores!

## 📝 Commit-Message-Vorlage

```
feat(tracking): Implement comprehensive user tracking system

- GPS tracking every 30s with background support
- Session tracking with Idle Detection API
- Device status tracking (battery, network)
- RAM-based daily data storage with midnight reset
- Activity score algorithm (0-100)
- Admin authentication via Google Sheets column D
- Tracking API endpoints (/gps, /session, /device)

[Next: PDF report generator & admin dashboard]
```
