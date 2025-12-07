Ich beschreibe im folgenden zuerst das Projekt, in welchem ich dich um Unterstützung bitte und danach beschreibe ich die Hilfe um die ich dich bitten würde.
## Projekt: EnergyScanCapture – Effizienztool für Außendienstmitarbeiter eines Stromanbieters

### Ziel der App
**Zeit sparen. Weniger Fehlkontakte. Mehr Abschlüsse.**  
Die App hilft Vertrieblern im Außendienst, **unnötige Klingelaktionen bei Bestandskunden zu vermeiden**, indem sie **automatisch erkennt**, wer bereits Kunde ist – **bevor** der Mitarbeiter klingelt.

---

### Kern-Workflow (Mitarbeiter-Seite)
1. **"Standort ermitteln"** → GPS wird erfasst (nur Deutschland)
2. **Foto vom Klingelschild hochladen**
3. **KI-gestützte Texterkennung (OCR)** → extrahiert Namen
4. **Abgleich mit Kundendatenbank**
5. **Ergebnis auf Foto überlagert**:
   - **Grün** = Bestandskunde → **nicht klingeln**
   - **Orange** = potenzieller Neukunde → **klingeln**
   - **Blau** = Duplikat / unsicher
6. **Nur bei echten Leads wird geklingelt** → **höhere Trefferquote, weniger Zeitverschwendung**

---

### Admin-Panel (Dashboard)
Administratoren überwachen alle Mitarbeiter in Echtzeit:

| Funktion | Beschreibung |
|--------|-------------|
| **Live-Karte** | Alle aktiven Mitarbeiter als Marker |
| **"Route"-Button** | Öffnet **Fullscreen-Popup** mit **animierter Streckenwiedergabe** |
| **Timeline-Scrubber** | Zeitstrahl zum Vor-/Zurückspulen |
| **Animationsgeschwindigkeit** | `secondsPerHour` → z. B. `6` = 1 Stunde GPS in 6 Sekunden |
| **Intelligenter Zoom** | Karte folgt dem Mitarbeiter, passt Zoom automatisch an |

---

### Technische Basis
- **Frontend**: React + TypeScript, Tailwind CSS
- **Backend**: Node.js + Express
- **Karten**: **Google Maps JavaScript API** (Admin-Route), Leaflet (Live-Übersicht)
- **Daten**: GPS-Logs, Fotos, OCR-Ergebnisse, Kundendaten
- **Auth**: JWT, Rollen: `user`, `admin`

---

### Wichtige Dateien
| Pfad | Zweck |
|------|------|
| `client/src/components/RouteReplayMap.tsx` | Animierte Route im Admin-Popup (Google Maps) |
| `client/src/components/GPSAddressForm.tsx` | Standort + Adresserkennung |
| `client/src/components/ImageWithOverlays.tsx` | Foto-Overlay Logik (Touch-Optimiert, Fusion, Drag&Drop) |
| `server/routes/admin.ts` | Admin-Endpunkte (Route, Stats) |
| `shared/trackingTypes.ts` | GPSPoint-Interface |

### Aktuelle Features & Fixes (Stand v2.8.13)
- **Touch-Optimierung (iOS/Mobile)**:
  - **Drag & Drop**: Textfelder erscheinen beim Ziehen **80px über dem Finger**, damit sie sichtbar bleiben.
  - **Visuelles Feedback**: Elemente skalieren auf **1.3x (Halten)** und **1.5x (Ziehen)** mit Schatten.
  - **Scroll-Schutz**: Scrollen wird während Drag & Drop zuverlässig deaktiviert (`touch-action: none`, `preventDefault`).
  - **Context Menu**: System-Menü (Kopieren/Teilen) wird unterdrückt oder stark verzögert (2s).
- **Overlay-Logik**:
  - **Fusion**: Drag & Drop von Textfeldern aufeinander fusioniert diese (z.B. Vor- und Nachname).
  - **Persistenz**: Bearbeitete Textfelder behalten ihren Status auch nach Neuladen/Reset.
  - **Smart Colors**: Automatische Farbcodierung (Grün/Orange/Blau) basierend auf Kundenstatus.
- **Netzwerk & Stabilität**:
  - **Local Network**: Fix für White Screen auf iOS im lokalen Netzwerk (GPS Error Handling).
  - **Data Safety**: Robuste Speicherung von Datensätzen und Fotos.


Nun zu meinen gewünschten Änderungen für die ich dich um Hilfe bitte: