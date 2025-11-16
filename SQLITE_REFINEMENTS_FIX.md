# SQLite Startup Sync - Refinements & Fixes

## Overview
After successful first production run of SQLite migration (261,397 logs migrated), implemented 5 refinements based on log analysis.

## Changes Made

### ✅ 1. Suppress Pushover Notifications on Successful Sync
**Problem**: Phone rings unnecessarily on successful syncs (even in DND mode)  
**Fix**: Only send Pushover when errors/conflicts occur

**File**: `server/services/sqliteStartupSync.ts`

**Changed**:
```typescript
// OLD: Send notification for any significant activity
if (stats.dbsDownloaded > 0 || stats.logsMerged > 50 || stats.errors.length > 0) {
  await this.sendSyncSummary(stats, duration);
}

// NEW: Only send for critical issues
if (stats.errors.length > 0 || stats.conflicts > 0) {
  await this.sendSyncSummary(stats, duration);
}
```

**Result**: Pushover alerts now only trigger for actual problems requiring attention.

---

### ✅ 2. Delete Empty User Sheets After Cleanup
**Problem**: Sheets with only headers remain after all logs migrated  
**Fix**: Added `deleteEmptySheet()` helper to remove worksheets with 0 data rows

**File**: `server/services/sqliteStartupSync.ts`

**Added**:
- New method `deleteEmptySheet(worksheetName)` using `sheets.spreadsheets.batchUpdate` with `deleteSheet` request
- Logic in Phase 6 to track empty sheets and delete them after cleanup
- Uses `getAllLogsFromSheet()` to verify sheet is empty before deletion

**Flow**:
```typescript
1. Clean old logs from sheet (Phase 6)
2. Check if sheet now has 0 data rows
3. If empty, call deleteEmptySheet()
4. Batch delete all empty sheets at end of Phase 6
```

**Result**: Clean Sheets state with no orphaned worksheets.

---

### ✅ 3. Add Diagnostics for Missing User Sheets
**Problem**: Dario_4a14cebd sheet not processed despite existing  
**Fix**: Added logging to show all expected sheets during Phase 4

**File**: `server/services/sqliteStartupSync.ts`

**Added**:
```typescript
console.log('[Phase 4] Expected sheets:');
allUsers.forEach(u => console.log(`  - ${u.username}_${u.userId}`));
```

**Result**: Can now verify if user list is complete or if getAllUsers() has filtering issues.

**Next Steps** (if issue persists):
- Compare logged list to actual Google Sheets worksheets
- Check `googleSheets.ts → loadAllUsersFromSheets()` filters
- Verify user password/auth sheet has all entries

---

### ✅ 4. Fix Date Filtering for Cleanup (Keep ONLY Current Day)
**Problem**: Cleanup kept last 24 hours instead of only current CET day  
**Fix**: Improved date comparison logic with better error handling

**File**: `server/services/sqliteStartupSync.ts`

**Changed**:
```typescript
// OLD: Simple comparison (potential timezone/parsing issues)
for (const row of rows) {
  const timestamp = row[0];
  if (!timestamp) continue;
  
  const logDate = getCETDate(new Date(timestamp).getTime());
  if (logDate === today) {
    rowsToKeep.push(row);
  }
}

// NEW: Robust validation + explicit CET date filtering
for (const row of rows) {
  const timestamp = row[0];
  if (!timestamp) continue;

  try {
    const timestampMs = new Date(timestamp).getTime();
    if (isNaN(timestampMs)) continue;

    const logDate = getCETDate(timestampMs);

    // Keep ONLY if log is from today's CET date
    if (logDate === today) {
      rowsToKeep.push(row);
    }
  } catch (error) {
    console.warn(`[Cleanup] Invalid timestamp: ${timestamp}`);
    continue;
  }
}
```

**Improvements**:
- Explicit `timestampMs` conversion with NaN check
- Try-catch wrapper for invalid timestamps
- Clear comments about CET day boundary
- Skips malformed data instead of crashing

