# Admin Dashboard Metriken - Detaillierte Erklärung

## 📊 Übersicht

Das Admin Dashboard zeigt **Live-Daten (heute)** und **historische Daten** aus SQLite-Logs. Alle Metriken werden aus strukturierten Logs rekonstruiert, die in Google Sheets (heute) und SQLite-Datenbanken (vergangene Tage) gespeichert sind.

---

## 🔢 Metriken im Detail

### **1. Aktionen (Actions)**
**Was wird gemessen:** Gesamtzahl aller API-Aufrufe/Operationen eines Mitarbeiters an einem Tag

**Wie wird es berechnet:**
- Jeder API-Call (`/api/ocr`, `/api/save-resident`, `/api/geocode`, etc.) wird als "Aktion" gezählt
- Im SQLite Log gespeichert als `logType: 'action'` mit `data.action: 'scan' | 'resident_update' | 'geocode' | ...`
- **Code:** `userData.totalActions++` für jeden Log mit `logType === 'action'`

**Beispiel-Aktionen:**
- `scan` = Foto hochgeladen (OCR)
- `resident_update` = Bewohner-Daten bearbeitet
- `bulk_residents_update` = Mehrere Bewohner gleichzeitig gespeichert
- `dataset_create` = Neuer Datensatz angelegt
- `geocode` = Adresse geocodiert
- `navigate` = Navigation gestartet

**Typischer Wert:** 200-500 Aktionen pro Arbeitstag

---

### **2. Fotos (Photos)**
**Was wird gemessen:** Anzahl **einzigartiger** hochgeladener Fotos (dedupliziert)

**Wie wird es berechnet:**
1. **Photo-Erkennung:** Nur Logs vom Endpoint `/api/ocr` zählen als Foto-Upload
   - `/api/ocr-correct` zählt NICHT (= Textkorrektur, kein neues Foto)
2. **Duplikats-Erkennung:** Hash-basierte Deduplizierung
   ```typescript
   const prospectData = {
     newProspects: ["schmidt", "müller"],      // Column G
     existingCustomers: [{id: "123", name: "kokkalis"}]  // Column H
   };
   const photoHash = MD5(JSON.stringify(prospectData));
   ```
3. **Warum KEIN Address-Hash?** User könnte Adresse ändern und dasselbe Foto nochmal hochladen!

**Code-Location:**
- **Historisch:** `server/services/sqliteHistoricalData.ts` (Zeile 250-280)
- **Live:** `server/services/dailyDataStore.ts` (`trackOCRPhoto()`)

**Wichtig:** 
- Gleiches Foto mit unterschiedlichen Adressen = 1x gezählt ✅
- Foto mit Textkorrektur = zählt nicht doppelt ✅
- Komplett anderes Foto = neuer Hash = +1 ✅

**Typischer Wert:** 30-80 Fotos pro Arbeitstag

---

### **3. Status-Änderungen (Status Changes)**
**Was wird gemessen:** Anzahl aller Bewohner, denen ein Status zugewiesen wurde

**Status-Typen:**
- `interest_later` = Interesse später
- `written` = Geschrieben/Abgeschlossen
- `no_interest` = Kein Interesse
- `appointment` = Termin vereinbart
- `not_reached` = Nicht erreicht

**Wie wird es berechnet:**
1. **Einzelne Status-Änderung:** 
   ```typescript
   if (actionData.residentStatus) {
     statusChanges.set(actionData.residentStatus, count + 1);
   }
   ```
2. **Bulk-Updates** (mehrere Bewohner gleichzeitig):
   ```typescript
   if (action === 'bulk_residents_update' && residents.length > 0) {
     residents.forEach(resident => {
       statusChanges.set(resident.status, count + 1);
     });
   }
   ```
3. **Legacy OCR-Logs** (Google Sheets-Ära):
   - `newProspects.length` → `interest_later` Count
   - `existingCustomers.length` → `written` Count

**Code-Location:** `server/services/sqliteHistoricalData.ts` (Zeile 285-330)

**Wichtig:** 
- 1 Bulk-Update mit 10 Bewohnern = 10 Status-Änderungen ✅
- Status bleibt gleich = zählt NICHT ✅

**Typischer Wert:** 100-300 Status-Änderungen pro Arbeitstag

---

### **4. GPS-Punkte (GPS Points)**
**Was wird gemessen:** Anzahl GPS-Koordinaten vom Gerät

**Quellen:**
- **Native GPS:** Von Capacitor Geolocation Plugin (alle 5 Minuten)
- **FollowMee:** Externe GPS-Tracking-App (iOS/Android)
- **External Tracking:** Manuelle GPS-Logs

**Wie wird es berechnet:**
```typescript
if (logType === 'gps' && latitude && longitude) {
  userData.gpsPoints.push({ latitude, longitude, accuracy, timestamp });
}
```

**Validierung:**
- `latitude` und `longitude` müssen Zahlen sein (kein NaN)
- `accuracy` wird gespeichert für Qualitätsanalyse

**Code-Location:** `server/services/sqliteHistoricalData.ts` (Zeile 150-180)

**Typischer Wert:** 100-500 GPS-Punkte pro Arbeitstag (abhängig von Tracking-Frequenz)

---

### **5. Distanz (Distance)**
**Was wird gemessen:** Zurückgelegte Strecke in Kilometern

**Berechnung:** Haversine-Formel zwischen aufeinanderfolgenden GPS-Punkten
```typescript
function calculateDistance(coord1, coord2) {
  const R = 6371000; // Erdradius in Metern
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat/2)² + 
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)²;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // in Metern
}
```

**Validierung:**
- GPS-Punkte werden sortiert nach Timestamp
- Distanz nur berechnet wenn vorheriger Punkt existiert
- `NaN` und `Infinity` werden gefiltert

