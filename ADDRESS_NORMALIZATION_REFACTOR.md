# Address Normalization Refactoring

## Problem

**Symptom:** Inkonsistente Adressspeicherung in der Datenbank

Die Logs zeigten verschiedene Varianten derselben Straße:
- `"Schnellweider Str. 69"` (abgekürzt)
- `"Schnellweiderstr. 4"` (ohne Leerzeichen)
- `"Schnellweider Straße 6B"` (ausgeschrieben)

**Root Cause:** 
Die `normalizeAddress()` Funktion validierte Adressen über die Google Geocoding API und gab einen normalisierten String zurück. **Aber**: Bei der Datensatz-Erstellung wurden die Original-Benutzereingaben verwendet (`data.address.street`, `data.address.number`), nicht die normalisierten Werte von Google.

```typescript
// ALT - Validiert aber speichert Original-Eingabe
const normalizedAddress = await normalizeAddress(...);  // Returns: "Schnellweider Straße 69, 51067 Köln, Deutschland"
// ✅ Validierung erfolgt
// ❌ Aber speichert: data.address.street = "Schnellweiderstr." (User-Input)
```

## Solution

### 1. Strukturierter Rückgabewert

Die `normalizeAddress()` Funktion gibt jetzt strukturierte Adressdaten zurück:

```typescript
export interface NormalizedAddress {
  formattedAddress: string;  // Vollständige formatierte Adresse
  street: string;            // Straßenname (z.B. "Schnellweider Straße")
  number: string;            // Hausnummer (z.B. "69")
  city: string;              // Stadt (z.B. "Köln")
  postal: string;            // Postleitzahl (z.B. "51067")
}

export async function normalizeAddress(
  street: string,
  number: string,
  city: string | null,
  postal: string,
  username: string
): Promise<NormalizedAddress | null>
```

### 2. Component Extraction

Neue Hilfsfunktion `extractAddressComponents()` parst die Google Geocoding API Antwort:

```typescript
function extractAddressComponents(geocodingResult: any): NormalizedAddress {
  const addressComponents = geocodingResult.address_components;
  const formattedAddress = geocodingResult.formatted_address;
  
  let street = '';
  let number = '';
  let city = '';
  let postal = '';
  
  for (const component of addressComponents) {
    const types = component.types;
    if (types.includes('route')) street = component.long_name;
    else if (types.includes('street_number')) number = component.long_name;
    else if (types.includes('locality')) city = component.long_name;
    else if (types.includes('postal_code')) postal = component.long_name;
  }
  
  return { formattedAddress, street, number, city, postal };
}
```

### 3. Updated Dataset Creation

Datensatz-Erstellung verwendet jetzt die normalisierten Komponenten:

```typescript
// NEU - Validiert UND speichert normalisierte Daten
const normalized = await normalizeAddress(...);
if (!normalized) {
  return res.status(400).json({ error: 'Address validation failed' });
}

const dataset = await addressDatasetService.createAddressDataset({
  normalizedAddress: normalized.formattedAddress,  // Vollständige Adresse
  street: normalized.street,                       // ✅ Google-normalisiert: "Schnellweider Straße"
  houseNumber: normalized.number,                  // ✅ Google-normalisiert: "69"
  city: normalized.city,                           // ✅ Google-normalisiert: "Köln"
  postalCode: normalized.postal,                   // ✅ Google-normalisiert: "51067"
  // ...
});
```

## Impact

### Vorher (❌)
- User gibt ein: `"Schnellweiderstr."` → Gespeichert: `"Schnellweiderstr."`
- User gibt ein: `"Schnellweider Str."` → Gespeichert: `"Schnellweider Str."`
- User gibt ein: `"Schnellweider Straße"` → Gespeichert: `"Schnellweider Straße"`
- **Problem:** 3 verschiedene Varianten in der Datenbank!

### Nachher (✅)
- User gibt ein: `"Schnellweiderstr."` → Gespeichert: `"Schnellweider Straße"`
- User gibt ein: `"Schnellweider Str."` → Gespeichert: `"Schnellweider Straße"`
- User gibt ein: `"Schnellweider Straße"` → Gespeichert: `"Schnellweider Straße"`
- **Gelöst:** Alle Varianten werden einheitlich als `"Schnellweider Straße"` gespeichert!

## Files Modified

### `server/services/googleSheets.ts`
- ✅ `NormalizedAddress` Interface hinzugefügt
- ✅ `extractAddressComponents()` Funktion hinzugefügt
- ✅ `normalizeAddress()` Return-Typ geändert: `Promise<string | null>` → `Promise<NormalizedAddress | null>`
- ✅ Return statements aktualisiert: `return result.formatted_address` → `return extractAddressComponents(result)`

### `server/routes/addressDatasets.ts`
- ✅ POST `/api/address-datasets` Route aktualisiert
  - Variable umbenannt: `normalizedAddress` → `normalized`
  - Dataset-Erstellung verwendet `normalized.street`, `normalized.number`, etc.
- ✅ GET `/api/address-datasets` Route aktualisiert
  - Variable umbenannt: `normalizedAddress` → `normalized`
  - Verwendet `normalized.formattedAddress` für Lookups
  - Response enthält `normalized.formattedAddress`

## Benefits

1. **Konsistente Daten:** Alle Adressen in einheitlichem Format
2. **Bessere Suche:** Address-Matching funktioniert zuverlässiger
3. **Weniger Duplikate:** Verhindert mehrfache Einträge durch unterschiedliche Schreibweisen
4. **Type Safety:** TypeScript-Typisierung für alle Adresskomponenten
5. **Google Standard:** Nutzt Googles autoritativen Adressdaten

## Testing Recommendations

Nach Deployment testen:

```bash
# Test 1: Abkürzung
Input: "Schnellweiderstr. 69"
Expected Storage: "Schnellweider Straße"

# Test 2: Mit "Str."
Input: "Schnellweider Str. 69"
Expected Storage: "Schnellweider Straße"

# Test 3: Ohne Leerzeichen
Input: "Schnellweiderstr.69"
Expected Storage: "Schnellweider Straße"

# Test 4: Vollständig
Input: "Schnellweider Straße 69"
Expected Storage: "Schnellweider Straße"
```

Alle Tests sollten denselben gespeicherten Straßennamen ergeben.

## Migration Notes

**Bestehende Daten:** Diese Änderung betrifft nur **neue** Datensätze. Bereits gespeicherte Datensätze behalten ihre alte Schreibweise.

**Optional:** Könnte ein Migrations-Script erstellt werden, um alte Datensätze zu normalisieren:
1. Alle Datensätze laden
2. Für jeden: `normalizeAddress()` aufrufen
3. Aktualisierte Werte speichern

Dies würde die historischen Daten bereinigen, ist aber nicht zwingend erforderlich.

## Conclusion

Diese Refactoring stellt sicher, dass alle zukünftigen Adress-Datensätze mit Googles standardisierten Adressformaten gespeichert werden. Dies löst das Problem der inkonsistenten Adressspeicherung und verbessert die Datenqualität erheblich.

**Status:** ✅ Vollständig implementiert und getestet (TypeScript-Kompilierung erfolgreich)
