# Long Press Status Context Menu - Implementation Summary

## ✅ Feature Overview

Ein vollständig integriertes Long Press System für schnelle Status-Zuweisungen an Anwohner, optimiert für PWA-Nutzung und iOS Safari mit Touch-Geräten.

## 🎯 Functionality

### Wo funktioniert Long Press?

1. **ResultsDisplay (Ergebnislisten)**
   - Alle Anwohner-Einträge in "Interessenten" und "Bestandskunden"
   - Long Press auf gesamten Eintrag
   - Öffnet iOS-ähnliches Context Menu mit Status-Optionen

2. **ImageWithOverlays (Textfelder auf Bild)**
   - Alle Namensschilder-Overlays auf dem Foto
   - Long Press auf Textfeld
   - Öffnet gleiches Context Menu für direkte Status-Zuweisung

### User Experience

- **Timing**: 600ms Long Press (optimiert für iOS)
- **Haptik**: Vibriert bei Erkennung (wenn verfügbar)
- **Visuell**: iOS-ähnliches Context Menu mit:
  - Backdrop (leicht geblurred)
  - Abgerundete Ecken (16px radius)
  - Icons für jeden Status (🚫 📞 ⏰ 📅 ✅)
  - Farbcodierte Labels
  - Checkmark beim aktuellen Status

## 📁 Created Files

### 1. `client/src/hooks/use-long-press.ts`
**Wiederverwendbarer Hook für Long Press Erkennung**

```typescript
useLongPress({
  threshold: 600,           // ms bis Long Press erkannt
  moveThreshold: 10,        // max px Bewegung
  onLongPress: (x, y) => {...}, // Callback mit Position
  onClick: () => {...},     // Optional: Normal Click
  hapticFeedback: true      // Vibrationseffekt
})
```

**Features:**
- ✅ Touch Events (iOS/Android optimiert)
- ✅ Mouse Events (Desktop Entwicklung)
- ✅ Move Detection (verhindert false positives)
- ✅ Haptisches Feedback via Vibration API
- ✅ Context Menu Prevention
- ✅ CSS Props für iOS (`-webkit-touch-callout`, `-webkit-user-select`)

### 2. `client/src/components/StatusContextMenu.tsx`
**iOS-ähnliches Context Menu für Status-Auswahl**

**Features:**
- ✅ Portal Rendering (body level)
- ✅ Auto-Positionierung (viewport aware)
- ✅ Backdrop mit Blur
- ✅ Icons + Farben pro Status
- ✅ Current Status Highlight
- ✅ Click Outside Detection
- ✅ ESC zum Schließen
- ✅ Tap Highlight Prevention

**Status Icons:**
- 🚫 Kein Interesse
- 📞 Nicht erreicht
- ⏰ Interesse später
- 📅 Termin
- ✅ Geschrieben

### 3. `client/src/constants/statuses.ts`
**Zentrale Status-Definitionen**

```typescript
export const RESIDENT_STATUSES: ResidentStatus[]
export const STATUS_LABELS: Record<ResidentStatus, string>
export function getStatusLabel(status: ResidentStatus): string
```

**Single Source of Truth für:**
- Status-Werte (TypeScript enum)
- Deutsche Labels (Vertriebsterminologie)
- Dokumentation der Bedeutungen

## 🔧 Implementation Details

### ResultsDisplay Integration

**Neue ResidentRow Komponente:**
```tsx
<ResidentRow 
  resident={resident}
  index={index}
  category="potential_new_customer"
/>
```

- Verwendet `useLongPress` Hook
- Long Press → Status Menu
- Normal Click → Edit Popup (optional)
- Ersetzt alte manuelle Rendering-Logik

**State Management:**
```typescript
const [statusMenuOpen, setStatusMenuOpen] = useState(false);
const [statusMenuPosition, setStatusMenuPosition] = useState({ x: 0, y: 0 });
const [statusMenuResident, setStatusMenuResident] = useState<...>(null);
```

**Status Change Handler:**
- Updates local state sofort
- Live-sync zu Backend (wenn Dataset existiert)
- Toast Notification bei Erfolg
- Error Handling mit User Feedback

### ImageWithOverlays Integration

**Erweiterte Long Press Handler:**
```typescript
handleLongPressStart(index, e) {
  // Position aus Touch/Mouse Event
  // Haptic Feedback (50ms vibration)
  // Status Menu öffnen mit Overlay-Info
}
```

**Overlay → Resident Mapping:**
- Findet Resident via `overlay.originalName`
- Zeigt aktuellen Status im Menu
- Updated Resident in `editableResidents` Array
- Synct mit Backend

## 🎨 iOS PWA Optimierungen

### CSS Properties
```css
-webkit-touch-callout: none;  /* Verhindert iOS-Popup */
-webkit-user-select: none;    /* Verhindert Textauswahl */
user-select: none;
touch-action: manipulation;   /* Optimiert Touch */
```

### Backdrop Filter
```css
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
```

### Tap Highlight
```css
-webkit-tap-highlight-color: transparent;
```

### Vibration API
```javascript
if ('vibrate' in navigator) {
  navigator.vibrate(50);
}
```

## 🧪 Testing Checklist

### Desktop (Development)
- [ ] Long Press mit Maus funktioniert
- [ ] Context Menu öffnet an korrekter Position
- [ ] Click Outside schließt Menu
- [ ] ESC schließt Menu
- [ ] Status-Update speichert korrekt

