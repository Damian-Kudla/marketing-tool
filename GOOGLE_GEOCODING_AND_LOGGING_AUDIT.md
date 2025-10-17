# 🗺️ Google Geocoding API & Logging Audit

## Übersicht
Dieses Dokument analysiert **wann** Google Geocoding API-Abfragen ausgelöst werden und **welche** User-Aktivitäten in Google Sheets geloggt werden, einschließlich Sicherheitsanalyse der Logging-Infrastruktur.

---

## 📍 TEIL 1: Google Geocoding API - Wann werden Abfragen ausgelöst?

### **1.1 POST /api/address-datasets** (Neuen Datensatz erstellen)
**Datei**: `server/routes/addressDatasets.ts:126`

**Trigger**: User legt einen neuen Datensatz an (nach OCR-Scan oder manuelle Eingabe)

**Code-Flow**:
```typescript
router.post('/', async (req, res) => {
  // 1. Validierung: Straße, Hausnummer, PLZ MÜSSEN vorhanden sein
  if (!data.address.street?.trim()) → Error
  if (!data.address.number?.trim()) → Error  
  if (!data.address.postal?.trim()) → Error
  
  // 2. ✅ GEOCODING API CALL
  normalized = await normalizeAddress(
    data.address.street,
    data.address.number,
    data.address.city,
    data.address.postal,
    username // Für Rate Limiting
  );
  
  // 3. Validierung des Ergebnisses
  if (!normalized) → Error: Adresse nicht gefunden
  
  // 4. Check: Existiert bereits ein Datensatz?
  existingDataset = await addressDatasetService.getRecentDatasetByAddress(...)
  
  // 5. Datensatz erstellen mit normalisierten Daten
  dataset = await addressDatasetService.createAddressDataset({
    normalizedAddress: normalized.formattedAddress,
    street: normalized.street,
    houseNumber: normalized.number, // User's Hausnummer!
    city: normalized.city,
    postalCode: normalized.postal,
  });
}
```

**Was wird validiert?**
- ✅ Straßenname existiert in Google Maps
- ✅ PLZ existiert und passt zur Stadt
- ❌ Hausnummer wird NICHT validiert (User-Eingabe bleibt erhalten)

**Rate Limit**: Max 10 Requests/Minute pro User

---

### **1.2 GET /api/address-datasets** (Datensätze abrufen)
**Datei**: `server/routes/addressDatasets.ts:256`

**Trigger**: User sucht nach Datensätzen für eine Adresse

**Code-Flow**:
```typescript
router.get('/', async (req, res) => {
  // Query params: street, number, city, postal
  const address = addressSchema.parse(req.query);
  
  // ✅ GEOCODING API CALL
  const normalized = await normalizeAddress(
    address.street,
    address.number,
    address.city,
    address.postal,
    username
  );
  
  if (!normalized) → Error: Adresse nicht gefunden
  
  // Datensätze abrufen mit flexiblem House-Number-Matching
  const datasets = await addressDatasetService.getAddressDatasets(
    normalized.formattedAddress, 
    5, 
    address.number
  );
}
```

**Zweck**: Adresse normalisieren bevor Datensätze gesucht werden

**Rate Limit**: Max 10 Requests/Minute pro User

---

### **1.3 POST /api/geocode** (GPS → Adresse)
**Datei**: `server/routes.ts:244`

**Trigger**: User nutzt GPS-Funktion um Adresse automatisch zu ermitteln

**Code-Flow**:
```typescript
app.post("/api/geocode", requireAuth, rateLimitMiddleware('geocoding'), async (req, res) => {
  const { latitude, longitude } = req.body;
  
  // ✅ GEOCODING API CALL (Reverse Geocoding)
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${geocodingKey}&language=de`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  // Adresskomponenten extrahieren
  // Straße, Hausnummer, PLZ, Stadt
});
```

**Zweck**: GPS-Koordinaten → Lesbare Adresse

**Rate Limit**: Max 10 Requests/Minute pro User

---

### **1.4 Zusammenfassung: Wann wird Geocoding API aufgerufen?**

| Aktion | Endpoint | API Call | Zweck | Limit |
|--------|----------|----------|-------|-------|
| ✅ Datensatz erstellen | POST `/api/address-datasets` | `normalizeAddress()` | Adresse validieren & normalisieren | 10/min |
| ✅ Datensätze abrufen | GET `/api/address-datasets` | `normalizeAddress()` | Adresse normalisieren für Suche | 10/min |
| ✅ GPS-Abfrage | POST `/api/geocode` | Reverse Geocoding | GPS → Adresse | 10/min |

**NICHT aufgerufen bei**:
- ❌ Resident-Updates (PUT `/api/address-datasets/residents`)
- ❌ OCR-Scan (POST `/api/ocr`)
- ❌ Adresssuche (POST `/api/search-address`)
- ❌ Verlauf abrufen (GET `/api/address-datasets/history/:username/:date`)

---

## 📊 TEIL 2: User-Aktivitäten Logging

### **2.1 Was wird geloggt?**

#### **Log-Typ 1: User Activity Logs** (Pro User ein Worksheet)
**Datei**: `server/services/googleSheetsLogging.ts`  
**Spreadsheet ID**: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`  
**Worksheet Name**: `{username}_{userId}` (z.B. `michael_user123`)

