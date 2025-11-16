# 🖥️ Lokale Entwicklung - SQLite Logging

## Setup für lokales Testing (ohne Railway Volume)

Das SQLite-System erkennt automatisch, ob es auf Railway oder lokal läuft und passt sich entsprechend an.

---

## 🛠️ Schnellstart (3 Schritte)

### 1. Lokales Daten-Verzeichnis erstellen

```bash
# Windows (PowerShell/CMD)
mkdir data\user-logs

# macOS/Linux
mkdir -p data/user-logs
```

**Das war's!** Das System verwendet automatisch diesen Pfad, wenn kein Railway Volume vorhanden ist.

### 2. Dependencies installieren

```bash
npm install
```

### 3. Server starten

```bash
npm run dev
```

**Fertig!** Der Server läuft jetzt lokal mit SQLite.

---

## 📁 Verzeichnisstruktur (lokal)

```
EnergyScanCapture - Kopie/
├── data/
│   └── user-logs/            ← Lokales "Volume"
│       ├── logs-2025-01-15.db
│       ├── logs-2025-01-15.db-wal
│       ├── logs-2025-01-15.db-shm
│       └── temp/             ← Downloads aus Drive
└── server/
    └── services/
        └── sqliteLogService.ts  (erkennt automatisch lokal vs. Railway)
```

---

## 🔍 Wie funktioniert die Auto-Erkennung?

In [sqliteLogService.ts](server/services/sqliteLogService.ts):

```typescript
// Railway Volume Path (fallback auf lokales data/ für Development)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'user-logs')
  : path.join(process.cwd(), 'data', 'user-logs');
```

**Lokal:** `RAILWAY_VOLUME_MOUNT_PATH` ist nicht gesetzt → nutzt `./data/user-logs`
**Railway:** Variable ist gesetzt → nutzt `/app/data/user-logs`

---

## 🧪 Lokales Testing

### Test 1: SQLite Logs erstellen

1. **Server starten:** `npm run dev`
2. **Login in App:** http://localhost:5050
3. **Aktion ausführen:** GPS-Tracking, Scan, etc.
4. **Check Logs:**

```bash
# Windows
dir data\user-logs

# macOS/Linux
ls -la data/user-logs
```

**Erwartete Ausgabe:**
```
logs-2025-01-15.db
logs-2025-01-15.db-wal
logs-2025-01-15.db-shm
```

### Test 2: Drive-Upload (lokal testen)

```bash
npx tsx test-drive-upload.ts
```

**Sollte erfolgreich sein** (Upload in echtes Google Drive)

### Test 3: Startup-Sync simulieren

```bash
npx tsx -e "
import('./server/services/sqliteStartupSync.js').then(async (m) => {
  await m.sqliteStartupSyncService.performStartupSync();
  process.exit(0);
});
"
```

**Testet:**
- Lokale DB-Checks
- Drive-Downloads
- Sheets-Merge

### Test 4: DB inspizieren

**Mit SQLite CLI (optional):**

```bash
# SQLite installieren (Windows: https://www.sqlite.org/download.html)
sqlite3 data/user-logs/logs-2025-01-15.db

# Queries:
sqlite> SELECT COUNT(*) FROM user_logs;
sqlite> SELECT log_type, COUNT(*) FROM user_logs GROUP BY log_type;
sqlite> SELECT * FROM user_logs LIMIT 5;
sqlite> .quit
```

**Oder mit VS Code Extension:**

1. Install: "SQLite Viewer" Extension
2. Rechtsklick auf `.db` Datei → "Open Database"
3. Explore Tables

---

## ⚙️ Environment Variables (lokal)

Deine `.env` sollte enthalten:

```env
PORT=5050
GOOGLE_SHEETS_KEY={...}
GOOGLE_CLOUD_VISION_KEY={...}
GOOGLE_GEOCODING_API_KEY=...
PUSHOVER_USER=...
PUSHOVER_TOKEN=...
FOLLOWMEE_API=...
FOLLOWMEE_USERNAME=...
GOOGLE_DRIVE_LOG_FOLDER_ID=1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U
```

**Alle funktionieren lokal genauso wie auf Railway!**

---

## 🚨 Unterschiede: Lokal vs. Railway

| Feature | Lokal (Development) | Railway (Production) |
|---------|---------------------|----------------------|
| **Daten-Pfad** | `./data/user-logs` | `/app/data/user-logs` |
| **Persistenz** | ✅ (Git-ignored) | ✅ (Railway Volume) |
| **Bei Git-Pull** | Bleibt erhalten | Bleibt erhalten |
| **Bei Server-Neustart** | Bleibt erhalten | Bleibt erhalten |
| **Bei Code-Änderung** | Bleibt erhalten | Bleibt erhalten |
| **Bei Deploy** | N/A | Bleibt erhalten (Volume!) |
| **Cleanup >7 Tage** | ✅ Automatisch | ✅ Automatisch |
| **Drive-Upload** | ✅ Funktioniert | ✅ Funktioniert |
| **Startup-Sync** | ✅ Funktioniert | ✅ Funktioniert |
| **Cron-Jobs** | ✅ Laufen lokal | ✅ Laufen auf Railway |

