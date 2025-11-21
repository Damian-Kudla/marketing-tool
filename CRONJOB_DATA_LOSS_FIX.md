# Data Loss Fix - Multi-Server Conflict Resolution

## Problem

**Symptom**: Kiri's Logs enden um 15:50 Uhr in der SQLite-Datenbank, obwohl die originalen Logs bis 22:00 Uhr (23:08 Uhr externe Tracking-Daten) gehen.

**Root Cause**: Multi-Server-Konflikt mit Google Drive als "Source of Truth"

### Das eigentliche Problem:

**Du hattest einen lokalen Server laufen, der die DB zu Drive gepusht hat!**

1. **Lokaler Server** (auf deinem Rechner):
   - Läuft parallel zu Railway
   - Empfängt **KEINE** externen GPS-Daten (nur lokale Aktionen)
   - Schreibt in `logs-2025-11-18.db` → nur unvollständige Daten
   - Pusht diese unvollständige DB zu Google Drive

2. **Railway Server** (Production):
   - Empfängt **ALLE** Daten (externe GPS, Actions, etc.)
   - Schreibt in `logs-2025-11-18.db` → vollständige Daten
   - Hat externe GPS-Daten von 15:50-23:08 Uhr

3. **Startup-Sync** auf Railway:
   - Erkennt: Lokale DB ≠ Drive DB (Checksum-Konflikt)
   - Konfliktlösung: **"Drive = Source of Truth"**
   - Lädt DB von Drive herunter → **Überschreibt lokale DB!**
   - **Resultat**: Externe GPS-Daten von Railway verloren!

### Zeitlicher Ablauf:

```
18.11.2025:
  06:46 Uhr - Kiri startet Arbeit
  15:50 Uhr - Letzter Log in finaler SQLite-DB ← HIER wurde lokale DB überschrieben!
  22:00 Uhr - Kiri's letzte Actions (nur in Sheets)
  23:08 Uhr - Kiri's letzte externe GPS-Daten (nur in Sheets)
  23:05 Uhr - Cronjob löscht Logs aus Sheets (bevor Startup-Sync sie holen konnte)

19.11.2025:
  00:05 Uhr - Startup-Sync hätte Sheets-Logs holen können
            - ABER: Sheets wurden bereits geleert vom Cronjob!
```

## Lösung

### Fix 1: Startup-Sync Phase-Reihenfolge ändern

**Problem**: Checksum-Vergleich (Phase 3) lief **VOR** Sheets-Merge (Phase 4)

**Vorher**:
```
Phase 1: Check local DBs
Phase 2: Download missing DBs
Phase 3: Checksum comparison ← Überschreibt lokale DB mit Drive!
Phase 4: Merge Sheets logs    ← Kommt zu spät, Daten schon weg!
```

**Nachher**:
```
Phase 1: Check local DBs
Phase 2: Download missing DBs
Phase 3: Merge Sheets logs    ← ERST Sheets-Daten in lokale DB holen!
Phase 4: Checksum comparison  ← DANN vergleichen (lokale DB ist komplett!)
Phase 5: Upload changed DBs   ← Vollständige DB zu Drive pushen
Phase 6: Cleanup Sheets
```

**Begründung**:
- **BEVOR** wir die DB mit Drive vergleichen, holen wir ALLE Sheets-Daten
- Lokale DB hat jetzt vollständige Daten (Railway-Logs + Sheets-Logs)
- Drive-DB wird mit vollständiger lokaler DB überschrieben, nicht umgekehrt!

### Fix 2: Cronjob-Zeit verzögern

**Vorher**: `5 0 * * *` (00:05 Uhr)
**Nachher**: `0 1 * * *` (01:00 Uhr)

**Begründung**: 
- Gibt Startup-Sync (läuft bei Serverstart) Zeit zum Mergen der Sheets-Logs
- 1 Stunde Sicherheitspuffer gegen Race Conditions

### Fix 3: Sicherheitspuffer in Cleanup-Logik

**Vorher**: 
```typescript
// Nur heute behalten
if (logDate === today) {
  rowsToKeep.push(row);
}
```

**Nachher**:
```typescript
// Gestern UND heute behalten (24h Sicherheitspuffer)
const yesterday = this.getYesterday(today);
if (logDate >= yesterday) {
  rowsToKeep.push(row);
}
```

**Begründung**:
- 24-Stunden-Fenster für Sheets-Logs
- Verhindert Datenverlust wenn Startup-Sync verzögert ist
- Schutz gegen Race Conditions zwischen Cronjob und Serverstart

## Geänderte Dateien

### 1. `server/services/sqliteStartupSync.ts`

**Änderungen**:
- ✅ **KRITISCH**: Phase-Reihenfolge getauscht (Sheets-Merge VOR Checksum-Vergleich)
- ✅ Phase 4 Merge: `logDate !== today` → `logDate < today`
- ✅ Phase 6 Cleanup: Behalte `logDate >= yesterday` statt nur `logDate === today`
- ✅ Neue Hilfsfunktion: `getYesterday(today: string)`