**Spalten**:
| Spalte | Inhalt | Beispiel |
|--------|--------|----------|
| Timestamp | ISO 8601 Zeitstempel | `2025-10-17T14:30:00.000Z` |
| User ID | User-ID | `user123` |
| Username | Benutzername | `michael` |
| Endpoint | API-Pfad | `/api/ocr` |
| Method | HTTP-Methode | `POST` |
| Address | Adresse (wenn vorhanden) | `Schnellweider Straße 30, 41462 Neuss` |
| New Prospects | Neue Prospects (kommagetrennt) | `Max Mustermann, Anna Schmidt` |
| Existing Customers | Existierende Kunden | `John Doe (cust_789), Jane Doe (cust_790)` |
| User Agent | Browser/Device Info | `Mozilla/5.0...` |

---

#### **Log-Typ 2: Authentication Logs** (Zentral in "AuthLogs" Worksheet)
**Worksheet Name**: `AuthLogs`

**Spalten**:
| Spalte | Inhalt | Beispiel |
|--------|--------|----------|
| Timestamp | ISO 8601 Zeitstempel | `2025-10-17T14:30:00.000Z` |
| IP Address | Client IP-Adresse | `192.168.1.100` |
| Success | Login erfolgreich? | `SUCCESS` / `FAILED` |
| Username | Benutzername (oder "unknown") | `michael` |
| User ID | User-ID (oder "unknown") | `user123` |
| Reason | Grund für Status | `valid_password`, `invalid_password`, `rate_limit_exceeded` |

---

### **2.2 Welche Aktivitäten werden geloggt?**

#### ✅ **Geloggte Endpoints**:

**1. POST /api/ocr** (OCR-Scan durchführen)
```typescript
await GoogleSheetsLoggingService.logUserActivity(
  req, 
  addressString,          // "Schnellweider Straße 30, 41462 Neuss"
  newProspects,           // ["Max Mustermann", "Anna Schmidt"]
  existingCustomers       // [{name: "John Doe", id: "cust_789"}]
);
```

**2. POST /api/ocr-correct** (OCR-Korrektur nach manuellem Edit)
```typescript
await GoogleSheetsLoggingService.logUserActivity(
  req, 
  addressString, 
  newProspects, 
  existingCustomers
);
```

**3. POST /api/search-address** (Adresssuche)
```typescript
await GoogleSheetsLoggingService.logUserActivity(
  req, 
  addressString  // Nur Adresse, keine Prospects/Customers
);
```

**4. GET /api/customers** (Kundenliste abrufen)
```typescript
await GoogleSheetsLoggingService.logUserActivity(req);
// Nur Timestamp + User Info, keine Adresse
```

**5. POST /api/auth/login** (Login-Versuche)
```typescript
// Erfolgreicher Login
await GoogleSheetsLoggingService.logAuthAttempt(
  clientIP, 
  true,        // success
  username, 
  userId, 
  'valid_password'
);

// Fehlgeschlagener Login
await GoogleSheetsLoggingService.logAuthAttempt(
  clientIP, 
  false,       // failed
  undefined,   // username unknown
  undefined,   // userId unknown
  'invalid_password' | 'rate_limit_exceeded' | 'missing_password' | 'server_error'
);
```

---

#### ❌ **NICHT geloggte Endpoints**:

