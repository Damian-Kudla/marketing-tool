# 🏘️ Analyse: Hausnummer-Berücksichtigung bei Duplikatsprüfung

## Fragestellung
Wird bei der Duplikatsprüfung korrekt berücksichtigt, dass:
1. Die **Hausnummer vom User** kommt (nicht normalisiert)
2. Der **Straßenname von Google** normalisiert wird
3. Bei Duplikatsprüfung **alle Datensätze mit gleicher Straße + PLZ** gefunden werden müssen
4. Dann geprüft wird, ob eine **Überschneidung bei den Hausnummern** existiert

---

## ✅ ANALYSE ERGEBNIS: **KORREKT IMPLEMENTIERT!**

Die Implementierung berücksichtigt bereits alle Anforderungen korrekt. Hier die detaillierte Aufschlüsselung:

---

## 📋 Code-Flow: Datensatz erstellen mit Duplikatsprüfung

### **Schritt 1: Adresse normalisieren** (normalizeAddress)
**Datei**: `server/services/googleSheets.ts:1336`

```typescript
// User gibt ein:
street = "Neusser Weyhe"
number = "27"           // ⚠️ Vom User, NICHT von Google!
postal = "41462"
city = "Neuss"

// Google API validiert nur Straße + PLZ
const addressString = `${street} ${number}, ${postal} ${city}, Deutschland`
// → "Neusser Weyhe 27, 41462 Neuss, Deutschland"

// Google gibt zurück:
result = {
  formatted_address: "Neusser Weyhe, 41462 Neuss, Deutschland",
  address_components: [
    { types: ['route'], long_name: 'Neusser Weyhe' },      // ✅ Straße von Google
    { types: ['postal_code'], long_name: '41462' },        // ✅ PLZ von Google
    { types: ['locality'], long_name: 'Neuss' }            // ✅ Stadt von Google
    // ⚠️ KEINE street_number in address_components!
  ]
}

// extractAddressComponents extrahiert:
return {
  formattedAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
  street: "Neusser Weyhe",   // ✅ Von Google (normalisiert)
  number: "27",              // ✅ Vom User (NICHT von Google!)
  city: "Neuss",             // ✅ Von Google
  postal: "41462"            // ✅ Von Google
}
```

**✅ KORREKT**: User's Hausnummer wird **nicht** durch Google normalisiert, sondern 1:1 übernommen!

---

### **Schritt 2: Duplikatsprüfung** (getRecentDatasetByAddress)
**Datei**: `server/routes/addressDatasets.ts:177`

```typescript
// Duplikatsprüfung mit User's Hausnummer
const existingDataset = await addressDatasetService.getRecentDatasetByAddress(
  normalized.formattedAddress,  // "Neusser Weyhe, 41462 Neuss, Deutschland"
  normalized.number,             // "27" (vom User!)
  30                             // 30 Tage zurück
);
```

**Was passiert intern:**

#### **2.1 getAddressDatasets aufrufen** (googleSheets.ts:510)
```typescript
async getAddressDatasets(
  normalizedAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
  limit: 50,
  houseNumber: "27"  // ✅ User's Hausnummer wird mitgegeben!
) {
  return datasetCache.getByAddress(normalizedAddress, limit, houseNumber);
}
```

#### **2.2 DatasetCache.getByAddress** (googleSheets.ts:171)
```typescript
getByAddress(
  normalizedAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
  limit: 50,
  houseNumber: "27"
) {
  // ✅ Hausnummer(n) extrahieren (unterstützt auch "27,29" für mehrere)
  const searchHouseNumbers = ["27"];
  
  // Alle Datensätze durchgehen
  const matchingDatasets = Array.from(this.cache.values())
    .filter(ds => {
      const datasetHouseNumbers = this.extractHouseNumbers(ds.houseNumber);
      // z.B. ["27"] oder ["27", "29"] oder ["1", "2", "3"]
      
      // ✅ Flexible Matching mit Hausnummer
      if (searchHouseNumbers.length > 0 && datasetHouseNumbers.length > 0) {
        return this.addressMatches(
          "Neusser Weyhe, 41462 Neuss, Deutschland",  // Search
          ["27"],                                      // Search-Hausnummern
          ds.normalizedAddress,                        // Dataset
          datasetHouseNumbers                          // Dataset-Hausnummern
        );
      }
      
      // Fallback: Exakte Adress-Übereinstimmung (wenn keine Hausnummern)
      return ds.normalizedAddress === normalizedAddress;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return limit ? matchingDatasets.slice(0, limit) : matchingDatasets;
}
```

