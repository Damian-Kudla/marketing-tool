# 🗺️ Adress-Normalisierung vor Dataset-Erstellung

**Datum:** 2025-10-18  
**Zweck:** Dokumentation des kompletten Adress-Normalisierungs-Ablaufs via Google Geocoding API

---

## 📊 Übersicht: Von User-Eingabe bis normalisierte Adresse

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. USER EINGABE (Frontend)                                          │
│    street: "Schnellweider str", number: "12A", postal: "41462"     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. FRONTEND VALIDIERUNG (scanner.tsx / ResultsDisplay.tsx)         │
│    ✅ Prüfung: street && number && postal vorhanden                │
│    ❌ Abbruch wenn fehlt: Toast-Meldung OHNE Backend-Call          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. API REQUEST                                                       │
│    POST /api/address-datasets                                        │
│    Body: { address: {...}, editableResidents: [...] }              │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. BACKEND VALIDIERUNG (addressDatasets.ts)                        │
│    ✅ Prüfung mit .trim(): street, number, postal                  │
│    ❌ Abbruch wenn fehlt: 400 Response mit missingFields[]         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. NORMALISIERUNG (googleSheets.normalizeAddress)                  │
│    📍 Google Geocoding API Aufruf                                   │
│    🔍 Validierung der Adresse                                       │
│    📋 Extraktion standardisierter Komponenten                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. DUPLIKATS-CHECK (30 Tage)                                        │
│    🔍 Suche nach existierendem Dataset mit flexibler Hausnummer     │
│    ❌ Abbruch wenn gefunden: 409 Response                           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 7. RACE CONDITION CHECK (Lock-Map)                                  │
│    🔒 Prüfe ob Dataset bereits erstellt wird                        │
│    ❌ Abbruch wenn locked: 409 Response                             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 8. DATASET ERSTELLEN                                                 │
│    ✅ Mit normalisierten Adressen-Komponenten                       │
│    🗄️ Speichern in Google Sheets                                   │
│    🔓 Lock entfernen nach Completion                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Schritt 5 im Detail: normalizeAddress()

### Eingabe-Parameter:
```typescript
normalizeAddress(
  street: "Schnellweider str",  // User-Eingabe (Tippfehler, Kleinschreibung)
  number: "12A",                // Hausnummer (wird IMMER beibehalten!)
  city: "Neuss",                // Optional
  postal: "41462",              // Pflichtfeld
  username: "damian"            // Für Rate-Limiting
)
```

---

### 5.1 Triple-Check Validierung

```typescript
// SCHRITT 1: Pflichtfeld-Prüfung
if (!street || !street.trim()) {
  throw new Error('Straße muss angegeben werden');
}
if (!number || !number.trim()) {
  throw new Error('Hausnummer muss angegeben werden');
}
if (!postal || !postal.trim()) {
  throw new Error('Postleitzahl muss angegeben werden');
}
```

**Resultat:** ✅ Alle Pflichtfelder vorhanden

---

### 5.2 Google API Key Check

```typescript
const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
if (!apiKey) {
  console.warn('Google Geocoding API key not configured');
  return null; // ❌ Normalisierung nicht möglich
}
```

**Resultat:** ✅ API-Key vorhanden

---

### 5.3 Rate-Limiting Check

```typescript
if (username) {
  const rateLimitCheck = checkRateLimit(username, 'geocoding');
  if (rateLimitCheck.limited) {
    throw new Error(rateLimitCheck.message);
  }
  incrementRateLimit(username, 'geocoding');
}
```

**Zweck:** Verhindert API-Missbrauch (zu viele Requests pro User)

**Resultat:** ✅ Limit nicht erreicht → Counter erhöht

---

### 5.4 Address String Construction

```typescript
const addressString = `${street} ${number}, ${postal} ${city || ''}, Deutschland`.trim();
// Resultat: "Schnellweider str 12A, 41462 Neuss, Deutschland"
```

**Wichtig:** 
- Hausnummer (`number`) wird MIT übergeben an Google
- Google korrigiert Rechtschreibfehler im Straßennamen
- Google findet ähnliche Adressen (z.B. "str" → "Straße")