- ❌ POST `/api/address-datasets` (Datensatz erstellen)
- ❌ GET `/api/address-datasets` (Datensätze abrufen)
- ❌ PUT `/api/address-datasets/residents` (Resident-Status ändern)
- ❌ PUT `/api/address-datasets/bulk-residents` (Bulk-Update)
- ❌ GET `/api/address-datasets/history/:username/:date` (Verlauf)
- ❌ GET `/api/address-datasets/:id` (Einzelner Datensatz)
- ❌ POST `/api/category-change-log` (Kategorie-Änderung)
- ❌ POST `/api/geocode` (GPS-Abfrage)

---

### **2.3 Zusammenfassung: Logging-Coverage**

| Aktivität | Geloggt? | Log-Typ | Details |
|-----------|----------|---------|---------|
| ✅ Login-Versuch | JA | AuthLogs | IP, Success, Username, Reason |
| ✅ OCR-Scan | JA | User Activity | Adresse, New Prospects, Existing Customers |
| ✅ OCR-Korrektur | JA | User Activity | Adresse, New Prospects, Existing Customers |
| ✅ Adresssuche | JA | User Activity | Adresse |
| ✅ Kundenliste abrufen | JA | User Activity | Nur User + Timestamp |
| ❌ Datensatz erstellen | NEIN | - | - |
| ❌ Datensätze abrufen | NEIN | - | - |
| ❌ Resident-Update | NEIN | - | - |
| ❌ Verlauf anzeigen | NEIN | - | - |
| ❌ GPS-Abfrage | NEIN | - | - |
| ✅ Kategorie-Änderung | JA | Separate Sheet | Eigenes Logging-System |

---

## 🔒 TEIL 3: Logging-Sicherheit - Sind die Logs wasserdicht?

### **3.1 Aktuelle Error-Handling-Strategie**

#### ✅ **Fehlertolerante Implementierung**:
```typescript
static async logUserActivity(...): Promise<void> {
  // 1. Early Returns (keine Exception!)
  if (!req.userId || !req.username) {
    return; // Kein User → Skip logging
  }
  
  if (!sheetsEnabled || !sheetsClient) {
    console.warn('Google Sheets Logging API not available - skipping log');
    return; // API nicht verfügbar → Skip logging
  }
  
  try {
    // 2. Worksheet erstellen/finden
    const worksheetName = await this.ensureUserWorksheet(req.userId, req.username);
    
    // 3. Log-Row zusammenstellen
    const logRow = [...];
    
    // 4. Append to Google Sheets
    await sheetsClient.spreadsheets.values.append({...});
    
  } catch (error) {
    // ⚠️ KRITISCH: Fehler wird nur geloggt, nicht geworfen!
    console.error(`Failed to log to Google Sheets for user ${req.username}:`, error);
    // ❌ KEINE Exception → Request geht weiter
  }
}
```

**Verhalten bei Fehler:**
- ✅ Request schlägt NICHT fehl (User bekommt normale Response)
- ❌ Log geht VERLOREN (keine Retry-Logik!)
- ⚠️ Fehler nur in Server-Console sichtbar

---

### **3.2 Potenzielle Fehlerquellen (Logs gehen verloren)**

#### **Fehlerquelle 1: Google Sheets API nicht verfügbar**
```typescript
if (!sheetsEnabled || !sheetsClient) {
  console.warn('Google Sheets Logging API not available - skipping log');
  return; // ❌ LOG VERLOREN
}
```

**Ursachen:**
- Credentials fehlen / ungültig
- API-Initialisierung fehlgeschlagen
- Netzwerkproblem beim Server-Start

**Häufigkeit**: Selten (nur beim Server-Start)

---

#### **Fehlerquelle 2: Worksheet-Erstellung fehlschlägt**
```typescript
const worksheetName = await this.ensureUserWorksheet(req.userId, req.username);
// Wenn fehlschlägt → Exception → Catch-Block → LOG VERLOREN
```

**Ursachen:**
- Spreadsheet-ID ungültig
- Keine Schreibrechte
- Quota exceeded (Google Sheets API Limits)
- Netzwerkfehler

**Häufigkeit**: Selten (nur beim ersten Log eines neuen Users)

---

#### **Fehlerquelle 3: Append-Operation fehlschlägt**
```typescript
await sheetsClient.spreadsheets.values.append({...});
// Wenn fehlschlägt → Exception → Catch-Block → LOG VERLOREN
```

**Ursachen:**
- Netzwerkfehler (Timeout, Connection Reset)
- Rate Limit exceeded (Google Sheets API: 100 Requests/100 Sekunden pro User)
- Spreadsheet wurde gelöscht/verschoben
- Permissions geändert

