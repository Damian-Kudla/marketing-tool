# 🐛 Table View Status Persistence Bug Fix

## Problem

**Symptom:** When users edit resident status in the table view (AddressOverview), the changes appear in the UI immediately but **do not persist** after dataset reload.

**Root Cause:** The `onResidentUpdate` callback in `scanner.tsx` only updated local state (`setEditableResidents`) without calling the API to save changes to the database.

## Bug Flow

1. User clicks resident in AddressOverview table
2. ResidentEditPopup opens, user changes status
3. `handleResidentSave` calls `onResidentUpdate(updatedResidents)`
4. **BUG:** `onResidentUpdate={setEditableResidents}` only updates React state
5. No API call is made to persist changes
6. Dataset reload fetches old data from database → changes lost

## Solution

### Changes Made

#### 1. Added Sanitization Utilities to `scanner.tsx`

```typescript
/**
 * ✅ UTILITY: Sanitize single resident before saving
 * Existing customers should NOT have status set
 */
const sanitizeResident = (resident: any): any => {
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
const sanitizeResidents = (residents: any[]): any[] => {
  return residents.map(sanitizeResident);
};
```

#### 2. Created `handleResidentUpdate` Callback

```typescript
/**
 * ✅ FIX: Handle resident updates from AddressOverview table
 * Updates local state AND persists to database via API
 */
const handleResidentUpdate = useCallback(async (updatedResidents: any[]) => {
  console.log('[handleResidentUpdate] Saving resident changes to database...');
  
  // Update local state immediately for responsive UI
  setEditableResidents(updatedResidents);
  
  // Persist to database
  if (currentDatasetId) {
    try {
      await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));
      console.log('[handleResidentUpdate] ✅ Residents saved successfully');
    } catch (error) {
      console.error('[handleResidentUpdate] ❌ Failed to save residents:', error);
      toast({
        title: t('error.saveFailed', 'Save failed'),
        description: t('error.saveFailedDesc', 'Could not save resident changes'),
        variant: 'destructive',
      });
    }
  } else {
    console.warn('[handleResidentUpdate] ⚠️ No currentDatasetId - skipping API save');
  }
}, [currentDatasetId, toast, t]);
```

#### 3. Updated AddressOverview Prop (Call Back Mode)

**Before:**
```tsx
<AddressOverview
  onResidentUpdate={setEditableResidents}
  currentDatasetId={currentDatasetId}
/>
```

**After:**
```tsx
<AddressOverview
  onResidentUpdate={handleResidentUpdate}
  currentDatasetId={currentDatasetId}
/>
```

#### 4. Updated ClickableAddressHeader Prop (Normal Mode)

**Before:**
```tsx
<ClickableAddressHeader 
  onResidentsUpdate={setEditableResidents}
  currentDatasetId={currentDatasetId}
/>
```

**After:**
```tsx
<ClickableAddressHeader 
  onResidentsUpdate={handleResidentUpdate}
  currentDatasetId={currentDatasetId}
/>
```

## Fix Flow

1. User clicks resident in table → ResidentEditPopup opens
2. User changes status, clicks save
3. `handleResidentSave` → `onResidentUpdate(updatedResidents)`
4. **NEW:** `handleResidentUpdate` is called:
   - Updates local state: `setEditableResidents(updatedResidents)`
   - Sanitizes data: `sanitizeResidents(updatedResidents)`
   - Calls API: `datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizedResidents)`
5. Changes persist in database ✅
6. Dataset reload → changes are preserved ✅

## API Used

### `bulkUpdateResidents`

**Location:** `client/src/services/api.ts`

```typescript
bulkUpdateResidents: async (datasetId: string, editableResidents: any[]) => {
  const response = await apiService.put('/address-datasets/bulk-residents', {
    datasetId,
    editableResidents,
  });
  if (!response.ok) {
    throw new Error('Failed to bulk update residents');
  }
  return response.json();
}
```

**Backend:** `PUT /address-datasets/bulk-residents`
- Updates all residents for a dataset
- Validates data with `bulkUpdateResidentsRequestSchema`
- Calls `addressDatasetService.bulkUpdateResidentsInDataset()`
- Updates cache and batches sync to Google Sheets

## Data Sanitization

The `sanitizeResident` function prevents a critical bug:

**Business Rule:** Existing customers (`category: 'existing_customer'`) should **NOT** have a status field set.

**Why:** Status tracking is only for new prospects. Existing customers already have a relationship with the company.

**Sanitization:** Automatically clears `status` field if set on existing customers before saving to database.

## Error Handling

If API save fails:
1. Error is logged to console
2. User sees toast notification: "Save failed - Could not save resident changes"
3. Local state is still updated (optimistic update)
4. User can retry by editing again

## Files Modified

- `client/src/pages/scanner.tsx` (3 sections):
  1. Added `sanitizeResident` and `sanitizeResidents` utilities
  2. Added `handleResidentUpdate` callback with API persistence
  3. Updated two `onResidentUpdate` props to use new callback

## Testing Checklist

- [x] Table view: Edit resident status → Save → Reload dataset → Status persists ✅
- [x] Call Back Mode: Edit resident status → Navigate away → Navigate back → Status persists ✅
- [x] Header overview: Click address header → Edit resident → Status persists ✅
- [x] Existing customers: Set status → Sanitized on save (status cleared) ✅
- [x] API failure: Error toast appears, local state updated ✅

## Pattern Consistency

This fix follows the same pattern used in:
- `ResultsDisplay.tsx` (7 locations)
- `ImageWithOverlays.tsx` (3 locations)

All now consistently use:
```typescript
await datasetAPI.bulkUpdateResidents(datasetId, sanitizeResidents(residents));
```

## Version

Fixed in: **Version 2.5.1** (unreleased)
Related to: Version 2.5.0 deployment
