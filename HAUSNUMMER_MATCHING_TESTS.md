# Hausnummern-Matching Algorithmus Tests

## Neuer Algorithmus: Intelligentes Suffix-Matching

### Test Cases:

#### ✅ Test 1: Exakte Übereinstimmung
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1"   | "1"   | ✅ Match | ✅ PASS  |
| "10"  | "10"  | ✅ Match | ✅ PASS  |
| "1a"  | "1a"  | ✅ Match | ✅ PASS  |

#### ✅ Test 2: Suffix-Toleranz (a, b, c, d)
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1"   | "1a"  | ✅ Match | ✅ PASS  |
| "1"   | "1b"  | ✅ Match | ✅ PASS  |
| "1"   | "1c"  | ✅ Match | ✅ PASS  |
| "10"  | "10a" | ✅ Match | ✅ PASS  |

#### ❌ Test 3: Keine False-Positives bei ähnlichen Nummern
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1"   | "10"  | ❌ NO Match | ✅ PASS  |
| "1"   | "11"  | ❌ NO Match | ✅ PASS  |
| "1"   | "12"  | ❌ NO Match | ✅ PASS  |
| "1"   | "100" | ❌ NO Match | ✅ PASS  |
| "2"   | "20"  | ❌ NO Match | ✅ PASS  |
| "2"   | "21"  | ❌ NO Match | ✅ PASS  |

#### ✅ Test 4: Spezifische Suffixe
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1a"  | "1"   | ❌ NO Match | ✅ PASS  |
| "1a"  | "1a"  | ✅ Match | ✅ PASS  |
| "1a"  | "1b"  | ❌ NO Match | ✅ PASS  |
| "1a"  | "10a" | ❌ NO Match | ✅ PASS  |

#### ✅ Test 5: Normalisierung (Punkte, Bindestriche, Leerzeichen)
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1"   | "1"   | ✅ Match | ✅ PASS  |
| "1"   | "1."  | ✅ Match | ✅ PASS  |
| "1-a" | "1a"  | ✅ Match | ✅ PASS  |
| "1 a" | "1a"  | ✅ Match | ✅ PASS  |

#### ✅ Test 6: Groß-/Kleinschreibung
| Suche | Kunde | Erwartet | Ergebnis |
|-------|-------|----------|----------|
| "1a"  | "1A"  | ✅ Match | ✅ PASS  |
| "1A"  | "1a"  | ✅ Match | ✅ PASS  |

## Algorithmus-Logik:

### Schritt 1: Normalisierung
```typescript
normalizeNumber = (num) => num.toLowerCase().trim().replace(/[.\-\s]/g, '')
```
- Kleinbuchstaben
- Trimmen
- Entferne Punkte, Bindestriche, Leerzeichen

### Schritt 2: Exakter Match Check
```typescript
if (customerNumber === searchNumber) return true
```
- "1" === "1" ✅
- "1a" === "1a" ✅

### Schritt 3: Numerischer Teil Extraktion
```typescript
searchNumeric = searchNumber.match(/^\d+/)?.[0] || ''
customerNumeric = customerNumber.match(/^\d+/)?.[0] || ''
```
- "1" → "1"
- "1a" → "1"
- "10" → "10"
- "10a" → "10"

### Schritt 4: Numerischer Teil Vergleich
```typescript
if (searchNumeric !== customerNumeric) return false
```
- Suche "1" vs Kunde "10": "1" !== "10" → ❌ Reject
- Suche "1" vs Kunde "1a": "1" === "1" → ✅ Continue

### Schritt 5: Suffix-Analyse
```typescript
searchSuffix = searchNumber.replace(/^\d+/, '')
customerSuffix = customerNumber.replace(/^\d+/, '')
```
- "1" → Suffix: ""
- "1a" → Suffix: "a"
- "10" → Suffix: ""
- "10a" → Suffix: "a"

### Schritt 6: Suffix-Matching
```typescript
if (!searchSuffix) {
  // Suche ohne Suffix: Erlaube nur single-letter Suffixe
  return !customerSuffix || /^[a-z]$/.test(customerSuffix)
}
// Suche mit Suffix: Exakter Match erforderlich
return customerSuffix === searchSuffix
```

## Beispiel: Rudolf-Breitscheid-Str.

### Bestandskunden:
- Rudolf-Breitscheid-Str. 1
- Rudolf-Breitscheid-Str. 1a
- Rudolf-Breitscheid-Str. 1b
- Rudolf-Breitscheid-Str. 10
- Rudolf-Breitscheid-Str. 11
- Rudolf-Breitscheid-Str. 12

### Suche: "Rudolf-Breitscheid-Str. 1"

**Vorher (Alt):**
```
✅ Nr. 1   (Exakt)
✅ Nr. 1a  (startsWith "1")
✅ Nr. 1b  (startsWith "1")
✅ Nr. 10  (startsWith "1") ← FALSCH!
✅ Nr. 11  (startsWith "1") ← FALSCH!
✅ Nr. 12  (startsWith "1") ← FALSCH!
```

**Nachher (Neu):**
```
✅ Nr. 1   (Exakt, numerisch: "1" === "1")
✅ Nr. 1a  (Numerisch: "1" === "1", Suffix: "a" ist single-letter)
✅ Nr. 1b  (Numerisch: "1" === "1", Suffix: "b" ist single-letter)
❌ Nr. 10  (Numerisch: "1" !== "10") ← KORREKT!
❌ Nr. 11  (Numerisch: "1" !== "11") ← KORREKT!
❌ Nr. 12  (Numerisch: "1" !== "12") ← KORREKT!
```

## Performance:
- ✅ Keine Performance-Einbußen
- ✅ O(1) Komplexität pro Hausnummer
- ✅ Regex nur einmal pro Hausnummer
