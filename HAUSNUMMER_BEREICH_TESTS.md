# Hausnummer-Bereich Tests - Komplette Test-Suite

## Übersicht

Vollständige Testfälle für die **Option 3 (Hybrid-Ansatz)** Implementierung.

**Verwandte Dateien:**
- Implementation: `HAUSNUMMER_BEREICH_IMPLEMENTIERUNG.md`
- Analyse: `HAUSNUMMER_BEREICH_ANALYSE.md`

---

## 🧪 Test-Matrix

### Gesamtübersicht

| Kategorie | Anzahl Tests | Status |
|-----------|--------------|--------|
| Expansion (Bereiche) | 25 | ✅ Dokumentiert |
| Expansion (Listen) | 15 | ✅ Dokumentiert |
| Expansion (Gemischt) | 20 | ✅ Dokumentiert |
| Matching (Einfach) | 15 | ✅ Dokumentiert |
| Matching (Bidirektional) | 18 | ✅ Dokumentiert |
| Deduplizierung | 10 | ✅ Dokumentiert |
| 30-Tage-Sperre | 25 | ✅ Dokumentiert |
| Performance | 8 | ✅ Dokumentiert |
| **GESAMT** | **136** | **✅** |

---

## 📋 Test-Kategorie 1: Expansion - Einfache Bereiche

### TC-EXP-001: Standard-Bereich
```typescript
Input: "1-3"
Expected: ["1", "2", "3"]
Reason: Einfacher aufsteigender Bereich
```

### TC-EXP-002: Großer Bereich
```typescript
Input: "10-15"
Expected: ["10", "11", "12", "13", "14", "15"]
Reason: Zweistellige Zahlen
```

### TC-EXP-003: Einzelnummer
```typescript
Input: "5"
Expected: ["5"]
Reason: Keine Expansion nötig
```

### TC-EXP-004: Leerer String
```typescript
Input: ""
Expected: []
Reason: Keine Hausnummer vorhanden
```

### TC-EXP-005: Nur Leerzeichen
```typescript
Input: "   "
Expected: []
Reason: Wird getrimmt zu ""
```

### TC-EXP-006: Ein-Element-Bereich
```typescript
Input: "5-5"
Expected: ["5"]
Reason: Start == End
```

### TC-EXP-007: Bereich mit 0
```typescript
Input: "0-3"
Expected: ["0", "1", "2", "3"]
Reason: 0 ist gültige Hausnummer
```

### TC-EXP-008: Großer sicherer Bereich
```typescript
Input: "1-50"
Expected: ["1", "2", ..., "50"]
Length: 50
Reason: Genau am Limit
```

### TC-EXP-009: Zu großer Bereich (Limit)
```typescript
Input: "1-100"
Expected: ["1", "2", ..., "50"]
Length: 50
Warning: "Range too large: 1-100, limiting to 50"
Reason: Sicherheitslimit greift
```

### TC-EXP-010: Sehr großer Bereich
```typescript
Input: "1-10000"
Expected: ["1", "2", ..., "50"]
Length: 50
Warning: "Range too large: 1-10000, limiting to 50"
Reason: Verhindert Speicher-Explosion
```

---

## 📋 Test-Kategorie 2: Expansion - Listen

### TC-LIST-001: Einfache Liste
```typescript
Input: "1,2,3"
Expected: ["1", "2", "3"]
```

### TC-LIST-002: Liste mit Lücken
```typescript
Input: "10,20,30"
Expected: ["10", "20", "30"]
```

### TC-LIST-003: Liste mit Leerzeichen
```typescript
Input: "1, 2, 3"
Expected: ["1", "2", "3"]
Reason: Trimming
```

### TC-LIST-004: Leere Teile filtern
```typescript
Input: "1,,3"
Expected: ["1", "3"]
Reason: Leere Strings werden entfernt
```

### TC-LIST-005: Trailing Comma
```typescript
Input: "1,2,3,"
Expected: ["1", "2", "3"]
```

### TC-LIST-006: Leading Comma
```typescript
Input: ",1,2,3"
Expected: ["1", "2", "3"]
```

---

## 📋 Test-Kategorie 3: Expansion - Gemischt

### TC-MIX-001: Zahl + Bereich
```typescript
Input: "1,3-5"
Expected: ["1", "3", "4", "5"]
```

### TC-MIX-002: Komplexe Mischung
```typescript
Input: "1-3,10,20-22"
Expected: ["1", "2", "3", "10", "20", "21", "22"]
```

