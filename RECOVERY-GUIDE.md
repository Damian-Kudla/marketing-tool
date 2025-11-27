# Datenwiederherstellungs-Anleitung

## Übersicht

Diese Anleitung beschreibt, wie verlorene Address Datasets aus Activity Logs wiederhergestellt werden können.

## 🔒 WICHTIG: Vor jedem Deployment/Push

**Führe IMMER dieses Backup-Skript aus, bevor du Code-Änderungen commitest und pushst:**

```bash
npx tsx backup-activity-logs.ts
```

Dieses Skript:
- ✅ Sammelt alle heutigen Activity Logs aus SQLite
- ✅ Sammelt alle heutigen Activity Logs aus Google Sheets
- ✅ Merged und dedupliziert die Logs
- ✅ Lädt das Backup nach Google Drive hoch
- ✅ Gibt dir eine Bestätigung mit Statistiken

**Nach erfolgreichem Backup kannst du sicher committen und pushen.**

---

## 📥 Server-Datenbanken herunterladen

Falls du die lokalen SQLite-Datenbanken vom Server analysieren möchtest:

```bash
# Railway CLI installieren (falls noch nicht installiert)
npm install -g @railway/cli

# Skript ausführbar machen
chmod +x download-server-dbs.sh

# Datenbanken herunterladen
./download-server-dbs.sh
```

Dies erstellt ein Verzeichnis `downloaded-dbs-YYYY-MM-DD-HH-MM-SS/` mit allen SQLite-Datenbanken vom Server.

---

## 🔧 Datenwiederherstellung aus Activity Logs

### Schritt 1: Backup-Datei besorgen

Lade die Backup-JSON-Datei von Google Drive herunter:

1. Gehe zu Google Drive → Backup-Ordner
2. Suche nach `activity-logs-backup-YYYY-MM-DD-HH-MM-SS.json`
3. Lade die Datei herunter (z.B. nach `./data/temp/`)

### Schritt 2: Backup analysieren

```bash
npx tsx restore-address-datasets.ts ./data/temp/activity-logs-backup-2025-11-27.json
```

Dieses Skript:
- ✅ Analysiert alle Logs nach Address Dataset Operationen
- ✅ Extrahiert vollständige Dataset-Informationen
- ✅ Exportiert die gefundenen Datasets als JSON zur manuellen Überprüfung
- ✅ Zeigt Statistiken an

**Output:**
```
📊 Datasets found: 42
📄 Export file: ./data/temp/recovered-datasets-1732723456789.json
```

### Schritt 3: Exportierte Daten überprüfen

Öffne die exportierte JSON-Datei und überprüfe die wiederhergestellten Datasets:

```bash
code ./data/temp/recovered-datasets-1732723456789.json
```

### Schritt 4: Daten wiederherstellen

Wenn die Daten korrekt aussehen, führe das Wiederherstellungs-Skript mit `--auto-restore` aus:

```bash
npx tsx restore-address-datasets.ts ./data/temp/activity-logs-backup-2025-11-27.json --auto-restore
```

Dies:
- ✅ Prüft, welche Datasets bereits in Google Sheets existieren
- ✅ Fügt nur neue/fehlende Datasets hinzu
- ✅ Schreibt direkt nach Google Sheets (System Sheet → "Adressen" tab)

**Nach dem Restore:**
- Die Datasets sind in Google Sheets
- Beim nächsten Server-Neustart werden sie automatisch nach SQLite synchronisiert
- Der DatasetCache lädt sie in den RAM

---

## 🔍 Manuelle SQLite-Analyse

Falls du die SQLite-Datenbanken manuell analysieren möchtest:

```bash
# Öffne address-datasets.db
sqlite3 ./downloaded-dbs-*/address-datasets.db

# Zeige alle Datasets
SELECT * FROM address_datasets;

# Zeige Datasets für einen bestimmten User
SELECT * FROM address_datasets WHERE created_by = 'username';

# Zeige Datasets nach Datum
SELECT * FROM address_datasets ORDER BY created_at DESC;

# Exportiere als CSV
.mode csv
.output datasets-export.csv
SELECT * FROM address_datasets;
.quit
```

### Activity Logs analysieren

```bash
# Öffne heutigen Log
sqlite3 ./downloaded-dbs-*/logs-2025-11-27.db

# Zeige alle Address Dataset Operationen
SELECT * FROM action_logs
WHERE endpoint = '/api/address-datasets'
ORDER BY timestamp DESC;

# Exportiere relevante Logs
.mode json
.output activity-logs-export.json
SELECT * FROM action_logs
WHERE endpoint LIKE '%address%'
ORDER BY timestamp DESC;
.quit
```

---

## 🛡️ Bidirektionale Synchronisation

Das System synchronisiert automatisch bei jedem Server-Start:

