# Google Sheets Architektur - Übersicht

## 📊 Zusammenfassung

Das System verwendet Google Sheets als **primäre Datenbank** mit verschiedenen Caching- und Batching-Strategien für Performance-Optimierung.

---

## 🗄️ Datenbanken & Caching-Strategien

### 1️⃣ **RAM-First mit Background Sync (Write-Back Cache)**
**Federführend: RAM | Google Sheets: Mirror (alle 60s)**

#### **Address Datasets (Kundendaten)**
- **Service**: `DatasetCache` in `server/services/googleSheets.ts`
- **Spreadsheet**: "Adressen" Sheet (ID: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`)
- **Strategie**: 
  - ✅ **Alle Datasets werden beim Start in RAM geladen** (3.252 Datasets aktuell)
  - ✅ **Alle Lese-Operationen aus RAM** (keine Sheets-Abfragen)
  - ✅ **Schreib-Operationen updaten RAM sofort** + markieren als "dirty"
  - ✅ **Background-Job synct dirty Datasets alle 60 Sekunden zu Sheets**
  - ⚠️ **Nur bei Neuanlage wird sofort in Sheets geschrieben** (mit Fallback)

**Operationen:**
```typescript
// Beim Server-Start (einmalig)
datasetCache.initialize(addressDatasetService)
  → loadAllDatasetsFromSheets() // Liest ALLE Datasets aus Sheets

// Lesen (immer aus RAM, 0 Sheets-Calls)
datasetCache.getByAddress(address) // O(1) Map-Lookup
datasetCache.get(datasetId)        // O(1) Map-Lookup
datasetCache.getAll()              // O(1) Array aus Cache

// Schreiben (RAM + Mark Dirty, 0 Sheets-Calls)
datasetCache.set(dataset, markDirty: true)
  → cache.set(dataset.id, dataset)
  → dirtyDatasets.add(dataset.id)

// Background-Sync (automatisch alle 60s)
syncInterval → syncDirtyDatasets()
  → writeDatasetToSheets(dataset) // Für jedes dirty Dataset
```

**Vorteile:**
- ⚡ Extrem schnelle Lese-Operationen (kein Netzwerk-Latenz)
- 📦 Batch-Updates zu Sheets reduzieren API-Calls drastisch
- 🔄 Daten bleiben auch bei Sheets-Ausfällen im RAM verfügbar

**Nachteile:**
- ⚠️ Bei Server-Crash können max. 60s Daten verloren gehen (dirty Datasets)
- 🔄 Multi-Server-Setup würde Synchronisations-Konflikte verursachen

---

### 2️⃣ **Batch-Write mit Delay (15s Buffer)**
**Federführend: RAM Buffer | Google Sheets: Target**

#### **User Activity Logs (Tracking-Daten)**
- **Service**: `BatchLogger` in `server/services/batchLogger.ts`
- **Spreadsheet**: User-spezifische Worksheets `{username}_{userId}` (ID: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`)
- **Strategie**:
  - ✅ **Logs werden in RAM-Queue gesammelt** (Map<userId, LogEntry[]>)
  - ✅ **Alle 15 Sekunden werden Queues geflusht**
  - ✅ **Batch-Append zu Google Sheets** (mehrere Logs auf einmal)
  - ⚠️ **Keine Lese-Operationen** (Sheets ist Write-Only Target)

**Operationen:**
```typescript
// Log hinzufügen (sofort in RAM-Queue)
batchLogger.addUserActivity(logEntry)
  → queue.get(userId).push(logEntry)

// Automatischer Flush alle 15s
setInterval(flush, 15000)
  → GoogleSheetsLoggingService.batchAppendToWorksheet(worksheetName, logRows)
    → sheetsClient.spreadsheets.values.append()
```

**Log-Typen:**
- GPS-Tracking (`/api/tracking/gps`)
- Foto-Uploads (`/api/photos/upload`)
- Adress-Suchen (`/api/search/address`)
- Bewohner-Aktionen (`/api/datasets/:id/residents`)
- App-Status (`/api/tracking/app-status`)

**Vorteile:**
- 🚀 Reduziert API-Calls um ~95% (statt pro Log, alle 15s batched)
- ⚡ Keine Verzögerung für App-Requests
- 📊 Chronologisch sortierte Logs

---

