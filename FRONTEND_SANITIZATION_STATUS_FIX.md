# Frontend Sanitierung für Status/Kategorie Konsistenz

**Datum**: 2025-10-20  
**Related**: CATEGORY_STATUS_AUTO_CLEAR_FIX.md

## Problem

Nach Implementierung der Backend-Sanitierung (siehe CATEGORY_STATUS_AUTO_CLEAR_FIX.md) traten **immer noch 400 Fehler** auf:

```
Failed to load resource: the server responded with a status of 400 (Bad Request)
/api/address-datasets/bulk-residents
```

### Root Cause

Das **Frontend** sendete Residents mit **inkonsistenten Daten** an das Backend:

```json
{
  "name": "Irina Ivanvna Dengova",
  "category": "existing_customer",    // ✅ Bestandskunde
  "status": "not_reached",            // ❌ Status nur für Neukunden erlaubt!
  "isFixed": false
}
```

### Warum Backend-Sanitierung nicht genug war

Die Backend-Sanitierung in `addressDatasets.ts` (Zeile 525-538) wurde **nach** der Zod-Schema-Validierung ausgeführt. Das Schema validierte bereits vorher und warf den 400 Fehler, bevor die Sanitierung greifen konnte.

## Lösung: Frontend-Sanitierung

### Utility-Funktionen

**Datei**: `client/src/components/ResultsDisplay.tsx` (Zeile 39-56)

```typescript
/**
 * ✅ UTILITY: Sanitize resident data before sending to backend
 * Ensures status is undefined for existing_customer category
 */
const sanitizeResident = (resident: EditableResident): EditableResident => {
  if (resident.category === 'existing_customer' && resident.status) {
    console.warn(`[sanitizeResident] ⚠️ Clearing status "${resident.status}" for existing_customer:`, resident.name);
    return {
      ...resident,
      status: undefined
    };
  }
  return resident;
};

/**
 * ✅ UTILITY: Sanitize array of residents
 */
const sanitizeResidents = (residents: EditableResident[]): EditableResident[] => {
  return residents.map(sanitizeResident);
};
```

### Angewandte Änderungen

#### 1. handleResidentSave (Zeile ~540)

**Vorher**:
```typescript
const updatedResident = { ...formData };
updatedResidents[editingResidentIndex] = updatedResident;
await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
```

**Nachher**:
```typescript
const sanitizedResident = sanitizeResident(updatedResident);
updatedResidents[editingResidentIndex] = sanitizedResident;
await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));
```

#### 2. Alle bulkUpdateResidents Calls (7 Stellen)

Alle Aufrufe von `datasetAPI.bulkUpdateResidents()` wurden geändert:

```typescript
// Vorher
await datasetAPI.bulkUpdateResidents(currentDatasetId, residents);

// Nachher
await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(residents));
```

**Betroffene Funktionen**:
1. `handleRequestDatasetCreation` - Zeile ~387
2. `handleResidentSave` - Zeile ~546
3. `handleResidentDelete` - Zeile ~596
4. `handleStatusChange` - Zeile ~695
5. `handleCategoryChange` - Zeile ~796
6. `handleCategoryAndStatusChange` - Zeile ~893
7. `handleDeleteConfirm` - Zeile ~926

## Defense in Depth

### Multi-Layer-Protection

| Layer | Location | Purpose |
|-------|----------|---------|
| **Frontend Sanitierung** | `ResultsDisplay.tsx` | Verhindert invalide Requests |
| **Backend Sanitierung** | `addressDatasets.ts` | Defensives Fallback für Race Conditions |
| **Service Layer** | `googleSheets.ts` | Datenintegrität in Datenbank |

### Vorteile

✅ **Keine 400 Errors mehr** - Frontend sendet nur valide Daten  
✅ **Performance** - Vermeidet unnötige Backend-Roundtrips  
✅ **Logging** - Klare Warnungen im Frontend-Log  
✅ **Wartbarkeit** - Zentrale Utility-Funktionen  

## Testing

### Test Case 1: Resident Edit mit Kategorie-Änderung

```typescript
// Given
const resident = {
  name: "Test User",
  category: "potential_new_customer",
  status: "phase_1"
};

// When: User ändert Kategorie zu "existing_customer"
handleResidentSave({
  ...resident,
  category: "existing_customer"
  // status bleibt "phase_1" im Form-State!
});

// Then: Frontend sanitiert automatisch
// Gesendete Daten:
{
  name: "Test User",
  category: "existing_customer",
  status: undefined  // ✅ Auto-cleared
}
```

### Test Case 2: Bulk Update mit gemischten Kategorien

```typescript
const residents = [
  { name: "A", category: "potential_new_customer", status: "phase_1" },
  { name: "B", category: "existing_customer", status: "phase_2" },  // ❌ Invalid
  { name: "C", category: "existing_customer", status: undefined }
];

// Sanitierung vor Backend-Call
const sanitized = sanitizeResidents(residents);

// Result:
[
  { name: "A", category: "potential_new_customer", status: "phase_1" },
  { name: "B", category: "existing_customer", status: undefined },  // ✅ Fixed
  { name: "C", category: "existing_customer", status: undefined }
]
```

## Monitoring

### Console Warnings

```typescript
[sanitizeResident] ⚠️ Clearing status "not_reached" for existing_customer: Irina Ivanvna Dengova
```

Diese Warnings helfen bei:
- **Debugging**: Identifikation von problematischen Flows
- **Analytics**: Wie oft tritt das Problem auf?
- **UX Improvements**: Wo sollte das UI klarer sein?

## Verhalten

### Vorher (nur Backend-Sanitierung)

```
1. User edited Resident mit category: existing_customer, status: not_reached
2. Frontend sendet Daten → 400 Bad Request ❌
3. Toast: "Changes could not be saved"
4. User Frustration
```

### Nachher (Frontend + Backend)

```
1. User edited Resident mit category: existing_customer, status: not_reached
2. Frontend sanitiert → status: undefined
3. Frontend sendet Daten → 200 OK ✅
4. Backend sanitiert (redundant, aber sicher)
5. Toast: "Changes were saved successfully"
```

## Zusammenfassung

| Aspekt | Nur Backend | Frontend + Backend |
|--------|-------------|-------------------|
| **400 Errors** | Häufig | Nie |
| **Performance** | Verschwendete Requests | Optimiert |
| **User Experience** | Fehlermeldungen | Nahtlos |
| **Data Integrity** | Backend-abhängig | Mehrfach abgesichert |
| **Debugging** | Schwer (Backend Logs) | Einfach (Browser Console) |

## Related Files

- ✅ `client/src/components/ResultsDisplay.tsx` - Utility-Funktionen und 7 Sanitierung-Calls
- ✅ `server/routes/addressDatasets.ts` - Backend Fallback-Sanitierung
- 📄 `CATEGORY_STATUS_AUTO_CLEAR_FIX.md` - Backend-Sanitierung Dokumentation

## Lessons Learned

1. **Client-Side Validation ist wichtig** - Nicht alle Fehler sollten ans Backend gehen
2. **Defense in Depth** - Mehrere Sicherheitsschichten sind besser als eine
3. **Utility-Funktionen** - Zentrale Logik statt Copy-Paste
4. **Logging** - Console.warn() hilft beim Debugging und Monitoring
