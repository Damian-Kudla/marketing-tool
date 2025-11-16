# Google Maps & Roads API Setup Guide

## Übersicht

Die Anwendung wurde vollständig auf Google Maps migriert mit folgenden Features:
- ✅ Google Maps JavaScript API für Karten-Anzeige
- ✅ Google Roads API für Snap-to-Roads mit intelligentem Caching
- ✅ Multi-Source Toggle (Alle/Native/FollowMee/External)
- ✅ Kosten-Kalkulation & Anzeige (in Cent)
- ✅ Partial Route Updates (nur neue Punkte verarbeiten)
- ✅ Monatliche JSON Cache-Dateien
- ✅ Stündliche Google Drive Synchronisierung
- ✅ Verwendet bestehende API Keys (GOOGLE_GEOCODING_API_KEY + GOOGLE_SHEETS_KEY)

## Benötigte Google Cloud APIs

### APIs aktivieren

Aktiviere folgende APIs in deinem Google Cloud Projekt (https://console.cloud.google.com/):

#### 1. Maps JavaScript API
- **Zweck**: Karten-Anzeige im Frontend
- **Kosten**: 10.000 kostenlose Map Loads pro Monat (ab März 2025)
- **Aktivierung**: https://console.cloud.google.com/apis/library/maps-backend.googleapis.com
- **API Key**: Verwendet bestehenden `GOOGLE_GEOCODING_API_KEY`

#### 2. Roads API
- **Zweck**: GPS-Punkte auf Straßen snappen
- **Kosten**: 500¢ pro 1.000 Requests (kein kostenloses Kontingent)
- **Aktivierung**: https://console.cloud.google.com/apis/library/roads.googleapis.com
- **API Key**: Verwendet bestehenden `GOOGLE_GEOCODING_API_KEY`

#### 3. Google Drive API
- **Zweck**: Stündliche Synchronisierung der Cache-Dateien
- **Kosten**: Kostenlos
- **Aktivierung**: https://console.cloud.google.com/apis/library/drive.googleapis.com
- **Service Account**: Verwendet bestehenden `GOOGLE_SHEETS_KEY`

### Wichtig: Keine neuen Credentials erforderlich!

Das System verwendet die bereits vorhandenen Credentials:
- `GOOGLE_GEOCODING_API_KEY` - für Maps & Roads API
- `GOOGLE_SHEETS_KEY` - Service Account für Google Drive

## Umgebungsvariablen (.env)

**Keine Änderungen erforderlich!** Das System verwendet bereits vorhandene ENV-Variablen:

```bash
# Bereits vorhanden - wird für Maps & Roads verwendet
GOOGLE_GEOCODING_API_KEY=AIza...

# Bereits vorhanden - wird für Drive Sync verwendet
GOOGLE_SHEETS_KEY={"type":"service_account",...}

# Bereits konfiguriert
GOOGLE_DRIVE_FOLDER_ID=1BpgBumKeOlGOdo8c3JWG5NyPPM0lYDIm
```

### Google Drive Ordner-Berechtigung

Stelle sicher, dass der Service Account Zugriff auf den Drive Ordner hat:
1. Öffne: https://drive.google.com/drive/folders/1BpgBumKeOlGOdo8c3JWG5NyPPM0lYDIm
2. Klicke auf "Teilen"
3. Füge `python-sheets-anbindung@daku-trading-gmbh.iam.gserviceaccount.com` hinzu
4. Berechtigung: "Editor"

## Implementierte Features

### 1. Intelligentes Caching System
- Monatliche JSON-Dateien: `data/snapped-routes-cache/YYYY-MM.json`
- Trackt `lastProcessedTimestamp` pro Route
- Verhindert doppelte API-Aufrufe
- Automatische Cache-Hit-Erkennung

### 2. Google Drive Synchronisierung
- Läuft jede Stunde automatisch
- Initial Sync nach 1 Minute nach Server-Start
- Überschreibt/erstellt Dateien in Drive Ordner
- Graceful Shutdown (speichert Cache vor Exit)

### 3. Multi-Source Filtering
- **Alle**: Alle GPS-Quellen kombiniert
- **Native App**: Nur native App GPS-Daten
- **FollowMee**: Nur FollowMee GPS-Daten
- **External**: Nur Damians Tracking App

Jede Quelle hat eigenen Cache-Eintrag!

### 4. Kosten-Kalkulation UI (in Cent)
- Zeigt gecachte Punkte an
- Berechnet Kosten für neue Punkte in **Cent (¢)**
- Modal mit zwei Optionen:
  - "Gespeicherte Route anzeigen" (0¢)
  - "Route vervollständigen" (zeigt Kosten in Cent)

### 5. Partial Route Updates
Beispiel-Szenario:
- 14:00 Uhr: Route mit 100 Punkten generiert → gecacht
- 20:00 Uhr: 50 neue Punkte hinzugekommen
- System erkennt Cache und verarbeitet nur die 50 neuen Punkte
- Kombiniert automatisch gecachte + neue Punkte

## API Endpoints

### POST `/api/admin/dashboard/snap-to-roads`
Hauptendpoint für Snap-to-Roads mit Caching

**Request Body:**
```json
{
  "userId": "user123",
  "date": "2025-01-08",
  "source": "all",
  "points": [
    { "latitude": 52.52, "longitude": 13.405, "accuracy": 10, "timestamp": 1736323200000 },
    ...
  ]
}
```

**Response:**
```json
{
  "snappedPoints": [...],
  "apiCallsUsed": 3,
  "costCents": 1.5,
  "fromCache": true,
  "cacheHitRatio": 0.75,
  "cacheInfo": {
    "cached": true,
    "cachedPointCount": 150,
    "lastProcessedTimestamp": 1736337600000,
    "apiCallsUsed": 5,
    "costCents": 2.5
  }
}
```

### GET `/api/admin/dashboard/snap-to-roads/cache-info`
Cache-Status abfragen (ohne API-Aufruf)

**Query Parameters:**
- `userId`: User ID
- `date`: YYYY-MM-DD
- `source`: all | native | followmee | external

### POST `/api/admin/dashboard/snap-to-roads/calculate-cost`
Kosten berechnen ohne API-Aufruf

**Request Body:**
```json
{
  "pointCount": 200
}
```

**Response:**
```json
{
  "requests": 2,
  "costCents": 1.0
}
```

### GET `/api/admin/google-maps-config`
Liefert Google Maps API Key für Client

**Response:**
```json
{
  "apiKey": "AIza..."
}
```

## Kosten-Übersicht (in Cent)

### Google Roads API Pricing
- **500¢ pro 1.000 Requests** (= 0,5¢ pro Request)
- **100 Punkte pro Request** (max)
- **Beispiel**: 500 Punkte = 5 Requests = 2,5¢

### Caching spart Kosten:
- **Ohne Cache**: Jeden Tag neue Route → 2,5¢/Tag = 75¢/Monat
- **Mit Cache**: Nur neue Punkte → ~0,5¢/Tag = 15¢/Monat
- **Ersparnis**: ~80%

### Maps JavaScript API
- **10.000 kostenlose Map Loads/Monat**
- Danach: 700¢ pro 1.000 Loads
- Für typische Nutzung: **kostenlos**

## Cache-Struktur

### Monatliche JSON-Datei (`2025-01.json`)
```json
{
  "month": "2025-01",
  "routes": [
    {
      "userId": "user123",
      "date": "2025-01-08",
      "source": "all",
      "lastProcessedTimestamp": 1736337600000,
      "snappedPoints": [...],
      "apiCallsUsed": 5,
      "costCents": 2.5,
      "createdAt": 1736323200000,
      "updatedAt": 1736337700000
    },
    ...
  ]
}
```

## Testing

### 1. Server starten
```bash
npm run dev
```

Erwartete Logs:
```
[Server] Initializing Google Roads Service...
[GoogleRoadsService] Created new cache for 2025-01
[Server] Initializing Google Drive Sync Service...
[GoogleDriveSync] Using Google Sheets service account for Drive access
[GoogleDriveSync] Initialized successfully
[GoogleDriveSync] Hourly sync started
```

### 2. Route generieren
1. Admin Dashboard öffnen
2. User und Datum auswählen → "Route" Tab
3. GPS-Quelle wählen (z.B. "Alle")
4. "Snap-to-Roads" Checkbox aktivieren
5. Modal öffnet sich mit Kosten-Kalkulation in Cent
6. "Vervollständigen" klicken
7. Warten auf Generierung
8. Route wird auf Google Maps angezeigt
9. Alert zeigt: "Kosten: X.XX¢"

### 3. Cache testen
1. Gleiche Route nochmal öffnen
2. "Snap-to-Roads" aktivieren
3. Modal zeigt "Gespeicherte Route anzeigen" mit 0¢
4. Klicke "Gespeicherte anzeigen" → Sofort geladen, keine API-Kosten

### 4. Partial Update testen
1. Warte bis neue GPS-Daten kommen
2. "Snap-to-Roads" aktivieren
3. Modal zeigt beide Optionen:
   - "Gespeicherte Route" (alte Punkte, 0¢)
   - "Vervollständigen" (nur neue Punkte + Kosten in Cent)

## Troubleshooting

### Problem: "GOOGLE_GEOCODING_API_KEY not configured"
- Prüfe `.env` Datei: `GOOGLE_GEOCODING_API_KEY=...`
- Prüfe dass der Key gültig ist
- Prüfe dass Roads API aktiviert ist

### Problem: "Google Roads API error: 403"
- API nicht aktiviert in Google Cloud Console
- API Key hat keine Berechtigung für Roads API
- Prüfe API-Einschränkungen (IP/Referrer)

### Problem: "Google Drive credentials not configured"
- Prüfe `.env`: `GOOGLE_SHEETS_KEY` existiert
- Prüfe JSON-Format ist korrekt
- Prüfe Service Account hat Zugriff auf Drive Ordner

### Problem: "Map not loading"
- Prüfe Browser Console für Fehler
- Prüfe `/api/admin/google-maps-config` liefert API Key
- Prüfe Maps JavaScript API ist aktiviert
- Cache leeren und Seite neu laden

### Problem: Cache wird nicht gespeichert
- Prüfe `data/snapped-routes-cache/` Ordner existiert
- Prüfe Schreibrechte
- Prüfe Server Logs für "[GoogleRoadsService] Saved cache"

### Problem: Kosten werden als $0.0000 angezeigt statt in Cent
- Alte Cache-Dateien haben noch `costUSD` statt `costCents`
- Lösung: Cache-Dateien löschen oder manuell umbenennen

## Dateien Übersicht

### Backend
- `server/services/googleRoadsService.ts` - Roads API + Caching (verwendet GOOGLE_GEOCODING_API_KEY, Kosten in Cent)
- `server/services/googleDriveSyncService.ts` - Drive Sync (verwendet GOOGLE_SHEETS_KEY)
- `server/routes/admin.ts` - API Endpoints (4 neue, inkl. google-maps-config)
- `server/index.ts` - Service Initialisierung + Graceful Shutdown

### Frontend
- `client/src/components/RouteReplayMap.tsx` - Komplett neu (Google Maps, Kosten in Cent)
- `client/src/pages/admin-dashboard.tsx` - userId Prop hinzugefügt
- `client/index.html` - Google Maps Script Tag (dynamisch geladen mit API Key vom Server)
- `client/src/types/google-maps.d.ts` - TypeScript Definitionen

### Cache & Data
- `data/snapped-routes-cache/*.json` - Monatliche Cache-Dateien (costCents statt costUSD)
- Google Drive Ordner - Backup der Cache-Dateien

## Setup Checklist

- ✅ **Keine neuen ENV-Variablen erforderlich** - verwendet bestehende!
- ✅ Aktiviere Maps JavaScript API in Google Cloud Console
- ✅ Aktiviere Roads API in Google Cloud Console
- ✅ Aktiviere Google Drive API in Google Cloud Console
- ✅ Teile Drive Ordner mit Service Account Email (`python-sheets-anbindung@daku-trading-gmbh.iam.gserviceaccount.com`)
- ✅ Starte Server und teste Route-Generierung
- ✅ Prüfe Cache-Dateien in `data/snapped-routes-cache/`
- ✅ Prüfe Drive Sync nach 1 Stunde

## Kosten-Beispielrechnung

### Szenario: 5 Mitarbeiter, täglich GPS-Tracking

**Pro Tag pro Mitarbeiter:**
- ~500 GPS-Punkte
- 5 Requests (100 Punkte pro Request)
- **Kosten: 2,5¢**

**Pro Tag gesamt (5 Mitarbeiter):**
- 5 × 2,5¢ = **12,5¢**

**Pro Monat (30 Tage):**
- 30 × 12,5¢ = **375¢ = 3,75 €**

**Mit intelligentem Caching (80% Ersparnis):**
- **75¢ = 0,75 € pro Monat**

### Google Maps JavaScript API
- 10.000 kostenlose Loads/Monat
- Bei 5 Mitarbeitern × 30 Tagen = 150 Loads/Monat
- **Kostenlos** (weit unter Limit)

### Gesamt-Kosten
- **~0,75 € - 3,75 €/Monat** (je nach Cache-Effizienz)

## Support

Bei Fragen oder Problemen:
- Prüfe Server Logs
- Prüfe Browser Console
- Prüfe Google Cloud Console → APIs & Services → Dashboard
- Prüfe Cache-Dateien haben `costCents` (nicht `costUSD`)
