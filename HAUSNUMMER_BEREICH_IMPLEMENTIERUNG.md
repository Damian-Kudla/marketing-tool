# Hausnummer-Bereich Matching - Vollständige Implementierung

## Übersicht

Implementierung der **Option 3 (Hybrid-Ansatz)** aus `HAUSNUMMER_BEREICH_ANALYSE.md`.

### Kernprinzipien

1. **Bestandskunden**: Expansion für Transparenz
   - "1-3" → ["1", "2", "3"]
   - User sieht alle matchenden Kunden
   - Deduplizierung verhindert mehrfache Anzeige

2. **Datensätze**: Granulare 30-Tage-Sperrung
   - "1,2" sperrt nur {1, 2, 1-2, 1-3} 
   - "1,2" sperrt NICHT "3"
   - Keine unnötige Straßen-Blockierung

3. **30-Tage-Regel** (nicht 3 Monate!)
   - Sperre: 30 Tage ab Erstellung
   - Creator kann immer neu erstellen

---

## 1. Bestandskunden-Matching (`server/storage.ts`)

### Neue Methoden

#### `expandHouseNumberRange(houseNumber: string): string[]`

**Zweck:** Expandiert Hausnummern-Bereiche in einzelne Nummern

**Logik:**
```typescript
private expandHouseNumberRange(houseNumber: string): string[] {
  if (!houseNumber || houseNumber.trim() === '') {
    return [];
  }

  // Komma-getrennte Teile
  const parts = houseNumber.split(',').map(p => p.trim()).filter(Boolean);
  const expanded: string[] = [];

  for (const part of parts) {
    // Bereich-Prüfung (z.B. "1-3")
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      // Validierung
      if (isNaN(start) || isNaN(end) || start > end) {
        expanded.push(part); // Als String behandeln
        continue;
      }

      // Sicherheitslimit: Max 50 Zahlen
      if (end - start > 50) {
        console.warn(`[expandHouseNumberRange] Range too large: ${part}, limiting to 50`);
        for (let i = start; i < start + 50; i++) {
          expanded.push(i.toString());
        }
      } else {
        for (let i = start; i <= end; i++) {
          expanded.push(i.toString());
        }
      }
    } else {
      expanded.push(part); // Einzelnummer
    }
  }

  // Deduplizierung
  return Array.from(new Set(expanded));
}
```

**Beispiele:**
| Input | Output |
|-------|--------|
| `"1-3"` | `["1", "2", "3"]` |
| `"1,2,3"` | `["1", "2", "3"]` |
| `"1,3-5"` | `["1", "3", "4", "5"]` |
| `"1-5,3-7"` | `["1", "2", "3", "4", "5", "6", "7"]` ✅ Set dedupliziert |
| `"1-100"` | `["1", ..., "50"]` ⚠️ Limit |
| `"abc-xyz"` | `["abc-xyz"]` ⚠️ Ungültig |
| `""` | `[]` |

---

#### `matchesHouseNumber(searchNumber: string, customerNumber: string): boolean`

**Zweck:** Prüft Überlappung zwischen Such- und Kunden-Hausnummern

**Logik:**
```typescript
private matchesHouseNumber(searchNumber: string, customerNumber: string): boolean {
  const searchExpanded = this.expandHouseNumberRange(searchNumber);
  const customerExpanded = this.expandHouseNumberRange(customerNumber);
  
  // Bidirektional: Irgendeine Überlappung?
  return searchExpanded.some(s => customerExpanded.includes(s));
}
```

**Beispiele:**
| Search | Customer | Match? | Grund |
|--------|----------|--------|-------|
| `"1"` | `"1-3"` | ✅ | 1 ∈ {1,2,3} |
| `"1,2"` | `"1-3"` | ✅ | {1,2} ⊆ {1,2,3} |
| `"4"` | `"1-3"` | ❌ | 4 ∉ {1,2,3} |
| `"2-4"` | `"3-5"` | ✅ | {3,4} ∩ {3,4,5} ≠ ∅ |
| `"1-3"` | `"5-7"` | ❌ | Keine Überlappung |

