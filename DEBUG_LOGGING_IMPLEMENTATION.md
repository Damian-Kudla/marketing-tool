# 🔍 Debug-Logging für Duplikatsprüfung - Implementierung

## Übersicht
Debug-Logging wurde in die `DatasetCache`-Klasse implementiert, um die Duplikatsprüfung bei Adress-Matching besser nachvollziehbar zu machen.

---

## 🎯 Implementierte Änderungen*Vorschlag: Retry mit Exponential Backoff**

### **1. Logging in `addressMatches()` Methode**
**Datei**: `server/services/googleSheets.ts` (Zeilen ~37-95)

#### **Was wird geloggt:**

**A. Vergleichsinformationen (Anfang der Prüfung)**
```typescript
console.log('[DatasetCache.addressMatches] Comparing addresses:', {
  search: {
    fullAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
    base: "neusser weyhe|41462",
    houseNumbers: ["27"]
  },
  dataset: {
    fullAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
    base: "neusser weyhe|41462",
    houseNumbers: ["27", "29"]
  }
});
```

**B. Straße/PLZ-Prüfung**
```typescript
// Wenn KEINE Übereinstimmung:
❌ No match: Street or postal code differs

// Wenn Übereinstimmung:
✅ Street + postal match, checking house numbers...
```

**C. Hausnummern-Prüfung**
```typescript
// Wenn Match gefunden:
✅ MATCH FOUND: House number "27" found in dataset

// Wenn kein Match:
❌ No match: No house number overlap
```

---

### **2. Logging in `getByAddress()` Methode**
**Datei**: `server/services/googleSheets.ts` (Zeilen ~191-230)

#### **Was wird geloggt:**

**A. Suchanfrage-Details**
```typescript
console.log('[DatasetCache.getByAddress] Searching for datasets:', {
  normalizedAddress: "Neusser Weyhe, 41462 Neuss, Deutschland",
  houseNumber: "27",
  searchHouseNumbers: ["27"],
  totalDatasetsInCache: 156,
  limit: 50
});
```

**B. Anzahl gefundener Datensätze**
```typescript
console.log(`[DatasetCache.getByAddress] Found ${matchingDatasets.length} matching dataset(s)`);
// Beispiel: Found 2 matching dataset(s)
```

**C. Details der zurückgegebenen Datensätze**
```typescript
console.log('[DatasetCache.getByAddress] Returning datasets:', [
  {
    id: "dataset_123",
    address: "Neusser Weyhe, 41462 Neuss, Deutschland",
    houseNumber: "27",
    createdAt: "2025-10-15T14:30:00.000Z",
    createdBy: "michael"
  },
  {
    id: "dataset_456",
    address: "Neusser Weyhe, 41462 Neuss, Deutschland",
    houseNumber: "27,29",
    createdAt: "2025-10-10T10:15:00.000Z",
    createdBy: "anna"
  }
]);
```

---

## 📊 Beispiel-Logs (Complete Flow)

### **Szenario 1: Match gefunden**

```log
[DatasetCache.getByAddress] Searching for datasets: {
  normalizedAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
  houseNumber: '27',
  searchHouseNumbers: [ '27' ],
  totalDatasetsInCache: 156,
  limit: 50
}

[DatasetCache.addressMatches] Comparing addresses: {
  search: {
    fullAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    base: 'neusser weyhe|41462',
    houseNumbers: [ '27' ]
  },
  dataset: {
    fullAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    base: 'neusser weyhe|41462',
    houseNumbers: [ '27', '29' ]
  }
}
[DatasetCache.addressMatches] ✅ Street + postal match, checking house numbers...
[DatasetCache.addressMatches] ✅ MATCH FOUND: House number "27" found in dataset

[DatasetCache.getByAddress] Found 1 matching dataset(s)
[DatasetCache.getByAddress] Returning datasets: [
  {
    id: 'dataset_abc123',
    address: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    houseNumber: '27,29',
    createdAt: 2025-10-15T14:30:00.000Z,
    createdBy: 'michael'
  }
]
```

---

### **Szenario 2: Kein Match (verschiedene Hausnummern)**

```log
[DatasetCache.getByAddress] Searching for datasets: {
  normalizedAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
  houseNumber: '27',
  searchHouseNumbers: [ '27' ],
  totalDatasetsInCache: 156,
  limit: 50
}

[DatasetCache.addressMatches] Comparing addresses: {
  search: {
    fullAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    base: 'neusser weyhe|41462',
    houseNumbers: [ '27' ]
  },
  dataset: {
    fullAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    base: 'neusser weyhe|41462',
    houseNumbers: [ '25', '29' ]
  }
}
[DatasetCache.addressMatches] ✅ Street + postal match, checking house numbers...
[DatasetCache.addressMatches] ❌ No match: No house number overlap

[DatasetCache.getByAddress] Found 0 matching dataset(s)
```

---

### **Szenario 3: Kein Match (verschiedene Straße)**

