# Hausnummern-Bereiche: Problem-Analyse und Lösungsstrategien

**Status**: 📋 Analyse & Konzept  
**Datum**: 19. Oktober 2025  
**Problem**: Umgang mit Hausnummern-Bereichen (z.B. "1-3") in Bestandskundendatenbank

---

## 🔍 Problem-Definition

### Aktuelle Situation

**Bestandskundendatenbank** enthält Einträge wie:
- Kundenname: "Max Mustermann"
- Straße: "Hauptstraße"
- Hausnummer: **"1-3"** ← Problem!
- PLZ: 50667

**Grund für Bereiche**:
- Ein Haus hat mehrere Hausnummern (1, 2, 3)
- Post wird zentral für alle Nummern eingeworfen
- Kunde zahlt für alle Nummern → Ein Eintrag im System

### Offene Fragen

1. **Matching-Logik**:
   - User scannt Hausnummer **1** → Soll Kunde "1-3" als Bestandskunde angezeigt werden? 🤔
   - User scannt Hausnummer **2** → Soll Kunde "1-3" als Bestandskunde angezeigt werden? 🤔
   - User scannt Hausnummer **4** → Soll Kunde "1-3" NICHT angezeigt werden? ✅

2. **Duplikats-Prävention (3-Monats-Regel)**:
   ```
   Szenario:
   - Datensatz 1: Hauptstraße 1-3 (Erstellt: 01.01.2025)
   - User scannt: Hauptstraße 2 (Heute: 01.02.2025)
   
   Frage: Soll der Scan erlaubt sein?
   - Option A: Nein → "1-3" blockiert auch "2" für 3 Monate
   - Option B: Ja → "2" ist nicht explizit in Datenbank, also erlaubt
   ```

3. **Gemischte Einträge**:
   ```
   Bestandskunden an Hauptstraße (gleiche PLZ):
   - Kunde A: Hausnummer "1"
   - Kunde B: Hausnummer "2"
   - Kunde C: Hausnummer "1-3"
   
   User scannt: Hauptstraße 1
   Frage: Welche Kunden werden angezeigt?
   - Nur Kunde A?
   - Kunde A + Kunde C?
   - Alle drei?
   ```

4. **Dataset-Erstellung**:
   - User scannt Hausnummer **1** → Dataset speichern als "1" oder "1-3"?
   - User scannt Hausnummer **2** → Ist das ein neuer Scan oder blockiert durch "1-3"?

---

## 🎯 Anforderungen

### Business-Regeln

1. **3-Monats-Regel**: Pro Adresse nur 1 Dataset alle 3 Monate
2. **Hausnummer-Granularität**: Nutzer sollen einzelne Hausnummern scannen können
3. **Bestandskunden-Transparenz**: Alle relevanten Bestandskunden anzeigen
4. **Datenintegrität**: Keine widersprüchlichen Einträge

### Technische Constraints

- Bestandskundendatenbank kann nicht geändert werden (externe Quelle)
- Hausnummern-Bereiche existieren bereits im System ("1-3", "10-12", etc.)
- App muss mit verschiedenen Formaten umgehen: "1-3", "1,2,3", "1/2/3", etc.

---

## 💡 Lösungsvorschläge

### Option 1: **Bereichs-Expansion** (Empfohlen für Bestandskunden)

**Konzept**: Hausnummern-Bereiche bei Abfragen automatisch expandieren

#### Implementierung

