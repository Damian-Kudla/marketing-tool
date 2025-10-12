# Farbkonfiguration für Overlay-Markierungen

Diese Anleitung erklärt, wie Sie die Farben der Overlay-Markierungen anpassen können.

## 📁 Dateiort

Die zentrale Farbkonfiguration befindet sich in:
```
shared/colorConfig.ts
```

## 🎨 Verfügbare Kategorien

Die Config unterstützt drei Kategorien von Bewohnern:

1. **Interessenten (Prospects)** - Neue potenzielle Kunden
2. **Bestandskunden (Existing)** - Bereits vorhandene Kunden
3. **Duplikate (Duplicates)** - Mehrfach gefundene Namen

## 🔧 Farben anpassen

### Farbformat

Alle Farben verwenden das RGBA-Format:
```typescript
'rgba(R, G, B, A)'
```

Wobei:
- **R** (Rot): 0-255
- **G** (Grün): 0-255
- **B** (Blau): 0-255
- **A** (Alpha/Transparenz): 0-1
  - `0` = vollständig durchsichtig
  - `1` = vollständig deckend
  - `0.5` = 50% transparent

### Farb-Eigenschaften pro Kategorie

Jede Kategorie hat drei Farbvarianten:

1. **`solid`** - Volldeckende Farbe für die Legende über dem Bild
2. **`background`** - Transparente Farbe für den Overlay-Hintergrund auf dem Bild
3. **`border`** - Farbe für den Rahmen um die Overlay-Boxen

### Beispiel: Interessenten von Gelb auf Orange ändern

Öffnen Sie `shared/colorConfig.ts` und ändern Sie:

```typescript
prospects: {
  solid: 'rgba(251, 146, 60, 1)',      // Orange statt Gelb
  background: 'rgba(251, 146, 60, 0.5)', // 50% transparent
  border: 'rgba(251, 146, 60, 0.8)',     // 80% deckend
},
```

### Beispiel: Bestandskunden von Rot auf Grün ändern

```typescript
existing: {
  solid: 'rgba(34, 197, 94, 1)',       // Grün statt Rot
  background: 'rgba(34, 197, 94, 0.5)', // 50% transparent
  border: 'rgba(34, 197, 94, 0.8)',     // 80% deckend
},
```

## 🎯 Wo werden die Farben verwendet?

Die Farben aus der Config werden automatisch angewendet auf:

1. ✅ **Legende über dem Bild** - Die farbigen Punkte neben den Kategorienamen
2. ✅ **Overlay-Boxen auf dem Bild** - Hintergrundfarbe der Textfelder
3. ✅ **Rahmen der Overlay-Boxen** - Border um die Textfelder

## 🔄 Änderungen aktivieren

Nach dem Bearbeiten der `colorConfig.ts`:

1. **Entwicklungsmodus**: Die Änderungen werden automatisch durch Hot-Reload übernommen
2. **Produktionsmodus**: Server neu starten oder neu bauen

```bash
# Entwicklung (automatischer Reload)
npm run dev

# Produktion (nach Änderungen neu bauen)
npm run build
```

## 💡 Empfohlene Transparenzwerte

Für beste Lesbarkeit empfehlen wir:

- **`solid`**: Immer `1.0` (volldeckend) für die Legende
- **`background`**: `0.3` bis `0.5` (30-50% transparent) für Overlay-Hintergrund
- **`border`**: `0.8` bis `1.0` (80-100% deckend) für guten Kontrast

## 🎨 Farbpaletten-Vorschläge

### Variante 1: Ampel-System
```typescript
prospects: { solid: 'rgba(255, 193, 7, 1)' }   // Gelb (Warnung)
existing: { solid: 'rgba(76, 175, 80, 1)' }    // Grün (OK)
duplicates: { solid: 'rgba(244, 67, 54, 1)' }  // Rot (Fehler)
```

### Variante 2: Pastellfarben
```typescript
prospects: { solid: 'rgba(255, 183, 197, 1)' }  // Rosa
existing: { solid: 'rgba(179, 229, 252, 1)' }   // Hellblau
duplicates: { solid: 'rgba(255, 224, 178, 1)' } // Pfirsich
```

### Variante 3: Kontrast (Aktuell)
```typescript
prospects: { solid: 'rgba(251, 238, 60, 1)' }   // Gelb
existing: { solid: 'rgba(239, 68, 68, 1)' }     // Rot
duplicates: { solid: 'rgba(59, 130, 246, 1)' }  // Blau
```

## 🛠️ Erweiterte Anpassungen

Wenn Sie zusätzliche Farbkategorien hinzufügen möchten, erweitern Sie das `ColorConfig` Interface in `shared/colorConfig.ts`.

## 📞 Support

Bei Fragen oder Problemen mit der Farbkonfiguration:
- Prüfen Sie die Konsole auf TypeScript-Fehler
- Stellen Sie sicher, dass alle RGBA-Werte im korrekten Format sind
- Vergessen Sie nicht, den Server neu zu starten nach Änderungen
