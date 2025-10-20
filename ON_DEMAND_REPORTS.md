# On-Demand PDF Reports - Resource Optimization

## ✅ Implementiert: 20.10.2025

### Problem
- Reports wurden auf dem Server gespeichert (persistente Dateien)
- Verschwendete Speicherplatz und Ressourcen
- Alte Reports wurden nie gelöscht

### Lösung
Reports werden jetzt **on-the-fly** generiert:

1. **Bei Download-Request** → Report generieren
2. **PDF streamen** → Direkt an Client senden
3. **Sofort löschen** → Nach erfolgreichem Stream

### Änderungen

#### 1. `server/routes/admin.ts`

**GET `/api/admin/reports/:date`**
- ✅ Prüft nicht mehr ob Datei existiert
- ✅ Gibt immer `exists: true` zurück
- ✅ Flag `generatedOnDemand: true`

**GET `/api/admin/reports/:date/download`**
```typescript
// Alt: Datei lesen → streamen
// Neu: Generieren → streamen → löschen

1. generateDailyReport(date) aufrufen
2. PDF zu Client streamen
3. fileStream.on('end') → fs.unlinkSync(tempFilePath)
4. Bei Fehler: Cleanup auch ausführen
```

#### 2. `server/services/reportGenerator.ts`

**Neue Funktion: `cleanupOldReports()`**
- Löscht alle `.pdf` Dateien im `/reports` Ordner beim Server-Start
- Entfernt Reste von alten Reports
- Wird automatisch beim Module Load ausgeführt

**Kommentare aktualisiert**
- "On-Demand" statt "persistent storage"
- Dokumentiert: Reports werden nach Download gelöscht

#### 3. `server/services/cronJobService.ts`

**Cron-Job deaktiviert**
```typescript
// Alt: Automatisch um 20:00 Uhr Report generieren
// Neu: Funktion deaktiviert (auskommentiert)
```

- Reports werden nur noch bei manueller Anfrage generiert
- Spart Ressourcen wenn Reports nicht benötigt werden
- Kann später wieder aktiviert werden falls gewünscht

### Vorteile

✅ **Speicherplatz gespart**
- Keine persistenten PDF-Dateien mehr
- Automatisches Cleanup bei Server-Start

✅ **Ressourcen geschont**
- Reports nur bei Bedarf generieren
- Keine täglichen Cron-Jobs mehr

✅ **Immer aktuelle Daten**
- Bei jedem Download: frische Daten aus Google Sheets
- Keine veralteten cached Reports

✅ **Skalierbar**
- Keine Speicher-Limits durch alte Reports
- Funktioniert auch bei vielen Report-Anfragen

### Workflow

**Frontend (Admin Dashboard):**
```
1. User klickt "Download Report" für 2025-10-17
2. GET /api/admin/reports/2025-10-17/download
3. Backend:
   - Scraped Daten von Google Sheets
   - Generiert HTML
   - Puppeteer → PDF
   - Stream zu Client
   - Löscht PDF sofort
4. User erhält: daily-report-2025-10-17.pdf
5. Server: Keine Dateien übrig
```

### Technische Details

**Report Lifecycle:**
```
Request → scrapeDayData(date)
       → generateHTML(report)
       → puppeteer.launch()
       → page.pdf({ path: tempFile })
       → fs.createReadStream(tempFile)
       → pipe(res)
       → fileStream.on('end') → fs.unlinkSync(tempFile)
       → Response complete
```

**Cleanup on Error:**
```typescript
} catch (error) {
  // Cleanup bei Fehler
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    fs.unlinkSync(tempFilePath);
  }
}
```

### Testing

**Manuelle Tests:**
```bash
# 1. Server starten
npm run dev
# → Sollte alte Reports löschen

# 2. Report downloaden
curl -o test.pdf http://localhost:5050/api/admin/reports/2025-10-17/download
# → PDF erhalten, aber Datei wurde gelöscht

# 3. Prüfen ob Datei weg ist
ls reports/
# → Leer (oder nur .gitkeep)
```

**Expected Logs:**
```
[ReportGenerator] 🗑️ Cleaning up 3 old report(s)...
[ReportGenerator] ✅ Old reports cleaned up
[Admin API] 📄 Generating on-the-fly report for 2025-10-17
[ReportGenerator] Report generated successfully: reports/daily-report-2025-10-17.pdf
[Admin API] ✅ Report generated, streaming to client...
[Admin API] 🗑️ Deleted temporary report: reports/daily-report-2025-10-17.pdf
```

### Rollback (falls nötig)

Falls du doch wieder persistente Reports möchtest:

1. **Cron-Job aktivieren:**
   ```typescript
   // In cronJobService.ts: auskommentierten Code wieder aktivieren
   ```

2. **Download-Route ändern:**
   ```typescript
   // In admin.ts: zurück zu fs.existsSync() check + stream
   ```

3. **Cleanup entfernen:**
   ```typescript
   // In reportGenerator.ts: cleanupOldReports() entfernen
   ```

### Nächste Schritte

Optional:
- [ ] Rate Limiting für Report-Downloads (max 3 pro Minute)
- [ ] Cache für Reports (5 Minuten) falls derselbe Report nochmal angefragt wird
- [ ] Pushover Notification wenn Report generiert wird

---

**Status:** ✅ Produktionsbereit  
**Getestet:** ⏳ Manueller Test ausstehend  
**Deployment:** Ready