---

#### Aktualisiert: `getCustomersByAddress(address: Partial<Address>): Promise<Customer[]>`

**Änderungen:**
1. Nutzt `matchesHouseNumber()` statt exaktem Vergleich
2. **Deduplizierung** mit `Set<string>` für Customer-IDs

**Code:**
```typescript
async getCustomersByAddress(address: Partial<Address>): Promise<Customer[]> {
  // ... PLZ + Straßen-Filterung ...

  if (address.number) {
    const searchNumber = address.number;
    const uniqueCustomerIds = new Set<string>();
    const uniqueMatches: Customer[] = [];

    for (const customer of matches) {
      if (!customer.houseNumber) continue;

      // ✅ Flexible Matching mit Expansion
      if (this.matchesHouseNumber(searchNumber, customer.houseNumber)) {
        // ✅ Deduplizierung: Kunde nur 1x hinzufügen
        if (!uniqueCustomerIds.has(customer.id)) {
          uniqueCustomerIds.add(customer.id);
          uniqueMatches.push(customer);
        }
      }
    }

    matches = uniqueMatches;
  }

  return matches;
}
```

**Effekt:**
- ✅ Kunde "1-3" wird bei Suche "1", "2", "1,2", "1-3" gefunden
- ✅ Kunde wird **nur einmal** angezeigt (auch wenn mehrere Nummern matchen)

---

## 2. Datensatz-Matching (`server/services/googleSheets.ts`)

### DatasetCache-Klasse

#### `expandHouseNumberRange(houseNumber: string): string[]`

**Identisch** zur Implementation in `storage.ts` (siehe oben).

---

#### Aktualisiert: `getByAddress(normalizedAddress, limit, houseNumber?): AddressDataset[]`

**Änderungen:**
1. Expandiert Such-Hausnummer
2. Nutzt `addressMatches()` mit expandierten Arrays

**Code:**
```typescript
getByAddress(normalizedAddress: string, limit: number = 5, houseNumber?: string): AddressDataset[] {
  // ✅ Expansion der Such-Hausnummer
  const searchHouseNumbers = houseNumber ? 
    this.expandHouseNumberRange(houseNumber) : [];

  console.log('[DatasetCache.getByAddress] Searching:', {
    normalizedAddress,
    houseNumber,
    searchHouseNumbers
  });

  const matchingDatasets = Array.from(this.cache.values()).filter(dataset => {
    // ✅ Expansion der Dataset-Hausnummer
    const datasetHouseNumbers = this.expandHouseNumberRange(dataset.houseNumber);
    
    return this.addressMatches(
      normalizedAddress,
      searchHouseNumbers,
      dataset.normalizedAddress,
      datasetHouseNumbers
    );
  });

  // ... Sortierung + Limit ...
}
```

---

#### `addressMatches(...): boolean`

**Logik:**
```typescript
private addressMatches(
  searchNormalizedAddress: string,
  searchHouseNumbers: string[],
  datasetNormalizedAddress: string,
  datasetHouseNumbers: string[]
): boolean {
  // 1. PLZ + Straße extrahieren
  const extractPostalAndStreet = (addr: string): string => {
    const postalMatch = addr.match(/\b\d{5}\b/);
    const postal = postalMatch ? postalMatch[0] : '';
    
    let streetPart = addr;
    if (postal) {
      const postalIndex = addr.indexOf(postal);
      if (postalIndex > 0) {
        streetPart = addr.substring(0, postalIndex);
      }
    }
    
    let street = streetPart
      .replace(/\d+[a-zA-Z]?(?:,?\s*\d+[a-zA-Z]?)*/g, '') // Hausnummern entfernen
      .replace(/[,\.]/g, '')
      .replace(/straße/gi, 'str')
      .replace(/strasse/gi, 'str')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    return `${street}|${postal}`;
  };

  const searchBase = extractPostalAndStreet(searchNormalizedAddress);
  const datasetBase = extractPostalAndStreet(datasetNormalizedAddress);

  // 2. PLZ + Straße müssen matchen
  if (searchBase !== datasetBase) {
    return false;
  }

  // 3. BIDIREKTIONALE Hausnummern-Prüfung
  // Vorwärts: Such-Nummer in Dataset?
  for (const searchNum of searchHouseNumbers) {
    if (datasetHouseNumbers.includes(searchNum)) {
      return true; // ✅ Überlappung
    }
  }
  
  // Rückwärts: Dataset-Nummer in Suche?
  for (const datasetNum of datasetHouseNumbers) {
    if (searchHouseNumbers.includes(datasetNum)) {
      return true; // ✅ Überlappung
    }
  }
  
  return false; // ❌ Keine Überlappung
}
```

