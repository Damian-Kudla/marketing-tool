# Tracking Logging Enhancement - Dokumentation

## Problem

Die Tracking-Daten aus Phase 1 (GPS, Session, Device) wurden zwar im RAM gespeichert, aber **nicht** in Google Sheets persistiert. Die bestehenden Log-Header in Google Sheets waren:

```
Timestamp | User ID | Username | Endpoint | Method | Address | New Prospects | Existing Customers | User Agent
```

Diese Spaltenstruktur passte nicht für strukturierte Tracking-Daten wie GPS-Koordinaten, Session-Status oder Device-Informationen.

## Lösung

### 1. Neue Spalte "Data" hinzugefügt (Spalte J)

**Google Sheets Header (neu):**
```
Timestamp | User ID | Username | Endpoint | Method | Address | New Prospects | Existing Customers | User Agent | Data
```

Die **Data**-Spalte speichert strukturierte JSON-Daten für jeden Log-Eintrag.

### 2. Erweiterte Logging-Funktion

**Vor:**
```typescript
logUserActivityWithRetry(
  req: AuthenticatedRequest,
  address?: string,
  newProspects?: string[],
  existingCustomers?: any[]
)
```

**Nach:**
```typescript
logUserActivityWithRetry(
  req: AuthenticatedRequest,
  address?: string,
  newProspects?: string[],
  existingCustomers?: any[],
  data?: any  // ✅ NEU: Strukturierte Daten als JSON
)
```

### 3. Tracking-Endpunkte aktualisiert

#### GPS Tracking (`POST /api/tracking/gps`)
```typescript
await logUserActivityWithRetry(
  req,
  `GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`, // Address field
  undefined,
  undefined,
  { // ✅ Data field
    action: 'gps_update',
    latitude: gps.latitude,
    longitude: gps.longitude,
    accuracy: gps.accuracy,
    timestamp
  }
);
```

**Beispiel in Google Sheets:**
- **Endpoint:** `/api/tracking/gps`
- **Address:** `GPS: 51.165691, 10.451526`
- **Data:** `{"action":"gps_update","latitude":51.165691,"longitude":10.451526,"accuracy":10,"timestamp":1729137600000}`

#### Session Tracking (`POST /api/tracking/session`)
```typescript
await logUserActivityWithRetry(
  req,
  undefined,
  undefined,
  undefined,
  { // ✅ Data field
    action: actionType, // z.B. 'session_update', 'scan', 'status_change'
    isActive: session.isActive,
    idleTime: session.idleTime,
    sessionDuration: session.sessionDuration,
    actionsCount: session.actions?.length || 0,
    timestamp
  }
);
```

**Beispiel in Google Sheets:**
- **Endpoint:** `/api/tracking/session`
- **Data:** `{"action":"session_update","isActive":true,"idleTime":0,"sessionDuration":3600000,"actionsCount":5,"timestamp":1729137600000}`

#### Device Tracking (`POST /api/tracking/device`)
```typescript
await logUserActivityWithRetry(
  req,
  undefined,
  undefined,
  undefined,
  { // ✅ Data field
    action: 'device_update',
    batteryLevel: device.batteryLevel,
    isCharging: device.isCharging,
    connectionType: device.connectionType,
    effectiveType: device.effectiveType,
    screenOrientation: device.screenOrientation,
    memoryUsage: device.memoryUsage,
    timestamp
  }
);
```

**Beispiel in Google Sheets:**
- **Endpoint:** `/api/tracking/device`
- **Data:** `{"action":"device_update","batteryLevel":0.85,"isCharging":false,"connectionType":"wifi","effectiveType":"4g","screenOrientation":"portrait-primary","memoryUsage":45.2,"timestamp":1729137600000}`

### 4. Address-Datasets Routes aktualisiert

#### Dataset erstellen (`POST /api/address-datasets`)
```typescript
await logUserActivityWithRetry(
  req,
  normalized.formattedAddress,
  undefined,
  undefined,
  { // ✅ Data field
    action: 'dataset_create',
    datasetId: dataset.id,
    street: normalized.street,
    houseNumber: normalized.number,
    city: normalized.city,
    postalCode: normalized.postal,
    residentsCount: dataset.editableResidents.length
  }
);
```

**Beispiel:**
- **Address:** `Schnellweider Straße 12, 59557 Lippstadt`
- **Data:** `{"action":"dataset_create","datasetId":"abc123","street":"Schnellweider Straße","houseNumber":"12","city":"Lippstadt","postalCode":"59557","residentsCount":3}`

#### Resident aktualisieren (`PUT /api/address-datasets/residents`)
```typescript
await logUserActivityWithRetry(
  req,
  dataset.normalizedAddress,
  undefined,
  undefined,
  { // ✅ Data field
    action: 'resident_update', // oder 'resident_delete'
    datasetId: data.datasetId,
    residentIndex: data.residentIndex,
    residentName: data.residentData?.name,
    residentStatus: data.residentData?.status
  }
);
```

**Beispiel:**
- **Address:** `Schnellweider Straße 12, 59557 Lippstadt`
- **Data:** `{"action":"resident_update","datasetId":"abc123","residentIndex":0,"residentName":"Max Mustermann","residentStatus":"interessiert"}`

#### Bulk Resident Update (`PUT /api/address-datasets/bulk-residents`)
```typescript
await logUserActivityWithRetry(
  req,
  dataset.normalizedAddress,
  undefined,
  undefined,
  { // ✅ Data field
    action: 'bulk_residents_update',
    datasetId: data.datasetId,
    residentsCount: data.editableResidents.length,
    residents: data.editableResidents.map(r => ({
      name: r.name,
      status: r.status
    }))
  }
);
```