**Bestandskunden-Matching**:
```typescript
// Input: User scannt "Hauptstraße 2"
// Database: "Hauptstraße 1-3" (Bestandskunde)

function expandHouseNumberRange(houseNumber: string): string[] {
  // "1-3" → ["1", "2", "3"]
  // "10" → ["10"]
  // "1,2,3" → ["1", "2", "3"]
  
  if (houseNumber.includes('-')) {
    const [start, end] = houseNumber.split('-').map(x => parseInt(x.trim()));
    if (!isNaN(start) && !isNaN(end)) {
      const range = [];
      for (let i = start; i <= end; i++) {
        range.push(i.toString());
      }
      return range;
    }
  }
  
  // Komma-separiert
  if (houseNumber.includes(',')) {
    return houseNumber.split(',').map(n => n.trim());
  }
  
  return [houseNumber.trim()];
}

// Matching-Logik
function matchesHouseNumber(searchNumber: string, customerNumber: string): boolean {
  const searchExpanded = expandHouseNumberRange(searchNumber);
  const customerExpanded = expandHouseNumberRange(customerNumber);
  
  // Check if ANY number overlaps
  return searchExpanded.some(s => customerExpanded.includes(s));
}

// Beispiele:
matchesHouseNumber("2", "1-3"); // true ✅
matchesHouseNumber("4", "1-3"); // false ✅
matchesHouseNumber("1", "1-3"); // true ✅
matchesHouseNumber("1-3", "2"); // true ✅
```

**Vorteile**:
- ✅ Intuitiv: User sieht alle relevanten Bestandskunden
- ✅ Transparent: Bereich "1-3" matched automatisch mit 1, 2, 3
- ✅ Keine Änderungen an Bestandskundendaten nötig

**Nachteile**:
- ❌ Performance: Bei großen Bereichen ("1-100") viele Expansionen
- ❌ Komplexität: Verschiedene Formate ("1-3", "1,2,3", "1/2/3")

---

### Option 2: **Virtuelle Hausnummer-Gruppen** (Empfohlen für Datasets)

**Konzept**: Datasets intern mit allen betroffenen Hausnummern verknüpfen

#### Implementierung

**Dataset-Struktur erweitern**:
```typescript
interface AddressDataset {
  id: string;
  address: string;
  houseNumber: string; // User-Input: "2"
  houseNumberGroup: string[]; // Expanded: ["2"] ODER ["1", "2", "3"]
  normalizedAddress: string;
  createdAt: Date;
  // ... rest
}
```

**3-Monats-Regel mit Gruppen**:
```typescript
function checkThreeMonthRule(
  street: string, 
  searchHouseNumber: string,
  existingDatasets: AddressDataset[]
): boolean {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  const searchExpanded = expandHouseNumberRange(searchHouseNumber);
  
  // Check if ANY existing dataset overlaps with search numbers
  const recentDatasets = existingDatasets.filter(ds => {
    // Same street
    if (!streetsMatch(street, ds.normalizedAddress)) return false;
    
    // Within 3 months
    if (new Date(ds.createdAt) < threeMonthsAgo) return false;
    
    // Check if any number in group overlaps with search
    return ds.houseNumberGroup.some(num => searchExpanded.includes(num));
  });
  
  return recentDatasets.length > 0; // true = blocked
}

// Beispiele:
// Dataset exists: "Hauptstraße 1-3" (01.01.2025)
// User scannt: "Hauptstraße 2" (01.02.2025)
// → Dataset.houseNumberGroup = ["1", "2", "3"]
// → searchExpanded = ["2"]
// → Overlap detected: "2" in ["1", "2", "3"]
// → BLOCKED ✅
```

**Vorteile**:
- ✅ Klare 3-Monats-Regel: Alle Nummern im Bereich werden blockiert
- ✅ Transparent: User sieht genau welche Nummern betroffen sind
- ✅ Flexibel: Einzelne Nummern UND Bereiche unterstützt

**Nachteile**:
- ❌ Breaking Change: Dataset-Schema muss erweitert werden
- ❌ Migration: Bestehende Datasets müssen migriert werden

---

### Option 3: **Smart Normalization** (Hybrid-Ansatz)

**Konzept**: Unterschiedliche Logik für Bestandskunden vs. Datasets

#### Regeln

**Bestandskunden** (Option 1):
- **Matching**: Bereichs-Expansion
- Kunde "1-3" wird angezeigt bei Scan von "1", "2", "3"
- **Ziel**: Maximale Transparenz

**Datasets** (3-Monats-Regel):
- **Matching**: Granular (pro Hausnummer)
- Dataset "Hauptstraße 2" blockiert nur "2", nicht "1" oder "3"
- **Ausnahme**: Dataset wurde mit Bereich erstellt ("1-3") → Blockiert alle