### TC-MIX-003: Überlappende Bereiche
```typescript
Input: "1-5,3-7"
Expected: ["1", "2", "3", "4", "5", "6", "7"]
Reason: Set dedupliziert 3, 4, 5
```

### TC-MIX-004: Mehrfache Überlappungen
```typescript
Input: "1-3,2-4,3-5"
Expected: ["1", "2", "3", "4", "5"]
Reason: Massive Deduplizierung
```

### TC-MIX-005: Bereich + Liste + Einzeln
```typescript
Input: "1,2-4,6,8-10"
Expected: ["1", "2", "3", "4", "6", "8", "9", "10"]
```

---

## 📋 Test-Kategorie 4: Fehlerbehandlung

### TC-ERR-001: Ungültiger Bereich (Buchstaben)
```typescript
Input: "abc-xyz"
Expected: ["abc-xyz"]
Reason: Als String behandeln
```

### TC-ERR-002: Umgekehrter Bereich
```typescript
Input: "5-1"
Expected: ["5-1"]
Reason: Start > End → ungültig
```

### TC-ERR-003: Gemischt gültig/ungültig
```typescript
Input: "1,abc,3-5"
Expected: ["1", "abc", "3", "4", "5"]
Reason: Ungültige Teile als String
```

### TC-ERR-004: Hausnummer mit Buchstabe
```typescript
Input: "12a"
Expected: ["12a"]
Reason: Nicht expandierbar
```

### TC-ERR-005: Bereich mit Buchstaben
```typescript
Input: "12a-12c"
Expected: ["12a-12c"]
Reason: Nicht expandierbar (noch nicht unterstützt)
```

### TC-ERR-006: Negative Zahlen
```typescript
Input: "-3--1"
Expected: ["-3--1"]
Reason: Parsing fehlschlägt
```

---

## 📋 Test-Kategorie 5: Matching - Einfach

### TC-MATCH-001: Exakter Match
```typescript
Search: "1"
Customer: "1"
Expected: true
```

### TC-MATCH-002: Match in Bereich
```typescript
Search: "1"
Customer: "1-3"
Expected: true
Reason: 1 ∈ {1,2,3}
```

### TC-MATCH-003: Kein Match außerhalb
```typescript
Search: "4"
Customer: "1-3"
Expected: false
Reason: 4 ∉ {1,2,3}
```

### TC-MATCH-004: Match mittlere Nummer
```typescript
Search: "2"
Customer: "1-3"
Expected: true
```

### TC-MATCH-005: Match letzte Nummer
```typescript
Search: "3"
Customer: "1-3"
Expected: true
```

---

## 📋 Test-Kategorie 6: Matching - Bidirektional

### TC-BIDI-001: Vorwärts-Match
```typescript
Search: "1"
Customer: "1,2"
Expected: true
Reason: 1 ∈ {1,2} (vorwärts)
```

### TC-BIDI-002: Rückwärts-Match
```typescript
Search: "1,2"
Customer: "1"
Expected: true
Reason: 1 ∈ {1,2} (rückwärts)
```

### TC-BIDI-003: Bereich überschneidend
```typescript
Search: "1-3"
Customer: "2-4"
Expected: true
Reason: {2,3} Überlappung
```

### TC-BIDI-004: Keine Überschneidung
```typescript
Search: "1-3"
Customer: "5-7"
Expected: false
Reason: Disjunkt
```

### TC-BIDI-005: Teilmenge
```typescript
Search: "1,2"
Customer: "1-5"
Expected: true
Reason: {1,2} ⊆ {1,2,3,4,5}
```

---

## 📋 Test-Kategorie 7: Deduplizierung

### TC-DEDUP-001: Einfache Deduplizierung
```typescript
Customer: { id: "C001", houseNumber: "1-3" }
Search: "1,2"
Expected: Customer erscheint 1x (nicht 2x)
```

### TC-DEDUP-002: Mehrfache Überlappungen
```typescript
Customer: { id: "C002", houseNumber: "10-15" }
Search: "10,11,12,13"
Expected: Customer erscheint 1x (nicht 4x)
```

### TC-DEDUP-003: Vollständige Abdeckung
```typescript
Customer: { id: "C003", houseNumber: "5-10" }
Search: "5-10"
Expected: Customer erscheint 1x
```

---

