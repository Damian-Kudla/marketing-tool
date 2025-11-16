# External Tracking Data Auto-Reconciliation

## Overview

Automated system for retroactively assigning unidentified external tracking GPS data to users when their device names are later added to the Zugangsdaten database.

## Problem Statement

When the external tracking app sends GPS data, if the device name (userName field) is not found in Zugangsdaten column F, the data is stored in the "Tracking App" Google Sheet under a worksheet named after the device. This data remains unassigned until the device name is manually added to Zugangsdaten.

Previously, this required running a manual Python script to:
1. Check device names against Zugangsdaten
2. Convert GPS data format
3. Append to user's worksheet
4. Delete assigned worksheets

## Solution

Automatic reconciliation service that runs at two trigger points:
1. **Server startup** (before 6-phase DB sync)
2. **Midnight cron** (before daily archive)

### Architecture

**Service**: `server/services/externalTrackingReconciliation.ts`

**Integration Points**:
- `server/index.ts` - Server startup
- `server/services/sqliteDailyArchive.ts` - Midnight cron (Step 0)
- `server/routes/admin.ts` - Manual test endpoint

### Workflow

```
┌─────────────────────────────────────┐
│  "Tracking App" Sheet               │
│  ├─ Device1 (worksheet)             │
│  │  └─ Timestamp\tLat\tLon          │
│  ├─ Device2 (worksheet)             │
│  └─ Device3 (worksheet)             │
└─────────────────────────────────────┘
           │
           │ Reconciliation Service
           │ (checks Zugangsdaten Column F)
           ▼
┌─────────────────────────────────────┐
│  Match Found: Device1 → User Kevin  │
│  1. Convert format                  │
│  2. Group by date                   │
│  3. Insert into SQLite (historical) │
│  4. Insert into batchLogger (today) │
│  5. Upload changed DBs              │
│  6. Delete Device1 worksheet        │
└─────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  Result: Device1 assigned ✅        │
│         Device2 remaining ⏳        │
│         Device3 remaining ⏳        │
└─────────────────────────────────────┘
```

### Data Format Conversion

**Input** (from "Tracking App" sheet):
```
Timestamp                   Latitude    Longitude
2024-11-16T10:30:00.000Z   52.123456   13.789012
2024-11-16T10:35:00.000Z   52.123789   13.789456
```

**Output** (SQLite log format):
```javascript
{
  timestamp: "2024-11-16T11:30:00+01:00",  // Berlin time
  userId: "1a4abbb8",
  username: "Kevin",
  endpoint: "/api/external-tracking/location",
  method: "POST",
  address: "",
  newProspects: "",
  existingCustomers: "",
  userAgent: "External Tracking App",
  data: JSON.stringify({
    latitude: 52.123456,
    longitude: 13.789012,
    timestamp: "2024-11-16T10:30:00.000Z",
    source: "external_app"  // Marks as external data
  })
}
```

## Implementation Details

### Reconciliation Logic

```typescript
async reconcileUnassignedTrackingData(): Promise<ReconciliationStats>
```

**Steps**:
1. **Load worksheets** - Get all worksheets from "Tracking App" sheet
2. **Match devices** - Check each device name against `Zugangsdaten` column F
3. **Load GPS data** - Read tab-separated GPS points from worksheet
4. **Group by date** - Separate historical data from today's data
5. **Insert historical** - Write to SQLite databases (grouped by date)
6. **Insert current** - Write to Google Sheets log via batchLogger
7. **Upload DBs** - Upload modified SQLite databases to Drive
8. **Delete worksheet** - Remove assigned device worksheet

### Return Statistics

```typescript
interface ReconciliationStats {
  devicesProcessed: number;       // Total worksheets checked
  devicesAssigned: number;         // Devices successfully matched
  devicesRemaining: number;        // Devices still unassigned
  totalDataPoints: number;         // Total GPS points processed
  historicalDataPoints: number;    // Points written to SQLite
  currentDataPoints: number;       // Points written to Sheets
  errors: Array<{
    deviceName: string;
    error: string;
  }>;
}
```

### Server Startup Integration

**Location**: `server/index.ts`

```typescript
// Perform External Tracking Reconciliation (before startup sync)
log('Checking for unassigned external tracking data...');
try {
  const { externalTrackingReconciliationService } = await import('./services/externalTrackingReconciliation');
  const stats = await externalTrackingReconciliationService.reconcileUnassignedTrackingData();
  
  if (stats.devicesProcessed > 0) {
    log(`External Tracking Reconciliation: ${stats.devicesAssigned} devices assigned, ${stats.devicesRemaining} remaining, ${stats.totalDataPoints} GPS points processed`);
  } else {
    log('No unassigned external tracking data found');
  }
} catch (error) {
  log('⚠️ External tracking reconciliation failed:', error);
}
```

**Timing**: Runs BEFORE 6-phase DB sync to ensure reconciled data is included in sync.

### Midnight Cron Integration

**Location**: `server/services/sqliteDailyArchive.ts`

