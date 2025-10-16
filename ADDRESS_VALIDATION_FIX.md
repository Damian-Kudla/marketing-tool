# Address Validation Fix

## Problem
Es wurden unvollständige Adressen in die Datenbank gespeichert, z.B.:
```
ds_1760566873031_vm1sq4fic | Deutschland | "" | 2 | "" | "" | Damian | 2025-10-15T22:21:13.000Z
```

**Fehlende Daten:**
- Kein Straßenname
- Keine Postleitzahl
- Nur Land und Hausnummer

**Ursache:**
- Frontend zeigte "Anwohner anlegen" Button auch bei unvollständiger Adresse
- Backend hatte keine Validierung der Adress-Vollständigkeit

---

## Lösung

### Frontend Validierung (3-fach gesichert)

#### 1. Button wird nur bei vollständiger Adresse angezeigt
**Datei:** `client/src/components/ResultsDisplay.tsx`

```tsx
// Zeile 687
{address && address.street && address.number && address.postal && canEdit && (
  <Button onClick={handleCreateResidentWithoutPhoto}>
    <UserPlus /> Anwohner anlegen
  </Button>
)}
```

**Vorher:** `{address && canEdit && (...)}`  
**Nachher:** Prüft `address.street`, `address.number`, `address.postal`

#### 2. Validierung in `handleCreateResidentWithoutPhoto()`
**Datei:** `client/src/components/ResultsDisplay.tsx` (Zeile 610-618)

```tsx
// Validate address completeness: street, number, and postal are required
if (!address.street || !address.number || !address.postal) {
  toast({
    variant: "destructive",
    title: t('error.incompleteAddress', 'Unvollständige Adresse'),
    description: t('error.incompleteAddressDesc', 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'),
  });
  return;
}
```

#### 3. Validierung in `handleRequestDatasetCreation()`
**Datei:** `client/src/components/ResultsDisplay.tsx` (Zeile 290-298)

```tsx
// Validate address completeness: street, number, and postal are required
if (!address.street || !address.number || !address.postal) {
  toast({
    variant: "destructive",
    title: t('error.incompleteAddress', 'Unvollständige Adresse'),
    description: t('error.incompleteAddressDesc', 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'),
  });
  return null;
}
```

---

### Backend Validierung (2-fach gesichert)

#### 1. Pflichtfeld-Validierung
**Datei:** `server/routes/addressDatasets.ts` (Zeile 133-146)

```typescript
// Validate address completeness: street, number, and postal are required
if (!data.address.street || !data.address.number || !data.address.postal) {
  return res.status(400).json({ 
    error: 'Incomplete address', 
    message: 'Straße, Hausnummer und Postleitzahl müssen angegeben werden',
    details: {
      street: !data.address.street ? 'Straße fehlt' : undefined,
      number: !data.address.number ? 'Hausnummer fehlt' : undefined,
      postal: !data.address.postal ? 'Postleitzahl fehlt' : undefined,
    }
  });
}
```

**Status Code:** `400 Bad Request`  
**Fehlermeldung:** Deutsch, zeigt fehlende Felder

#### 2. Geocoding API Validierung
**Datei:** `server/routes/addressDatasets.ts` (Zeile 153-160)

```typescript
// Normalize the address using Geocoding API
const normalizedAddress = await normalizeAddress(
  data.address.street,
  data.address.number,
  data.address.city,
  data.address.postal
);

// Verify that normalization produced a valid result
if (!normalizedAddress || normalizedAddress.length < 10) {
  return res.status(400).json({ 
    error: 'Address validation failed', 
    message: 'Die angegebene Adresse konnte nicht verifiziert werden. Bitte überprüfe die Eingabe.',
  });
}
```

**Validierung:**
- Geocoding API muss Adresse finden
- Normalisierte Adresse muss mindestens 10 Zeichen haben
- Verhindert Typos und ungültige Adressen

---

## Validierungs-Flow

