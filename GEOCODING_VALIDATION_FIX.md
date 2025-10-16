# Geocoding API Validation Fix

## Problem

**Ungültige Adressen wurden akzeptiert:**
```
Eingabe: "asd 2, 51067"
Gespeichert: ds_1760567389821_u5yymhfa4
├─ Straße: "asd" ❌ Existiert nicht
├─ Nummer: 2
├─ PLZ: 51067
└─ Normalisiert: "51067 Köln-Mülheim, Deutschland"
```

**Ursache:**
Die Geocoding API gibt bei ungültigen Straßennamen oft trotzdem ein Ergebnis zurück:
- Nur PLZ + Stadt gefunden → `status: "OK"` ✅
- Aber keine gültige Straße → Datensatz trotzdem erstellt ❌

**Alter Code:**
```typescript
if (data.status === "OK" && data.results && data.results.length > 0) {
  return data.results[0].formatted_address; // ✅ Akzeptiert alles!
}
```

---

## Lösung: Komponenten-Validierung

### Neue Validierungs-Logik

Die Geocoding API gibt `address_components` zurück mit verschiedenen Typen:

| Component Type | Bedeutung | Erforderlich |
|----------------|-----------|--------------|
| **route** | Straßenname | ✅ **JA** |
| **street_number** | Hausnummer | ✅ Empfohlen |
| **postal_code** | Postleitzahl | ❌ Nein |
| **locality** | Stadt | ❌ Nein |
| **country** | Land | ❌ Nein |

**Zusätzlich:** `location_type` (Genauigkeit):
- `ROOFTOP` = Exakte Adresse (höchste Präzision) ✅
- `RANGE_INTERPOLATED` = Hausnummer interpoliert (hohe Präzision) ✅
- `GEOMETRIC_CENTER` = Nur ungefähre Lage ⚠️
- `APPROXIMATE` = Sehr ungenau ❌

---

## Implementation

### 1. Funktion `normalizeAddress()` komplett überarbeitet

**Datei:** `server/services/googleSheets.ts` (Zeile 1283)

**Signatur geändert:**
```typescript
// VORHER
export async function normalizeAddress(...): Promise<string>

// NACHHER
export async function normalizeAddress(...): Promise<string | null>
```

**Neue Validierung:**
```typescript
const result = data.results[0];
const addressComponents = result.address_components;

// 1. Prüfe ob Straßenname (route) vorhanden
const hasRoute = addressComponents.some((component: any) => 
  component.types.includes('route')
);

// 2. Prüfe ob Hausnummer vorhanden
const hasStreetNumber = addressComponents.some((component: any) => 
  component.types.includes('street_number')
);

// 3. Prüfe Genauigkeit
const locationType = result.geometry?.location_type;

// 4. Validierungs-Regeln
if (!hasRoute) {
  // Keine Straße gefunden → UNGÜLTIG
  return null;
}

if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') {
  // Hohe Präzision → GÜLTIG
  return result.formatted_address;
}

if (!hasStreetNumber) {
  // Niedrige Präzision UND keine Hausnummer → UNGÜLTIG
  return null;
}

return result.formatted_address;
```

**Logging hinzugefügt:**
```typescript
console.log('[normalizeAddress] Validating:', addressString);
console.log('[normalizeAddress] Validation result:', {
  hasRoute,
  hasStreetNumber,
  locationType,
  formatted: result.formatted_address
});
```

---

### 2. Keine Fallbacks mehr

**VORHER (❌ Unsicher):**
```typescript
if (data.status === "OK") {
  return result.formatted_address;
}

// Fallback - akzeptiert ALLES
return `${street} ${number}, ${postal} ${city}`.trim();
```

**NACHHER (✅ Sicher):**
```typescript
if (data.status === "OK") {
  // Strikte Validierung...
  if (isValid) {
    return result.formatted_address;
  }
}

// Kein Fallback - lieber ablehnen als ungültige Daten speichern
return null;
```

**Ohne API Key:**
```typescript
if (!apiKey) {
  console.warn('Google Geocoding API key not configured');
  return null; // Keine Validierung möglich → ablehnen
}
```

---

### 3. Backend-Routen angepasst

#### POST `/api/address-datasets` (Dataset erstellen)

**Datei:** `server/routes/addressDatasets.ts` (Zeile 145)

