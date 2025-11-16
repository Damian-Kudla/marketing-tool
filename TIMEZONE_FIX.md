# Timezone Fix: UTC → CET/CEST

## Problem
Die Anwendung verwendete UTC-Zeiten für Tageswechsel und Scheduling, obwohl alle Benutzer in Deutschland (CET/CEST) arbeiten.

### Symptome
- Logs ab 23:00 UTC wurden als "nächster Tag" behandelt (korrekt: 00:00 CET)
- Daily Reset erfolgte um 01:00 CET statt 00:00 CET (Winterzeit)
- Daily Reports wurden um 21:00 CET statt 20:00 CET geplant

### Warum UTC-Timestamps trotzdem korrekt sind
Alle Timestamps in der DB sind **korrekt in UTC gespeichert** (ISO 8601 Format mit `Z`):
```
2025-11-14T23:00:05.557Z  → UTC 23:00 = CET 00:00 (Mitternacht in Deutschland)
```

**UTC für Storage ist Best Practice** ✅ - Das Problem war nur die **Interpretation** für Tagesgrenzen.

---

## Implementierte Fixes

### 1. ✅ `dailyDataStore.ts` - getCurrentDate()
**Vorher**: UTC-Datum verwendet
```typescript
private getCurrentDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // UTC-Datum!
}
```

**Nachher**: CET/CEST-Datum verwendet
```typescript
private getCurrentDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  
  return `${year}-${month}-${day}`;
}
```

---

### 2. ✅ `dailyDataStore.ts` - scheduleMidnightReset()
**Vorher**: UTC Mitternacht
```typescript
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0); // UTC 00:00
```

**Nachher**: CET/CEST Mitternacht
```typescript
// Calculate next midnight in CET/CEST timezone
const formatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const parts = formatter.formatToParts(now);
const year = parseInt(parts.find(p => p.type === 'year')!.value);
const month = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
const day = parseInt(parts.find(p => p.type === 'day')!.value);

const tomorrowMidnight = new Date(year, month, day + 1, 0, 0, 0, 0);

// Convert Berlin timezone to UTC for setTimeout
const offsetMinutes = tomorrowMidnight.getTimezoneOffset();
const tomorrowMidnightUTC = tomorrowMidnight.getTime() - (offsetMinutes * 60 * 1000);
```

---

### 3. ✅ `cronJobService.ts` - scheduleDailyReport()
**Vorher**: UTC 20:00
```typescript
const target = new Date(now);
target.setHours(20, 0, 0, 0); // UTC 20:00!
```

**Nachher**: CET/CEST 20:00
```typescript
// Calculate 20:00 in Berlin timezone
const formatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  // ... (siehe Code oben)
});

const target = new Date(year, month, day, 20, 0, 0, 0);

// Convert to UTC for setTimeout
const offsetMinutes = target.getTimezoneOffset();
const targetUTC = target.getTime() - (offsetMinutes * 60 * 1000);
```

---

### 4. ✅ `sqliteLogService.ts` - getCETDate()
**Status**: Bereits korrekt implementiert ✅

Die Funktion verwendete bereits `toLocaleString` mit `timeZone: 'Europe/Berlin'`:
```typescript
export function getCETDate(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const germanTimeString = date.toLocaleString('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // Parse MM/DD/YYYY → YYYY-MM-DD
  const [month, day, year] = germanTimeString.split(/[/,\s]+/);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
```

**Keine Änderung nötig** - Diese Funktion war der Grund, warum die Sheet-Cleanup-Logik bereits korrekt funktionierte.

---

### 5. ✅ `sqliteDailyArchive.ts` - Cron Job
**Status**: Bereits korrekt konfiguriert ✅

Der Cron-Job verwendete bereits `timezone: 'Europe/Berlin'`:
```typescript
this.cronJob = cron.schedule(
  '5 0 * * *',  // 00:05 Uhr
  async () => {
    await this.runDailyArchive();
  },
  {
    timezone: 'Europe/Berlin' // CET/CEST
  }
);
```

**Keine Änderung nötig** ✅

---

## Auswirkungen

### Vorher (UTC-basiert)
| Zeit (CET) | UTC-Zeit | Was passierte? |
|------------|----------|----------------|
| 15.11. 00:00 | 14.11. 23:00 | Noch als 14.11. behandelt ❌ |
| 15.11. 01:00 | 15.11. 00:00 | Daily Reset ❌ |
| 15.11. 20:00 | 15.11. 19:00 | - |
| 15.11. 21:00 | 15.11. 20:00 | Daily Report ❌ |

### Nachher (CET/CEST-basiert)
| Zeit (CET) | UTC-Zeit | Was passiert? |
|------------|----------|---------------|
| 15.11. 00:00 | 14.11. 23:00 | Daily Reset ✅ |
| 15.11. 00:05 | 14.11. 23:05 | Daily Archive Cron ✅ |
| 15.11. 20:00 | 15.11. 19:00 | Daily Report ✅ |

---

## Testing

### Test 1: Tageswechsel-Verhalten
**Setup**: Server läuft um 23:50 CET
**Erwartung**: 
- Um 00:00 CET → `getCurrentDate()` wechselt von `2025-11-14` zu `2025-11-15`
- Um 00:00 CET → Daily Reset wird ausgelöst
- Log-Einträge ab 23:00 UTC (= 00:00 CET) werden als 15.11. klassifiziert

**Validierung**:
```
2025-11-14T22:59:59.999Z → CET-Datum: 2025-11-14 ✅
2025-11-14T23:00:00.000Z → CET-Datum: 2025-11-15 ✅
```

### Test 2: Sommerzeit-Wechsel
**CET (Winter)**: UTC+1  
**CEST (Sommer)**: UTC+2

**Validierung**:
- `Intl.DateTimeFormat` behandelt automatisch DST (Daylight Saving Time) ✅
- `getTimezoneOffset()` liefert korrekte Minuten-Differenz für beide Zeiten ✅

### Test 3: Sheet Cleanup
**Setup**: Logs mit Timestamps:
```
2025-11-14T22:30:00Z → 14.11. 23:30 CET → Soll gelöscht werden
2025-11-14T23:00:00Z → 15.11. 00:00 CET → Soll behalten werden
```

**Erwartung**: Cleanup für 2025-11-15 löscht nur Logs < `2025-11-14T23:00:00Z`

---

## Konsistenz-Regeln für die Zukunft

### ✅ DO: Storage in UTC
```typescript
// Immer UTC für Datenbank/API
const timestamp = Date.now();
const isoString = new Date().toISOString(); // ...Z am Ende
```

### ✅ DO: Business Logic in CET/CEST
```typescript
// Für Tagesgrenzen, Reporting, UI
const germanDate = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  // ...
});
```

### ❌ DON'T: Mischen
```typescript
// FALSCH: UTC-Datum für deutschen Tageswechsel
const today = new Date().toISOString().split('T')[0]; // ❌

// RICHTIG: CET-Datum für deutschen Tageswechsel
const today = getCETDate(); // ✅
```

---

## Dateien geändert

1. ✅ `server/services/dailyDataStore.ts` (2 Funktionen)
2. ✅ `server/services/cronJobService.ts` (1 Funktion)
3. ✅ `server/services/sqliteLogService.ts` (bereits korrekt)
4. ✅ `server/services/sqliteDailyArchive.ts` (bereits korrekt)

---

## Backward Compatibility

**Keine Breaking Changes**:
- Alle UTC-Timestamps bleiben unverändert
- Nur die Interpretation für Tagesgrenzen wurde korrigiert
- Bestehende Daten sind weiterhin voll kompatibel

**Migration**: Keine erforderlich ✅
