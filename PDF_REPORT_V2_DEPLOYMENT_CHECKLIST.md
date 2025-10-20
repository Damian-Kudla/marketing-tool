# PDF Report Generator V2.0 - Migrations & Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Code-Änderungen validieren
- [ ] `reportGenerator.ts` kompiliert ohne TypeScript-Fehler
- [ ] Alle Imports korrekt (`scrapeDayData` statt `dailyDataStore`)
- [ ] Keine Syntax-Fehler in PDF-Generierung
- [ ] UTF-8 Encoding für deutsche Umlaute aktiviert

### 2. Abhängigkeiten prüfen
```bash
# Prüfe ob alle Packages installiert sind:
npm list pdfkit
npm list googleapis
```

**Erforderlich:**
- ✅ `pdfkit` (bereits installiert)
- ✅ `googleapis` (bereits installiert)
- ✅ TypeScript >= 4.0
- ✅ Node.js >= 14

### 3. Environment Variables
```bash
# .env Datei muss enthalten:
GOOGLE_SHEETS_KEY='{"type":"service_account",...}'
```

**Validierung:**
```bash
# Test Google Sheets Zugriff:
node -e "console.log(process.env.GOOGLE_SHEETS_KEY ? '✅ GOOGLE_SHEETS_KEY set' : '❌ Missing')"
```

### 4. Berechtigungen prüfen
- [ ] Service Account hat Lesezugriff auf LOG_SHEET_ID
- [ ] `reports/` Ordner hat Schreibrechte
- [ ] Server läuft mit ausreichend RAM (min. 512 MB für Reports)

---

## 🚀 Deployment Steps

### Schritt 1: Code deployen
```bash
# 1. Git Status prüfen
git status

# 2. Änderungen committen
git add server/services/reportGenerator.ts
git commit -m "feat: PDF Report Generator V2.0 - Historical data from Google Sheets"

# 3. Pushen
git push origin main
```

### Schritt 2: Server neu starten
```bash
# TypeScript kompilieren
npm run build

# Server neu starten (mit PM2 oder systemd)
pm2 restart energy-scan-app
# ODER
systemctl restart energy-scan
```

### Schritt 3: Erster Test nach Deployment
```bash
# Test-Script ausführen mit gestrigem Datum
node test-report-generator.js $(date -d "yesterday" +%Y-%m-%d)
```

**Erwartetes Ergebnis:**
```
✅ Report erfolgreich generiert!
   Dauer: ~10 Sekunden
   Pfad: reports/daily-report-YYYY-MM-DD.pdf
   Dateigröße: 50-200 KB
```

---

## 🧪 Post-Deployment Testing

### Test 1: Manueller Report
```bash
# 1. Report für gestern generieren
curl -X POST http://localhost:3000/api/admin/generate-report \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-01-15"}'

# 2. Prüfe Response
# Erwartete: 200 OK + { "filePath": "reports/daily-report-2025-01-15.pdf" }
```

### Test 2: Scheduled Task
```bash
# Warte bis 20:00 Uhr oder triggere manuell:
# (Scheduled Task sollte automatisch laufen)

# Prüfe Logs:
tail -f logs/server.log | grep ReportGenerator

# Erwartete Logs:
# [ReportGenerator] 📊 Generating daily report for 2025-01-15...
# [ReportGenerator] ✅ Report generated successfully
```

### Test 3: Report-Download
```bash
# Lade Report herunter und öffne:
curl http://localhost:3000/api/admin/reports/daily-report-2025-01-15.pdf \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  --output test-report.pdf

# Öffne PDF
start test-report.pdf  # Windows
open test-report.pdf   # Mac
xdg-open test-report.pdf  # Linux
```

### Test 4: Visueller Check
Öffne das PDF und prüfe:
- [ ] Seite 1: Ranking-Tabelle mit 8 Spalten
- [ ] User-Links funktionieren (klickbar)
- [ ] Seite 2+: User-Detail-Seiten vollständig
- [ ] Performance-Metriken Sektion vorhanden
- [ ] Status-Breakdown mit Icons (✓ ★ ○ ✗)
- [ ] Conversion-Funnel angezeigt
- [ ] GPS-Route Top 10 (wenn GPS-Daten vorhanden)
- [ ] Peak Hours mit Prozenten
- [ ] Deutsche Umlaute korrekt (ä, ö, ü, ß)
- [ ] Keine abgeschnittenen Texte
- [ ] Footer mit Seitenzahl

---

## 🔍 Monitoring nach Deployment

### Logs überwachen (erste 24 Stunden)
```bash
# Live-Logs anzeigen:
tail -f logs/server.log | grep -E "(ReportGenerator|HistoricalDataScraper)"

# Suche nach Fehlern:
grep -i error logs/server.log | grep ReportGenerator
```

### Metriken prüfen:
- [ ] Report-Generierung läuft täglich um 20:00 Uhr
- [ ] Durchschnittliche Generierungszeit: < 30 Sekunden
- [ ] Dateigröße pro Report: 50-500 KB
- [ ] Keine Google Sheets API Fehler
- [ ] Keine Memory Leaks (RAM-Nutzung stabil)

### Error-Tracking:
```bash
# Prüfe ob Fehler in letzten 7 Tagen:
grep -i "ReportGenerator.*error" logs/server-$(date +%Y-%m-%d).log

# Häufigste Fehler:
grep -i error logs/server.log | grep ReportGenerator | sort | uniq -c | sort -rn
```