**Häufigkeit**: **MITTEL** - kann bei hoher Last passieren!

---

#### **Fehlerquelle 4: Early Return bei fehlenden User-Daten**
```typescript
if (!req.userId || !req.username) {
  return; // ❌ LOG VERLOREN - aber gewollt (keine User-Info)
}
```

**Ursachen:**
- Auth-Middleware hat User nicht gesetzt (sollte nicht passieren bei `requireAuth`)
- Race Condition bei Session

**Häufigkeit**: **SEHR SELTEN** (nur bei Bug in Auth)

---

### **3.3 Logging-Lücken Zusammenfassung**

| Fehlertyp | Häufigkeit | Impact | Logs verloren? |
|-----------|------------|--------|----------------|
| API nicht verfügbar | Selten | Hoch | ✅ Alle Logs während Ausfall |
| Worksheet-Erstellung fehlschlägt | Selten | Niedrig | ✅ Erster Log pro User |
| Append fehlschlägt | **MITTEL** | **MITTEL** | ✅ Einzelne Logs |
| User-Daten fehlen | Sehr Selten | Niedrig | ✅ Einzelne Logs (gewollt) |
| Netzwerkfehler | Mittel | Mittel | ✅ Logs während Netzwerkproblem |
| Rate Limit | **Bei hoher Last** | Hoch | ✅ Logs bis Rate Limit zurückgesetzt |

---

## 🛡️ TEIL 4: Verbesserungsvorschläge - Logging wasserdicht machen

### **4.1 Problem: Keine Retry-Logik**

**Aktuell:**
```typescript
catch (error) {
  console.error(`Failed to log to Google Sheets:`, error);
  // ❌ Log ist verloren - keine zweite Chance!
}
```

**Vorschlag: Retry mit Exponential Backoff**
```typescript
async function logWithRetry(logFn: () => Promise<void>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await logFn();
      return; // ✅ Erfolg
    } catch (error) {
      if (i === maxRetries - 1) {
        // Letzter Versuch fehlgeschlagen → Fallback
        await fallbackLogging(logData);
      } else {
        // Warten und nochmal versuchen
        await sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
      }
    }
  }
}
```

**Vorteil**: Transiente Fehler (Netzwerk-Timeouts) werden ausgeglichen

---

### **4.2 Problem: Keine Fallback-Speicherung**

**Vorschlag: Lokales Fallback-Log**
```typescript
// server/services/fallbackLogging.ts
import fs from 'fs/promises';

class FallbackLogger {
  private logFile = './logs/failed-logs.jsonl';
  
  async saveFailed(logEntry: LogEntry) {
    try {
      // Als JSON Lines speichern
      await fs.appendFile(
        this.logFile, 
        JSON.stringify(logEntry) + '\n'
      );
      console.warn(`[Fallback] Log saved to file: ${logEntry.userId}`);
    } catch (error) {
      console.error('[Fallback] Even file logging failed!', error);
    }
  }
  
  // Cron-Job: Retry failed logs
  async retryFailedLogs() {
    const content = await fs.readFile(this.logFile, 'utf-8');
    const lines = content.split('\n').filter(l => l);
    
    for (const line of lines) {
      const entry = JSON.parse(line);
      try {
        await GoogleSheetsLoggingService.logUserActivity(...);
        // ✅ Erfolg → Aus Fallback-File entfernen
      } catch (error) {
        // ❌ Immernoch Fehler → Im File lassen
      }
    }
  }
}
```

**Vorteil**: Kein Log geht verloren, auch bei längeren Ausfällen

---

### **4.3 Problem: Keine Monitoring/Alerts**

**Vorschlag: Error-Tracking mit Metriken**
```typescript
class LoggingMetrics {
  private successCount = 0;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  
  recordSuccess() {
    this.successCount++;
  }
  
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = new Date();
    
    // ⚠️ Alert wenn zu viele Fehler
    const errorRate = this.failureCount / (this.successCount + this.failureCount);
    if (errorRate > 0.1) { // > 10% Fehlerrate
      this.sendAlert('HIGH_ERROR_RATE', errorRate);
    }
  }
  
  async sendAlert(type: string, value: number) {
    // Email, Slack, Discord, etc.
    console.error(`🚨 ALERT: ${type} = ${value}`);
  }
}
```

**Vorteil**: Du weißt sofort, wenn Logging ausfällt

---