---

### **Schritt 3: addressMatches - Die Matching-Logik** (googleSheets.ts:37)

**Das Herzstück der Duplikatsprüfung!**

```typescript
private addressMatches(
  searchNormalizedAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
  searchHouseNumbers: ["27"],
  datasetNormalizedAddress: ds.normalizedAddress,
  datasetHouseNumbers: ds.houseNumber (z.B. ["27", "29"])
): boolean {
  
  // ✅ SCHRITT 1: Straße + PLZ MÜSSEN übereinstimmen
  // Extrahiert: "neusser weyhe|41462"
  const extractPostalAndStreet = (normalizedAddr) => {
    // PLZ extrahieren (5 Ziffern)
    const postal = normalizedAddr.match(/\b\d{5}\b/)[0];  // "41462"
    
    // Straße extrahieren (Teil vor PLZ, normalisiert)
    let street = normalizedAddr.substring(0, normalizedAddr.indexOf(postal))
      .replace(/\d+[a-zA-Z]?(?:,?\s*\d+[a-zA-Z]?)*/g, '')  // Hausnummern entfernen
      .replace(/[,\.]/g, '')                                // Interpunktion entfernen
      .replace(/straße/gi, 'str')                           // "straße" → "str"
      .replace(/strasse/gi, 'str')                          // "strasse" → "str"
      .replace(/\s+/g, ' ')                                 // Leerzeichen normalisieren
      .trim()
      .toLowerCase();
    
    return `${street}|${postal}`;  // "neusser weyhe|41462"
  };
  
  const searchBase = extractPostalAndStreet(searchNormalizedAddress);
  // → "neusser weyhe|41462"
  
  const datasetBase = extractPostalAndStreet(datasetNormalizedAddress);
  // → "neusser weyhe|41462" (wenn gleiche Straße + PLZ)
  
  // ✅ Check 1: Straße + PLZ müssen identisch sein
  if (searchBase !== datasetBase) {
    return false;  // ❌ Andere Straße oder PLZ → kein Match
  }
  
  // ✅ SCHRITT 2: Hausnummern-Überschneidung prüfen (BIDIREKTIONAL!)
  // Gibt es IRGENDEINE Überschneidung zwischen den Hausnummer-Sets?
  
  // Check: Ist eine Search-Hausnummer in Dataset?
  for (const searchNum of searchHouseNumbers) {  // ["27"]
    if (datasetHouseNumbers.includes(searchNum)) {
      return true;  // ✅ Match: "27" ist in Dataset
    }
  }
  
  // Check: Ist eine Dataset-Hausnummer in Search?
  for (const datasetNum of datasetHouseNumbers) {  // ["27", "29"]
    if (searchHouseNumbers.includes(datasetNum)) {
      return true;  // ✅ Match: "27" ist in Search
    }
  }
  
  return false;  // ❌ Keine Überschneidung
}
```

---

## 🎯 Matching-Beispiele

### **Beispiel 1: Exakte Übereinstimmung**
```typescript
Search:  "Neusser Weyhe, 41462 Neuss" + Hausnummer "27"
Dataset: "Neusser Weyhe, 41462 Neuss" + Hausnummer "27"

✅ MATCH:
- Straße + PLZ identisch: "neusser weyhe|41462"
- Hausnummer-Überschneidung: "27" in ["27"]
→ Duplikat erkannt!
```

### **Beispiel 2: Multi-Hausnummer-Datensatz**
```typescript
Search:  "Neusser Weyhe, 41462 Neuss" + Hausnummer "27"
Dataset: "Neusser Weyhe, 41462 Neuss" + Hausnummer "27,29"

✅ MATCH:
- Straße + PLZ identisch: "neusser weyhe|41462"
- Hausnummer-Überschneidung: "27" ist in ["27", "29"]
→ Duplikat erkannt! (Teilmenge!)
```