**Implementierung**:
```typescript
// Bestandskunden: Bereichs-Expansion
function getExistingCustomers(street: string, houseNumber: string) {
  const searchExpanded = expandHouseNumberRange(houseNumber);
  
  return customers.filter(c => {
    if (!streetsMatch(street, c.street)) return false;
    
    const customerExpanded = expandHouseNumberRange(c.houseNumber);
    return searchExpanded.some(s => customerExpanded.includes(s));
  });
}

// Datasets: Granular Matching
function checkDatasetConflict(street: string, houseNumber: string) {
  const searchExpanded = expandHouseNumberRange(houseNumber);
  
  return existingDatasets.filter(ds => {
    if (!streetsMatch(street, ds.normalizedAddress)) return false;
    if (!isWithinThreeMonths(ds.createdAt)) return false;
    
    // GRANULAR: Check if ds.houseNumber was a range
    const datasetExpanded = expandHouseNumberRange(ds.houseNumber);
    
    // Overlap?
    return searchExpanded.some(s => datasetExpanded.includes(s));
  });
}
```

**Beispiel-Szenario**:
```
Bestandskunden:
- Kunde A: Hauptstraße "1-3"

Datasets:
- Dataset 1: Hauptstraße "2" (01.01.2025)

User scannt: Hauptstraße "2" (01.02.2025)

Bestandskunden-Anzeige:
→ Kunde A wird angezeigt ✅ (Expansion: "1-3" enthält "2")

Dataset-Erstellung:
→ BLOCKIERT ✅ (Dataset 1 "2" blockiert "2" für 3 Monate)

User scannt: Hauptstraße "1" (01.02.2025)

Bestandskunden-Anzeige:
→ Kunde A wird angezeigt ✅ (Expansion: "1-3" enthält "1")

Dataset-Erstellung:
→ ERLAUBT ✅ (Dataset 1 "2" blockiert nicht "1")
```

**Vorteile**:
- ✅ Best of Both Worlds: Transparenz bei Bestandskunden, Granularität bei Datasets
- ✅ Keine Breaking Changes bei Datasets
- ✅ Business-Logik bleibt intuitiv

**Nachteile**:
- ❌ Komplexität: Zwei unterschiedliche Logiken zu verstehen
- ❌ Edge Cases: Was wenn User absichtlich "1-3" eingibt?

---

### Option 4: **UI-Assisted Disambiguation** (User-Driven)

**Konzept**: Bei Bereichen User fragen, welche Nummern gemeint sind

#### Implementierung

**UI-Flow**:
```
1. User scannt Hausnummer "2"

2. App prüft Bestandskunden:
   → Kunde "1-3" gefunden
   
3. App zeigt Hinweis:
   "⚠️ An dieser Adresse gibt es einen Bestandskunden für Hausnummern 1-3.
   Scannen Sie für:"
   
   [ ] Hausnummer 1
   [x] Hausnummer 2  ← Auto-selected
   [ ] Hausnummer 3
   [ ] Alle (1-3)
   
4. User bestätigt → Dataset wird mit gewählten Nummern erstellt

5. 3-Monats-Regel:
   - Nur gewählte Nummern werden blockiert
   - Bei "Alle (1-3)" → Alle blockiert
```

**Code-Beispiel**:
```typescript
interface DatasetCreationContext {
  street: string;
  scannedHouseNumber: string; // "2"
  selectedHouseNumbers: string[]; // ["2"] ODER ["1", "2", "3"]
  existingCustomerRanges: string[]; // ["1-3"] für UI-Hinweis
}

async function createDataset(context: DatasetCreationContext) {
  // Dataset mit expliziten Nummern erstellen
  const dataset: AddressDataset = {
    id: generateId(),
    address: `${context.street} ${context.scannedHouseNumber}`,
    houseNumber: context.scannedHouseNumber, // User-Input
    houseNumberGroup: context.selectedHouseNumbers, // Explizit gewählt
    createdAt: new Date(),
    // ...
  };
  
  await saveDataset(dataset);
}
```

