# FollowMee GPS Integration - Implementierungsdokumentation

## 📍 Übersicht

Die FollowMee-Integration ermöglicht kontinuierliches GPS-Tracking von Mitarbeitern durch die FollowMee-App, auch wenn die EnergyScanCapture-App nicht geöffnet ist. GPS-Daten werden automatisch alle 5 Minuten aus der FollowMee-API abgerufen und chronologisch in die bestehenden Google Sheets-Logs eingefügt.

## 🎯 Ziele

1. **Hintergrund-GPS-Tracking**: Erfassung der Mitarbeiterstandorte ohne geöffnete App
2. **Chronologische Integration**: Einfügen von FollowMee-GPS-Daten an der richtigen zeitlichen Position
3. **Duplikatsvermeidung**: Verhinderung von doppelten Einträgen bei erneutem Abruf
4. **Nahtlose Dashboard-Integration**: Anzeige von FollowMee-GPS im Admin Dashboard

## 🏗️ Architektur

### Neue Komponenten

#### 1. `server/services/followMeeApi.ts`
- **FollowMeeApiService**: Hauptservice für FollowMee-API-Kommunikation
- **Funktionen**:
  - `fetchHistoryForAllDevices(hours)`: Abrufen der GPS-Historie für alle Geräte
  - `fetchDateRangeForAllDevices(from, to)`: Abrufen für spezifischen Zeitraum
  - `syncAllUsers()`: Synchronisierung aller konfigurierten Benutzer (Hauptfunktion)
  - `insertLocationsChronologically()`: Einfügen in Google Sheets
- **Duplikatserkennung**: 
  - `processedLocationIds` Map speichert bereits verarbeitete GPS-Punkte
  - Location-ID Format: `{DeviceID}_{Date}_{Lat}_{Lng}`
- **User-Mapping**: 
  - `userMappings` Map verknüpft UserID → FollowMee Device ID
  - Aktualisierung über `updateUserMappings()`

#### 2. `server/services/followMeeSyncScheduler.ts`
- **FollowMeeSyncScheduler**: Cron-Job-Scheduler für automatisches Syncing
- **Intervall**: Alle 5 Minuten (300.000 ms)
- **Funktionen**:
  - `start()`: Startet automatisches Syncing bei Server-Start
  - `stop()`: Stoppt den Scheduler
  - `syncNow()`: Manuelle Synchronisierung (auch via Admin-API)
  - `getStatus()`: Status-Informationen für Monitoring

#### 3. Schema-Erweiterungen

**`shared/schema.ts`**:
```typescript
export const users = pgTable("users", {
  // ... existing fields
  followMeeDeviceId: text("followmee_device_id"), // NEU
});
```

**`server/services/googleSheets.ts`**:
```typescript
export interface UserData {
  userId: string;
  username: string;
  password: string;
  postalCodes: string[];
  isAdmin: boolean;
  followMeeDeviceId?: string; // NEU
}

async getAllUsers(): Promise<UserData[]> // NEU
```

### Google Sheets Konfiguration

**Users Sheet (Zugangsdaten)** - Spalten:
- **A**: Passwort
- **B**: Username
- **C**: Postleitzahlen (kommasepariert)
- **D**: Rolle (admin/leer)
- **E**: FollowMee Device ID ⬅️ **NEU**

**Beispiel**:
```
| A (Password) | B (Username) | C (PLZ)      | D (Role) | E (FollowMee Device ID) |
|--------------|--------------|--------------|----------|-------------------------|
| pass123      | Damian       | 41462,41460  | admin    | device_123456           |
| pass456      | Daniel       | 41464        |          | device_789012           |
```

## 🔄 Datenfluss

```
FollowMee App (iOS/Android)
    ↓ (kontinuierliches GPS-Tracking)
FollowMee API Server
    ↓ (alle 5 Min via Scheduler)
EnergyScanCapture Server
    ↓ (FollowMeeApiService.syncAllUsers)
Google Sheets Logging Service
    ↓ (batchAppendToWorksheet)
Google Sheets (per-user worksheets)
    ↓ (Read by historicalDataScraper)
Admin Dashboard
```

## 📊 Google Sheets Log-Format

FollowMee-GPS-Punkte werden im gleichen Format wie manuelle GPS-Logs gespeichert:

| Timestamp | User ID | Username | Endpoint | Method | Address | New Prospects | Existing Customers | User Agent | Data |
|-----------|---------|----------|----------|--------|---------|---------------|-------------------|------------|------|
| 2025-11-04T14:23:45Z | user_abc | Damian | /api/tracking/gps | POST | GPS: 51.12345, 6.98765 [FollowMee] | | | FollowMee GPS Tracker | `{"source":"followmee","deviceId":"...","latitude":...}` |

