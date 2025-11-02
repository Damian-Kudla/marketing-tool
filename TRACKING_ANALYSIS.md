# Tracking & Admin Dashboard Analyse
**Datum:** 2. November 2025  
**Zweck:** Analyse für Außendienst-Überwachung und Effizienzprüfung

---

## 📊 Aktuell implementiertes Tracking

### 1. **GPS & Standort-Tracking** ✅
- **Live-Tracking:** Aktuelle Position aller Mitarbeiter auf Karte
- **Route-Wiedergabe:** Vollständige GPS-Route pro Tag anzeigbar
- **Distanz:** Zurückgelegte Strecke in km (automatisch berechnet)
- **Genauigkeit:** GPS-Accuracy pro Punkt gespeichert
- **Foto-Integration:** Fotos werden in Route mit Flash-Markern angezeigt

### 2. **Aktivitäts-Tracking** ✅
- **Total Actions:** Gesamtzahl aller Aktionen pro Tag
- **Action-Breakdown** (detailliert):
  - 📸 **Fotos hochgeladen** (scans)
  - 📸 **Unique Fotos** (dedupliziert nach Anwohner-Daten)
  - 👤 **Datensatz-Updates** (ocrCorrections)
    - Mit erweiterbarer Sub-Breakdown:
      - 🔄 Status geändert
      - ✏️ Bearbeitet
      - 💾 Gespeichert
      - 🗑️ Gelöscht
  - 📝 **Datensätze erstellt** (datasetCreates)
  - 📍 **GPS-Abfragen** (geocodes)
  - 🧭 **Navigationen** (navigations)
  - ➕ **Sonstige** (other)

### 3. **Status-Änderungs-Tracking** ✅
- **Status Changes:** Alle Statusänderungen (auch mehrfache pro Anwohner)
- **Final Status:** Endgültiger Status pro Anwohner (dedupliziert)
- **Conversion Rates:** Von "Interesse später" zu anderen Status
  - → Geschrieben (%)
  - → Termin vereinbart (%)
  - → Kein Interesse (%)
  - → Nicht erreicht (%)
- **Status-Typen:**
  - Interessiert / Interest Later
  - Termin vereinbart / Appointment
  - Geschrieben / Written ⭐ (Hauptziel)
  - Nicht angetroffen / Not Reached
  - Nicht interessiert / No Interest

### 4. **Zeit-Tracking** ✅
- **Session Duration:** Gesamte App-Nutzungszeit
- **Active Time:** Tatsächliche Arbeitszeit (ohne Idle)
- **Idle Time:** Inaktivitätszeit
- **Peak Time:** Zeitraum mit höchster Aktivität (z.B. "13:00-15:00")
- **Pausen:** Top 3 längste Pausen (Start, Ende, Dauer)

### 5. **Dashboard-Features** ✅
- **Live-Ansicht:** Echtzeit-Daten mit Auto-Refresh (30s)
- **Historische Ansicht:** Daten vergangener Tage
- **Sortierung:** Nach Actions, Status-Änderungen, Geschrieben
- **Route-Wiedergabe:** Animierte Route mit Foto-Markern
- **PDF-Reports:** On-the-fly Generierung für beliebiges Datum
- **Statistik-Cards:**
  - Gesamt Mitarbeiter (aktiv/inaktiv)
  - Gesamt Fotos (unique)
  - Gesamt Status-Änderungen
  - Gesamt Distanz
- **Charts:**
  - Status-Änderungen pro Mitarbeiter (Balkendiagramm)
  - Finale Status-Zuordnungen (Balkendiagramm)
  - Conversion Rates Karten

---

## ⚠️ Was fehlt aktuell

### 1. **Effizienz-Metriken**
❌ **Pro-Stunde-Metriken:**
- Geschriebene Verträge pro Stunde
- Fotos pro Stunde
- Anwohner-Kontakte pro Stunde
- Zurückgelegte Distanz pro Stunde

❌ **Durchschnitts-Zeiten:**
- Durchschnittliche Zeit pro Foto
- Durchschnittliche Zeit pro Anwohner-Kontakt
- Durchschnittliche Zeit zwischen Fotos (Effizienz-Indikator)

### 2. **Vergleichs-Metriken**
❌ **Team-Durchschnitte:**
- Prozentuale Abweichung vom Team-Durchschnitt
- Ranking innerhalb des Teams (1., 2., 3. Platz)
- Benchmark-Anzeigen (z.B. "20% über Durchschnitt")

❌ **Historische Vergleiche:**
- Wochenvergleich (diese Woche vs. letzte Woche)
- Monatsvergleich
- Trend-Pfeile (↑ besser, ↓ schlechter)

### 3. **Qualitäts-Metriken**
❌ **Conversion-Qualität:**
- Success-Rate: Geschrieben / Total Kontakte (%)
- Rejection-Rate: Nicht interessiert / Total Kontakte (%)
- Follow-up-Rate: Interesse später / Total Kontakte (%)
- Efficiency-Score: Geschrieben pro Stunde

❌ **GPS-Qualität:**
- Durchschnittliche GPS-Genauigkeit
- Anzahl schlechter GPS-Punkte (accuracy > 50m)
- Zeitstempel-Lücken (fehlende GPS-Daten)