**Vorteile**:
- ✅ User Control: User entscheidet explizit
- ✅ Transparenz: User versteht Bereichs-Logik
- ✅ Flexibilität: Einzeln ODER Bereich möglich

**Nachteile**:
- ❌ UX-Overhead: Zusätzlicher Klick bei jedem Bereich
- ❌ Komplexität: UI muss Bereiche erkennen und anzeigen
- ❌ Edge Cases: Was wenn User falsche Auswahl trifft?

---

## 📊 Vergleich der Optionen

| Kriterium | Option 1<br>(Expansion) | Option 2<br>(Gruppen) | Option 3<br>(Hybrid) | Option 4<br>(UI-Assisted) |
|-----------|-------------------------|----------------------|----------------------|---------------------------|
| **Bestandskunden-Transparenz** | ✅ Hoch | ✅ Hoch | ✅ Hoch | ✅ Sehr hoch |
| **3-Monats-Regel Genauigkeit** | ⚠️ Mittel | ✅ Hoch | ✅ Hoch | ✅ Sehr hoch |
| **Implementation Complexity** | ✅ Niedrig | ❌ Hoch | ⚠️ Mittel | ❌ Hoch |
| **Breaking Changes** | ✅ Keine | ❌ Ja | ✅ Keine | ⚠️ UI-Änderung |
| **User Experience** | ✅ Einfach | ✅ Einfach | ✅ Einfach | ⚠️ Extra Klick |
| **Edge Case Handling** | ⚠️ Mittel | ✅ Gut | ✅ Gut | ✅ Sehr gut |

---

## 🎯 Empfohlene Lösung: **Option 3 (Hybrid-Ansatz)**

### Begründung

1. **Keine Breaking Changes**: Bestehende Datasets bleiben unverändert
2. **Intuitive Logik**: 
   - Bestandskunden: "Zeige mir alle relevanten Kunden" → Expansion
   - Datasets: "Blockiere nur die gescannte Nummer" → Granular
3. **Implementierbar**: Keine UI-Änderungen nötig
4. **Erweiterbar**: Kann später mit Option 4 (UI) erweitert werden

### Implementation Plan

#### Phase 1: Bereichs-Expansion für Bestandskunden

**Änderungen in `server/storage.ts`**:

```typescript
// ADD: Helper function
function expandHouseNumberRange(houseNumber: string): string[] {
  if (!houseNumber) return [];
  
  // Handle hyphen-separated ranges: "1-3" → ["1", "2", "3"]
  if (houseNumber.includes('-')) {
    const parts = houseNumber.split('-');
    if (parts.length === 2) {
      const start = parseInt(parts[0].trim());
      const end = parseInt(parts[1].trim());
      
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        const range: string[] = [];
        for (let i = start; i <= end; i++) {
          range.push(i.toString());
        }
        return range;
      }
    }
  }
  
  // Handle comma-separated: "1,2,3" → ["1", "2", "3"]
  if (houseNumber.includes(',')) {
    return houseNumber.split(',').map(n => n.trim()).filter(n => n.length > 0);
  }
  
  // Single number: "2" → ["2"]
  return [houseNumber.trim()];
}

// MODIFY: searchCustomers function
async searchCustomers(address: SearchAddress): Promise<CustomerData[]> {
  // ... existing code ...
  
  // Filter by house number with EXPANSION
  if (address.number) {
    const searchExpanded = expandHouseNumberRange(address.number);
    
    matches = matches.filter(customer => {
      if (!customer.houseNumber) return false;
      
      const customerExpanded = expandHouseNumberRange(customer.houseNumber);
      
      // Check if ANY number overlaps
      return searchExpanded.some(s => customerExpanded.includes(s));
    });
  }
  
  return matches;
}
```