**Unterscheidungsmerkmale**:
- **Address**: Enthält `[FollowMee]` Suffix
- **User Agent**: `FollowMee GPS Tracker`
- **Data (JSON)**:
  ```json
  {
    "source": "followmee",
    "deviceId": "device_123456",
    "deviceName": "Damians iPhone",
    "latitude": 51.123456,
    "longitude": 6.987654,
    "speed": 15.5,
    "direction": 45,
    "accuracy": 10,
    "timestamp": 1730728425000
  }
  ```

## 🔧 Konfiguration

### Environment Variables (`.env`)

```bash
FOLLOWMEE_API="7e349aadf51610850bcad2a91b7fac22"
FOLLOWMEE_USERNAME="Saskia.zucht"  # FollowMee Account Username
```

### Server-Start Integration (`server/index.ts`)

```typescript
import { followMeeSyncScheduler } from "./services/followMeeSyncScheduler";

server.listen(port, "0.0.0.0", async () => {
  // ... existing initialization
  
  // Start FollowMee GPS sync scheduler (every 5 minutes)
  if (process.env.FOLLOWMEE_API) {
    log('Starting FollowMee GPS sync scheduler...');
    followMeeSyncScheduler.start();
  }
});
```

## 🛠️ Admin-API-Endpunkte

### 1. Status Abrufen

```http
GET /api/admin/followmee/status
Authorization: (admin session required)
```

**Response**:
```json
{
  "configured": true,
  "userCount": 5,
  "users": [
    {
      "username": "Damian",
      "deviceId": "device_123456",
      "lastFetch": 1730728425000,
      "processedLocations": 142
    }
  ],
  "running": true,
  "syncing": false,
  "intervalMs": 300000
}
```

### 2. Manuelles Syncing Auslösen

```http
POST /api/admin/followmee/sync
Authorization: (admin session required)
```

**Response**:
```json
{
  "success": true,
  "message": "FollowMee sync started in background",
  "startTime": "2025-11-04T14:30:00.000Z"
}
```

## 🔐 Duplikatserkennung

Die Duplikatserkennung verhindert, dass GPS-Punkte mehrfach eingefügt werden:

1. **Location ID Generierung**:
   ```typescript
   const locationId = `${location.DeviceID}_${location.Date}_${location.Latitude}_${location.Longitude}`;
   ```

2. **Tracking pro User**:
   ```typescript
   private processedLocationIds: Map<string, Set<string>>
   ```

3. **Vor dem Einfügen**:
   ```typescript
   const newLocations = deviceLocations.filter(loc => {
     const locationId = this.createLocationId(loc);
     return !this.isLocationProcessed(userId, locationId);
   });
   ```

4. **Nach erfolgreichem Einfügen**:
   ```typescript
   for (const location of newLocations) {
     this.markLocationProcessed(userId, locationId);
   }
   ```

## 📈 Chronologische Insertion

### Aktueller Ansatz (v1)
- **Methode**: Append an das Ende der Worksheet
- **Sortierung**: Beim Abrufen durch `historicalDataScraper` nach Timestamp
- **Vorteil**: Einfach, performant, keine Google Sheets-Updates nötig
- **Nachteil**: Logs nicht physisch chronologisch in Sheet

### Zukünftige Optimierung (v2)
Falls gewünscht, kann echte chronologische Insertion implementiert werden:
1. Abrufen existierender Logs via `getWorksheetData()`
2. Binäre Suche für korrekte Insert-Position
3. Verwendung von `batchUpdate` statt `append`
4. **Trade-off**: Mehr API-Calls, höhere Komplexität

## 🧪 Testing

### Manueller Test
```bash
# 1. Server starten
npm run dev

# 2. Status prüfen (als Admin einloggen)
curl http://localhost:5050/api/admin/followmee/status

# 3. Manuelles Sync auslösen
curl -X POST http://localhost:5050/api/admin/followmee/sync

# 4. Logs prüfen in Google Sheets
```

### Erwartete Logs
```
[FollowMee Scheduler] Starting automatic sync (every 5 minutes)...
[FollowMee] Mapped user Damian to device device_123456
[FollowMee] Updated mappings for 5 users with FollowMee devices
[FollowMee] Fetching 1h history for all devices...
[FollowMee] Received 47 location points
[FollowMee] Processing 47 locations for user Damian
[FollowMee] 23 new locations for user Damian
[FollowMee] Appended 23 locations to Damian's log
[FollowMee Scheduler] ✅ Sync completed successfully
```