**Beispiel:**
- **Address:** `Schnellweider Straße 12, 59557 Lippstadt`
- **Data:** `{"action":"bulk_residents_update","datasetId":"abc123","residentsCount":3,"residents":[{"name":"Max Mustermann","status":"interessiert"},{"name":"Erika Musterfrau","status":"nicht_interessiert"},{"name":"Hans Schmidt","status":"termin_vereinbart"}]}`

#### GPS Geocoding (`POST /api/geocode`)
```typescript
await logUserActivityWithRetry(
  req,
  addressString,
  undefined,
  undefined,
  { // ✅ Data field
    action: 'geocode',
    latitude,
    longitude,
    street: address.street,
    number: address.number,
    postal: address.postal,
    city: address.city
  }
);
```

**Beispiel:**
- **Address:** `Schnellweider Straße 12, 59557 Lippstadt`
- **Data:** `{"action":"geocode","latitude":51.665691,"longitude":8.351526,"street":"Schnellweider Straße","number":"12","postal":"59557","city":"Lippstadt"}`

## Änderungen in Code-Dateien

### Modifizierte Dateien:

1. **`server/services/googleSheetsLogging.ts`**
   - Header erweitert: `A1:J1` (statt `A1:I1`)
   - `logUserActivity()` mit `data?: any` Parameter
   - `batchAppendToWorksheet()` Range: `A:J` (statt `A:I`)

2. **`server/services/enhancedLogging.ts`**
   - `logUserActivityWithRetry()` mit `data?: any` Parameter
   - `LogEntry` Interface erweitert

3. **`server/services/fallbackLogging.ts`**
   - `LogEntry` Interface erweitert mit `data?: any`

4. **`server/services/batchLogger.ts`**
   - `flushUserActivityLogs()` serialisiert `data` zu JSON
   - Log-Rows enthalten 10 Spalten (statt 9)

5. **`server/routes/tracking.ts`**
   - Alle 3 Tracking-Endpunkte loggen strukturierte Daten

6. **`server/routes/addressDatasets.ts`**
   - POST `/` - Dataset-Erstellung
   - PUT `/residents` - Resident-Update
   - PUT `/bulk-residents` - Bulk-Update

7. **`server/routes.ts`**
   - POST `/api/geocode` - GPS-Koordinaten und Adresse

## Vorteile

### ✅ Keine Datenverluste mehr
Alle Tracking-Daten werden jetzt vollständig in Google Sheets gespeichert.

### ✅ Strukturierte Daten
JSON-Format in "Data"-Spalte ermöglicht einfaches Parsen und Auswerten.

### ✅ Abwärtskompatibilität
Bestehende Logs ohne "Data"-Spalte bleiben gültig (leere Spalte).

### ✅ Flexibilität
Jeder Endpunkt kann beliebige strukturierte Daten loggen.

### ✅ Historische Daten-Rekonstruktion
`historicalDataScraper.ts` kann aus Logs:
- GPS-Pfade rekonstruieren
- Session-Zeiten berechnen
- Device-Status analysieren
- Activity Score berechnen

## Batch Logging

Alle Logs werden **gebatched** alle 15 Sekunden in Google Sheets geschrieben:
- Reduziert API-Calls
- Verbessert Performance
- Retry-Logik mit Exponential Backoff
- Fallback zu `failed-logs.jsonl` bei Fehlern

## Migration bestehender Daten

**Keine Migration nötig!** Bestehende Logs bleiben unverändert. Die neue "Data"-Spalte ist optional. `historicalDataScraper.ts` prüft ob `Data`-Spalte vorhanden ist und verwendet sie wenn verfügbar.

## Testing

### Manuelle Tests:
1. **GPS Tracking:** App öffnen → GPS-Updates sollten in Sheets erscheinen
2. **Session Tracking:** Actions ausführen → Session-Logs in Sheets
3. **Device Tracking:** Device-Status-Changes → Device-Logs in Sheets
4. **Dataset Creation:** Neuen Datensatz anlegen → `action: 'dataset_create'` in Sheets
5. **Resident Update:** Status ändern → `action: 'resident_update'` in Sheets
6. **Geocoding:** GPS-Abfrage → Koordinaten in "Data"-Spalte

### Google Sheets prüfen:
```
1. Öffne Spreadsheet: 1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw
2. Worksheet: [username]_[userId]
3. Spalte J ("Data") prüfen
4. JSON-Format validieren
```

## Bekannte Einschränkungen

- **Max. JSON-Größe:** Google Sheets Zellen: ~50.000 Zeichen
  - Lösung: Logs werden automatisch gebatched, große Arrays vermeiden
- **Batch-Delay:** 15 Sekunden bis Logs in Sheets erscheinen
  - Lösung: Bei Bedarf `batchLogger.forceFlushNow()` aufrufen

## Nächste Schritte

Mit dieser Implementierung sind alle Daten vollständig persistiert. Die Admin-Dashboard-APIs (Phase 3) können jetzt:
- Historische Daten aus Google Sheets scrapen
- DailyUserData rekonstruieren
- PDF-Reports mit allen KPIs generieren
- Live-Tracking anzeigen

**Version:** 2.3.5  
**Datum:** 17. Oktober 2025  
**Status:** ✅ Produktiv deployed