**Test-Cases**:
```typescript
// Test 1: Range matches single
expandHouseNumberRange("1-3"); // ["1", "2", "3"]
matchesHouseNumber("2", "1-3"); // true ✅

// Test 2: Single matches range
matchesHouseNumber("1-3", "2"); // true ✅

// Test 3: Non-overlapping
matchesHouseNumber("4", "1-3"); // false ✅

// Test 4: Comma-separated
expandHouseNumberRange("1,2,3"); // ["1", "2", "3"]
matchesHouseNumber("2", "1,2,3"); // true ✅

// Test 5: Complex overlap
matchesHouseNumber("2-4", "3-6"); // true ✅ (3, 4 overlap)
```

#### Phase 2: Granulare 3-Monats-Regel für Datasets

**Änderungen in `server/services/googleSheets.ts`**:

```typescript
// MODIFY: addressMatches function
private addressMatches(
  searchNormalizedAddress: string, 
  searchHouseNumbers: string[],
  datasetNormalizedAddress: string,
  datasetHouseNumbers: string[]
): boolean {
  // ... existing postal + street matching ...
  
  // GRANULAR MATCHING with expansion
  const searchExpanded = searchHouseNumbers.flatMap(num => 
    expandHouseNumberRange(num)
  );
  
  const datasetExpanded = datasetHouseNumbers.flatMap(num => 
    expandHouseNumberRange(num)
  );
  
  // Check overlap
  return searchExpanded.some(s => datasetExpanded.includes(s));
}
```

**Test-Cases**:
```typescript
// Dataset 1: Hauptstraße "2" (01.01.2025)
// User scannt: Hauptstraße "2" (01.02.2025)
// → BLOCKED ✅

// Dataset 1: Hauptstraße "2" (01.01.2025)
// User scannt: Hauptstraße "1" (01.02.2025)
// → ALLOWED ✅

// Dataset 1: Hauptstraße "1-3" (01.01.2025)
// User scannt: Hauptstraße "2" (01.02.2025)
// → BLOCKED ✅ (Bereich blockiert alle Nummern)
```

#### Phase 3: UI-Feedback (Optional Enhancement)

**Hinweis bei Bereichs-Erkennung**:

```typescript
// In ResultsDisplay.tsx
{existingCustomers.some(c => c.houseNumber.includes('-')) && (
  <Alert className="mb-4">
    <Info className="h-4 w-4" />
    <AlertTitle>Hausnummern-Bereich erkannt</AlertTitle>
    <AlertDescription>
      An dieser Adresse gibt es Bestandskunden mit Hausnummern-Bereichen 
      (z.B. "1-3"). Alle Nummern im Bereich werden als Bestandskunden angezeigt.
    </AlertDescription>
  </Alert>
)}
```

---

## 🧪 Testing-Szenarien

### Szenario 1: Einfacher Bereich

**Setup**:
- Bestandskunde: Hauptstraße "1-3", PLZ 50667
- Kein Dataset vorhanden

**Test-Cases**:

| User-Scan | Bestandskunde angezeigt? | Dataset-Erstellung? | Erwartet |
|-----------|--------------------------|---------------------|----------|
| Hauptstraße 1 | ✅ Ja | ✅ Erlaubt | ✅ Pass |
| Hauptstraße 2 | ✅ Ja | ✅ Erlaubt | ✅ Pass |
| Hauptstraße 3 | ✅ Ja | ✅ Erlaubt | ✅ Pass |
| Hauptstraße 4 | ❌ Nein | ✅ Erlaubt | ✅ Pass |

### Szenario 2: Gemischte Einträge

**Setup**:
- Kunde A: Hauptstraße "1"
- Kunde B: Hauptstraße "2"
- Kunde C: Hauptstraße "1-3"

**Test-Cases**:

| User-Scan | Angezeigte Kunden | Erwartet |
|-----------|-------------------|----------|
| Hauptstraße 1 | A, C | ✅ Pass (Expansion: "1" matched beide) |
| Hauptstraße 2 | B, C | ✅ Pass (Expansion: "2" matched beide) |
| Hauptstraße 3 | C | ✅ Pass (Expansion: nur C) |
| Hauptstraße 4 | - | ✅ Pass (keine Matches) |