```
User Input
    ↓
┌─────────────────────────────────────┐
│ FRONTEND CHECK 1: Button Sichtbarkeit │
│ - address.street ✓                   │
│ - address.number ✓                   │
│ - address.postal ✓                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ FRONTEND CHECK 2: onClick Handler    │
│ - Nochmalige Prüfung aller Felder   │
│ - Toast bei Fehler                   │
└─────────────────────────────────────┘
    ↓
    POST /api/address-datasets
    ↓
┌─────────────────────────────────────┐
│ BACKEND CHECK 1: Pflichtfelder       │
│ - street, number, postal required   │
│ - 400 Bad Request bei Fehler        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ BACKEND CHECK 2: Geocoding API       │
│ - Google Maps Validierung           │
│ - Normalisierung der Adresse        │
│ - 400 Bad Request bei Fehler        │
└─────────────────────────────────────┘
    ↓
✅ Dataset wird gespeichert
```

---

## Pflichtfelder

| Feld | Erforderlich | Beispiel |
|------|--------------|----------|
| **Straße** | ✅ JA | "Schloßstraße" |
| **Hausnummer** | ✅ JA | "160" |
| **Postleitzahl** | ✅ JA | "12163" |
| Stadt | ❌ Nein | "Berlin" |
| Land | ❌ Nein | "Deutschland" |

**Hinweis:** Stadt wird oft automatisch über PLZ ermittelt (Geocoding API)

---

## Error Messages

### Frontend
```typescript
{
  title: 'Unvollständige Adresse',
  description: 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'
}
```

### Backend (Pflichtfelder)
```json
{
  "error": "Incomplete address",
  "message": "Straße, Hausnummer und Postleitzahl müssen angegeben werden",
  "details": {
    "street": "Straße fehlt",
    "number": undefined,
    "postal": "Postleitzahl fehlt"
  }
}
```

### Backend (Geocoding)
```json
{
  "error": "Address validation failed",
  "message": "Die angegebene Adresse konnte nicht verifiziert werden. Bitte überprüfe die Eingabe."
}
```

---

## Beispiel: Verhinderte Fehler-Datensätze

### Vorher (❌ Wurde gespeichert)
```
Land: Deutschland
Straße: ""
Hausnummer: 2
PLZ: ""
→ INVALID! Wurde trotzdem gespeichert
```

### Nachher (✅ Wird verhindert)
```
Land: Deutschland
Straße: ""
Hausnummer: 2
PLZ: ""
→ Button "Anwohner anlegen" wird nicht angezeigt
→ Falls doch aufgerufen: Frontend zeigt Toast-Fehler
→ Falls API direkt aufgerufen: Backend gibt 400 Bad Request
```

---

## Testing Checklist

- [ ] Button "Anwohner anlegen" nur sichtbar bei vollständiger Adresse
- [ ] Toast-Fehler bei unvollständiger Adresse (Frontend)
- [ ] 400 Error bei fehlendem street (Backend)
- [ ] 400 Error bei fehlendem number (Backend)
- [ ] 400 Error bei fehlendem postal (Backend)
- [ ] 400 Error bei ungültiger Adresse (Geocoding API findet nichts)
- [ ] Erfolgreiche Speicherung bei korrekter Adresse

---

## Betroffene Dateien

### Frontend
- `client/src/components/ResultsDisplay.tsx`
  - Button-Bedingung (Zeile 687)
  - `handleCreateResidentWithoutPhoto()` (Zeile 610)
  - `handleRequestDatasetCreation()` (Zeile 290)

### Backend
- `server/routes/addressDatasets.ts`
  - POST `/` Route (Zeile 133-160)
  - Pflichtfeld-Validierung
  - Geocoding-Validierung

### Bestehende Funktion (unverändert)
- `server/services/googleSheets.ts`
  - `normalizeAddress()` (Zeile 1283)
  - Verwendet bereits Google Geocoding API

---

## Deployment Notes

**Breaking Change:** Nein, nur zusätzliche Validierung  
**Migration nötig:** Nein  
**Alte Datensätze:** Bleiben erhalten (keine Retroaktive Löschung)

**Empfehlung:** Alte ungültige Datensätze manuell prüfen und ggf. löschen:
```sql
SELECT * FROM address_datasets 
WHERE street = '' OR houseNumber = '' OR postalCode = '';
```