1. **SQLite → Sheets**: Lokale Daten, die nicht in Sheets sind, werden hochgeladen
2. **Sheets → SQLite**: Sheets-Daten, die nicht lokal sind, werden heruntergeladen
3. **Konflikt-Auflösung**: Bei Duplikaten wird die neuere Version (basierend auf `createdAt`) verwendet

**Verifizierung:**
- Server-Logs beim Start überprüfen:
  ```
  [SystemSync] Phase 2: Bidirectional Sheets sync...
  [SystemSync]   addressDatasets: 42 synced (bidirectional)
  ```

---

## ✅ Dual-Write Verifikation

Das System schreibt **IMMER in beide Datenbanken**:

### createAddressDataset Flow:
1. **SQLite schreiben** (KRITISCH - wirft Error bei Fehler)
2. **RAM-Cache aktualisieren** (nur wenn SQLite erfolgreich)
3. **Google Sheets schreiben** (NON-BLOCKING - logged Warning bei Fehler)

### Beispiel-Code:
```typescript
// Step 1: Save to SQLite (PRIMARY - CRITICAL!)
try {
  addressDatasetsDB.upsert({...});
  console.log(`✅ Saved to SQLite: ${id}`);
} catch (error) {
  console.error(`❌ CRITICAL: Failed to save to SQLite, aborting:`, error);
  throw new Error(`Failed to persist dataset: ${error}`);
}

// Step 2: Add to RAM cache
datasetCache.addNew(fullDataset);

// Step 3: Save to Sheets (BACKUP - non-blocking)
try {
  await sheetsClient.spreadsheets.values.append({...});
  console.log(`✅ Backed up to Sheets: ${id}`);
} catch (error) {
  console.warn(`⚠️ Failed to backup to Sheets (SQLite backup exists):`, error);
  datasetCache.set(fullDataset, true); // Mark as dirty for retry
}
```

**Wenn Sheets fehlschlägt:**
- Dataset ist trotzdem in SQLite gesichert ✅
- Dataset ist im RAM-Cache ✅
- Dataset wird als "dirty" markiert ✅
- Background-Sync versucht alle 60s, es nach Sheets zu schreiben ✅

---

## 📊 Monitoring

### System DB Status überprüfen

```bash
# Server-Logs anschauen
railway logs

# Nach Sync-Meldungen suchen
railway logs --filter "SystemSync"

# Rate Limit Status
railway logs --filter "Rate limit"
```

### Lokale Tests

```bash
# TypeScript kompilieren
npx tsc --noEmit

# Server lokal starten
npm run dev

# Logs beobachten
# Achte auf:
# - [SystemSync] Startup sync messages
# - [addressDatasets] Write operations
# - [BatchLogger] Flush operations
```

---

## 🔄 Workflow-Zusammenfassung

### Vor Deployment:
1. ✅ `npx tsx backup-activity-logs.ts` ausführen
2. ✅ Bestätigung abwarten (Drive File ID, etc.)
3. ✅ Committen und pushen

### Nach Datenverlust:
1. ✅ Backup-Datei von Drive herunterladen
2. ✅ `npx tsx restore-address-datasets.ts <backup.json>` ausführen
3. ✅ Exportierte JSON überprüfen
4. ✅ `npx tsx restore-address-datasets.ts <backup.json> --auto-restore` ausführen
5. ✅ Server neu starten → Bidirektionale Sync läuft automatisch

### Optional - Server DBs analysieren:
1. ✅ `./download-server-dbs.sh` ausführen
2. ✅ SQLite-Datenbanken mit `sqlite3` analysieren
3. ✅ Daten manuell exportieren/importieren falls nötig

---

## 🆘 Troubleshooting

### "Google credentials not configured"
- Überprüfe `.env`: `GOOGLE_APPLICATION_CREDENTIALS_JSON` oder `GOOGLE_SHEETS_KEY` gesetzt?
- Überprüfe Railway: Environment Variables korrekt konfiguriert?

### "Backup file not found"
- Falscher Pfad? Überprüfe den Dateinamen und Pfad
- Datei von Drive heruntergeladen? Überprüfe Downloads-Ordner

### "No datasets found in backup"
- Activity Logs könnten leer sein (z.B. wenn heute keine Datasets erstellt wurden)
- Versuche ein Backup von gestern oder vorgestern

### "Rate limit error (429)"
- Warte 5 Minuten (globale Rate Limit Cooldown)
- Das System versucht automatisch erneut, wenn das Limit aufgehoben ist

### Server-DBs Download schlägt fehl
- Railway CLI installiert? `npm install -g @railway/cli`
- Eingeloggt? `railway login`
- Richtiges Projekt? `railway link`

---

## 📧 Support

Bei Problemen:
1. Überprüfe Server-Logs: `railway logs`
2. Überprüfe lokale Logs: Konsolen-Output des Skripts
3. Kontaktiere den Entwickler mit:
   - Fehlermeldung
   - Verwendetes Kommando
   - Relevante Log-Auszüge