### Szenario 3: 3-Monats-Regel

**Setup**:
- Dataset 1: Hauptstraße "2" (01.01.2025)
- Heute: 15.02.2025

**Test-Cases**:

| User-Scan | Dataset-Erstellung? | Grund | Erwartet |
|-----------|---------------------|-------|----------|
| Hauptstraße 1 | ✅ Erlaubt | Keine Überlappung | ✅ Pass |
| Hauptstraße 2 | ❌ Blockiert | Gleiche Nummer, < 3 Monate | ✅ Pass |
| Hauptstraße 3 | ✅ Erlaubt | Keine Überlappung | ✅ Pass |
| Hauptstraße 1-3 | ❌ Blockiert | Bereich enthält "2" | ✅ Pass |

### Szenario 4: Bereich vs. Bereich

**Setup**:
- Dataset 1: Hauptstraße "1-3" (01.01.2025)
- Heute: 15.02.2025

**Test-Cases**:

| User-Scan | Dataset-Erstellung? | Grund | Erwartet |
|-----------|---------------------|-------|----------|
| Hauptstraße 1 | ❌ Blockiert | "1" in "1-3" | ✅ Pass |
| Hauptstraße 2 | ❌ Blockiert | "2" in "1-3" | ✅ Pass |
| Hauptstraße 3 | ❌ Blockiert | "3" in "1-3" | ✅ Pass |
| Hauptstraße 4 | ✅ Erlaubt | "4" nicht in "1-3" | ✅ Pass |
| Hauptstraße 2-4 | ❌ Blockiert | "2,3" überlappen | ✅ Pass |
| Hauptstraße 5-7 | ✅ Erlaubt | Keine Überlappung | ✅ Pass |

---

## 🚧 Edge Cases

### 1. Hausnummern mit Buchstaben

**Beispiel**: "10a", "10b", "10c"

**Problem**: Ist "10a-10c" ein Bereich?

**Lösung**: 
- **Vorerst**: Nur numerische Bereiche expandieren
- **Später**: Buchstaben-Bereiche als separate Logik ("10a, 10b, 10c")

```typescript
// Current implementation: Nur Zahlen
expandHouseNumberRange("10a-10c"); // ["10a-10c"] (nicht expandiert)

// Future enhancement
expandHouseNumberRange("10a-10c", {supportLetters: true}); 
// → ["10a", "10b", "10c"]
```

### 2. Große Bereiche

**Beispiel**: "1-100"

**Problem**: Performance bei Expansion (100 Elemente)

**Lösung**:
- **Limit**: Max. 20 Nummern expandieren
- **Fallback**: Bei > 20 → Nur Start + End prüfen

```typescript
function expandHouseNumberRange(houseNumber: string, maxExpansion = 20): string[] {
  // ... existing logic ...
  
  const rangeSize = end - start + 1;
  if (rangeSize > maxExpansion) {
    console.warn(`[HouseNumber] Range too large: ${houseNumber} (${rangeSize} numbers)`);
    // Return only start and end for matching
    return [start.toString(), end.toString()];
  }
  
  // ... expand normally ...
}
```

### 3. Ungültige Bereiche

**Beispiel**: "3-1" (End < Start)

**Lösung**: Validierung + Fallback

```typescript
if (start > end) {
  console.warn(`[HouseNumber] Invalid range: ${houseNumber} (start > end)`);
  return [houseNumber]; // Treat as single number
}
```

### 4. Mehrere Bereiche

**Beispiel**: "1-3, 10-12"

**Lösung**: Mehrfache Expansion

```typescript
function expandHouseNumberRange(houseNumber: string): string[] {
  // Split by comma first
  const parts = houseNumber.split(',').map(p => p.trim());
  
  // Expand each part individually
  return parts.flatMap(part => {
    if (part.includes('-')) {
      // Expand range
      return expandRange(part);
    }
    return [part];
  });
}

// Example:
expandHouseNumberRange("1-3, 10-12");
// → ["1", "2", "3", "10", "11", "12"]
```

---