### **Beispiel 3: Verschiedene Hausnummern**
```typescript
Search:  "Neusser Weyhe, 41462 Neuss" + Hausnummer "27"
Dataset: "Neusser Weyhe, 41462 Neuss" + Hausnummer "25,29"

❌ KEIN MATCH:
- Straße + PLZ identisch: "neusser weyhe|41462"
- Keine Hausnummer-Überschneidung: "27" ist NICHT in ["25", "29"]
→ Kein Duplikat! (Verschiedene Hausnummern)
```

### **Beispiel 4: Verschiedene Straße**
```typescript
Search:  "Neusser Weyhe, 41462 Neuss" + Hausnummer "27"
Dataset: "Schnellweider Straße, 41462 Neuss" + Hausnummer "27"

❌ KEIN MATCH:
- Straße unterschiedlich: "neusser weyhe|41462" ≠ "schnellweider str|41462"
→ Kein Duplikat! (Verschiedene Straßen trotz gleicher Hausnummer)
```

### **Beispiel 5: Verschiedene PLZ**
```typescript
Search:  "Hauptstraße, 41462 Neuss" + Hausnummer "27"
Dataset: "Hauptstraße, 41460 Neuss" + Hausnummer "27"

❌ KEIN MATCH:
- PLZ unterschiedlich: "hauptstr|41462" ≠ "hauptstr|41460"
→ Kein Duplikat! (Verschiedene PLZ)
```

### **Beispiel 6: Straße/Strasse Normalisierung**
```typescript
Search:  "Schnellweider Straße, 41462 Neuss" + Hausnummer "30"
Dataset: "Schnellweider Strasse, 41462 Neuss" + Hausnummer "30"

✅ MATCH:
- Normalisierung: "straße" und "strasse" werden zu "str"
- Basis: "schnellweider str|41462" (identisch!)
- Hausnummer-Überschneidung: "30" in ["30"]
→ Duplikat erkannt! (Normalisierung funktioniert!)
```

---

## 🔍 Kritische Analyse: Ist die Implementierung korrekt?

### ✅ **Anforderung 1: Hausnummer vom User (nicht von Google)**
**STATUS**: ✅ **ERFÜLLT**

- `extractAddressComponents` verwendet `userHouseNumber` Parameter
- Google's `street_number` wird **ignoriert**
- User's Input wird 1:1 in `normalized.number` übernommen

### ✅ **Anforderung 2: Straßenname von Google normalisiert**
**STATUS**: ✅ **ERFÜLLT**

- `normalizeAddress` verwendet Google's `route` component
- `extractAddressComponents` extrahiert `component.long_name` von `route`
- Straßenname ist **immer** von Google validiert

### ✅ **Anforderung 3: Alle Datensätze mit Straße + PLZ finden**
**STATUS**: ✅ **ERFÜLLT**

- `extractPostalAndStreet` extrahiert **nur** Straße + PLZ (ignoriert Hausnummer)
- Vergleich: `searchBase !== datasetBase` prüft nur `street|postal`
- Stadt wird **ignoriert** (korrekt, da optional/variabel)

### ✅ **Anforderung 4: Hausnummern-Überschneidung prüfen**
**STATUS**: ✅ **ERFÜLLT**

- Bidirektionale Prüfung: `searchNum in dataset` **UND** `datasetNum in search`
- Unterstützt **mehrere Hausnummern** (z.B. "27,29")
- Teilmengen werden erkannt (z.B. "27" matched "27,29")

---

## 🚀 Verbesserungsvorschläge (Optional)

### **Vorschlag 1: Hausnummern-Normalisierung verbessern**

**Problem**: User könnte verschiedene Formate eingeben:
```
"27"        → ["27"]
"27, 29"    → ["27", "29"]
"27,29"     → ["27", "29"]
"27 29"     → ["27 29"]  ⚠️ Wird als EINE Hausnummer erkannt!
"27a"       → ["27a"]
"27 a"      → ["27 a"]
```

**Verbesserung**: Leerzeichen auch als Trenner unterstützen
```typescript
private extractHouseNumbers(houseNumberStr: string): string[] {
  return houseNumberStr
    .split(/[,\s]+/)  // Split bei Komma ODER Leerzeichen
    .map(num => num.trim())
    .filter(num => num.length > 0);
}
```

**Beispiele nach Verbesserung**:
```
"27 29"     → ["27", "29"]  ✅
"27, 29"    → ["27", "29"]  ✅
"27,29"     → ["27", "29"]  ✅
"27a, 29b"  → ["27a", "29b"] ✅
```