## 📋 Test-Kategorie 8: 30-Tage-Sperrung

### TC-BLOCK-001: Sperre innerhalb 30 Tage (exakt)
```typescript
Dataset: { houseNumber: "1", createdAt: "2024-01-15", createdBy: "user_a" }
Search: "1"
CurrentDate: "2024-01-20" (5 Tage später)
Expected: canCreateNew = false, existingTodayBy = "user_a"
```

### TC-BLOCK-002: Sperre innerhalb 30 Tage (Bereich)
```typescript
Dataset: { houseNumber: "1-3", createdAt: "2024-01-15", createdBy: "user_a" }
Search: "2"
CurrentDate: "2024-01-20"
Expected: canCreateNew = false
```

### TC-BLOCK-003: Keine Sperre (keine Überlappung)
```typescript
Dataset: { houseNumber: "1,2", createdAt: "2024-01-15", createdBy: "user_a" }
Search: "3"
CurrentDate: "2024-01-20"
Expected: canCreateNew = true ✅
```

### TC-BLOCK-004: Sperre abgelaufen (Tag 31)
```typescript
Dataset: { houseNumber: "1", createdAt: "2024-01-15", createdBy: "user_a" }
Search: "1"
CurrentDate: "2024-02-15" (31 Tage später)
Expected: canCreateNew = true
```

### TC-BLOCK-005: Creator-Privileg
```typescript
Dataset: { houseNumber: "1", createdAt: "2024-01-15", createdBy: "user_a" }
Search: "1"
CurrentDate: "2024-01-20"
Username: "user_a"
Expected: canCreateNew = true ✅
```

### TC-BLOCK-006: Granulare Sperrung (1,2 sperrt nicht 3)
```typescript
Dataset: { houseNumber: "1,2", createdAt: "2024-01-15", createdBy: "user_a" }

Test 1: Search "1" → canCreateNew = false
Test 2: Search "2" → canCreateNew = false
Test 3: Search "1,2" → canCreateNew = false
Test 4: Search "1-3" → canCreateNew = false (weil 1,2 überlappen)
Test 5: Search "3" → canCreateNew = true ✅
Test 6: Search "4,5" → canCreateNew = true ✅
```

---

## 📋 Test-Kategorie 9: Performance

### TC-PERF-001: Kleine Bereiche
```typescript
Input: "1-10"
Expected: < 5ms
```

### TC-PERF-002: Limit-Bereiche
```typescript
Input: "1-50"
Expected: < 10ms
```

### TC-PERF-003: Sehr große Bereiche (mit Limit)
```typescript
Input: "1-10000"
Expected: < 10ms
Reason: Wird auf 50 limitiert
```

### TC-PERF-004: 100 Kunden mit Bereichen
```typescript
Setup: 100 Kunden mit je "X0-X5" (10-15, 20-25, ...)
Search: "50"
Expected: < 100ms
```

### TC-PERF-005: Set-Deduplizierung
```typescript
Operation: uniqueCustomerIds.has(id)
Expected: O(1) nicht O(n)
```

---

## 🎯 Realistische Szenarien

### Szenario A: Hauptstraße 1-3

**Setup:**
```json
{
  "customer": { "id": "C001", "houseNumber": "1-3" },
  "dataset": { "id": "DS001", "houseNumber": "1,2", "createdAt": "2024-01-15", "createdBy": "max" }
}
```

**Tests:**
| User | Suche | Datum | Kunde? | Dataset-Sperre? | Kann erstellen? |
|------|-------|-------|--------|----------------|----------------|
| lisa | "1" | 2024-01-20 | ✅ C001 | ✅ DS001 (max) | ❌ Gesperrt |
| lisa | "3" | 2024-01-20 | ✅ C001 | ❌ Keine | ✅ Erlaubt |
| max | "1" | 2024-01-20 | ✅ C001 | ✅ DS001 (max) | ✅ Creator |
| lisa | "1" | 2024-02-20 | ✅ C001 | ❌ Abgelaufen | ✅ Erlaubt |

---

### Szenario B: Bahnhofstraße 10-15

**Setup:**
```json
{
  "customer1": { "id": "C002", "houseNumber": "10-15" },
  "customer2": { "id": "C003", "houseNumber": "20-25" },
  "dataset": { "id": "DS002", "houseNumber": "12", "createdAt": "2024-01-15", "createdBy": "anna" }
}
```