**Beispiele:**

| Search Nr. | Dataset Nr. | Match? | Grund |
|------------|-------------|--------|-------|
| `"1"` | `"1,2"` | ✅ | 1 ∈ {1,2} (vorwärts) |
| `"1,2"` | `"1"` | ✅ | 1 ∈ {1,2} (rückwärts) |
| `"3"` | `"1,2"` | ❌ | 3 ∉ {1,2}, {1,2} ∩ {3} = ∅ |
| `"1-3"` | `"2-4"` | ✅ | {2,3} Überlappung |

---

### AddressDatasetService

#### `getRecentDatasetByAddress(normalizedAddress, houseNumber?, daysBack = 30)`

**30-Tage-Sperrung mit Expansion:**

```typescript
async getRecentDatasetByAddress(
  normalizedAddress: string, 
  houseNumber?: string, 
  daysBack: number = 30
): Promise<AddressDataset | null> {
  const now = getBerlinTime();
  const cutoffDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  // ✅ Nutzt flexible Hausnummer-Matching
  const datasets = await this.getAddressDatasets(normalizedAddress, 50, houseNumber);
  
  for (const dataset of datasets) {
    if (dataset.createdAt >= cutoffDate && dataset.createdAt <= now) {
      return dataset; // ✅ Datensatz innerhalb 30 Tage
    }
  }

  return null; // ✅ Keine Sperre
}
```

**Effekt:**
- ✅ Datensatz "1,2" sperrt "1", "2", "1,2", "1-3"
- ✅ Datensatz "1,2" sperrt **NICHT** "3"
- ✅ Sperre gilt **30 Tage** (nicht 3 Monate)
- ✅ Creator kann immer neu erstellen

---

## 3. Testszenarien

### Szenario 1: Bestandskunden-Expansion

**Datenbank:**
```json
{
  "customer_id": "C001",
  "name": "Müller GmbH",
  "street": "Hauptstraße",
  "postalCode": "50667",
  "houseNumber": "1-3"
}
```

**Test 1.1: Suche "1"**
```typescript
getCustomersByAddress({ street: "Hauptstraße", postalCode: "50667", number: "1" })
```
- Expansion: "1-3" → ["1", "2", "3"]
- Matching: "1" ∈ ["1", "2", "3"] ✅
- **Ergebnis:** Kunde wird angezeigt

**Test 1.2: Suche "1,2"**
```typescript
getCustomersByAddress({ street: "Hauptstraße", postalCode: "50667", number: "1,2" })
```
- Expansion: Search → ["1", "2"], Customer → ["1", "2", "3"]
- Matching: {1,2} ⊆ {1,2,3} ✅
- **Ergebnis:** Kunde wird angezeigt

**Test 1.3: Suche "4"**
```typescript
getCustomersByAddress({ street: "Hauptstraße", postalCode: "50667", number: "4" })
```
- Expansion: Search → ["4"], Customer → ["1", "2", "3"]
- Matching: 4 ∉ {1,2,3} ❌
- **Ergebnis:** Kunde wird **NICHT** angezeigt