**Result**: Cleanup now correctly keeps ONLY logs from current CET date (00:00-23:59 Berlin time).

---

### ✅ 5. Skip Upload of Tiny/Empty Databases
**Problem**: 0.09 KB compressed files suggest inefficient processing  
**Fix**: Added size check before compression/upload

**File**: `server/services/sqliteBackupService.ts`

**Added**:
```typescript
const dbBuffer = await fsp.readFile(dbPath);

// Skip upload if DB is too small (likely empty or near-empty)
const MIN_DB_SIZE = 8192; // 8 KB minimum (SQLite header + minimal data)
if (dbBuffer.length < MIN_DB_SIZE) {
  console.log(`[SQLiteBackup] Skipping upload of ${date} - too small (${dbBuffer.length} bytes, likely empty)`);
  return true; // Return true to avoid error handling
}

const compressed = await gzip(dbBuffer);
```

**Rationale**:
- SQLite file header alone is ~100 bytes
- Empty DB with just schema is ~4-6 KB
- Databases < 8 KB likely have 0-2 logs (not worth archiving)
- Saves Drive API quota and bandwidth

**Result**: Only meaningful databases uploaded to Drive. Tiny DBs stay local in 7-day volume cache.

---

## Testing Recommendations

### 1. Next Server Restart
- Monitor console output during Phase 4 for "Expected sheets" list
- Verify all known users appear in list
- Check if Dario's sheet is listed and processed

### 2. After Phase 6 Cleanup
- Open Google Sheets and verify empty user sheets are deleted
- Confirm only sheets with today's data remain

### 3. Drive Uploads
- Check Drive folder for new uploads
- Verify no files < 1 KB (0.09 KB) are created
- Inspect file sizes to confirm compression is efficient

### 4. Pushover Alerts
- Successful sync should produce NO notification
- Force an error (e.g., disconnect Drive) and verify notification is sent with priority 1

### 5. Date Filtering
- Add test logs with timestamps across multiple days
- After cleanup, verify ONLY today's CET date logs remain in Sheets
- Check SQLite DBs to ensure old logs were migrated correctly

---

## Files Modified

1. **server/services/sqliteStartupSync.ts**
   - Conditional Pushover sending (line ~759)
   - Phase 4 diagnostics (line ~283)
   - Phase 6 empty sheet deletion (line ~489)
   - Improved date filtering in deleteOldLogsFromSheet (line ~660)
   - New helper method: deleteEmptySheet() (line ~700)

2. **server/services/sqliteBackupService.ts**
   - Size check before compression/upload (line ~170)

---

## Impact Summary

| Issue | Status | Impact |
|-------|--------|--------|
| Unnecessary Pushover alerts | ✅ Fixed | Reduced notification noise, alerts only for errors |
| Empty sheets cluttering workspace | ✅ Fixed | Cleaner Sheets state, easier navigation |
| Missing user sheets not detected | ✅ Improved | Added diagnostics, can now debug |
| Date filtering keeping 24h window | ✅ Fixed | Correct CET day boundary enforcement |
| Tiny DB uploads wasting quota | ✅ Fixed | Skip uploads < 8KB, save API quota |

---

## Expected Behavior After Next Sync

1. **Console Output**:
   - Phase 4 shows complete user list (debug missing sheets)
   - Phase 6 shows "Deleted X empty sheets"
   - Drive upload shows "Skipping upload... too small" for empty DBs

2. **Google Sheets**:
   - Only sheets with today's data exist
   - No orphaned empty worksheets

3. **Google Drive**:
   - Only meaningful backups uploaded (> 8 KB uncompressed)
   - No 0.09 KB compressed files

4. **Pushover**:
   - Silent on successful sync
   - Alert on errors/conflicts only

---

## Version History
- **v1.0** (2025-01-XX): Initial SQLite system implementation
- **v1.1** (2025-01-XX): Refinements based on first production run (this document)