```typescript
// STEP 0: External Tracking Reconciliation (before archiving)
console.log('\n--- Step 0: External Tracking Reconciliation ---');
await this.stepReconcileExternalTracking();

// STEP 1: Checkpoint yesterday's DB (flush WAL to main DB)
console.log('\n--- Step 1: Checkpoint DBs ---');
await this.stepCheckpointDBs(yesterday);
```

**Timing**: Runs at 00:05 CET/CEST, BEFORE archiving to ensure reconciled data is included in yesterday's archive if applicable.

### Manual Test Endpoint

**Endpoint**: `POST /api/admin/test-tracking-reconciliation`

**Auth**: Requires admin privileges

**Usage**:
```bash
curl -X POST http://localhost:3001/api/admin/test-tracking-reconciliation \
  -H "Cookie: auth=<admin-session-cookie>"
```

**Response**:
```json
{
  "success": true,
  "message": "External tracking reconciliation completed",
  "timestamp": "2024-11-16T12:34:56+01:00",
  "stats": {
    "devicesProcessed": 3,
    "devicesAssigned": 1,
    "devicesRemaining": 2,
    "totalDataPoints": 127,
    "historicalDataPoints": 100,
    "currentDataPoints": 27,
    "errorCount": 0,
    "errors": []
  }
}
```

## Configuration

### Environment Variables

No new environment variables required. Uses existing:
- `GOOGLE_SHEETS_KEY` - Service account for Sheets API access
- `GOOGLE_DRIVE_FOLDER_ID` - Drive folder for DB uploads

### Google Sheets Structure

**"Tracking App" Sheet ID**: `1OspTbAfG6TM4SiUIHeRAF_QlODy3oHjubbiUTRGDo3Y`

**Format**:
- Each device = 1 worksheet
- Worksheet title = device name (must match Zugangsdaten column F)
- Columns: A (Timestamp), B (Latitude), C (Longitude)
- Header row: "Timestamp", "Latitude", "Longitude"

**Zugangsdaten Sheet**:
- Column F: Comma-separated device names (tracking names)
- Example: `"Device1, Raphael iPhone, Kevin Android"`

## Error Handling

### Validation

1. **GPS Data Validation**:
   - Timestamp must be valid ISO string
   - Latitude/Longitude must be valid numbers
   - Invalid rows are logged and skipped

2. **Device Name Matching**:
   - Case-insensitive comparison
   - Whitespace trimming
   - No match → worksheet kept for future reconciliation

3. **SQLite Insertion**:
   - DB created if missing
   - Logs table created if missing
   - Transaction-based insertion (all-or-nothing per device)

### Error Recovery

**Errors are non-fatal**:
- Failed device processing → logged, device worksheet kept
- Failed DB upload → logged, device still assigned (data in SQLite)
- Reconciliation failure → logged, archive continues

**Error Tracking**:
```typescript
errors: [
  {
    deviceName: "Unknown Device",
    error: "Failed to upload database for 2024-11-16: Network timeout"
  }
]
```

## Monitoring

### Console Logs

**Startup**:
```
[ExternalTrackingReconciliation] Google Sheets API initialized
Checking for unassigned external tracking data...
[ExternalTrackingReconciliation] Starting reconciliation process...
[ExternalTrackingReconciliation] Found 3 device worksheets
[ExternalTrackingReconciliation] Processing device: "Kevin iPhone"
[ExternalTrackingReconciliation] ✅ Found user Kevin (1a4abbb8) for device "Kevin iPhone"
[ExternalTrackingReconciliation] Loaded 127 GPS points from "Kevin iPhone"
[ExternalTrackingReconciliation] Data spans 2 different dates
[ExternalTrackingReconciliation] Processing 100 points for PAST date (2024-11-15)
[ExternalTrackingReconciliation] Inserted 100 GPS points into SQLite for Kevin on 2024-11-15
[ExternalTrackingReconciliation] Uploading modified database for 2024-11-15...
[ExternalTrackingReconciliation] ✅ Successfully uploaded database for 2024-11-15
[ExternalTrackingReconciliation] Processing 27 points for TODAY (2024-11-16)
[ExternalTrackingReconciliation] Added 27 GPS points to batchLogger for Kevin
[ExternalTrackingReconciliation] ✅ Deleted worksheet "Kevin iPhone" after successful assignment
External Tracking Reconciliation: 1 devices assigned, 2 remaining, 127 GPS points processed
```

**Midnight Cron**:
```
--- Step 0: External Tracking Reconciliation ---
[Step 0] Reconciling unassigned external tracking data...
[Step 0] ✅ Processed 3 devices:
         - Assigned: 1
         - Remaining: 2
         - Total GPS points: 127
         - Historical points: 100
         - Current points: 27
```

### Dashboard Integration

Reconciled external GPS data appears in:
- Admin Dashboard → Route view (source: 'external')
- Historical data queries (SQLite logs)
- Live data (via batchLogger)

**Filtering**:
```javascript
// Route endpoint supports source filter
GET /api/admin/dashboard/route?userId=1a4abbb8&date=2024-11-16&source=external
```

## Testing

### Manual Testing Steps