**Code-Location:** `server/services/sqliteHistoricalData.ts` (Zeile 375-395)

**Typischer Wert:** 20-100 km pro Arbeitstag

---

### **6. Aktive Zeit (Active Time)**
**Was wird gemessen:** Tatsächliche Arbeitszeit (Session-Zeit minus Pausen)

**Berechnung:**
```typescript
activeTime = totalSessionTime - totalIdleTime
```

**Alternative Berechnung** (wenn keine Session-Logs):
```typescript
// Zeitspanne zwischen erstem und letztem Log
const firstLog = logs[0].timestamp;
const lastLog = logs[logs.length - 1].timestamp;
activeTime = lastLog - firstLog;
```

**Code-Location:** 
- `server/services/sqliteHistoricalData.ts` (Zeile 195-210)
- `server/services/historicalDataScraper.ts` (Legacy Google Sheets)

**Wichtig:**
- **Pausen werden NICHT gezählt** (Idle-Time wird abgezogen)
- Bei fehlenden Session-Logs: Gesamter Zeitraum wird genutzt

**Typischer Wert:** 2-8 Stunden pro Arbeitstag

---

### **7. Geschrieben (Written)**
**Was wird gemessen:** Anzahl Bewohner mit finalem Status `written`

**Unterschied zu Status-Änderungen:**
- **Status-Änderungen:** Alle Status-Zuweisungen (auch mehrfach)
- **Geschrieben:** Nur finaler Status am Ende des Tages

**Berechnung:**
```typescript
const writtenCount = userData.finalStatuses.get('written') || 0;
```

**Code-Location:** `server/routes/admin.ts` (calculateFinalStatuses)

**Wichtig:**
- Bewohner wechselt von `interest_later` → `written` → `no_interest` am selben Tag
  - Status-Änderungen: 3 ✅
  - Geschrieben: 0 (finaler Status ist `no_interest`) ✅

**Typischer Wert:** 10-50 Geschrieben pro Arbeitstag

---

## 🔧 Datenfluss

```
┌─────────────────────┐
│   Mobile App        │
│  (Capacitor iOS)    │
└──────────┬──────────┘
           │ API Calls
           ▼
┌─────────────────────┐
│   Express Server    │
│   /api/ocr          │ ──► trackOCRPhoto() ──► RAM (DailyDataStore)
│   /api/save-resident│ ──► logToSheets() ───► Google Sheets (heute)
│   /api/gps          │ ──► SQLite Log ──────► SQLite DB (archiviert)
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  SQLite Startup Sync│
│  (jeden Serverstart) │
│                      │
│  1. Phase 4: Merge  │ ──► Alte Logs aus Sheets in SQLite
│  2. Phase 6: Cleanup│ ──► Sheets-Logs löschen (nur heute behalten)
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Admin Dashboard    │
│                      │
│  Live: RAM          │ ──► DailyDataStore
│  Historisch: SQLite │ ──► sqliteHistoricalData.ts
└─────────────────────┘
```

---

## ⚠️ Bekannte Einschränkungen

### **Historische Fotos (vor SQLite-Migration)**
- **Problem:** Vor der SQLite-Migration (ca. Oktober 2024) wurden Photos NICHT geloggt
- **Folge:** Historische Tage zeigen `0 Fotos`, obwohl Photos gemacht wurden
- **Lösung:** Nur Daten ab SQLite-Einführung sind vollständig

### **Actions Count bei alten Logs**
- **Problem:** Google Sheets-Logs hatten andere Action-Typen (`edit`, `save`, `delete`)
- **Neue Typen:** `resident_update`, `bulk_residents_update`, `resident_delete`
- **Lösung:** Mapping in `calculateActionDetails()` (admin.ts Zeile 25-60)

### **Status-Änderungen ohne finalStatuses**
- Alte Logs haben keine `finalStatuses` → nur `statusChanges` verfügbar
- Dashboard zeigt dann nur Gesamtzahl der Änderungen, nicht finale Zuordnung

---

## 🎯 Best Practices für Admins

**Dashboard laden:**
1. **Live-Ansicht:** Zeigt aktuellen Tag (heute) aus RAM
2. **Historisch:** Datum auswählen → lädt aus SQLite DB

**Metriken interpretieren:**
- **Hohe Actions, wenig GPS:** User war statisch (z.B. Office-Arbeit)
- **Viel GPS, wenig Actions:** Nur Tracking, keine Interaktionen
- **Fotos = Scans:** Sollte ungefähr gleich sein (±10%)
- **Status-Änderungen > Geschrieben:** Normal (viele Status, wenige finale `written`)

**Performance:**
- Historische Daten >7 Tage werden aus Google Drive geladen (1h Cache)
- Große Datensätze (>500 GPS-Punkte) können langsam laden

---

## 📝 Changelog

**15.11.2025 - Photo Hash Fix:**
- ❌ **Alt:** Hash basierte auf `address` → User konnte System austricksen
- ✅ **Neu:** Hash basiert NUR auf OCR-Daten (`newProspects` + `existingCustomers`)
- ✅ Duplikatserkennung jetzt robust gegen Address-Änderungen

**14.11.2025 - Crypto Import Fix:**
- ❌ **Alt:** `require('crypto')` (CommonJS) → `ReferenceError` in TSX
- ✅ **Neu:** `import crypto from 'crypto'` (ESM)

**12.11.2025 - Action Type Mapping:**
- ✅ Mapping für `resident_update` → `edits`
- ✅ Mapping für `bulk_residents_update` → `ocrCorrections`
- ✅ Confusing "Alle Updates als Bulk" Message entfernt