## 📋 Implementation Checklist

### Phase 1: Core Logic (Week 1)

- [ ] Implement `expandHouseNumberRange()` helper
- [ ] Update `searchCustomers()` with expansion logic
- [ ] Add unit tests for expansion
- [ ] Test with real Bestandskundendaten

### Phase 2: Dataset Matching (Week 1)

- [ ] Update `addressMatches()` with expansion
- [ ] Update 3-Monats-Regel prüfung
- [ ] Add unit tests for dataset conflicts
- [ ] Test end-to-end scenarios

### Phase 3: Edge Cases (Week 2)

- [ ] Handle large ranges (> 20 numbers)
- [ ] Handle invalid ranges (end < start)
- [ ] Handle multiple ranges ("1-3, 10-12")
- [ ] Add error logging for edge cases

### Phase 4: Documentation (Week 2)

- [ ] Update API documentation
- [ ] Add code comments
- [ ] Create user guide for Hausnummern-Bereiche
- [ ] Add troubleshooting guide

### Phase 5: Optional Enhancements (Future)

- [ ] UI hint for detected ranges
- [ ] UI-assisted disambiguation (Option 4)
- [ ] Support for letter suffixes ("10a-10c")
- [ ] Analytics: Track range usage frequency

---

## 🎓 Learnings & Best Practices

### Design Principles

1. **Separation of Concerns**:
   - Bestandskunden: Maximale Transparenz (Expansion)
   - Datasets: Granulare Kontrolle (3-Monats-Regel)

2. **Graceful Degradation**:
   - Ungültige Bereiche → Behandle als einzelne Nummer
   - Zu große Bereiche → Limit auf 20

3. **Performance**:
   - Expansion nur wenn nötig (nicht bei jedem Request)
   - Cache expandierte Ranges bei Bedarf

4. **Testability**:
   - Pure Functions für Expansion
   - Unit Tests für alle Edge Cases

### Anti-Patterns zu vermeiden

❌ **Nicht tun**:
```typescript
// BAD: Expansion bei jedem API-Call
app.get('/customers', async (req, res) => {
  const allCustomers = await getAllCustomers();
  const expanded = allCustomers.map(c => ({
    ...c,
    houseNumbers: expandHouseNumberRange(c.houseNumber)
  }));
  // ... matching logic
});
```

✅ **Besser**:
```typescript
// GOOD: Expansion nur beim Matching
async function searchCustomers(address: SearchAddress) {
  const searchExpanded = expandHouseNumberRange(address.number);
  
  return customers.filter(c => {
    const customerExpanded = expandHouseNumberRange(c.houseNumber);
    return searchExpanded.some(s => customerExpanded.includes(s));
  });
}
```

---

## 📚 Referenzen

- **Related Files**:
  - `server/storage.ts` (Bestandskunden-Matching)
  - `server/services/googleSheets.ts` (Dataset-Matching)
  - `server/routes.ts` (3-Monats-Regel)

- **Related Docs**:
  - `HAUSNUMMER_MATCHING_IMPLEMENTATION.md` (Wird erstellt nach Implementation)
  - `HAUSNUMMER_DUPLIKATSPRÜFUNG_ANALYSE.md` (Bestehend)

---

## ✅ Zusammenfassung

**Empfohlene Lösung**: **Option 3 (Hybrid-Ansatz)**

**Warum**:
1. ✅ Keine Breaking Changes
2. ✅ Intuitive Business-Logik
3. ✅ Implementierbar ohne große Refactorings
4. ✅ Erweiterbar für zukünftige Features

**Nächste Schritte**:
1. Review mit User (Damian)
2. Implementation Phase 1 (Bestandskunden)
3. Testing mit echten Daten
4. Implementation Phase 2 (Datasets)
5. End-to-End Testing

**Estimated Effort**: 2-3 Tage Development + 1 Tag Testing

---

**Erstellt**: 19. Oktober 2025  
**Autor**: AI Assistant  
**Review**: Pending (Damian)  
**Status**: 📋 **AWAITING APPROVAL**