### 3️⃣ **Daily RAM Store (Nur RAM, kein Sync)**
**Federführend: RAM | Google Sheets: Nie (nur manueller Export)**

#### **Tagesaktueller Tracking-Status**
- **Service**: `DailyDataStore` in `server/services/dailyDataStore.ts`
- **Spreadsheet**: ❌ **Keine Google Sheets Integration!**
- **Strategie**:
  - ✅ **Alle Daten nur in RAM** (Map<userId, DailyUserData>)
  - ✅ **Automatisches Reset um Mitternacht**
  - ✅ **Wird NUR für Admin-Dashboard verwendet**
  - ⚠️ **Daten gehen bei Server-Restart verloren** (absichtlich!)

**Daten:**
```typescript
DailyUserData {
  userId, username, date,
  gpsPoints: GPSCoordinates[],      // GPS-Punkte des Tages
  photoCount: number,                // Foto-Anzahl
  lastAppStatus: string,             // Letzter App-Status
  uniquePhotoAddresses: Set<string>, // Eindeutige Adressen
  newProspects: number,              // Neue Interessenten
  existingCustomers: number,         // Bestandskunden
  // ... KPIs
}
```

**Operationen:**
```typescript
// Daten hinzufügen (nur RAM)
dailyDataStore.addGPS(userId, username, gps)
dailyDataStore.trackOCRPhoto(userId, username, prospectData)
dailyDataStore.updateSession(userId, username, session)

// Lesen (nur RAM)
dailyDataStore.getUserDailyData(userId)
dailyDataStore.getAllUsersData()

// Automatisch um Mitternacht
dailyDataStore.reset() → this.data.clear()
```

**Vorteile:**
- ⚡⚡⚡ Extremst schnell (reine RAM-Operationen)
- 📊 Perfekt für Echtzeit-Dashboard
- 🔄 Kein Sync-Overhead

**Nachteile:**
- ⚠️ Daten gehen bei Restart verloren (aber eh nur für heute relevant)
- 📊 Keine Historie (nur aktueller Tag)

---

### 4️⃣ **Direct Write (Sofort zu Sheets)**
**Federführend: Google Sheets | RAM: Gar nicht**

#### **4.1 Authentifizierung (Passwörter & User-Daten)**
- **Service**: `GoogleSheetsService` in `server/services/googleSheets.ts`
- **Spreadsheet**: "Zugangsdaten" Sheet (ID: `1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s`)
- **Strategie**:
  - ✅ **Jeder Login liest direkt aus Sheets**
  - ✅ **Keine Caching-Strategie** (Sicherheit!)
  - ⚠️ **Sofortige Sheets-Abfrage pro Request**

**Operationen:**
```typescript
// Bei jedem Login (direkter Sheets-Call)
googleSheetsService.getPasswordUserMap()
  → sheetsClient.spreadsheets.values.get(range: 'A2:D')

googleSheetsService.isUserAdmin(password)
  → sheetsClient.spreadsheets.values.get(range: 'A2:D')

googleSheetsService.getUserPostalCodes(username)
  → sheetsClient.spreadsheets.values.get(range: 'A2:C')

// FollowMee Device IDs (seit heute)
googleSheetsService.getAllUsers()
  → sheetsClient.spreadsheets.values.get(range: 'A2:E')
```

**Spalten:**
- A: Passwort
- B: Username
- C: Postleitzahlen (kommagetrennt)
- D: Admin-Rolle ('admin' oder leer)
- E: FollowMee Device ID (neu seit heute)

**Warum kein Cache?**
- 🔒 Sicherheit: Passwort-Änderungen müssen sofort wirksam werden
- 👥 Multi-User: Keine Synchronisations-Probleme zwischen Servern
- 📊 Selten: Login passiert nicht oft genug für Performance-Probleme

---

