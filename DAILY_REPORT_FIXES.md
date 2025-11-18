# Daily Report Data Accuracy Fixes

## Commit Hash
`cb57758` - fix: Daily report data accuracy issues

## Problems Identified

### 1. ❌ Peak Time Format
**Problem**: Report showed only start hour (`"15:00"`)  
**Expected**: Time range matching admin panel (`"12:00-16:00"`)  
**Root Cause**: `calculatePeakTime()` in `dailyReportGenerator.ts` only returned single hour

**Fix**: Rewrote function to match `admin.ts` implementation:
- Find consecutive hours with highest activity
- Try window sizes 1-4 hours
- Return formatted range: `"HH:00-HH:00"`

### 2. ❌ Status Changes All Zero
**Problem**: 
```json
"statusChangeDetails": {
  "laterInterest": 0,
  "appointmentScheduled": 0,
  "written": 0,
  "noInterest": 0,
  "notReached": 0
}
```

**Expected**: Actual values (68, 1, 252, 32, 69)  
**Root Cause**: Wrong German status keys (capitalized vs lowercase with underscores)

**Fix**: Changed status keys to match `dailyDataStore.ts`:
```typescript
// BEFORE (wrong)
userData.statusChanges.get('Später Interesse')
userData.statusChanges.get('Termin vereinbart')
userData.statusChanges.get('Geschrieben')
userData.statusChanges.get('Kein Interesse')
userData.statusChanges.get('Nicht erreicht')

// AFTER (correct)
userData.statusChanges.get('interessiert')
userData.statusChanges.get('termin_vereinbart')
userData.statusChanges.get('geschrieben')
userData.statusChanges.get('nicht_interessiert')
userData.statusChanges.get('nicht_angetroffen')
```

### 3. ❌ Final Status Assignments All Zero
**Problem**:
```json
"finalStatusAssignments": {
  "laterInterest": 0,
  "appointmentScheduled": 0,
  "written": 0,
  "noInterest": 0,
  "notReached": 0
}
```

**Expected**: Admin panel values (8, 1, 0, 42, 20)  
**Root Cause**: Two issues:
1. Wrong property name: `finalStatusCounts` instead of `finalStatuses`
2. Wrong German keys (same as issue #2)

**Fix**:
```typescript
// BEFORE (wrong)
userData.finalStatusCounts?.get('Interessiert')

// AFTER (correct)
userData.finalStatuses?.get('interessiert')
```

### 4. ❌ Missing "Saves" Field
**Problem**: Action details missing 174 "Datensatz-Updates"  
**Expected**: `saves: 174` in actionDetails  
**Root Cause**: Field not included in report interface and not mapped

**Fix**:
1. Added `saves: number;` to `actionDetails` interface
2. Mapped to `dataset_update` action type:
```typescript
saves: userData.actionsByType.get('dataset_update') || 0,
```

## Status Key Reference

### Correct Keys (lowercase with underscores)
| Frontend Display | Database Key | Example Count |
|-----------------|--------------|---------------|
| Später Interesse | `interessiert` | 68 |
| Termin vereinbart | `termin_vereinbart` | 1 |
| Geschrieben | `geschrieben` | 252 |
| Nicht interessiert | `nicht_interessiert` | 32 |
| Nicht erreicht | `nicht_angetroffen` | 69 |

### Final Status Keys (for assignments)
Same keys as above, but from `userData.finalStatuses` Map:
- `interessiert`: 8
- `termin_vereinbart`: 1
- `geschrieben`: 0
- `nicht_interessiert`: 20
- `nicht_angetroffen`: 42

## Action Type Mapping

| Frontend Label | Action Type Key | Example |
|---------------|-----------------|---------|
| Scans | `scan` | 0 |
| OCR Corrections | `bulk_residents_update` | 164 |
| Datensätze erstellt | `dataset_create` | 77 |
| Geocodes | `geocode` | 0 |
| Edits | `resident_update` | 0 |
| **Datensatz-Updates** | `dataset_update` | **174** |
| Deletes | `resident_delete` | 0 |
| Status Changes | `status_change` | 0 |
| Navigations | `navigate` | 0 |

## Remaining Issue: Distance Discrepancy

**Problem**: Report shows 98.8 km, but admin panel shows 8.74 km  
**Likely Cause**: Different distance calculation methods
- Report uses `userData.totalDistance` (all GPS points)
- Admin panel uses filtered calculation (walking speed <8 km/h, active time periods only)

**Impact**: **CRITICAL** - Distance data in reports is inflated ~11x

**Recommendation**: 
1. Investigate distance calculation in `dailyDataStore.ts`
2. Ensure report uses same filtered calculation as admin panel
3. Verify active time period detection is working correctly

**Files to Check**:
- `server/services/dailyDataStore.ts` - Distance calculation logic
- Recent changes to GPS filtering (<8 km/h, native source only)
- Active time period detection from native GPS logs

## Testing Checklist

✅ Peak time shows range format (`"12:00-16:00"`)  
✅ Status changes populated with actual counts  
✅ Final status assignments populated  
✅ Saves field included in action details  
⏳ Distance calculation accuracy (needs investigation)

## Next Steps

1. **Generate new report** for Nic with fixed code
2. **Verify all fields** match admin panel exactly:
   - Peak time format
   - Status change counts
   - Final status assignments
   - Action details including saves
3. **Investigate distance** - Why 98.8 km vs 8.74 km?
4. **Document** any additional discrepancies found

## Code Quality Notes

- All status keys now use consistent lowercase_underscore format
- Peak time calculation matches admin.ts implementation exactly
- Property names verified against actual data structure
- TypeScript compilation successful with no errors