---

### Szenario 2: Deduplizierung

**Datenbank:**
```json
{
  "customer_id": "C002",
  "houseNumber": "10-15"
}
```

**Test 2.1: Suche "10,11,12"**
```typescript
getCustomersByAddress({ number: "10,11,12" })
```
- Kunde matcht bei 10, 11, **UND** 12
- `uniqueCustomerIds.has("C002")` → Nur **1x** hinzugefügt
- **Ergebnis:** Kunde nur **einmal** in Liste

---

### Szenario 3: 30-Tage-Sperrung (granular)

**Datensatz:**
```json
{
  "datasetId": "DS001",
  "normalizedAddress": "Schulstraße, 80331 München",
  "houseNumber": "1,2",
  "createdAt": "2024-01-15T10:00:00Z",
  "createdBy": "user_max"
}
```

**Test 3.1: User "lisa" sucht "1" (Tag 5)**
```typescript
currentDate = "2024-01-20T14:00:00Z" // 5 Tage nach Erstellung
getRecentDatasetByAddress("Schulstraße, 80331 München", "1", 30)
```
- Expansion: Search → ["1"], Dataset → ["1", "2"]
- Matching: 1 ∈ {1,2} ✅
- `createdAt` < `cutoffDate` ❌ (noch innerhalb 30 Tage)
- `createdBy !== "lisa"` → "user_max"
- **Ergebnis:** `canCreateNew = false`, `existingTodayBy = "user_max"`

**Test 3.2: User "lisa" sucht "3" (Tag 5)**
```typescript
getRecentDatasetByAddress("Schulstraße, 80331 München", "3", 30)
```
- Expansion: Search → ["3"], Dataset → ["1", "2"]
- Matching: 3 ∉ {1,2} ❌
- **Ergebnis:** `canCreateNew = true` ✅ **Keine Sperre!**

**Test 3.3: User "max" sucht "1" (Tag 5)**
```typescript
username = "user_max"
```
- `createdBy === "user_max"` ✅
- **Ergebnis:** `canCreateNew = true` ✅ **Creator darf immer**

**Test 3.4: User "lisa" sucht "1" (Tag 36)**
```typescript
currentDate = "2024-02-20T14:00:00Z" // 36 Tage nach Erstellung
```
- `cutoffDate = 2024-01-21T14:00:00Z`
- `dataset.createdAt (2024-01-15) < cutoffDate` ✅
- **Ergebnis:** `canCreateNew = true` ✅ **Sperre abgelaufen**

---

### Szenario 4: Komplexe Bereiche

**Test 4.1: Gemischte Eingabe**
```typescript
expandHouseNumberRange("1,3-5,10")
// → ["1", "3", "4", "5", "10"]
```

**Test 4.2: Überlappende Bereiche**
```typescript
expandHouseNumberRange("1-5,3-7")
// → ["1", "2", "3", "4", "5", "6", "7"]
// ✅ Set dedupliziert 3, 4, 5
```

**Test 4.3: Sicherheitslimit**
```typescript
expandHouseNumberRange("1-100")
// ⚠️ console.warn: "Range too large: 1-100, limiting to 50"
// → ["1", "2", ..., "50"]
```

**Test 4.4: Fehlerhafte Eingaben**
```typescript
expandHouseNumberRange("abc-xyz") // → ["abc-xyz"]
expandHouseNumberRange("") // → []
expandHouseNumberRange("5-1") // → ["5-1"] (ungültig)
```

---

## 4. API-Änderungen

### GET `/api/address-datasets`

**Request:**
```json
{
  "street": "Hauptstraße",
  "city": "Köln",
  "postalCode": "50667",
  "number": "1,2"  // ✅ Unterstützt Bereiche
}
```