### **4.4 Problem: Rate Limit bei hoher Last**

**Vorschlag: Batch-Logging mit Queue**
```typescript
class BatchLogger {
  private queue: LogEntry[] = [];
  private batchSize = 10;
  private flushInterval = 5000; // 5 Sekunden
  
  constructor() {
    setInterval(() => this.flush(), this.flushInterval);
  }
  
  async log(entry: LogEntry) {
    this.queue.push(entry);
    
    if (this.queue.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async flush() {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.batchSize);
    
    try {
      // Alle Logs in einem API-Call
      await sheetsClient.spreadsheets.values.append({
        range: `...`,
        resource: {
          values: batch.map(entry => [/* ... */])
        }
      });
    } catch (error) {
      // ❌ Batch fehlgeschlagen → Zurück in Queue
      this.queue.unshift(...batch);
    }
  }
}
```

**Vorteil**: Weniger API-Calls = weniger Rate-Limit-Probleme

---

### **4.5 Problem: Fehlende Endpoints im Logging**

**Aktuell nicht geloggt:**
- POST `/api/address-datasets` (Datensatz erstellen)
- GET `/api/address-datasets` (Datensätze abrufen)
- PUT `/api/address-datasets/residents` (Resident-Status ändern)
- POST `/api/geocode` (GPS-Abfrage)

**Vorschlag: Logging für alle kritischen Endpoints**
```typescript
// In addressDatasets.ts
router.post('/', async (req, res) => {
  try {
    // ... Datensatz erstellen ...
    
    // ✅ Logging hinzufügen
    await GoogleSheetsLoggingService.logUserActivity(
      req,
      normalized.formattedAddress, // Adresse
      undefined, // keine Prospects
      undefined, // keine Customers
      'dataset_created' // Extra Info
    );
    
    res.json(dataset);
  } catch (error) {
    // ...
  }
});
```

**Vorteil**: Vollständige Audit-Trail aller User-Aktivitäten

---

## 📋 TEIL 5: Implementierungs-Roadmap

### **Priority 1: KRITISCH (Sofort implementieren)**
1. ✅ **Fallback-Logging zu Datei** → Kein Log geht verloren
2. ✅ **Retry-Logik mit Exponential Backoff** → Transiente Fehler ausgleichen
3. ✅ **Error-Tracking/Metriken** → Wissen, wenn etwas kaputt ist

### **Priority 2: WICHTIG (Binnen 1 Woche)**
4. ✅ **Batch-Logging für hohe Last** → Rate Limits vermeiden
5. ✅ **Cron-Job für Fallback-Retry** → Verlorene Logs nachsenden
6. ✅ **Logging für alle Endpoints** → Vollständiger Audit-Trail

### **Priority 3: NICE-TO-HAVE (Optional)**
7. ✅ **Health-Check Endpoint** → Monitoring-Integration
8. ✅ **Log-Archivierung** → Alte Logs in BigQuery/S3
9. ✅ **Real-time Dashboard** → Logs visualisieren

---

## 🎯 Fazit

### **Geocoding API:**
- Wird bei **3 Endpoints** aufgerufen: Datensatz erstellen, Datensätze abrufen, GPS-Abfrage
- **Zweck**: Adresse validieren, normalisieren, GPS → Adresse
- **Rate Limit**: 10 Requests/Minute pro User
- **Nicht** bei: Resident-Updates, OCR-Scan, Adresssuche

### **Logging:**
- ✅ **Geloggt**: Login, OCR-Scan, OCR-Korrektur, Adresssuche, Kundenliste
- ❌ **Nicht geloggt**: Datensatz-CRUD, GPS-Abfrage, Verlauf
- ⚠️ **Logging-Lücken**: 
  - Keine Retry bei Fehler
  - Keine Fallback-Speicherung
  - Rate Limits bei hoher Last
  - ~30-40% der kritischen Endpoints nicht geloggt

### **Sicherheit:**
- 🔴 **NICHT wasserdicht**: Logs können bei Netzwerkfehlern, Rate Limits oder API-Ausfällen verloren gehen
- 🟡 **Mittel-hohes Risiko**: Bei hoher Last oder instabiler Netzwerkverbindung
- 🟢 **Empfehlung**: Implementierung von Fallback-Logging + Retry-Logik (Priority 1)

---

**Erstellt**: 2025-10-17  
**Version**: 1.0  
**Nächster Review**: Nach Implementierung der Priority 1 Verbesserungen