---

## 🛠️ Rollback Plan (falls Probleme)

### Schritt 1: Alte Version wiederherstellen
```bash
# Git Commit rückgängig machen:
git revert HEAD
git push origin main

# Server neu starten:
npm run build
pm2 restart energy-scan-app
```

### Schritt 2: Manueller Report mit alter Version
```bash
# Falls alte Reports noch benötigt werden:
# 1. Checkout alte Version
git checkout main~1 server/services/reportGenerator.ts

# 2. Kompilieren und testen
npm run build
node test-report-generator.js 2025-01-15

# 3. Wenn OK, committen
git add server/services/reportGenerator.ts
git commit -m "revert: Rollback to old report generator"
git push origin main
```

### Schritt 3: Logs prüfen
```bash
# Prüfe ob Rollback erfolgreich:
tail -f logs/server.log | grep ReportGenerator
# Sollte keine Fehler mehr zeigen
```

---

## 🔧 Troubleshooting

### Problem: Report-Generierung schlägt fehl

**Fehler:** `No activity data found`
```bash
# Lösung: Prüfe Google Sheets Zugriff
node -e "
const { scrapeDayData } = require('./server/services/historicalDataScraper');
scrapeDayData('2025-01-15').then(data => 
  console.log('✅ Found', data.length, 'users')
).catch(err => 
  console.error('❌ Error:', err.message)
);
"
```

**Fehler:** `Permission denied`
```bash
# Lösung: Service Account Berechtigung prüfen
# 1. Öffne Google Sheets
# 2. Share → Add people
# 3. Füge Service Account Email hinzu (aus GOOGLE_SHEETS_KEY)
# 4. Berechtigung: "Viewer" reicht aus
```

**Fehler:** `No users with sufficient activity`
```bash
# Lösung: Filter-Schwellwerte temporär senken
# In reportGenerator.ts:
const users = allUsers.filter(userData => 
  userData.gpsPoints.length >= 5 || userData.totalActions >= 2  // Gesenkt!
);
```

### Problem: PDF ist leer oder unvollständig

**Symptom:** PDF hat nur 1-2 Seiten
```bash
# Check: Wie viele User wurden gefiltert?
grep "Filtering out" logs/server.log
# Wenn viele User gefiltert: Schwellwerte zu hoch
```

**Symptom:** Keine GPS-Route
```bash
# Check: Hat User GPS-Daten?
# Prüfe in Google Sheets ob Column J GPS-Koordinaten enthält
```

### Problem: Performance-Probleme

**Symptom:** Report braucht > 60 Sekunden
```bash
# Profiling aktivieren:
NODE_OPTIONS="--prof" node test-report-generator.js 2025-01-15

# Profiling-Datei analysieren:
node --prof-process isolate-*.log > profile.txt
cat profile.txt | less
```

**Optimierung:**
- Cache für Google Sheets Anfragen aktivieren
- Parallel-Processing für multiple User-Pages
- PDF-Kompression aktivieren

---

## 📊 Performance Benchmarks

### Erwartete Werte (Production):
| Metrik | Ziel | Max. akzeptabel |
|--------|------|-----------------|
| Report-Generierung | < 15s | < 30s |
| Google Sheets Fetch | < 5s | < 10s |
| PDF-Erstellung | < 5s | < 10s |
| Dateigröße (10 User) | ~100 KB | < 200 KB |
| RAM-Nutzung | +50 MB | +150 MB |

### Messung:
```bash
# Zeit messen:
time node test-report-generator.js 2025-01-15

# RAM-Nutzung:
ps aux | grep node | awk '{print $6/1024 " MB"}'
```

---

## 🔐 Security Checklist

- [ ] GOOGLE_SHEETS_KEY nicht in Logs/Code exposed
- [ ] Reports nur für Admin-User zugänglich
- [ ] Keine sensiblen Daten (Passwörter, API Keys) im PDF
- [ ] Input-Validierung für Datum-Parameter
- [ ] Rate-Limiting für Report-Generation API
- [ ] HTTPS für Report-Download

---

## 📝 Documentation Updates

Nach erfolgreichem Deployment:
- [ ] README.md aktualisieren (neuer Report Generator erwähnen)
- [ ] API-Dokumentation erweitern (neue Report-Metriken)
- [ ] Changelog aktualisieren (Version 2.0)
- [ ] Team über neue Features informieren

---

## ✅ Final Deployment Sign-Off

**Deployment abgeschlossen am:** _______________

**Deployed von:** _______________

**Checkliste abgeschlossen:**
- [ ] Alle Tests bestanden
- [ ] Logs zeigen keine Fehler
- [ ] Scheduled Task läuft
- [ ] Reports werden täglich generiert
- [ ] Team informiert

**Bekannte Issues:** _______________

**Nächste Steps:** _______________

---

## 📞 Eskalation

Bei kritischen Problemen:
1. **Rollback** durchführen (siehe oben)
2. **Logs** sammeln und analysieren
3. **Issue** in GitHub erstellen mit:
   - Fehler-Log
   - Environment-Details
   - Test-Datum
   - Erwartetes vs. tatsächliches Verhalten

---

**Version:** 2.0  
**Letzte Änderung:** 2025-01-20  
**Status:** Ready for Production Deployment