1. **Setup**:
   - Add GPS data to "Tracking App" sheet under device name (e.g., "TestDevice")
   - Ensure device name NOT in Zugangsdaten column F

2. **Add device to Zugangsdaten**:
   - Update column F: `"ExistingDevice1, TestDevice"`
   - Save sheet

3. **Trigger reconciliation** (choose one):
   - Restart server (automatic at startup)
   - Wait for midnight cron (00:05 CET/CEST)
   - Call test endpoint: `POST /api/admin/test-tracking-reconciliation`

4. **Verify**:
   - Check console logs for assignment confirmation
   - Verify "TestDevice" worksheet deleted from "Tracking App" sheet
   - Check SQLite DB for historical dates
   - Check Google Sheets log for today's date
   - Verify Route view shows external GPS points

### Unit Testing Scenarios

**Scenario 1**: Device found, data assigned
- ✅ Device name matches Zugangsdaten
- ✅ GPS data valid
- ✅ Worksheet deleted
- ✅ Data in SQLite/Sheets

**Scenario 2**: Device not found, data kept
- ❌ Device name not in Zugangsdaten
- ✅ Worksheet remains
- ✅ No data modification
- ✅ No errors logged

**Scenario 3**: Mixed dates (historical + today)
- ✅ Historical data → SQLite
- ✅ Today's data → batchLogger
- ✅ DBs uploaded to Drive
- ✅ Worksheet deleted

**Scenario 4**: Invalid GPS data
- ❌ Invalid latitude/longitude
- ✅ Row skipped
- ✅ Valid rows processed
- ✅ Warning logged

## Performance Considerations

### Batch Processing

- **Worksheets**: Processed sequentially (avoid API rate limits)
- **GPS Points**: Batch inserted per date (transaction-based)
- **DB Uploads**: Only modified databases uploaded

### API Rate Limits

**Google Sheets API**:
- Read operations: ~100 requests/100 seconds
- Write operations: ~100 requests/100 seconds

**Optimization**:
- Single read per worksheet (all data at once)
- Single delete per worksheet
- Batch inserts to SQLite (not per-row)

### Memory Usage

- GPS data loaded per worksheet (not all at once)
- SQLite prepared statements (memory efficient)
- Database closed after insertion

### Timing

**Expected Duration**:
- 1 device, 100 GPS points: ~2-3 seconds
- 5 devices, 500 GPS points: ~10-15 seconds
- 10 devices, 1000 GPS points: ~20-30 seconds

**Delays**:
- Startup: Non-blocking (continues if errors)
- Midnight: Runs before archive (adds ~30s to cron job)

## Future Enhancements

### Potential Improvements

1. **Bulk Processing**:
   - Process multiple worksheets in parallel (with rate limiting)

2. **Notification**:
   - Pushover notification on successful assignment
   - Alert when many devices remain unassigned

3. **Metrics**:
   - Track reconciliation success rate
   - Monitor average GPS points per device

4. **Validation**:
   - Check for duplicate GPS points before insertion
   - Validate timestamp chronology

5. **Rollback**:
   - Implement undo mechanism for mis-assigned devices
   - Store original worksheet data before deletion

## Troubleshooting

### Common Issues

**Issue**: Device not assigned despite being in Zugangsdaten
- **Cause**: Name mismatch (whitespace, case, special characters)
- **Fix**: Check exact spelling, use case-insensitive comparison

**Issue**: Historical data not in SQLite
- **Cause**: DB upload failed
- **Fix**: Check Drive folder permissions, retry upload

**Issue**: Today's data not in Google Sheets log
- **Cause**: batchLogger not flushed yet
- **Fix**: Wait for batch flush (every 30s) or restart server

**Issue**: Worksheet not deleted after assignment
- **Cause**: Delete API call failed (permissions)
- **Fix**: Verify service account has write access to "Tracking App" sheet

### Debug Logs

Enable verbose logging:
```typescript
// In externalTrackingReconciliation.ts
console.log('[DEBUG] Device name:', deviceName);
console.log('[DEBUG] User search result:', user);
console.log('[DEBUG] GPS data:', trackingData);
```

### Manual Cleanup

If reconciliation fails mid-process:

1. **Check SQLite DBs**: Use DB Browser to verify insertions
2. **Check Google Sheets logs**: Verify batchLogger entries
3. **Check "Tracking App" sheet**: Verify worksheet status
4. **Re-run reconciliation**: Safe to run multiple times (idempotent for assigned devices)

## References

### Related Files

- `server/services/externalTrackingReconciliation.ts` - Main service
- `server/services/externalTrackingService.ts` - Original external tracking
- `server/routes/admin.ts` - Test endpoint
- `server/index.ts` - Startup integration
- `server/services/sqliteDailyArchive.ts` - Midnight cron integration

### Related Documentation

- `GOOGLE_SHEETS_ARCHITECTURE.md` - Sheets structure
- `GPS_ROUTE_ARCHITECTURE.md` - GPS tracking system
- `ADMIN_DASHBOARD_METRIKEN.md` - Dashboard metrics

### API Documentation

- Google Sheets API: https://developers.google.com/sheets/api
- Google Drive API: https://developers.google.com/drive/api