---

### 5.5 Google Geocoding API Request

```typescript
const url = `https://maps.googleapis.com/maps/api/geocode/json
  ?address=${encodeURIComponent(addressString)}
  &key=${apiKey}
  &language=de`;

const response = await fetch(url);
const data = await response.json();
```

**Beispiel-Response:**
```json
{
  "status": "OK",
  "results": [
    {
      "formatted_address": "Schnellweider Straße 12, 41462 Neuss",
      "address_components": [
        {
          "long_name": "12",
          "short_name": "12",
          "types": ["street_number"]
        },
        {
          "long_name": "Schnellweider Straße",
          "short_name": "Schnellweider Str.",
          "types": ["route"]
        },
        {
          "long_name": "Neuss",
          "short_name": "Neuss",
          "types": ["locality", "political"]
        },
        {
          "long_name": "41462",
          "short_name": "41462",
          "types": ["postal_code"]
        }
      ],
      "geometry": {
        "location": {
          "lat": 51.214198,
          "lng": 6.678189
        },
        "location_type": "ROOFTOP"  // ✅ Höchste Präzision!
      }
    }
  ]
}
```

---

### 5.6 Validation Logic (Multi-Level)

#### Level 1: Component-Checks
```typescript
const hasRoute = addressComponents.some(component => 
  component.types.includes('route')  // Straßenname vorhanden?
);

const hasStreetNumber = addressComponents.some(component => 
  component.types.includes('street_number')  // Hausnummer vorhanden?
);

const locationType = result.geometry?.location_type;
// Mögliche Werte:
// - ROOFTOP: Exakte Adresse (höchste Präzision)
// - RANGE_INTERPOLATED: Interpoliert zwischen Hausnummern
// - GEOMETRIC_CENTER: Zentrum eines Bereichs (niedrigere Präzision)
// - APPROXIMATE: Ungefähre Position (niedrigste Präzision)
```

#### Level 2: High Precision Check
```typescript
if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') {
  console.log('[normalizeAddress] ✅ Accepted: High precision location type');
  return extractAddressComponents(result, number);
}
```

**Resultat:** ✅ `ROOFTOP` → Adresse wird akzeptiert!

#### Level 3: Fallback-Validierungen (bei niedrigerer Präzision)
```typescript
// Fallback 1: Formatted Address enthält Straßenname + PLZ + hat Route-Component
if (hasRoute && 
    formattedLower.includes(streetLower) && 
    formattedLower.includes(postalStr)) {
  return extractAddressComponents(result, number);
}

// Fallback 2: Route-Component + PLZ stimmt
if (hasRoute && formattedLower.includes(postalStr)) {
  return extractAddressComponents(result, number);
}

// Fallback 3: Nur PLZ stimmt (Last Resort)
if (formattedLower.includes(postalStr)) {
  return extractAddressComponents(result, number);
}

// REJECT: Keine Validierung möglich
return null;
```

**Zweck:** Auch Adressen mit ungewöhnlichen Namen akzeptieren (z.B. "Neusser Weyhe")

---

### 5.7 Address Component Extraction

```typescript
function extractAddressComponents(
  result: any, 
  userHouseNumber: string  // ⚠️ WICHTIG: User-Hausnummer wird beibehalten!
): NormalizedAddress {
  const addressComponents = result.address_components;
  const formattedAddress = result.formatted_address;
  
  let street = '';
  let city = '';
  let postal = '';
  
  // Iteriere durch alle address_components
  for (const component of addressComponents) {
    const types = component.types;
    
    if (types.includes('route')) {
      street = component.long_name;  // "Schnellweider Straße"
    } else if (types.includes('locality')) {
      city = component.long_name;    // "Neuss"
    } else if (types.includes('postal_code')) {
      postal = component.long_name;  // "41462"
    }
  }
  
  return {
    formattedAddress,                // "Schnellweider Straße 12, 41462 Neuss"
    street,                          // "Schnellweider Straße" ✅ KORRIGIERT!
    number: userHouseNumber,         // "12A" ⚠️ User-Eingabe beibehalten!
    city,                            // "Neuss"
    postal,                          // "41462"
  };
}
```