**Response:**
```json
{
  "datasets": [
    {
      "id": "DS123",
      "normalizedAddress": "Hauptstraße, 50667 Köln",
      "houseNumber": "1-3",  // ✅ Matched wegen Überlappung
      "canEdit": false,
      "isNonExactMatch": true
    }
  ],
  "canCreateNew": false,
  "existingTodayBy": "user_other",
  "normalizedAddress": "Hauptstraße, 50667 Köln"
}
```

### GET `/api/customers/search`

**Request:**
```json
{
  "street": "Bahnhofstraße",
  "postalCode": "10115",
  "number": "10-15"
}
```

**Response:**
```json
{
  "customers": [
    {
      "id": "C001",
      "name": "Müller GmbH",
      "houseNumber": "10"
    },
    {
      "id": "C002",
      "name": "Schmidt AG",
      "houseNumber": "10-20"
    }
  ]
  // ✅ Jeder Kunde nur 1x
}
```

---

## 5. Performance

### Optimierungen

1. **Set-basierte Deduplizierung**
   ```typescript
   const uniqueCustomerIds = new Set<string>();
   // ✅ O(1) Lookup statt O(n) Array.includes()
   ```

2. **Expansion-Limit**
   ```typescript
   if (end - start > 50) {
     console.warn(`Range too large: ${part}, limiting to 50`);
   }
   // ✅ Verhindert Speicher-Explosionen
   ```

3. **Cache-Optimierung**
   - Google Sheets Cache: In-Memory
   - `expandHouseNumberRange()` einmal pro Abfrage

---

## 6. Migration & Kompatibilität

### Rückwärtskompatibilität
- ✅ Einfache Hausnummern ("1") funktionieren
- ✅ Bestehende Datensätze unverändert
- ✅ Keine Datenbank-Migration nötig

### Bestandsdaten
- Kunden mit "1-3" automatisch expandiert
- Datensätze mit "1,2,3" automatisch expandiert
- Keine manuelle Anpassung

---

## 7. Fehlerbehandlung

### Ungültige Eingaben
```typescript
expandHouseNumberRange("") → []
expandHouseNumberRange("   ") → []
expandHouseNumberRange("abc-xyz") → ["abc-xyz"]
expandHouseNumberRange("5-1") → ["5-1"]
expandHouseNumberRange("1,abc,3-5") → ["1", "abc", "3", "4", "5"]
```

### Logging
```typescript
console.warn('[expandHouseNumberRange] Range too large: 1-100, limiting to 50');
```

---

## 8. Zukünftige Erweiterungen

### Hausnummern mit Buchstaben
```typescript
// Aktuell: "12a" → String
// Zukünftig: "12a-12c" → ["12a", "12b", "12c"]
```

### UI-Hinweise
```typescript
if (isNonExactMatch) {
  showToast("Datensatz enthält mehrere Hausnummern", "info");
}
```

### Statistiken
```typescript
logUserActivity(req, address, undefined, undefined, {
  houseNumberRangeUsed: houseNumber.includes('-') || houseNumber.includes(',')
});
```

---

## Zusammenfassung

### ✅ Implementiert
1. Hausnummern-Expansion (`storage.ts` + `googleSheets.ts`)
2. Bidirektionales Matching mit Überlappung
3. Deduplizierung bei Bestandskunden
4. 30-Tage-Sperrung (granular)
5. Sicherheitslimit (max 50 Zahlen)

### 🎯 Vorteile
- **Transparenz**: Alle relevanten Kunden sichtbar
- **Keine unnötigen Sperren**: "3" frei trotz "1,2"
- **Flexibilität**: "1-3", "1,2,3", "1,3-5" möglich
- **Fairness**: Creator kann immer erstellen

### 🔧 Qualität
- ✅ Keine Breaking Changes
- ✅ Rückwärtskompatibel
- ✅ Performance-optimiert
- ✅ Fehlertoleranz
- ✅ Debug-Logging

---

**Status:** ✅ **Implementierung abgeschlossen**  
**Datum:** Januar 2024  
**Basis:** Option 3 (Hybrid) aus `HAUSNUMMER_BEREICH_ANALYSE.md`