```typescript
const normalizedAddress = await normalizeAddress(
  data.address.street,
  data.address.number,
  data.address.city,
  data.address.postal
);

if (!normalizedAddress) {
  return res.status(400).json({ 
    error: 'Address validation failed', 
    message: `Die Adresse "${data.address.street} ${data.address.number}, ${data.address.postal}" konnte nicht gefunden werden. Bitte überprüfe die Schreibweise der Straße.`,
    details: {
      street: data.address.street,
      number: data.address.number,
      postal: data.address.postal,
      hint: 'Die Google Geocoding API konnte diese Adresse nicht verifizieren. Stelle sicher, dass die Straße korrekt geschrieben ist.'
    }
  });
}
```

**Status Code:** `400 Bad Request`  
**Fehlermeldung:** Enthält eingegebene Adresse + Hinweis zur Überprüfung

#### GET `/api/address-datasets` (Datasets abrufen)

**Datei:** `server/routes/addressDatasets.ts` (Zeile 250)

```typescript
const normalizedAddress = await normalizeAddress(
  address.street,
  address.number,
  address.city,
  address.postal
);

if (!normalizedAddress) {
  return res.status(400).json({ 
    error: 'Address validation failed', 
    message: `Die Adresse "${address.street} ${address.number}, ${address.postal}" konnte nicht gefunden werden.`,
  });
}
```

---

## Validierungs-Flow

```
User Input: "asd 2, 51067"
    ↓
Frontend: Pflichtfelder OK ✓ (Straße, Nummer, PLZ vorhanden)
    ↓
POST /api/address-datasets
    ↓
Backend: normalizeAddress("asd", "2", null, "51067")
    ↓
Google Geocoding API:
  Query: "asd 2, 51067, Deutschland"
  Result: {
    formatted_address: "51067 Köln-Mülheim, Deutschland",
    address_components: [
      { types: ["postal_code"], long_name: "51067" },
      { types: ["locality"], long_name: "Köln-Mülheim" },
      // ❌ KEINE "route" component!
    ],
    geometry: {
      location_type: "APPROXIMATE" // ❌ Sehr ungenau
    }
  }
    ↓
Validierung:
  hasRoute: false ❌
  hasStreetNumber: false ❌
  locationType: "APPROXIMATE" ⚠️
    ↓
normalizeAddress() → null
    ↓
Backend: 400 Bad Request
{
  error: "Address validation failed",
  message: "Die Adresse 'asd 2, 51067' konnte nicht gefunden werden. 
            Bitte überprüfe die Schreibweise der Straße.",
  details: {
    street: "asd",
    number: "2",
    postal: "51067",
    hint: "Die Google Geocoding API konnte diese Adresse nicht verifizieren..."
  }
}
    ↓
Frontend: Toast-Fehlermeldung
❌ Datensatz wird NICHT erstellt
```

---

## Beispiele

### ❌ Ungültige Adressen (werden abgelehnt)

#### 1. Erfundener Straßenname
```
Input: "asd 2, 51067"
Geocoding Result: {
  formatted: "51067 Köln-Mülheim",
  components: [postal_code, locality] // ❌ Keine route
}
→ hasRoute = false
→ return null
→ 400 Bad Request
```

#### 2. Nur PLZ eingegeben
```
Input: "xyz 5, 12163"
Geocoding Result: {
  formatted: "12163 Berlin",
  components: [postal_code, locality] // ❌ Keine route
}
→ hasRoute = false
→ return null
→ 400 Bad Request
```

#### 3. Typo in Straßenname
```
Input: "Schlossstrase 160, 12163" (Typo: "Schlossstrase")
Geocoding Result: {
  formatted: "12163 Berlin",
  components: [postal_code, locality] // ❌ Keine route gefunden
}
→ hasRoute = false
→ return null
→ 400 Bad Request (mit Hinweis zur Überprüfung)
```

---

### ✅ Gültige Adressen (werden akzeptiert)

#### 1. Vollständige korrekte Adresse
```
Input: "Schloßstraße 160, 12163"
Geocoding Result: {
  formatted: "Schloßstraße 160, 12163 Berlin",
  components: [
    { types: ["route"], long_name: "Schloßstraße" }, // ✅
    { types: ["street_number"], long_name: "160" },  // ✅
    ...
  ],
  location_type: "ROOFTOP" // ✅ Höchste Präzision
}
→ hasRoute = true ✅
→ hasStreetNumber = true ✅
→ locationType = "ROOFTOP" ✅
→ return "Schloßstraße 160, 12163 Berlin, Deutschland"
→ 200 OK - Dataset erstellt
```

