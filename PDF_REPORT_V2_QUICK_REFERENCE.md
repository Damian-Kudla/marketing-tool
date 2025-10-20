# PDF Report Generator V2.0 - Quick Reference

## 🚀 Schnellstart

### Report generieren:
```typescript
import { generateDailyReport } from './server/services/reportGenerator';
await generateDailyReport('2025-01-15');
```

### Test-Script ausführen:
```bash
node test-report-generator.js 2025-01-15
```

---

## 📊 Neue Metriken im Report

### Seite 1 - Ranking-Tabelle (8 Spalten):
| Rang | Mitarbeiter | Score | Actions | Status-Änd. | Fotos | Distanz | Conv. % |
|------|-------------|-------|---------|-------------|-------|---------|---------|
| 1 | Max M. | 78 | 234 | 128 | 18 | 12.4 km | 44% |

### Seite 2-N - User-Details:

#### 1️⃣ Performance-Metriken (9 KPIs):
```
├─ Activity Score: 78 / 100
├─ Gesamtdistanz: 12.4 km
├─ Eindeutige Adressen: 45
├─ Eindeutige Fotos: 18 (dedupliziert)
├─ Status-Änderungen: 128
├─ Actions gesamt: 234
├─ Aktive Zeit: 7h 23m (von 8h 15m)
├─ Idle Zeit: 52m (11%)
└─ Scans/Stunde: 17.2
```

#### 2️⃣ Status-Änderungen (Detailliert):
```
✓ Interessiert: 45 (35%)
★ Termin vereinbart: 12 (9%)
○ Nicht angetroffen: 38 (30%)
✗ Nicht interessiert: 33 (26%)
─────────────────────────
Gesamt: 128 Status-Änderungen
Conversion Rate: 44%
```

#### 3️⃣ Conversion-Funnel:
```
1. Fotos hochgeladen: 18
2. Adressen besucht: 45
3. Status-Änderungen: 128
4. Erfolgreiche Kontakte: 57
```

#### 4️⃣ Zeitstrahl:
```
Erste Aktivität: 08:15
Letzte Aktivität: 17:42
Längste Pause: 1h 23m ⚠️
Peak Hours:
  09:00-10:00 (23%)
  14:00-15:00 (18%)
  16:00-17:00 (15%)
```

#### 5️⃣ GPS-Route Top 10:
```
1. Lat: 51.21420, Lng: 6.67819 | 09:15 | Besuche: 5
2. Lat: 51.23145, Lng: 6.68234 | 10:32 | Besuche: 3
...
```

#### 6️⃣ Gerätestatus:
```
Ø Batterie: 87%
Low Battery Events: 0
Offline Events: 2
```

---

## 🔧 Wichtigste Code-Änderungen

### ALT (Live-Daten):
```typescript
const users = dailyDataStore.getUsersWithMinLogs(10);
```

### NEU (Historische Daten):
```typescript
const allUsers = await scrapeDayData(date);
const users = allUsers.filter(userData => 
  userData.gpsPoints.length >= 10 || userData.totalActions >= 5
);
```

---

## ⚙️ Konfiguration

### Filter-Schwellwerte:
```typescript
// Mindestens EINE Bedingung muss erfüllt sein:
MIN_GPS_POINTS = 10    // ODER
MIN_ACTIONS = 5
```

### GPS-Route Proximity:
```typescript
PROXIMITY_THRESHOLD = 0.0005  // ~50 Meter
```

### Warnschwellen:
```typescript
LOW_ACTIVITY_SCORE = 50      // Warnung im Footer
HIGH_IDLE_TIME = 3600000     // 1 Stunde (in ms)
```

---

## 🎨 Farbcodierung

### Activity Score:
- 🔴 **Rot** (< 50): Niedrige Aktivität
- 🟡 **Gelb** (50-74): Mittlere Aktivität
- 🟢 **Grün** (≥ 75): Hohe Aktivität

### Conversion Rate:
- 🟢 **Grün** (≥ 40%): Gute Performance
- 🟡 **Gelb** (< 40%): Verbesserungspotenzial

---

## 🐛 Fehlerbehandlung

### Keine Daten:
```
Error: No activity data found for 2025-01-15
→ Kein User hatte an diesem Tag Aktivität
```

### Zu wenig Aktivität:
```
Error: No users with sufficient activity
→ Alle User < 10 GPS UND < 5 Actions
```

### Google Sheets Fehler:
```
Error: Permission denied
→ Service Account braucht Zugriff auf Spreadsheet
```

---

## 📝 Status-Icons