```log
[DatasetCache.getByAddress] Searching for datasets: {
  normalizedAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
  houseNumber: '27',
  searchHouseNumbers: [ '27' ],
  totalDatasetsInCache: 156,
  limit: 50
}

[DatasetCache.addressMatches] Comparing addresses: {
  search: {
    fullAddress: 'Neusser Weyhe, 41462 Neuss, Deutschland',
    base: 'neusser weyhe|41462',
    houseNumbers: [ '27' ]
  },
  dataset: {
    fullAddress: 'Schnellweider Straße, 41462 Neuss, Deutschland',
    base: 'schnellweider str|41462',
    houseNumbers: [ '27' ]
  }
}
[DatasetCache.addressMatches] ❌ No match: Street or postal code differs

[DatasetCache.getByAddress] Found 0 matching dataset(s)
```

---

## 🎯 Verwendung / Debugging

### **Wo finde ich die Logs?**

1. **Server-Console**: Alle Logs werden in die Server-Console ausgegeben
2. **Railway/Fly.io**: Logs sind im Dashboard unter "Logs" sichtbar
3. **Lokale Entwicklung**: Terminal wo `npm run dev` läuft

### **Wie aktiviere ich detailliertes Logging?**

Die Logs sind **immer aktiviert** - keine Konfiguration nötig!

### **Wann werden die Logs ausgegeben?**

Die Logs werden **bei jeder Duplikatsprüfung** ausgegeben:
- Bei `POST /api/address-datasets` (Datensatz erstellen)
- Bei `GET /api/address-datasets` (Datensätze abrufen)
- Bei `getRecentDatasetByAddress()` (30-Tage-Prüfung)
- Bei `getTodaysDatasetByAddress()` (Heute-Prüfung)

### **Performance-Impact?**

- **Minimal**: Logging passiert nur während Duplikatsprüfung
- **Typisch**: 1-10 Vergleiche pro Request (je nach Cache-Größe)
- **Worst Case**: 50 Vergleiche (wenn `limit=50` gesetzt)

---

## 🔍 Troubleshooting mit den Logs

### **Problem: Duplikat wird nicht erkannt**

**1. Prüfe die `base` Werte:**
```log
search: { base: 'neusser weyhe|41462' }
dataset: { base: 'neusser weyhe|41462' }
```
✅ Wenn identisch: Straße + PLZ matchen  
❌ Wenn unterschiedlich: Verschiedene Straße oder PLZ

**2. Prüfe die `houseNumbers` Arrays:**
```log
search: { houseNumbers: ['27'] }
dataset: { houseNumbers: ['27', '29'] }
```
✅ Überschneidung: "27" ist in beiden Arrays  
❌ Keine Überschneidung: Verschiedene Hausnummern

**3. Prüfe die Match-Nachricht:**
```log
✅ MATCH FOUND: House number "27" found in dataset
```
Zeigt an, **welche** Hausnummer zum Match führte

---

### **Problem: Zu viele Matches gefunden**

**Prüfe die zurückgegebenen Datensätze:**
```log
[DatasetCache.getByAddress] Returning datasets: [...]
```

Jedes Match zeigt:
- `id`: Welcher Datensatz
- `houseNumber`: Welche Hausnummern
- `createdBy`: Wer hat ihn erstellt
- `createdAt`: Wann wurde er erstellt

**Mögliche Ursachen:**
- Mehrere Datensätze mit denselben Hausnummern (verschiedene Zeitpunkte)
- Hausnummern-Überschneidung (z.B. "27" matched "27,29")

---

### **Problem: Keine Matches, obwohl erwartet**

**1. Prüfe `totalDatasetsInCache`:**
```log
totalDatasetsInCache: 0
```
❌ Cache leer → Server muss neu gestartet werden

**2. Prüfe `searchHouseNumbers`:**
```log
searchHouseNumbers: []
```
❌ Leer → Hausnummer wurde nicht korrekt extrahiert

**3. Prüfe alle Vergleiche:**
Suche nach `[DatasetCache.addressMatches]` in den Logs  
→ Zeigt **jeden** Vergleich mit Details

---

## 📋 Zusammenfassung

### ✅ **Was wurde implementiert:**
1. ✅ Detailliertes Logging in `addressMatches()` (Straße/PLZ + Hausnummern-Prüfung)
2. ✅ Detailliertes Logging in `getByAddress()` (Such-Parameter + Ergebnisse)
3. ✅ Visuelle Indikatoren (✅/❌) für schnelles Scannen der Logs
4. ✅ Strukturierte Objekt-Ausgabe (einfach zu lesen)

### 🎯 **Nutzen:**
- Sofortige Sichtbarkeit bei Matching-Problemen
- Nachvollziehbarkeit der Duplikatsprüfung
- Debugging ohne Code-Änderungen
- Performance-Analyse (wie viele Vergleiche?)

### 🚀 **Nächste Schritte:**
- Logs im Server beobachten bei nächster Duplikatsprüfung
- Bei Problemen: Log-Output analysieren
- Optional: Log-Level konfigurierbar machen (verbose/quiet)

---

**Erstellt**: 2025-10-17  
**Version**: 1.0  
**Git Commit**: (Nach nächstem Commit hinzufügen)