---

## 🔧 Debugging-Tipps

### Logs überwachen

```bash
# Entwicklungsserver mit verbose logging
npm run dev
```

**Check für:**
```
[SQLite] Created data directory: C:\Users\damia\...\data\user-logs
[SQLite] ✅ Created new database: 2025-01-15
[EnhancedLogging] Error writing to SQLite: ... ← SOLLTE NICHT erscheinen
```

### DB-Größe checken

```bash
# Windows (PowerShell)
Get-ChildItem data\user-logs -Recurse | Measure-Object -Property Length -Sum

# macOS/Linux
du -sh data/user-logs
```

### Manuell DB löschen (für frischen Start)

```bash
# Windows
rmdir /s /q data\user-logs
mkdir data\user-logs

# macOS/Linux
rm -rf data/user-logs
mkdir -p data/user-logs
```

**Wichtig:** Google Sheets bleiben als Backup → Startup-Sync merged alles wieder!

---

## 🎯 Typische Entwicklungs-Workflows

### Workflow 1: Feature-Test

```bash
1. npm run dev
2. Teste Feature in App (z.B. GPS-Tracking)
3. Check logs in Console
4. Inspiziere DB: sqlite3 data/user-logs/logs-2025-01-15.db
5. Iterate
```

### Workflow 2: Startup-Sync-Test

```bash
1. Lösche lokale DB: rm data/user-logs/*.db
2. npm run dev
3. Server lädt automatisch aus Sheets + Drive
4. Check logs für "STARTUP SYNC COMPLETED"
```

### Workflow 3: Drive-Integration-Test

```bash
1. npm run dev
2. Warte bis Tagesende (oder triggere manuell)
3. Check Google Drive für neue .db.gz Dateien
4. Delete lokale DB
5. Restart server → sollte aus Drive laden
```

### Workflow 4: Performance-Test

```bash
# Terminal 1: Server
npm run dev

# Terminal 2: Admin-Dashboard-Query
curl http://localhost:5050/api/admin/dashboard/historical?date=2025-01-10

# Measure Zeit in Console-Logs
# Sollte <1s sein (vs. 10s+ mit Sheets)
```

---

## 📊 Was lokal NICHT funktioniert

❌ **Railway Volume Monitoring** - Nur auf Railway
❌ **Railway Environment Variables** - Musst du in `.env` setzen
❌ **Railway Auto-Deploy** - Lokal manuell starten

✅ **Alles andere funktioniert identisch!**

---

## 🐛 Häufige Probleme

### Problem: "EACCES: permission denied"

**Ursache:** Verzeichnis existiert nicht oder keine Schreibrechte

**Lösung:**
```bash
mkdir data\user-logs
# Oder mit Admin-Rechten ausführen
```

### Problem: "Database is locked"

**Ursache:** Mehrere Server-Instanzen greifen auf dieselbe DB zu

**Lösung:**
```bash
# Stoppe alle laufenden Instanzen
# Lösche WAL-Dateien:
del data\user-logs\*.db-wal
del data\user-logs\*.db-shm
```

### Problem: "Drive upload works locally but not on Railway"

**Ursache:** Env-Variable nicht auf Railway gesetzt

**Lösung:**
```bash
# Railway Dashboard → Settings → Variables
GOOGLE_DRIVE_LOG_FOLDER_ID=1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U
```

---

## 🔐 .gitignore

Das `data/` Verzeichnis ist bereits in `.gitignore`:

```gitignore
/data
/dist
/node_modules
.env
```

→ **Lokale DBs werden NICHT ins Repo committed** ✅

---

## 🚀 Ready für Railway Deploy

Wenn lokal alles funktioniert:

1. ✅ **Commit & Push:**
   ```bash
   git add .
   git commit -m "Add: SQLite User-Logging System"
   git push origin main
   ```

2. ✅ **Railway Volume erstellen** (siehe [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md))

3. ✅ **Deploy & Monitor:**
   ```bash
   railway logs --tail
   ```

---

## 📞 Support

**Bei lokalen Problemen:**
1. Check Server-Logs: Console-Output
2. Check DB-Pfad: Sollte `data/user-logs` sein
3. Check Berechtigungen: Verzeichnis beschreibbar?
4. Manuell DB löschen & neu starten

**Bei Drive-Problemen:**
```bash
npx tsx test-drive-upload.ts
```

---

**Happy Coding! 🎉**

Lokales Development ist jetzt genauso performant wie Production (SQLite statt Sheets).
