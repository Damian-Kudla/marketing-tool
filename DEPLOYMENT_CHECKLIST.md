# 🚀 SQLite Logging System - Deployment Checklist

## ✅ Pre-Deployment (ERLEDIGT)

- [x] **Google Drive Ordner erstellt:** "Logs" (ID: 1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U)
- [x] **Service Account berechtigt:** `python-sheets-anbindung@daku-trading-gmbh.iam.gserviceaccount.com`
- [x] **Upload-Test erfolgreich:** ✅ (siehe Drive)
- [x] **`.env` aktualisiert:** `GOOGLE_DRIVE_LOG_FOLDER_ID` hinzugefügt
- [x] **Dependencies installiert:** `better-sqlite3`, `node-cron`
- [x] **Services implementiert:** 5 neue + 3 angepasste Dateien

## 📋 Deployment-Schritte

### 1. Dependencies installieren (lokal testen)

```bash
npm install
```

**Neue Packages:**
- `better-sqlite3@^11.0.0`
- `node-cron@^3.0.3`
- `@types/better-sqlite3@^7.6.11`
- `@types/node-cron@^3.0.11`

### 2. Railway Environment Variables setzen

**In Railway Dashboard → Settings → Variables:**

```
GOOGLE_DRIVE_LOG_FOLDER_ID=1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U
```

**Wichtig:** Alle anderen Env-Variablen bleiben unverändert!

### 3. Railway Volume erstellen

**Railway Dashboard → Settings → Volumes:**

1. Klick **"Add Volume"**
2. Konfiguration:
   - **Mount Path:** `/app/data`
   - **Size:** `1 GB` (kostenlos)
3. Klick **"Add"**
4. **Wichtig:** Volume muss ERST erstellt werden, BEVOR du deployest!

### 4. Deploy

```bash
# Lokaler Build-Test (optional)
npm run build

# Commit & Push (triggert Railway Auto-Deploy)
git add .
git commit -m "Add: SQLite User-Logging System mit Drive-Archivierung"
git push origin main
```

**ODER via npm script:**

```bash
npm run deploy
```

## 🔍 Post-Deployment Checks

### Schritt 1: Logs überwachen (erste 2 Minuten)

Railway Logs sollten zeigen:

```
✅ [SQLite] Created data directory: /app/data/user-logs
✅ Initializing SQLite Backup Service...
✅ [SQLiteBackup] ✅ Initialized successfully
✅ Starting SQLite Startup Sync...

   🔄 STARTUP SYNC STARTED
   --- Phase 1: Local DB Check (7 days) ---
   ...
   ✅ STARTUP SYNC COMPLETED

✅ Starting SQLite Daily Archive cron job...
✅ [DailyArchive] ✅ Cron job started (runs daily at 00:05 CET/CEST)
```

### Schritt 2: Volume-Check (nach 5 Minuten)

```bash
# Via Railway CLI
railway run ls -la /app/data/user-logs
```

**Erwartete Ausgabe:**
```
logs-2025-01-15.db
logs-2025-01-15.db-wal
logs-2025-01-15.db-shm
```

### Schritt 3: Google Drive Check

Gehe zu: https://drive.google.com/drive/folders/1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U

**Nach Startup-Sync solltest du sehen:**
- Keine neuen Dateien (wenn keine alten Logs in Sheets waren)
- ODER: `logs-YYYY-MM-DD.db.gz` + `.meta.json` (wenn alte Logs gemerged wurden)

### Schritt 4: Test User-Logging

1. **Mache Login in der App**
2. **Führe eine Aktion aus** (GPS-Tracking, Scan, etc.)
3. **Check Railway Logs:**

```
[EnhancedLogging] Error writing to SQLite: ... ← SOLLTE NICHT erscheinen!
[SQLite] ✅ Created new database: 2025-01-15 ← GUT!
```

4. **Check Google Sheets:** Log sollte auch dort sein (Backup)

## ⚠️ Troubleshooting

### Problem: "Volume not mounted"

**Symptom:**
```
[SQLite] Created data directory: /data/user-logs
[SQLite] Error: EACCES permission denied
```

**Lösung:**
1. Railway Dashboard → Settings → Volumes
2. Verify Mount Path: `/app/data`
3. Redeploy

### Problem: "Drive upload failed 403"

**Symptom:**
```
[SQLiteBackup] ❌ Upload failed: Permission denied
```

**Lösung:**
1. Check `GOOGLE_DRIVE_LOG_FOLDER_ID` in Railway env
2. Verify Service Account hat "Editor" Berechtigung
3. Warte 2-3 Minuten (Berechtigungspropagierung)

### Problem: "Startup Sync dauert >10 Min"

**Ursache:** Viele alte Logs in Google Sheets

**Lösung:** Normal beim ersten Deploy. Warten lassen!

**Monitoring:** Check Railway Logs für Fortschritt:
```
[Phase 4] Processing 3 user sheets...
[Phase 4] ✅ Merged 127 logs from Sheets
```

### Problem: "DB corrupted"

**Symptom:**
```
[Phase 1] ❌ Corrupted DB detected: 2025-01-15
```

**Lösung:** Automatische Wiederherstellung aus Drive (sollte automatisch passieren)

Falls nicht:
```bash
railway run node -e "
  import('./server/services/sqliteBackupService.js').then(async (m) => {
    await m.sqliteBackupService.initialize();
    await m.sqliteBackupService.downloadDB('2025-01-15');
    process.exit(0);
  });
"
```

## 📊 Erwartete Performance

| Metrik | Vor SQLite | Nach SQLite | Verbesserung |
|--------|-----------|-------------|--------------|
| Query 1 Tag | 8-12s | 0.2-0.5s | **24x** |
| Admin Load | 15s+ | 2s | **7x** |
| Server Start | 3-5min | 30-60s | **5x** |
| API Calls/Tag | 500-1000 | 50-100 | **90% ↓** |

## 🎯 Erfolgskriterien

✅ **Server startet in <2 Minuten**
✅ **Keine SQLite-Errors in Logs**
✅ **Volume-Verzeichnis existiert** (`/app/data/user-logs`)
✅ **User-Logs werden dual geschrieben** (Sheets + SQLite)
✅ **Admin-Dashboard lädt historische Daten schnell** (<2s für 7 Tage)
✅ **Tagesende-Cron läuft** (Check um 00:05 CET)

## 📞 Support

Bei Problemen:
1. **Check Railway Logs:** `railway logs --tail`
2. **Check Pushover:** Alerts für kritische Fehler
3. **Review:** [SQLITE_LOGGING_SETUP.md](SQLITE_LOGGING_SETUP.md)
4. **Manueller Test:** `npx tsx test-drive-upload.ts`

---

**Deployment-Datum:** 2025-01-15
**Version:** 1.0.0
**Status:** READY FOR DEPLOYMENT ✅
