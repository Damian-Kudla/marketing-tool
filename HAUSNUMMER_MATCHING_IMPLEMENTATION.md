# Hausnummer-Bereich Matching - Implementierung (Option 3: Hybrid-Ansatz)

## Übersicht

Implementierung der **Option 3 (Hybrid-Ansatz)** aus der Analyse (siehe `HAUSNUMMER_BEREICH_ANALYSE.md`).

### Kernprinzipien

1. **Bestandskunden**: Hausnummern-Bereiche werden expandiert für Transparenz
   - "1-3" wird zu ["1", "2", "3"]
   - User sieht alle Kunden, die zu seinen Eingaben passen
   - Deduplizierung verhindert mehrfache Anzeige

2. **Datensätze**: Granulare 30-Tage-Sperrung
   - Datensatz "1,2" sperrt nur "1", "2", "1,2" und "1-3"
   - Datensatz "1,2" sperrt NICHT "3"
   - Verhindert unnötige Blockierung ganzer Straßen

3. **30-Tage-Regel**: User-Input wird bereits verarbeitet (nicht 3 Monate!)
   - Sperre gilt 30 Tage ab Erstellung
   - Creator kann immer neue Datensätze erstellen

## Technische Details

### 1. DatasetCache Erweiterung (`server/services/googleSheets.ts`)

#### Neue Hilfsfunktionen:
- **`extractHouseNumbers(houseNumberStr: string): string[]`**
  - Extrahiert einzelne Hausnummern aus einer kommagetrennten Liste
  - Beispiel: `"30,31,32,33"` → `["30", "31", "32", "33"]`

- **`addressMatches(...): boolean`**
  - Vergleicht zwei Adressen mit flexibler Hausnummern-Logik
  - Prüft zuerst, ob Straße, PLZ und Stadt übereinstimmen
  - Dann prüft, ob mindestens eine Hausnummer übereinstimmt

#### Aktualisierte `getByAddress` Methode:
```typescript
getByAddress(normalizedAddress: string, limit?: number, houseNumber?: string): AddressDataset[]
```
- Neuer optionaler Parameter `houseNumber` für flexible Suche
- Wenn Hausnummern vorhanden: Verwendet `addressMatches()` für intelligente Suche
- Sonst: Fallback auf exakte Übereinstimmung

#### Bidirektionale Matching-Logik:
Die `addressMatches` Funktion prüft in **beide Richtungen**:
1. **Vorwärts**: Ist eine Such-Hausnummer im Dataset enthalten?
   - Beispiel: Suche "1" findet Dataset "1,2" ✅
2. **Rückwärts**: Ist eine Dataset-Hausnummer in der Suche enthalten?
   - Beispiel: Suche "1,2" findet Dataset "1" ✅

Dies verhindert:
- Duplikate mit Teilmengen (z.B. "1" wenn "1,2" existiert)
- Duplikate mit Obermengen (z.B. "1,2" wenn "1" existiert)
- Überschneidende Datasets (z.B. "1,2,3" wenn "2" existiert)

### 2. Service-Layer Updates

**`AddressDatasetService.getAddressDatasets()`**
```typescript
async getAddressDatasets(normalizedAddress: string, limit: number = 5, houseNumber?: string): Promise<AddressDataset[]>
```
- Leitet Hausnummer an Cache weiter

**`AddressDatasetService.getTodaysDatasetByAddress()`**
```typescript
async getTodaysDatasetByAddress(normalizedAddress: string, houseNumber?: string): Promise<AddressDataset | null>
```
- Nutzt flexible Suche auch für heutige Datasets

### 3. Route Updates (`server/routes/addressDatasets.ts`)

**GET `/api/address-datasets`**
- Übergibt `address.number` an Service für flexible Suche

**POST `/api/address-datasets`**
- Prüft Duplikate mit flexibler Hausnummernsuche

### 4. Interface Updates
```typescript
export interface AddressSheetsService {
  getAddressDatasets(normalizedAddress: string, limit?: number, houseNumber?: string): Promise<AddressDataset[]>;
  getTodaysDatasetByAddress(normalizedAddress: string, houseNumber?: string): Promise<AddressDataset | null>;
  // ... andere Methoden
}
```

## Beispiel-Szenarien

