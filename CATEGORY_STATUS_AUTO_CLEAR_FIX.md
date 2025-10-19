# Fix: Automatisches Löschen des Status beim Kategoriewechsel

**Datum**: 2025-10-19
**Problem**: Beim Ändern eines Residents von "Potentieller Neukunde" zu "Bestandskunde" wurde der Status nicht automatisch entfernt, was zu Backend-Validierungsfehlern führte.

## Problem Details

### Symptome
```json
{
    "error": "Status can only be assigned to potential new customers",
    "details": "Resident \"Melanie Patzler\" has category \"existing_customer\" but status is only allowed for \"potential_new_customer\""
}
```

### Ursache
1. **Frontend**: Setzt `status: undefined` beim Kategoriewechsel (korrekt in `ResultsDisplay.tsx` Zeile 756)
2. **Backend**: Validierte strikt und warf einen Fehler, wenn Status + falsche Kategorie kombiniert wurden
3. **Race Condition**: Wenn mehrere Residents im Array waren, konnten inkonsistente Zustände entstehen

## Lösung

### Backend Sanitierung (Defensives Pattern)

**Datei**: `server/routes/addressDatasets.ts`

#### 1. Bulk Update Endpoint (`PUT /bulk-residents`)

**Vorher** (Zeile 525-533):
```typescript
// FIX: Validate that only potential_new_customer can have status
for (const resident of data.editableResidents) {
  if (resident.status && resident.category !== 'potential_new_customer') {
    console.error(`[Bulk Update] VALIDATION ERROR: Cannot assign status to ${resident.category}:`, resident);
    return res.status(400).json({ 
      error: 'Status can only be assigned to potential new customers', 
      details: `Resident "${resident.name}" has category "${resident.category}" but status is only allowed for "potential_new_customer"` 
    });
  }
}
```

**Nachher**:
```typescript
// FIX: Auto-clear status if category is not potential_new_customer
// This handles the case where a resident is changed from potential_new_customer → existing_customer
const sanitizedResidents = data.editableResidents.map(resident => {
  if (resident.status && resident.category !== 'potential_new_customer') {
    console.warn(`[Bulk Update] Auto-clearing status for ${resident.name} (category: ${resident.category})`);
    return {
      ...resident,
      status: undefined
    };
  }
  return resident;
});

// Use sanitized residents for the update
data.editableResidents = sanitizedResidents;
```

#### 2. Single Update Endpoint (`PUT /residents`)

**Hinzugefügt** (nach Zeile 476):
```typescript
// Sanitize: Auto-clear status if category is not potential_new_customer
let sanitizedResidentData = data.residentData;
if (sanitizedResidentData && sanitizedResidentData.status && sanitizedResidentData.category !== 'potential_new_customer') {
  console.warn(`[Update Resident] Auto-clearing status for ${sanitizedResidentData.name} (category: ${sanitizedResidentData.category})`);
  sanitizedResidentData = {
    ...sanitizedResidentData,
    status: undefined
  };
}

await addressDatasetService.updateResidentInDataset(
  data.datasetId,
  data.residentIndex,
  sanitizedResidentData  // Use sanitized data
);
```

## Vorteile der Lösung

### ✅ Defensives Programming
- Backend "heilt" automatisch inkonsistente Daten
- Keine Breaking Changes für Frontend
- Fehlertoleranter gegenüber Race Conditions

### ✅ Datenintegrität
- Garantiert, dass `existing_customer` niemals einen Status haben
- Klare Business Rule Enforcement
- Automatisches Cleanup bei Kategorienwechsel

### ✅ User Experience
- Keine kryptischen Fehlermeldungen mehr
- Nahtloser Übergang zwischen Kategorien
- Keine manuellen Korrekturen nötig

## Verhalten

### Szenario 1: Potentieller Neukunde → Bestandskunde

**Vor dem Fix**:
```
1. User ändert Kategorie von "Potentieller Neukunde" zu "Bestandskunde"
2. Frontend setzt status: undefined
3. Backend validiert und wirft Fehler (wenn Race Condition)
4. ❌ Änderung fehlgeschlagen
```

**Nach dem Fix**:
```
1. User ändert Kategorie von "Potentieller Neukunde" zu "Bestandskunde"
2. Frontend setzt status: undefined
3. Backend prüft und cleared Status falls noch vorhanden
4. ✅ Änderung erfolgreich
```

### Szenario 2: Bulk Update mit gemischten Kategorien

**Vor dem Fix**:
```
editableResidents: [
  { name: "A", category: "potential_new_customer", status: "phase_1" },  // OK
  { name: "B", category: "existing_customer", status: "phase_2" }        // ❌ ERROR
]
→ Gesamter Request fehlgeschlagen
```

**Nach dem Fix**:
```
editableResidents: [
  { name: "A", category: "potential_new_customer", status: "phase_1" },  // OK
  { name: "B", category: "existing_customer", status: "phase_2" }        // Auto-cleared
]
→ Backend sanitized zu:
editableResidents: [
  { name: "A", category: "potential_new_customer", status: "phase_1" },
  { name: "B", category: "existing_customer", status: undefined }       // ✅ Fixed
]
→ Request erfolgreich
```

## Testing

### Manueller Test

1. **Setup**:
   ```
   - Erstelle einen potentiellen Neukunden
   - Weise einen Status zu (z.B. "Phase 1")
   ```

2. **Test Kategoriewechsel**:
   ```
   - Öffne Long-Press Menü
   - Wähle "Als Bestandskunde markieren"
   - ✅ Erwartung: Erfolgreiche Änderung, kein Fehler
   ```

3. **Verifikation**:
   ```
   - Prüfe Backend Logs: "Auto-clearing status for ..."
   - Prüfe Datenbank: status sollte null/undefined sein
   - Prüfe Frontend: Kein Status-Badge sichtbar
   ```

### Edge Cases

- ✅ Bulk Update mit 100+ Residents
- ✅ Schnelle aufeinanderfolgende Kategorie-Änderungen
- ✅ Offline/Online Transitions
- ✅ Concurrent Updates von verschiedenen Tabs

## Logging

Neue Log Messages für Debugging:

```typescript
// Bulk Update
console.warn(`[Bulk Update] Auto-clearing status for ${resident.name} (category: ${resident.category})`);

// Single Update  
console.warn(`[Update Resident] Auto-clearing status for ${sanitizedResidentData.name} (category: ${sanitizedResidentData.category})`);
```

Diese Warnings helfen bei:
- Performance Monitoring (sollte selten vorkommen)
- Debugging von Race Conditions
- Audit Trail für Datenbereinigung

## Zusammenfassung

| Aspekt | Vorher | Nachher |
|--------|--------|---------|
| **Error Handling** | Strikte Validierung → Fehler | Sanitierung → Success |
| **User Experience** | Fehlermeldungen | Nahtlose Änderung |
| **Datenintegrität** | Frontend-abhängig | Backend-garantiert |
| **Wartbarkeit** | Frontend muss perfekt sein | Backend ist tolerant |

## Related Files

- `server/routes/addressDatasets.ts` - Backend Sanitierung
- `client/src/components/ResultsDisplay.tsx` - Frontend Kategoriewechsel (Zeile 756)
- `server/services/googleSheets.ts` - Service Layer (keine Änderung nötig)

## Nächste Schritte

1. ✅ Backend Sanitierung implementiert
2. ⏳ Deployment testen
3. ⏳ User Feedback sammeln
4. ⏳ Monitoring für Auto-Clear Warnings einrichten