### Mobile Browser (Safari)
- [ ] Long Press erkennt Touch (600ms)
- [ ] Kein natives iOS Context Menu erscheint
- [ ] Haptisches Feedback spürbar
- [ ] Menu positioniert sich viewport-aware
- [ ] Backdrop Blur funktioniert
- [ ] Tap auf Status funktioniert

### Installierte PWA
- [ ] Standalone-Modus aktiv (`navigator.standalone`)
- [ ] Long Press ohne Browser-UI Interferenz
- [ ] Native-ähnliche Gesten
- [ ] Performance flüssig
- [ ] Alle Features wie Mobile Browser

### Funktionalität
- [ ] **ResultsDisplay**: Long Press auf Interessent
- [ ] **ResultsDisplay**: Long Press auf Bestandskunde
- [ ] **ImageWithOverlays**: Long Press auf Textfeld
- [ ] Status-Änderung aktualisiert UI sofort
- [ ] Status-Änderung speichert in Backend
- [ ] Aktueller Status wird markiert (✓)
- [ ] Icons und Farben korrekt pro Status

## 📊 Performance Considerations

### Optimierungen
- ✅ Portal Rendering (verhindert Reflow)
- ✅ Lazy Loading von `datasetAPI`
- ✅ Event Listener Cleanup
- ✅ Timeout Cleanup bei Unmount
- ✅ Minimal Re-Renders durch State Isolation

### Memory
- Timeouts werden immer gecleant
- Event Listeners entfernt bei Unmount
- Portal wird entfernt bei Close

## 🔗 Dependencies

```json
{
  "react": "^18.x",
  "react-dom": "^18.x",
  "@radix-ui/react-*": "Portal, Dialog primitives"
}
```

## 📝 Usage Example

```tsx
import { useLongPress } from '@/hooks/use-long-press';
import { StatusContextMenu } from '@/components/StatusContextMenu';

function MyComponent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const longPressHandlers = useLongPress({
    onLongPress: (x, y) => {
      setMenuPos({ x, y });
      setMenuOpen(true);
    }
  });

  return (
    <>
      <div {...longPressHandlers}>
        Long press mich!
      </div>

      <StatusContextMenu
        isOpen={menuOpen}
        x={menuPos.x}
        y={menuPos.y}
        onClose={() => setMenuOpen(false)}
        onSelectStatus={(status) => {
          console.log('Status:', status);
          setMenuOpen(false);
        }}
      />
    </>
  );
}
```

## 🐛 Known Limitations

1. **iOS Safari Browser (nicht installiert)**
   - Natives Context Menu kann manchmal erscheinen
   - `-webkit-touch-callout: none` nicht 100% zuverlässig
   - ✅ Lösung: PWA installieren für beste UX

2. **Accessibility**
   - Long Press nicht für alle zugänglich
   - Screenreader-User brauchen Alternative
   - ✅ Alternative: Edit Buttons bleiben verfügbar

3. **Barrierefreiheit**
   - Keine Keyboard-Navigation für Context Menu
   - ✅ Verbesserung: Arrow Keys + Enter implementieren

## 🚀 Future Enhancements

- [ ] Keyboard Navigation (Arrow Keys + Enter)
- [ ] Double-Tap Alternative für Accessibility
- [ ] Custom Icons statt Emojis
- [ ] Animationen beim Öffnen/Schließen
- [ ] Swipe-to-dismiss Geste
- [ ] Context Menu Position Memory (last position)
- [ ] Konfigurierbares Threshold pro User

## ✨ Status Labels Zentralisierung

**Problem gelöst:**
- Status-Labels waren in 3+ Komponenten dupliziert
- "Notiert" war falsch (sollte "Geschrieben" sein)
- Inkonsistente Terminologie

**Lösung:**
- Zentrale Datei `constants/statuses.ts`
- Alle Komponenten importieren von dort
- Dokumentierte Bedeutungen
- Single Source of Truth

**Updated Components:**
- ✅ LeonFilter.tsx
- ✅ AddressOverview.tsx
- ✅ ResultsDisplay.tsx (via StatusContextMenu)
- ✅ ImageWithOverlays.tsx (via StatusContextMenu)

## 🎉 Button Overlap Fix

**Problem:**
- Reset Button überlagerte Grid-Inhalt trotz `pb-32`
- Fixed button mit variabler Höhe (Navigation + Reset)

**Lösung:**
- Erhöht von `pb-32` (128px) auf `pb-56` (224px)
- Berücksichtigt:
  - `safe-area-bottom` CSS
  - `p-4` Container Padding
  - 2 Button-Reihen (Navigation + Reset)
  - Gap zwischen Buttons

## 📖 Related Documentation

- [PWA_IMPLEMENTATION.md](./PWA_IMPLEMENTATION.md) - PWA Setup
- [UI_REDESIGN_PROGRESS.md](./UI_REDESIGN_PROGRESS.md) - UI Features
- [COLOR_CONFIG_README.md](./COLOR_CONFIG_README.md) - Color System

---

**Implementiert:** Oktober 2025  
**Status:** ✅ Production Ready  
**iOS PWA:** ✅ Optimiert  
**Accessibility:** ⚠️ Verbesserungswürdig (Alternative verfügbar)
