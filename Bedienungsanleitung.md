# 📱 EnergyScan Capture - Benutzerhandbuch

**Marketing Tool für Energieversorger**  
Version 1.0 | Oktober 2025

---

## 📋 Inhaltsverzeichnis

1. [Was ist EnergyScan Capture?](#was-ist-energyscan-capture)
2. [Installation (iPhone/Android)](#installation)
3. [Erste Schritte](#erste-schritte)
4. [Workflow: Haustür-Marketing](#workflow)
5. [Funktionen im Detail](#funktionen)
6. [Tipps & Best Practices](#tipps)
7. [Häufige Probleme](#probleme)
8. [Support](#support)

---

## 🎯 Was ist EnergyScan Capture?

EnergyScan Capture ist eine **Progressive Web App (PWA)** für effizientes Haustür-Marketing. Die App ermöglicht:

- 📸 **Foto von Klingelschildern** aufnehmen
- 🤖 **Automatische Texterkennung (OCR)** aller Namen
- 📊 **Intelligente Kategorisierung**:
  - 🟡 **Interessenten** (Neue potenzielle Kunden)
  - 🔴 **Bestandskunden** (Bereits in Kundenliste)
  - 🔵 **Duplikate** (Mehrfach vorhandene Namen)
- 📍 **GPS-Standort automatisch erfassen**
- 💾 **Cloud-Speicherung** aller Daten
- 📱 **Offline-fähig** (funktioniert ohne Internet)

---

## 📲 Installation

### iPhone (iOS):

1. **Safari öffnen**
2. URL eingeben: `https://your-app.up.railway.app`
3. **Teilen-Button** tippen (Viereck mit Pfeil nach oben)
4. Nach unten scrollen → **"Zum Home-Bildschirm"**
5. **"Hinzufügen"** bestätigen
6. ✅ App-Icon erscheint auf dem Homescreen

### Android:

1. **Chrome öffnen**
2. URL eingeben: `https://your-app.up.railway.app`
3. **Menü** (⋮) → **"App installieren"**
4. **"Installieren"** bestätigen
5. ✅ App-Icon erscheint auf dem Homescreen

### Desktop (Optional):

- Chrome/Edge: URL öffnen → Adressleiste → **"App installieren"** Icon
- Funktioniert auch im Browser ohne Installation

---

## 🚀 Erste Schritte

### 1. Login

```
Benutzername: [Ihr Benutzername]
Passwort: [Ihr Passwort]
```

- Login-Daten werden **sicher gespeichert**
- Beim nächsten Öffnen **automatisch eingeloggt**

### 2. GPS-Position erfassen

Nach dem Login erscheint das **GPS-Formular**:

```
┌─────────────────────────────────────┐
│  📍 Standort automatisch ermitteln  │
│                                     │
│  Oder manuell eingeben:             │
│  ┌───────────────────────────────┐  │
│  │ Straße                        │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Hausnummer                    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ PLZ                           │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Ort                           │  │
│  └───────────────────────────────┘  │
│                                     │
│         [ Weiter ]                  │
└─────────────────────────────────────┘
```

**Optionen**:
- ✅ **Empfohlen**: "Standort automatisch ermitteln" → GPS nutzt aktuelle Position
- 📝 **Manuell**: Adresse selbst eingeben

### 3. Foto aufnehmen

Nach GPS-Erfassung öffnet sich die **Kamera**:

```
┌─────────────────────────────────────┐
│         [ 📷 Kamera ]               │
│         [ 🖼️ Galerie ]              │
└─────────────────────────────────────┘
```

**Tipps für gute Fotos**:
- ✅ Klingelschild **komplett im Bild**
- ✅ **Gute Beleuchtung** (Blitz bei Bedarf)
- ✅ **Frontal fotografieren** (nicht schräg)
- ✅ **Scharf stellen** (Namen lesbar)
- ❌ Keine Spiegelungen/Reflexionen

---

## 🔄 Workflow: Haustür-Marketing

### Schritt-für-Schritt:

```
1. APP ÖFFNEN
   ↓
2. GPS-POSITION ERFASSEN
   "Standort ermitteln" klicken
   ↓
3. FOTO AUFNEHMEN
   Klingelschild fotografieren
   ↓
4. WARTEN (ca. 3-5 Sekunden)
   OCR erkennt automatisch Namen
   ↓
5. NAMEN ÜBERPRÜFEN & BEARBEITEN
   - Namen korrigieren wenn nötig
   - Status ändern (Interessent/Bestandskunde)
   - Neue Namen hinzufügen
   ↓
6. DATENSATZ ERSTELLEN
   "Datensatz erstellen" klicken
   ↓
7. FERTIG! ✅
   Daten sind in der Cloud gespeichert
```

---

## 🎨 Funktionen im Detail

### 📸 Foto mit Overlays

Nach der OCR-Erkennung erscheint das Foto mit **farbigen Markierungen**:

```
┌─────────────────────────────────────┐
│  🟡 Interessenten  🔴 Bestandskunden │
│  🔵 Duplikate                       │
│                                     │
│  📷 [Foto mit Namen-Overlays]       │
│                                     │
│     🟡 Max Müller                   │
│     🔴 Anna Schmidt                 │
│     🟡 Peter Klein                  │
│     🔵 Anna Schmidt                 │
│                                     │
└─────────────────────────────────────┘
```

**Farb-Legende**:
- 🟡 **Gelb** = Interessent (potentieller Neukunde)
- 🔴 **Rot** = Bestandskunde (bereits in Kundenliste)
- 🔵 **Blau** = Duplikat (Name kommt mehrfach vor)

### ✏️ Namen bearbeiten

**Auf einen Namen klicken** → Bearbeitungs-Dialog öffnet sich:

```
┌─────────────────────────────────────┐
│  Anwohner bearbeiten                │
│                                     │
│  Name:                              │
│  ┌───────────────────────────────┐  │
│  │ Max Müller                    │  │
│  └───────────────────────────────┘  │
│                                     │
│  Status:                            │
│  ○ Interessent                      │
│  ○ Bestandskunde                    │
│                                     │
│  [ Löschen ] [ Abbrechen ] [ OK ]   │
└─────────────────────────────────────┘
```

**Aktionen**:
- ✏️ **Name ändern**: Tippfehler korrigieren
- 🔄 **Status ändern**: Interessent ↔ Bestandskunde
- 🗑️ **Löschen**: Falscher Name entfernen

### ➕ Neuen Namen hinzufügen

Rechts unten: **"+ Anwohner hinzufügen"** Button

```
1. Button klicken
2. Namen eingeben
3. Status wählen
4. "Speichern" klicken
```

### 📝 Bearbeitbare Namen-Liste

Unter dem Foto erscheint eine **scrollbare Liste**:

```
┌─────────────────────────────────────┐
│  Erkannte Namen (bearbeitbar)       │
│  ┌───────────────────────────────┐  │
│  │ ✏️ Max Müller                 │  │
│  │ ✏️ Anna Schmidt               │  │
│  │ ✏️ Peter Klein                │  │
│  │ ✏️ Anna Schmidt               │  │
│  └───────────────────────────────┘  │
│                                     │
│  [ + Anwohner hinzufügen ]          │
│                                     │
│  [ Datensatz erstellen ]            │
└─────────────────────────────────────┘
```

**Funktion**:
- ✏️ Icon → Namen bearbeiten
- Scrollen → Alle Namen ansehen
- Status wird farblich angezeigt

### 💾 Datensatz erstellen

**"Datensatz erstellen"** klicken:

```
✅ Erfolgsmeldung:
"Datensatz erstellt
Die Daten wurden erfolgreich gespeichert"
```

**Was passiert?**:
1. ✅ Namen werden in Google Sheets gespeichert
2. ✅ Foto wird hochgeladen
3. ✅ GPS-Position wird gespeichert
4. ✅ Zeitstempel wird erfasst
5. ✅ Datensatz erhält eindeutige ID

### 🔄 Alte Datensätze laden

Nach dem Erstellen erscheint: **"📂 Alte Datensätze vorhanden"**

```
Klicken → Liste alter Datensätze:

┌─────────────────────────────────────┐
│  Gespeicherte Datensätze            │
│  ┌───────────────────────────────┐  │
│  │ 📍 Hauptstraße 15, 12345      │  │
│  │    13.10.2025, 14:30          │  │
│  │    [ Laden ]                  │  │
│  ├───────────────────────────────┤  │
│  │ 📍 Musterweg 42, 67890        │  │
│  │    12.10.2025, 10:15          │  │
│  │    [ Laden ]                  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Funktion**:
- Alte Datensätze **ansehen**
- Alte Datensätze **bearbeiten** (falls nötig)
- Zwischen Datensätzen **wechseln**

### 🔄 Zurücksetzen

**"Zurücksetzen"** Button (oben rechts):

```
Funktion:
✅ Foto entfernen
✅ GPS-Position zurücksetzen
✅ Namen-Liste leeren
✅ Zurück zum GPS-Formular
```

**Wann nutzen?**:
- Neues Gebäude besuchen
- Von vorne starten
- Aktuelles Foto verwerfen

---

## 💡 Tipps & Best Practices

### 📸 Foto-Qualität

**✅ DO**:
- Klingelschild komplett im Bild
- Frontal fotografieren
- Gute Beleuchtung nutzen
- Blitz bei Dunkelheit
- Scharf stellen

**❌ DON'T**:
- Schräge Winkel
- Zu weit weg
- Spiegelungen
- Verwackelt
- Namen unleserlich

### 🎯 Namen-Erfassung

**✅ DO**:
- Alle Namen überprüfen
- Tippfehler korrigieren
- Duplikate markieren
- Fehlende Namen hinzufügen

**❌ DON'T**:
- Blind auf OCR verlassen
- Falsche Namen speichern
- Duplikate ignorieren

### 📍 GPS-Position

**✅ DO**:
- "Standort ermitteln" nutzen (schneller)
- GPS-Berechtigung erlauben
- Draußen für besseres Signal

**❌ DON'T**:
- Manuelle Eingabe bei gutem GPS
- Falsche Adresse eingeben
- GPS-Berechtigung verweigern

### 💾 Datensatz-Speicherung

**✅ DO**:
- Sofort nach Foto-Check speichern
- "Datensatz erstellen" nicht vergessen
- Internet-Verbindung prüfen

**❌ DON'T**:
- Ungeprüft speichern
- Zu lange warten
- Offline ohne später zu syncen

---

## 🔧 Häufige Probleme & Lösungen

### ❌ Problem: OCR erkennt Namen nicht richtig

**Lösung**:
1. ✏️ Falsche Namen **manuell korrigieren**
2. ➕ Fehlende Namen **hinzufügen**
3. 🗑️ Falsche Namen **löschen**

### ❌ Problem: GPS funktioniert nicht

**Mögliche Ursachen**:
- ❌ GPS-Berechtigung verweigert
- ❌ Schlechtes GPS-Signal (in Gebäuden)
- ❌ Standortdienste deaktiviert

**Lösung**:
1. **iOS**: Einstellungen → Safari → Standort → "Beim Verwenden erlauben"
2. **Android**: Einstellungen → Apps → Chrome → Berechtigungen → Standort
3. **Alternative**: Adresse manuell eingeben

### ❌ Problem: App lädt nicht / weiße Seite

**Lösung**:
1. **Internet-Verbindung prüfen**
2. **App neu laden**: Browser schließen → App neu öffnen
3. **Cache leeren**: 
   - iOS: Einstellungen → Safari → Verlauf löschen
   - Android: Chrome → Einstellungen → Datenschutz → Browserdaten löschen
4. **App neu installieren** (vom Homescreen löschen → neu installieren)

### ❌ Problem: Login funktioniert nicht

**Lösung**:
1. **Benutzername/Passwort prüfen** (Groß-/Kleinschreibung!)
2. **Internet-Verbindung prüfen**
3. **Support kontaktieren** (siehe unten)

### ❌ Problem: Foto wird nicht hochgeladen

**Ursache**: Keine Internet-Verbindung beim Speichern

**Lösung**:
1. **WLAN/Mobile Daten aktivieren**
2. **"Datensatz erstellen" nochmal klicken**
3. App speichert automatisch wenn wieder online

### ❌ Problem: App ist langsam

**Lösung**:
1. **Andere Apps schließen** (RAM freigeben)
2. **Handy neustarten**
3. **App neu installieren** (Cache wird gelöscht)
4. **Alte Datensätze löschen** (falls viele gespeichert)

### ❌ Problem: Update nicht installiert

**Lösung**:
1. **Automatisches Update abwarten** (30 Sekunden)
2. **"Jetzt aktualisieren"** klicken wenn Benachrichtigung erscheint
3. **Manuell**: App schließen → Browser-Cache leeren → App neu öffnen

---

## 📞 Support

### 🆘 Technische Probleme

**E-Mail**: support@daku-trading.de  
**Telefon**: +49 (0) XXX XXXXXXX  
**Erreichbarkeit**: Mo-Fr, 9:00-17:00 Uhr

### 📚 Weitere Ressourcen

- **Video-Tutorial**: [Link zum Tutorial]
- **FAQ**: [Link zur FAQ-Seite]
- **Changelog**: [Link zu Updates]

### 🐛 Bug melden

Bei Fehlern bitte folgende Infos angeben:

```
- Welches Gerät? (iPhone/Android/Desktop)
- Welcher Browser? (Safari/Chrome/Firefox)
- Was hast du gemacht?
- Was ist passiert?
- Fehlermeldung? (Screenshot hilfreich!)
```

---

## 🔄 Updates

Die App **aktualisiert sich automatisch**!

**Was passiert bei Updates?**:
1. ⏰ Alle 30 Sekunden: App prüft auf Updates
2. 🔔 Benachrichtigung erscheint: "Neue Version verfügbar"
3. 🔄 "Jetzt aktualisieren" klicken
4. ✅ App lädt neu mit neuer Version

**Kein manueller Download nötig!** 🎉

---

## 📊 Datenschutz & Sicherheit

### 🔒 Was wird gespeichert?

- ✅ GPS-Position (Straße, Hausnummer, PLZ, Ort)
- ✅ Namen von Klingelschildern
- ✅ Fotos der Klingelschilder
- ✅ Zeitstempel
- ✅ Benutzer-ID (anonymisiert)

### 🛡️ Wie werden Daten geschützt?

- ✅ **HTTPS-Verschlüsselung** (Ende-zu-Ende)
- ✅ **Google Cloud Speicherung** (DSGVO-konform)
- ✅ **Passwort-geschützt** (nur autorisierte Mitarbeiter)
- ✅ **Keine Weitergabe** an Dritte

### 🗑️ Datenlöschung

- Daten können jederzeit gelöscht werden
- Anfrage an: datenschutz@daku-trading.de

---

## ✅ Checkliste für neue Mitarbeiter

Vor dem ersten Einsatz:

- [ ] App installiert (iPhone/Android)
- [ ] Login-Daten erhalten
- [ ] Erfolgreich eingeloggt
- [ ] GPS-Berechtigung erteilt
- [ ] Kamera-Berechtigung erteilt
- [ ] Test-Foto gemacht
- [ ] Test-Datensatz erstellt
- [ ] Handbuch gelesen
- [ ] Bei Fragen: Support kontaktiert

**Viel Erfolg! 🚀**

---

*EnergyScan Capture v1.0*  
*© 2025 DAKU Trading GmbH*  
*Alle Rechte vorbehalten*