#### 2. Adresse mit interpolierter Hausnummer
```
Input: "Schloßstraße 161, 12163" (ungerade Hausnummer, evtl. interpoliert)
Geocoding Result: {
  formatted: "Schloßstraße 161, 12163 Berlin",
  components: [...],
  location_type: "RANGE_INTERPOLATED" // ✅ Hohe Präzision
}
→ hasRoute = true ✅
→ locationType = "RANGE_INTERPOLATED" ✅
→ return "Schloßstraße 161, 12163 Berlin, Deutschland"
→ 200 OK - Dataset erstellt
```

---

## Error Messages

### Frontend (wird vom Backend angezeigt)

**Toast Notification:**
```typescript
{
  variant: "destructive",
  title: "Adresse ungültig",
  description: "Die Adresse 'asd 2, 51067' konnte nicht gefunden werden. 
                Bitte überprüfe die Schreibweise der Straße."
}
```

### Backend Response

**POST /api/address-datasets (400):**
```json
{
  "error": "Address validation failed",
  "message": "Die Adresse 'asd 2, 51067' konnte nicht gefunden werden. Bitte überprüfe die Schreibweise der Straße.",
  "details": {
    "street": "asd",
    "number": "2",
    "postal": "51067",
    "hint": "Die Google Geocoding API konnte diese Adresse nicht verifizieren. Stelle sicher, dass die Straße korrekt geschrieben ist."
  }
}
```

**GET /api/address-datasets (400):**
```json
{
  "error": "Address validation failed",
  "message": "Die Adresse 'asd 2, 51067' konnte nicht gefunden werden."
}
```

---

## Logs (für Debugging)

```
[normalizeAddress] Validating: asd 2, 51067, Deutschland
[normalizeAddress] Validation result: {
  hasRoute: false,
  hasStreetNumber: false,
  locationType: 'APPROXIMATE',
  formatted: '51067 Köln-Mülheim, Deutschland'
}
[normalizeAddress] Invalid: No street found in geocoding result
```

---

## Testing Checklist

- [ ] Ungültige Straße "asd" → 400 Error
- [ ] Typo in Straßenname → 400 Error mit Hinweis
- [ ] Nur PLZ ohne Straße → 400 Error
- [ ] Korrekte Adresse "Schloßstraße 160, 12163" → 200 OK
- [ ] Adresse mit ungültiger PLZ → 400 Error
- [ ] Ohne API Key → 400 Error (keine Validierung möglich)
- [ ] Frontend zeigt Toast-Fehlermeldung bei 400

---

## API Key Konfiguration

**Erforderlich:** `GOOGLE_GEOCODING_API_KEY` in `.env`

```bash
GOOGLE_GEOCODING_API_KEY=AIza...
```

**Ohne API Key:**
- Validierung nicht möglich
- `normalizeAddress()` gibt `null` zurück
- Alle Adress-Requests werden mit 400 abgelehnt
- Warnung im Log: "Google Geocoding API key not configured - address validation disabled"

---

## Breaking Changes

**Rückgabewert geändert:**
```typescript
// VORHER
function normalizeAddress(): Promise<string>

// NACHHER
function normalizeAddress(): Promise<string | null>
```

**Migration:** Alle Aufrufe müssen `null` Handling hinzufügen (bereits erledigt)

---

## Betroffene Dateien

### Backend
- `server/services/googleSheets.ts`
  - `normalizeAddress()` Funktion (Zeile 1283)
  - Rückgabetyp: `Promise<string | null>`
  - Komponenten-Validierung hinzugefügt
  - Logging hinzugefügt
  - Fallbacks entfernt

- `server/routes/addressDatasets.ts`
  - POST `/` Route (Zeile 145)
  - GET `/` Route (Zeile 250)
  - Null-Checks hinzugefügt
  - Detaillierte Fehlermeldungen

---

## Empfehlung: Alte ungültige Datensätze bereinigen

```sql
-- Finde alle Datensätze ohne "route" in normalizedAddress
SELECT * FROM address_datasets 
WHERE normalizedAddress NOT LIKE '%straße%'
  AND normalizedAddress NOT LIKE '%weg%'
  AND normalizedAddress NOT LIKE '%platz%'
  AND normalizedAddress NOT LIKE '%allee%';

-- Beispiel: Datensatz mit street="asd"
SELECT * FROM address_datasets 
WHERE street = 'asd';
-- Ergebnis: ds_1760567389821_u5yymhfa4

-- Optional: Löschen
DELETE FROM address_datasets WHERE street = 'asd';
```