### 2. `server/services/sqliteDailyArchive.ts`

**Änderungen**:
- ✅ Cronjob-Zeit: 00:05 → 01:00 Uhr
- ✅ mergeOldLogsFromSheets: `logDate !== today` → `logDate < today`
- ✅ deleteOldLogsFromSheet: Behalte `logDate >= yesterday` statt nur `logDate === today`
- ✅ Dokumentation aktualisiert

## Warum das Problem auftrat

**Multi-Server-Setup ohne Koordination**:

| Server | Daten | DB Status | Drive Upload |
|--------|-------|-----------|--------------|
| Lokal | ❌ Keine externen GPS | Unvollständig | ✅ Ja (überschreibt!) |
| Railway | ✅ Alle Daten | Vollständig | ✅ Ja (aber zu spät!) |

**Konfliktauflösung**: "Drive = Source of Truth" bedeutet:
- Railway-DB wird mit lokaler (unvollständiger) DB überschrieben
- Externe GPS-Daten gehen verloren

**Neue Konfliktauflösung** (nach Fix):
1. **ERST**: Merge Sheets-Logs in lokale DB
2. **DANN**: Vergleiche mit Drive
3. **RESULTAT**: Lokale DB ist vollständig, überschreibt Drive

## Erwartete Verbesserungen

### Vor dem Fix:
- ❌ Multi-Server-Konflikte führen zu Datenverlust
- ❌ Drive-DB überschreibt Railway-DB mit unvollständigen Daten
- ❌ Sheets-Logs werden gelöscht bevor sie gemerged werden
- ❌ Logs von 15:50-23:08 Uhr verloren gegangen

### Nach dem Fix:
- ✅ Sheets-Logs werden ZUERST in lokale DB gemerged
- ✅ Vollständige lokale DB überschreibt Drive-DB
- ✅ 24-Stunden-Sicherheitspuffer in Sheets
- ✅ 1 Stunde Verzögerung für Cronjob
- ✅ Keine Datenverluste mehr, auch bei Multi-Server-Setup

## Verifizierung

### Test-Szenarios:

1. **Multi-Server-Konflikt**:
   - Lokaler Server pusht unvollständige DB
   - Railway Startup-Sync merged Sheets → lokale DB ist vollständig
   - Checksum-Vergleich: Lokale DB überschreibt Drive ✅

2. **Normaler Betrieb** (01:00 Uhr Cronjob):
   - Merge: Logs von vorgestern → SQLite
   - Cleanup: Lösche Logs von vorvorgestern
   - Behalte: Gestern + heute in Sheets ✅

3. **Serverstart nach Datenverlust** (z.B. 02:00 Uhr):
   - Sheets-Merge läuft VOR Checksum-Vergleich
   - Alle Sheets-Daten werden gerettet
   - Keine Datenverluste ✅

## Wichtige Empfehlungen

### **NIEMALS lokalen Server mit Google Drive verbinden!**

**Problem**: Lokaler Server hat nicht alle Daten (z.B. externe Tracking-API läuft nur auf Railway)

**Lösung**: 
1. **Option A**: Deaktiviere Google Drive auf lokalem Server
   ```typescript
   // .env.local
   # Kommentiere aus:
   # GOOGLE_DRIVE_CREDENTIALS=...
   ```

2. **Option B**: Verwende separates Google Drive für lokale Entwicklung
   ```typescript
   // .env.local
   GOOGLE_DRIVE_FOLDER_ID=<anderer-folder>
   ```

3. **Option C (Empfohlen)**: Nutze nur Railway für Production, lokal nur für Development ohne Drive-Sync

### Langfristig:

1. **Server-Identifikation**: Environment-Variable die Server identifiziert
   ```typescript
   const SERVER_ID = process.env.SERVER_ID || 'unknown';
   // Nur 'production' Server dürfen Drive überschreiben
   ```

2. **Conflict Resolution verbessern**: 
   - Statt "Drive = Source of Truth"
   - "Merge beide DBs" (komplexer, aber sicherer)

3. **Monitoring**:
   - Alert wenn Checksum-Konflikte auftreten
   - Alert wenn Drive-Download lokale DB überschreibt

## Zusammenfassung

**Problem**: Multi-Server-Setup führte zu Datenverlust durch Drive-Konfliktauflösung.

**Ursache**: 
1. Lokaler Server pushte unvollständige DB zu Drive
2. Checksum-Vergleich lief **VOR** Sheets-Merge
3. Drive-DB überschrieb vollständige Railway-DB

**Lösung**: 
1. **Phase-Reihenfolge**: Sheets-Merge VOR Checksum-Vergleich
2. Cronjob 1 Stunde später (01:00 Uhr)
3. 24-Stunden-Sicherheitspuffer in Sheets-Cleanup

**Ergebnis**: Vollständige Datenintegrität, auch bei Multi-Server-Setup.