---

### **Vorschlag 2: Debug-Logging für Duplikatsprüfung**

**Problem**: Bei Fehlfunktion ist schwer nachzuvollziehen, warum ein Match nicht gefunden wurde.

**Verbesserung**: Detailliertes Logging hinzufügen
```typescript
private addressMatches(...): boolean {
  const searchBase = extractPostalAndStreet(searchNormalizedAddress);
  const datasetBase = extractPostalAndStreet(datasetNormalizedAddress);

  console.log('[addressMatches] Comparing:', {
    search: { base: searchBase, houseNumbers: searchHouseNumbers },
    dataset: { base: datasetBase, houseNumbers: datasetHouseNumbers }
  });

  if (searchBase !== datasetBase) {
    console.log('[addressMatches] ❌ No match: Street or postal differs');
    return false;
  }

  // ... Hausnummern-Prüfung ...
  
  if (matchFound) {
    console.log('[addressMatches] ✅ Match found: House number overlap');
  } else {
    console.log('[addressMatches] ❌ No match: No house number overlap');
  }
  
  return matchFound;
}
```

---

### **Vorschlag 3: Hausnummern-Bereich unterstützen**

**Problem**: User könnte Bereiche eingeben:
```
"27-31"  → Sollte ["27", "28", "29", "30", "31"] werden?
"27-29"  → Sollte ["27", "28", "29"] werden?
```

**Verbesserung**: Bereich-Expansion implementieren
```typescript
private extractHouseNumbers(houseNumberStr: string): string[] {
  const parts = houseNumberStr.split(/[,\s]+/).map(p => p.trim()).filter(p => p);
  const expanded: string[] = [];
  
  for (const part of parts) {
    // Check if it's a range (e.g., "27-29")
    const rangeMatch = part.match(/^(\d+)a?-(\d+)a?$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      const hasLetterA = part.includes('a');
      
      for (let i = start; i <= end; i++) {
        expanded.push(hasLetterA ? `${i}a` : `${i}`);
      }
    } else {
      expanded.push(part);
    }
  }
  
  return expanded;
}
```

**Beispiele**:
```
"27-29"     → ["27", "28", "29"]  ✅
"27a-29a"   → ["27a", "28a", "29a"] ✅
"27,29-31"  → ["27", "29", "30", "31"] ✅
```

**⚠️ ACHTUNG**: Nur ungerade/gerade Hausnummern in Deutschland üblich!
```typescript
// Verbesserung: Nur ungerade ODER gerade Hausnummern
for (let i = start; i <= end; i += 2) {  // ±2 statt ±1
  expanded.push(hasLetterA ? `${i}a` : `${i}`);
}
```

---

## 📊 Zusammenfassung

### ✅ **AKTUELLER ZUSTAND: KORREKT IMPLEMENTIERT**

Die Duplikatsprüfung funktioniert **exakt** wie gewünscht:

1. ✅ **Hausnummer vom User**: Wird 1:1 übernommen, NICHT von Google normalisiert
2. ✅ **Straße von Google**: Wird durch Google Geocoding API validiert und normalisiert
3. ✅ **Matching-Logik**: Prüft zuerst Straße + PLZ, dann Hausnummern-Überschneidung
4. ✅ **Bidirektionale Prüfung**: Teilmengen werden erkannt (z.B. "27" matched "27,29")
5. ✅ **Normalisierung**: "Straße" vs "Strasse" werden gleich behandelt

### 🎯 **OPTIONALE VERBESSERUNGEN**

- **Leerzeichen als Trenner**: "27 29" → ["27", "29"] (aktuell: ["27 29"])
- **Debug-Logging**: Bessere Nachvollziehbarkeit bei Fehlfunktion
- **Bereich-Expansion**: "27-29" → ["27", "28", "29"] (Nice-to-have)

### 🔴 **KEINE KRITISCHEN PROBLEME GEFUNDEN**

Die Implementierung ist robust und erfüllt alle Anforderungen. Die vorgeschlagenen Verbesserungen sind **optional** und würden nur Edge-Cases abdecken.

---

**Erstellt**: 2025-10-17  
**Version**: 1.0  
**Status**: ✅ Analyse abgeschlossen - System funktioniert korrekt