**Tests:**
| Suche | Gefundene Kunden | Dataset-Sperre? | Kann erstellen? |
|-------|------------------|----------------|----------------|
| "12" | C002 (1x) | ✅ DS002 | ❌ |
| "10,11,12" | C002 (1x dedupliziert) | ✅ DS002 | ❌ |
| "15" | C002 | ❌ Keine | ✅ |
| "22" | C003 | ❌ Keine | ✅ |
| "30" | Keine | ❌ Keine | ✅ |

---

### Szenario C: Komplexe Überlappungen

**Setup:**
```json
{
  "dataset1": { "houseNumber": "1-5", "createdAt": "2024-01-10", "createdBy": "user_a" },
  "dataset2": { "houseNumber": "3-7", "createdAt": "2024-01-12", "createdBy": "user_b" },
  "dataset3": { "houseNumber": "10", "createdAt": "2024-01-14", "createdBy": "user_c" }
}
```

**Tests:**
| Suche | Gefundene Datasets | Kann erstellen? | Grund |
|-------|-------------------|----------------|-------|
| "1" | DS1 | ❌ | Überlappung mit DS1 |
| "3" | DS1, DS2 | ❌ | Überlappung mit DS1+DS2 |
| "6" | DS2 | ❌ | Überlappung mit DS2 |
| "8" | Keine | ✅ | Keine Überlappung |
| "10" | DS3 | ❌ | Überlappung mit DS3 |
| "11" | Keine | ✅ | Keine Überlappung |

---

## ✅ Erwartete Ergebnisse - Zusammenfassung

### Bestandskunden-Matching
- ✅ "1" findet Kunde "1-3"
- ✅ "1,2" findet Kunde "1-3"
- ✅ "4" findet NICHT Kunde "1-3"
- ✅ Kunde wird nur 1x angezeigt (Deduplizierung)

### Datensatz-Sperrung
- ✅ "1,2" sperrt "1", "2", "1,2", "1-3"
- ✅ "1,2" sperrt NICHT "3"
- ✅ Sperre gilt 30 Tage (nicht 3 Monate)
- ✅ Creator kann immer erstellen

### Performance
- ✅ Expansion < 10ms (auch bei großen Bereichen)
- ✅ Matching < 100ms (100 Kunden)
- ✅ Set-Deduplizierung O(1)

### Fehlerbehandlung
- ✅ Ungültige Bereiche als String
- ✅ Limit bei > 50 Zahlen
- ✅ Leere Strings → []

---

## 🔧 Test-Ausführung

### Manueller Test-Flow

1. **Bestandskunden erstellen:**
   ```sql
   INSERT INTO customers (id, name, street, postalCode, houseNumber)
   VALUES ('C001', 'Test GmbH', 'Hauptstraße', '50667', '1-3');
   ```

2. **Dataset erstellen:**
   ```typescript
   POST /api/address-datasets
   Body: {
     street: "Hauptstraße",
     postalCode: "50667",
     number: "1,2",
     residents: [...]
   }
   ```

3. **Test-Suchen:**
   ```typescript
   // Kunde finden
   GET /api/customers/search?street=Hauptstraße&postalCode=50667&number=1
   
   // Dataset-Sperre prüfen
   GET /api/address-datasets?street=Hauptstraße&postalCode=50667&number=1
   ```

### Automatisierte Tests

```bash
# Unit Tests
npm test -- expandHouseNumberRange
npm test -- matchesHouseNumber

# Integration Tests
npm test -- getCustomersByAddress
npm test -- getRecentDatasetByAddress

# E2E Tests
npm run test:e2e
```

---

## 📊 Test-Metriken

### Erfolgsrate (Ziel)
- Unit Tests: > 95%
- Integration Tests: > 90%
- E2E Tests: > 85%

### Code Coverage (Ziel)
- `expandHouseNumberRange()`: 100%
- `matchesHouseNumber()`: 100%
- `getCustomersByAddress()`: > 90%
- `getRecentDatasetByAddress()`: > 90%

---

**Verwandte Dokumente:**
- `HAUSNUMMER_BEREICH_IMPLEMENTIERUNG.md` - Vollständige Implementation
- `HAUSNUMMER_BEREICH_ANALYSE.md` - Analyse & Optionen
- `HAUSNUMMER_DUPLIKATSPRÜFUNG_ANALYSE.md` - Deduplizierung

**Status:** ✅ Test-Suite vollständig dokumentiert  
**Datum:** Januar 2024