**Wichtig:**
- ✅ **Straßenname** wird von Google korrigiert (Rechtschreibung, Abkürzungen)
- ⚠️ **Hausnummer** wird NICHT überschrieben (User-Eingabe bleibt!)
- ✅ **Postleitzahl** wird von Google validiert
- ✅ **Stadt** wird von Google standardisiert

---

### 5.8 Return Value

```typescript
// Normalisiertes Objekt:
{
  formattedAddress: "Schnellweider Straße 12, 41462 Neuss",
  street: "Schnellweider Straße",    // ✅ Korrigiert von "Schnellweider str"
  number: "12A",                     // ⚠️ User-Eingabe beibehalten (nicht "12")
  city: "Neuss",
  postal: "41462"
}
```

---

## 🎯 Warum wird die Hausnummer NICHT von Google übernommen?

### Problem: Google kennt nicht alle Hausnummern-Suffixe

**Beispiel:**
- User gibt ein: `"Schnellweider Straße 12A"`
- Google kennt nur: `12`, `14`, `16`, ... (ohne Suffixe)
- Google würde zurückgeben: `street_number: "12"` (OHNE "A")

**Lösung:**
```typescript
number: userHouseNumber  // Behalte "12A" vom User!
```

**Vorteil:**
- User kann spezifische Hausnummern-Varianten erfassen (12A, 12B, 12-14, etc.)
- Straßenname wird trotzdem von Google korrigiert
- Postleitzahl wird von Google validiert

---

## ✅ Was wird durch Normalisierung erreicht?

| Aspekt | Vorher (User-Eingabe) | Nachher (Normalisiert) |
|--------|----------------------|------------------------|
| **Straßenname** | "Schnellweider str" (Tippfehler) | "Schnellweider Straße" ✅ |
| **Groß-/Kleinschreibung** | "schnellweider STR" | "Schnellweider Straße" ✅ |
| **Abkürzungen** | "Schnellweider Str." | "Schnellweider Straße" ✅ |
| **Hausnummer** | "12A" | "12A" ⚠️ BLEIBT! |
| **Postleitzahl** | "41462" | "41462" ✅ VALIDIERT |
| **Stadt** | "neuss" | "Neuss" ✅ |
| **Existenz** | ❓ Unbekannt | ✅ VON GOOGLE BESTÄTIGT |

---

## 🚫 Wann wird eine Adresse abgelehnt?

### Fall 1: Google findet die Adresse nicht
```json
{
  "status": "ZERO_RESULTS"
}
```
**Resultat:** `normalizeAddress()` gibt `null` zurück

---

### Fall 2: Niedrige Präzision + Straßenname stimmt nicht überein
```json
{
  "geometry": {
    "location_type": "APPROXIMATE"  // Nur ungefährer Bereich
  },
  "formatted_address": "41462 Neuss"  // Kein Straßenname!
}
```
**Resultat:** Fallback-Checks schlagen fehl → `null`

---

### Fall 3: Postleitzahl stimmt nicht
```typescript
const postalStr = "41462";
const formattedLower = "schnellweider straße 12, 41460 neuss";  // ❌ Falsche PLZ!

if (!formattedLower.includes(postalStr)) {
  return null;  // Adresse wird abgelehnt
}
```

---

## 🔒 Sicherheit: Was passiert nach der Normalisierung?

### Schritt 6: Duplikats-Check (30 Tage)
```typescript
const existingDataset = await addressDatasetService.getRecentDatasetByAddress(
  normalized.formattedAddress,  // "Schnellweider Straße 12, 41462 Neuss"
  normalized.number,            // "12A"
  30                            // Tage
);

if (existingDataset && existingDataset.isEditable) {
  return res.status(409).json({
    error: 'Dataset already exists',
    message: 'Datensatz existiert bereits'
  });
}
```

**Zweck:** Verhindert doppelte Datensätze für dieselbe Adresse innerhalb 30 Tagen

---