### 4. **Arbeitszeit-Details**
❌ **Arbeitsstart/Ende:**
- Erste Aktivität des Tages
- Letzte Aktivität des Tages
- Arbeitszeit-Dauer (Ende - Start)
- Pausen-Details (bereits vorhanden, aber nicht prominent)

❌ **Arbeitsmuster:**
- Konsistenz-Score (wie regelmäßig arbeitet der Mitarbeiter)
- Stoßzeiten-Analyse (wann am produktivsten)

### 5. **Warnungen & Alerts**
❌ **Inaktivitäts-Warnung:**
- Kein GPS-Update seit X Minuten
- Keine Actions seit X Minuten
- Ungewöhnlich lange Pause

❌ **Leistungs-Warnung:**
- Unter Team-Durchschnitt
- Null Geschrieben-Status heute
- Sehr niedriger Conversion-Rate

❌ **Technische Warnung:**
- Niedriger Akkustand (bereits getrackt, aber nicht angezeigt)
- Offline-Events (bereits getrackt, aber nicht angezeigt)
- GPS-Genauigkeit-Probleme

### 6. **Geo-Analytics**
❌ **Gebiets-Analyse:**
- Welche Stadtteile/PLZ wurden besucht
- Heatmap der Aktivitäten
- Überlappung mit anderen Mitarbeitern (Doppelarbeit)

❌ **Routing-Effizienz:**
- Zurückgelegte Distanz vs. Luftlinie
- Routing-Effizienz-Score (wie direkt war die Route)
- Unnötige Umwege-Erkennung

### 7. **Mobile-spezifische Daten**
❌ **Device-Status (bereits getrackt, nicht angezeigt):**
- Batterie-Level über den Tag
- Charging-Events
- Connection-Type (WiFi/4G/5G)
- Memory-Usage

### 8. **Ziel-Tracking**
❌ **Tages-Ziele:**
- Ziel: X Geschrieben-Status pro Tag
- Fortschritt-Anzeige (z.B. "5 von 10 erreicht")
- Ziel-Projektion ("Bei aktueller Rate: 7 bis 17 Uhr")

❌ **Wochen-Ziele:**
- Wöchentliche Summen
- Ziel-Erreichung (%)

---

## 💡 Empfohlene Prioritäten

### **🔴 KRITISCH (sofort implementieren):**

1. **Effizienz-Score Dashboard-Card**
   - Geschrieben pro Stunde
   - Prozentuale Abweichung vom Team-Durchschnitt
   - Farbcodierung (Grün/Gelb/Rot)

2. **Team-Ranking Tabelle**
   - Platzierung nach Geschrieben-Status
   - Delta zum Durchschnitt
   - Trend-Pfeile (↑↓)

3. **Arbeitszeit-Übersicht**
   - Start/Ende-Zeiten prominent anzeigen
   - Arbeitsdauer berechnen
   - Pausen-Übersicht verbessern

4. **Success-Rate Metrik**
   - Geschrieben / Total Kontakte (%)
   - Pro Mitarbeiter anzeigen
   - Team-Durchschnitt

### **🟡 WICHTIG (mittelfristig):**

5. **Wochenvergleich-View**
   - Diese Woche vs. letzte Woche
   - Trend-Charts
   - Performance-Entwicklung

6. **Inaktivitäts-Alerts**
   - Live-Warning bei langer Inaktivität
   - Farbliche Markierung inaktiver Mitarbeiter

7. **Gebiets-Heatmap**
   - Welche PLZ wurden bearbeitet
   - Aktivitäts-Konzentration

### **🟢 NICE-TO-HAVE (langfristig):**

8. **Tages-Ziele mit Projektion**
9. **Routing-Effizienz-Analyse**
10. **Device-Status-Anzeige**

---

## 📋 Zusammenfassung

**Stärken des aktuellen Systems:**
- ✅ Umfangreiches Tracking aller Aktivitäten
- ✅ Detaillierte GPS-Route-Wiedergabe
- ✅ Status-Conversion-Tracking
- ✅ Live & historische Daten verfügbar
- ✅ PDF-Reports on-the-fly

**Hauptlücken:**
- ❌ Keine Effizienz-Metriken (pro Stunde)
- ❌ Kein Team-Vergleich/Ranking
- ❌ Keine Arbeitszeit-Übersicht (Start/Ende)
- ❌ Keine Ziel-Tracking-Funktion
- ❌ Keine Inaktivitäts-Warnungen

**Empfehlung:**
Fokus auf **Effizienz-Metriken** und **Team-Vergleiche**, da diese dem Leiter die wichtigsten Informationen liefern, um:
1. Schnell zu erkennen, wer arbeitet und wer nicht
2. Zu sehen, wer am effizientesten ist
3. Schwache Performer zu identifizieren
4. Objektive Vergleiche zu ermöglichen

---

## 🎯 Nächste Schritte

Soll ich folgende Features implementieren?

1. **Effizienz-Dashboard-Card** (Geschrieben/Stunde, Team-Ranking)
2. **Arbeitszeit-Übersicht** (Start/Ende, Dauer)
3. **Success-Rate Metrik** (Conversion-Rate pro Mitarbeiter)
4. **Team-Vergleichs-View** (Ranking, Durchschnitt, Delta)

Diese 4 Features würden dem Leiter die wichtigsten KPIs liefern, um die Mitarbeiter-Performance zu bewerten.