#### **4.2 Termine (Appointments)**
- **Service**: `AppointmentService` in `server/services/googleSheets.ts`
- **Spreadsheet**: "Termine" Sheet (ID: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`)
- **Strategie**:
  - ✅ **RAM-Cache mit manueller Sync** (alle 60s bei Lesezugriff)
  - ✅ **Schreib-Operationen gehen sofort zu Sheets** + Cache-Update
  - ⚠️ **Cache wird nur bei Read aktualisiert** (lazy loading)

**Operationen:**
```typescript
// Termin erstellen (sofort zu Sheets + Cache)
appointmentService.createAppointment(...)
  → sheetsClient.spreadsheets.values.append()
  → appointmentsCache.set(id, appointment)

// Termin lesen (aus Cache, ggf. Sync)
appointmentService.getUserAppointments(username)
  → if (cacheAge > 60s) syncFromSheets()
  → return appointmentsCache.values().filter(...)

// Termin löschen (sofort aus Sheets + Cache)
appointmentService.deleteAppointment(id)
  → sheetsClient.spreadsheets.batchUpdate({ deleteDimension })
  → appointmentsCache.delete(id)
```

**Hybrid-Ansatz:**
- 📖 Lesen: Aus Cache (mit 60s TTL)
- ✍️ Schreiben: Sofort zu Sheets + Cache-Update
- 🔄 Sync: Lazy (nur bei Read wenn Cache stale)

---

#### **4.3 Kategorie-Änderungen (Audit Log)**
- **Service**: `CategoryChangeLoggingService` in `server/services/googleSheets.ts`
- **Spreadsheet**: "Log_Änderung_Kategorie" Sheet (ID: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`)
- **Strategie**:
  - ✅ **Jede Kategorie-Änderung wird sofort geloggt**
  - ❌ **Kein Cache, keine Queue** (audit trail)
  - ⚠️ **Direkter Sheets-Append pro Änderung**

**Operationen:**
```typescript
// Bei jeder Kategorie-Änderung (sofort zu Sheets)
categoryChangeLoggingService.logCategoryChange(...)
  → sheetsClient.spreadsheets.values.append()
```

**Warum kein Batching?**
- 🔐 Audit-Trail: Jede Änderung muss sofort persistent sein
- 📊 Selten: Kategorie-Änderungen passieren nicht oft
- 🔍 Compliance: Nachvollziehbarkeit wichtiger als Performance

---

#### **4.4 FollowMee GPS Sync (Chronologisches Insert)**
- **Service**: `FollowMeeApiService` in `server/services/followMeeApi.ts`
- **Spreadsheet**: User Logs `{username}_{userId}` (ID: `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw`)
- **Strategie** (NEU seit heute):
  - ✅ **Liest alle bestehenden Logs aus Sheets**
  - ✅ **Merged mit neuen GPS-Daten**
  - ✅ **Sortiert chronologisch nach Timestamp**
  - ✅ **Überschreibt komplettes Worksheet**
  - ⚠️ **Performance-Impact bei vielen Logs** (11.000+ Einträge)

**Operationen:**
```typescript
// Alle 5 Minuten (automatisch)
followMeeSyncScheduler.syncNow()
  → followMeeApi.syncAllUsers()
    → fetchHistoryForAllDevices(1 hour)
    → insertLocationsChronologically()
      → GoogleSheetsLoggingService.batchInsertChronologically()
        1. sheetsClient.spreadsheets.values.get() // Alle Logs lesen
        2. Merge + Sort nach Timestamp
        3. sheetsClient.spreadsheets.values.clear() // Alte Logs löschen
        4. sheetsClient.spreadsheets.values.update() // Alle Logs schreiben
```

**Performance:**
- David: 11.336 Einträge → ~3-5 Sekunden
- Imi: 6.141 Einträge → ~2-3 Sekunden
- ✅ Akzeptabel für 5-Minuten-Intervall
- ⚠️ Skaliert nicht gut bei >50.000 Einträgen

---

### 5️⃣ **Read-Only Cache (Validierte Adressen)**
**Federführend: Google Sheets | RAM: Read-Only Mirror**

#### **Validierte Straßennamen**
- **Service**: `ValidatedStreetCache` in `server/services/googleSheets.ts`
- **Spreadsheet**: "Adressen" Sheet (nutzt Address Datasets)
- **Strategie**:
  - ✅ **Lädt alle validierten Adressen beim Start**
  - ✅ **Nur Lese-Operationen aus RAM**
  - ✅ **Neue validierte Adressen werden in RAM hinzugefügt**
  - ⚠️ **Kein Sync zurück zu Sheets** (passiv)

**Operationen:**
```typescript
// Beim Server-Start (einmalig)
validatedStreetCache.initialize()
  → addressDatasetService.getAllDatasets()
  → Extracts street + postal → cache

// Adress-Validierung prüfen (aus RAM)
validatedStreetCache.getValidated(street, postal)
  → if (found) skip Google Geocoding API
  → else call Google API + add to cache

// Neue validierte Adresse (nur RAM)
validatedStreetCache.add(street, postal, city)
```