| Icon | Status (DE) | Status (EN) |
|------|-------------|-------------|
| ✓ | Interessiert | interest_later |
| ★ | Termin vereinbart | appointment |
| ○ | Nicht angetroffen | not_reached |
| ✗ | Nicht interessiert | no_interest |
| ✉ | Schriftlich kontaktiert | written |

---

## 🔍 Debugging

### Console Logs:
```
[ReportGenerator] 📊 Generating daily report for 2025-01-15...
[ReportGenerator] ✅ Using HISTORICAL DATA from Google Sheets
[ReportGenerator] 📥 Retrieved data for 8 users from Google Sheets
[ReportGenerator] 🔸 Filtering out TestUser_123 (3 GPS, 2 actions)
[ReportGenerator] ✅ 7 users meet activity threshold
[ReportGenerator] ✅ Report generated successfully
```

### Verbose Logging aktivieren:
```typescript
process.env.DEBUG = 'true';
```

---

## 📦 Dateistruktur

```
reports/
├── daily-report-2025-01-15.pdf
├── daily-report-2025-01-14.pdf
└── ...
```

### Dateiname-Format:
```
daily-report-YYYY-MM-DD.pdf
```

### Dateigröße (typisch):
- 1-10 User: ~50-100 KB
- 11-30 User: ~100-200 KB
- 30+ User: ~200-500 KB

---

## 🧪 Test-Checklist

- [ ] Report generiert ohne Fehler
- [ ] Ranking-Tabelle zeigt alle 8 Spalten
- [ ] User-Detail-Seiten vollständig
- [ ] Status-Breakdown mit Icons & Prozenten
- [ ] GPS-Route Top 10 vorhanden (wenn GPS-Daten)
- [ ] Conversion-Funnel berechnet korrekt
- [ ] Peak Hours mit Prozent-Anteil
- [ ] Längste Pause angezeigt (wenn > 1h)
- [ ] Fotos dedupliziert (uniquePhotos)
- [ ] Links zwischen Seiten funktionieren
- [ ] Deutsche Umlaute korrekt dargestellt
- [ ] Warnungen bei niedriger Aktivität
- [ ] Footer mit Seitenzahl

---

## 💡 Tipps

### Performance:
- Report-Generierung: ~5-30 Sekunden
- Google Sheets API: ~2-10 Sekunden
- PDF-Erstellung: ~1-5 Sekunden

### Best Practice:
- Reports nach 20:00 Uhr generieren (vollständige Daten)
- Test mit gestrigem Datum (garantiert vollständig)
- Bei Fehlern: Logs prüfen, dann Google Sheets API

### Wartung:
- Reports älter als 30 Tage archivieren
- Google Sheets API Quota überwachen
- Bei > 50 Usern: Paging in Ranking-Tabelle prüfen

---

## 🔗 Verwandte Dateien

| Datei | Zweck |
|-------|-------|
| `reportGenerator.ts` | Haupt-Logic (NEU!) |
| `historicalDataScraper.ts` | Google Sheets Zugriff (unverändert) |
| `dailyDataStore.ts` | Live-Daten für Dashboard (unverändert) |
| `trackingTypes.ts` | TypeScript Interfaces (minimal erweitert) |

---

## 📞 Support

### Häufige Probleme:

**Problem:** Report ist leer  
**Lösung:** Prüfe ob Daten in Google Sheets für das Datum existieren

**Problem:** Keine GPS-Route  
**Lösung:** User hatte < 10 GPS-Punkte oder GPS-Tracking war aus

**Problem:** Conversion Rate 0%  
**Lösung:** Keine Status-Änderungen für "interessiert" oder "termin"

**Problem:** Peak Hours fehlen  
**Lösung:** User hatte keine Actions mit explizitem Timestamp

---

## ✅ Quick Validation

Nach Report-Generierung:
```bash
# 1. Datei existiert?
ls reports/daily-report-2025-01-15.pdf

# 2. Dateigröße plausibel?
du -h reports/daily-report-2025-01-15.pdf

# 3. PDF öffnen
start reports/daily-report-2025-01-15.pdf
```

Visuell prüfen:
- ✅ Übersichts-Tabelle zeigt alle User
- ✅ Score-Farbcodierung korrekt
- ✅ User-Links funktionieren
- ✅ Detail-Seiten vollständig
- ✅ Keine abgeschnittenen Texte
- ✅ Deutsche Umlaute lesbar

---

**Version:** 2.0  
**Letzte Änderung:** 2025-01-20  
**Status:** ✅ Production Ready