### Szenario 1: Suche nach einzelner Hausnummer
- **Aktion**: Benutzer sucht nach "Musterstraße 30"
- **Im System**: Dataset existiert mit "Musterstraße 30,31,32,33"
- **Ergebnis**: ✅ Dataset wird gefunden

### Szenario 2: Suche nach mehreren Hausnummern
- **Aktion**: Benutzer sucht nach "Musterstraße 30,32"
- **Im System**: Dataset existiert mit "Musterstraße 30,31,32,33"
- **Ergebnis**: ✅ Dataset wird gefunden (30 und 32 sind enthalten)

### Szenario 3: Keine Übereinstimmung
- **Aktion**: Benutzer sucht nach "Musterstraße 35"
- **Im System**: Dataset existiert mit "Musterstraße 30,31,32,33"
- **Ergebnis**: ❌ Dataset wird NICHT gefunden

### Szenario 4: Exakte Übereinstimmung
- **Aktion**: Benutzer sucht nach "Musterstraße 30"
- **Im System**: Dataset existiert mit "Musterstraße 30"
- **Ergebnis**: ✅ Dataset wird gefunden (wie vorher)

## Bidirektionale Duplikatsprüfung

### Szenario 5: Teilmenge verhindern (NEU)
- **Aktion**: Benutzer will "Musterstraße 1" anlegen
- **Im System**: Dataset existiert bereits mit "Musterstraße 1,2"
- **Logik**: "1" ist in ["1", "2"] enthalten
- **Ergebnis**: ❌ **409 Conflict** - Dataset bereits vorhanden

### Szenario 6: Superset verhindern (NEU)
- **Aktion**: Benutzer will "Musterstraße 1,2,3" anlegen
- **Im System**: Dataset existiert bereits mit "Musterstraße 2"
- **Logik**: "2" (aus Dataset) ist in ["1", "2", "3"] (neue Anfrage) enthalten
- **Ergebnis**: ❌ **409 Conflict** - Überschneidung erkannt

### Szenario 7: Keine Überschneidung erlaubt
- **Aktion**: Benutzer will "Musterstraße 5,6" anlegen
- **Im System**: Dataset existiert mit "Musterstraße 1,2"
- **Logik**: Keine gemeinsamen Hausnummern
- **Ergebnis**: ✅ Neues Dataset kann angelegt werden

## Frontend-Integration

Das Frontend spaltet bereits kommagetrennte Hausnummern auf (`GPSAddressForm.tsx`):
```typescript
address.number.split(',').map(n => n.trim())
```

Diese einzelnen Nummern werden dann in separaten Suchen verwendet, die nun alle das korrekte Dataset finden.

## Logging

Die Implementierung enthält ausführliches Debug-Logging:
```
[DatasetCache.getByAddress] Searching for: { normalizedAddress, houseNumber, searchHouseNumbers }
[DatasetCache.getByAddress] MATCH FOUND: { datasetId, datasetHouseNumbers, matchType }
[DatasetCache.getByAddress] Found X matching datasets
```

## Testing

### Manueller Test:
1. Erstelle Dataset mit "Teststraße 1,2,3"
2. Suche nach "Teststraße 1"
3. Erwartung: Dataset wird angezeigt
4. Suche nach "Teststraße 2"
5. Erwartung: Dasselbe Dataset wird angezeigt
6. Suche nach "Teststraße 5"
7. Erwartung: Dataset wird NICHT angezeigt

## Rückwärtskompatibilität

✅ Die Änderungen sind vollständig rückwärtskompatibel:
- Alle neuen Parameter sind optional
- Alte Aufrufe ohne Hausnummer funktionieren wie vorher
- Exakte Übereinstimmung funktioniert weiterhin

## Performance-Überlegungen

- **Cache-basiert**: Keine zusätzlichen Datenbankabfragen
- **Effizient**: String-Operationen in der Cache-Filterung
- **Skalierbar**: Funktioniert mit tausenden von Datasets

## Zukünftige Erweiterungen

Mögliche Verbesserungen:
1. Unterstützung für Hausnummern-Bereiche (z.B. "30-35")
2. Fuzzy-Matching für Hausnummern mit Buchstaben (z.B. "30a", "30b")
3. Cache-Index für noch schnellere Suchen bei vielen Datasets