**Zweck:**
- 💰 **Reduziert Google Geocoding API Kosten** (0,005 USD pro Request)
- ⚡ **Instant Address Validation** für bekannte Adressen
- 📊 **Aktuell ~3.250 validierte Adressen**

---

### 6️⃣ **Customer Data (Externe Tabelle)**
- **Service**: `CustomerDataStorage` in `server/storage.ts`
- **Spreadsheet**: Separates Sheet (ID aus `GOOGLE_SHEETS_SPREADSHEET_ID`)
- **Strategie**:
  - ✅ **Direct Write bei Kunden-Erstellung**
  - ⚠️ **Keine Caching-Strategie**
  - 📊 **Legacy-System** (wird kaum noch genutzt)

---

## 📈 Performance-Übersicht

### API-Call Reduktion durch Caching/Batching

| System | Ohne Optimization | Mit Optimization | Reduktion |
|--------|-------------------|------------------|-----------|
| **Address Datasets** | ~1000 Calls/h | ~60 Calls/h | **-94%** |
| **User Activity Logs** | ~500 Calls/h | ~240 Calls/h (alle 15s) | **-52%** |
| **Daily Tracking** | ~500 Calls/h | 0 Calls/h | **-100%** |
| **FollowMee GPS** | 12 Calls/h (pro 5min) | 12 Calls/h | 0% (aber chronologisch!) |
| **Authentication** | ~50 Calls/h | ~50 Calls/h | 0% (Sicherheit) |

**Gesamt-Einsparung: ~85% weniger Google Sheets API Calls**

---

## 🔄 Sync-Intervalle

| System | Intervall | Trigger |
|--------|-----------|---------|
| **Address Datasets** | 60 Sekunden | Timer-basiert |
| **User Activity Logs** | 15 Sekunden | Timer-basiert |
| **Daily Tracking** | Nie (RAM only) | - |
| **FollowMee GPS** | 5 Minuten | Timer-basiert |
| **Appointments** | 60 Sekunden (lazy) | Bei Lesezugriff |
| **Authentication** | Sofort (per Request) | Pro Login |

---

## 🚨 Datenverlust-Risiko

| System | Max. Datenverlust bei Crash | Akzeptabel? |
|--------|------------------------------|-------------|
| **Address Datasets** | 60 Sekunden | ✅ Ja (nur geänderte Datasets) |
| **User Activity Logs** | 15 Sekunden | ✅ Ja (Tracking-Daten) |
| **Daily Tracking** | Gesamter Tag | ✅ Ja (nur Dashboard) |
| **FollowMee GPS** | 0 (schreibt sofort) | ✅ Ja |
| **Appointments** | 0 (schreibt sofort) | ✅ Ja |
| **Authentication** | 0 (kein Write) | ✅ Ja |

---

## 🎯 Empfehlungen

### ✅ Gut optimiert:
1. **Address Datasets**: Perfekte RAM-First Strategie
2. **Daily Tracking**: Richtig für Use-Case (Dashboard)
3. **FollowMee GPS**: Chronologisches Insert gelöst (neu!)

### ⚠️ Verbesserungspotenzial:
1. **User Activity Logs**: 
   - Könnte auf 30-60s Intervall erhöht werden
   - Aktuell 15s ist sehr aggressiv
   
2. **Appointments**:
   - Könnte auf gleiche Strategie wie Datasets umgestellt werden
   - Aktuell Hybrid-Ansatz nicht optimal

3. **Authentication**:
   - Könnte mit 5-Minuten-Cache versehen werden
   - Reduziert Sheets-Calls bei Multi-Logins

### 🔮 Zukünftige Skalierung:
- Bei >10.000 Address Datasets: Pagination einführen
- Bei >100.000 Logs: FollowMee Insert wird zu langsam
- Multi-Server Setup: Würde Redis/DB erfordern

---

## 📊 Spreadsheet-IDs

| Name | ID | Zweck |
|------|----|-
| **Zugangsdaten** | `1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s` | User Auth |
| **Tracking Logs** | `1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw` | Alle Logs + Datasets |
| **Customer Data** | Aus ENV Variable | Legacy System |

---

**Erstellt**: 5. November 2025  
**Letzte Aktualisierung**: Nach FollowMee chronologischem Insert