## 📝 Setup-Anleitung für Neuen Mitarbeiter

1. **FollowMee App installieren** (iOS App Store / Google Play)
2. **FollowMee Account erstellen** mit Username `Saskia.zucht`
3. **Device ID ermitteln**:
   - In FollowMee App → Settings → Device ID kopieren
4. **Google Sheets aktualisieren**:
   - Sheet: "Zugangsdaten"
   - Zeile des Mitarbeiters finden
   - Spalte E: Device ID eintragen
5. **Server restart** (oder warten auf nächsten automatischen Sync)
6. **Verifikation**: Admin Dashboard → GPS-Tracking prüfen

## 🚀 Deployment

Die Integration ist bereits in folgenden Dateien implementiert:

- ✅ `server/services/followMeeApi.ts` (neu)
- ✅ `server/services/followMeeSyncScheduler.ts` (neu)
- ✅ `server/services/googleSheets.ts` (erweitert)
- ✅ `shared/schema.ts` (erweitert)
- ✅ `server/index.ts` (Scheduler-Start)
- ✅ `server/routes/admin.ts` (neue Endpunkte)
- ✅ `.env` (API-Key + Username)

**Deployment-Schritte**:
```bash
# 1. TypeScript kompilieren
npm run build

# 2. Version bump
npm run version:bump

# 3. Git commit & push
git add .
git commit -m "feat: FollowMee GPS integration for background tracking"
git push origin main

# 4. Railway deploy (automatisch via GitHub)
```

## 🔍 Monitoring & Debugging

### Logs prüfen
```bash
# Production logs (Railway)
railway logs

# Lokale logs
grep "FollowMee" logs/*.log
```

### Status-Dashboard (Admin UI)
Zukünftige Implementierung könnte umfassen:
- FollowMee Sync Status Widget
- Letzte Sync-Zeit pro User
- GPS-Punkte-Zähler (manuell vs. FollowMee)
- Fehler-Historie

## 🐛 Bekannte Limitationen

1. **API Rate Limit**: FollowMee erlaubt max. 1 Request/Minute
   - ✅ **Gelöst**: 5-Minuten-Intervall
2. **Historische Daten**: API liefert max. 72 Stunden Historie
   - **Workaround**: Regelmäßiges Syncing verhindert Datenverlust
3. **Zeitzone**: FollowMee-Timestamps sind UTC
   - ✅ **Gelöst**: Konsistente UTC-Verwendung im gesamten System
4. **Offline-Geräte**: Keine GPS-Daten wenn Gerät offline
   - **Hinweis**: FollowMee speichert Daten lokal und synct bei Verbindung

## 📚 FollowMee API Referenz

### Base URL
```
https://www.followmee.com/api/tracks.aspx
```

### Authentication
```
?key={API_KEY}&username={USERNAME}
```

### Functions

#### 1. History for All Devices
```http
GET /api/tracks.aspx?key=...&username=...&output=json&function=historyforalldevices&history=1
```
- **Parameter `history`**: 1-72 (Stunden)
- **Use Case**: Reguläres Syncing (alle 5 Min mit `history=1`)

#### 2. Date Range for All Devices
```http
GET /api/tracks.aspx?key=...&username=...&output=json&function=daterangeforalldevices&from=2025-11-04&to=2025-11-04
```
- **Use Case**: Historische Daten nachholen

### Response Format
```json
{
  "data": [
    {
      "DeviceID": "device_123456",
      "DeviceName": "Damians iPhone",
      "Date": "2025-11-04 14:23:45",
      "Latitude": 51.123456,
      "Longitude": 6.987654,
      "Speed": 15.5,
      "Direction": 45,
      "Accuracy": 10,
      "Address": "Hauptstraße 12, 41462 Neuss"
    }
  ]
}
```

## 🎉 Erfolgsmetriken

Nach erfolgreicher Implementierung:
- ✅ Kein manuelles GPS-Tracking mehr nötig
- ✅ Lückenlose Route-Aufzeichnung über gesamten Arbeitstag
- ✅ Admin Dashboard zeigt vollständige Bewegungsprofile
- ✅ Automatische Integration ohne User-Interaktion
- ✅ Duplikatsfrei trotz mehrfachen Abrufen

## 🔗 Weitere Dokumentation

- FollowMee API Docs: [https://www.followmee.com/api/](https://www.followmee.com/api/)
- EnergyScanCapture Tracking: `TRACKING_ANALYSIS.md`
- Google Sheets Logging: `LOGGING_ERWEITERUNG_SUMMARY.md`

---

**Version**: 2.6.8  
**Datum**: 04. November 2025  
**Autor**: GitHub Copilot AI Assistant