### Schritt 7: Lock-Map (Race Condition Prevention)
```typescript
const lockKey = `${normalized.formattedAddress}:${username}`;

if (creationLocks.has(lockKey)) {
  return res.status(409).json({
    error: 'Dataset creation already in progress',
    message: 'Datensatz wird bereits erstellt'
  });
}

// Lock setzen für 10 Sekunden
creationLocks.set(lockKey, { timestamp: Date.now() });
```

**Zweck:** Verhindert parallele Dataset-Erstellung für dieselbe Adresse

---

### Schritt 8: Dataset-Erstellung
```typescript
const dataset = await addressDatasetService.createAddressDataset({
  normalizedAddress: normalized.formattedAddress,  // ✅ Vollständige Adresse
  street: normalized.street,                       // ✅ Korrigierter Straßenname
  houseNumber: normalized.number,                  // ⚠️ User-Hausnummer
  city: normalized.city,                           // ✅ Standardisierte Stadt
  postalCode: normalized.postal,                   // ✅ Validierte PLZ
  // ... weitere Felder
});

// Lock entfernen nach Success/Failure
creationLocks.delete(lockKey);
```

---

## 📊 Beispiel: Kompletter Ablauf

### User-Eingabe:
```typescript
{
  street: "schnellweider str",
  number: "12a",
  postal: "41462",
  city: "neuss"
}
```

### Nach Frontend-Validierung:
✅ Alle Pflichtfelder vorhanden → Request gesendet

### Nach Backend-Validierung:
✅ `.trim()` Checks erfolgreich → Normalisierung starten

### Google Geocoding API Response:
```json
{
  "status": "OK",
  "results": [{
    "formatted_address": "Schnellweider Straße 12, 41462 Neuss",
    "geometry": { "location_type": "ROOFTOP" },
    "address_components": [
      { "long_name": "Schnellweider Straße", "types": ["route"] },
      { "long_name": "Neuss", "types": ["locality"] },
      { "long_name": "41462", "types": ["postal_code"] }
    ]
  }]
}
```

### Normalisiertes Objekt:
```typescript
{
  formattedAddress: "Schnellweider Straße 12, 41462 Neuss",
  street: "Schnellweider Straße",  // ✅ Korrigiert
  number: "12a",                   // ⚠️ User-Eingabe beibehalten
  city: "Neuss",                   // ✅ Standardisiert
  postal: "41462"                  // ✅ Validiert
}
```

### Duplikats-Check:
✅ Kein existierendes Dataset gefunden

### Lock-Check:
✅ Kein Lock vorhanden → Lock erstellen

### Dataset erstellt:
```typescript
{
  id: "abc123",
  normalizedAddress: "Schnellweider Straße 12, 41462 Neuss",
  street: "Schnellweider Straße",
  houseNumber: "12a",
  postalCode: "41462",
  city: "Neuss",
  createdBy: "damian",
  createdAt: "2025-10-18T10:30:00Z"
}
```

### Lock entfernt:
✅ `creationLocks.delete("Schnellweider Straße 12, 41462 Neuss:damian")`

---

## 🎓 Zusammenfassung

### Was macht die Normalisierung?
1. ✅ **Validiert** dass die Adresse existiert (Google kennt sie)
2. ✅ **Korrigiert** Tippfehler im Straßennamen
3. ✅ **Standardisiert** Groß-/Kleinschreibung und Abkürzungen
4. ✅ **Verifiziert** die Postleitzahl
5. ⚠️ **Behält** die User-Hausnummer (wichtig für Suffixe wie "12A")

### Warum ist das wichtig?
- 🔍 **Duplikats-Erkennung:** Verhindert mehrfache Datensätze für dieselbe Adresse
- 📊 **Konsistenz:** Alle Datensätze verwenden dieselbe Schreibweise
- ✅ **Validierung:** Nur existierende Adressen werden akzeptiert
- 🔒 **Sicherheit:** Multi-Layer Validierung verhindert unvollständige Daten

### Was passiert NACH der Normalisierung?
1. 🔍 Duplikats-Check (30 Tage)
2. 🔒 Race Condition Check (Lock-Map)
3. ✅ Dataset-Erstellung mit normalisierten Daten
4. 🔓 Lock-Cleanup
