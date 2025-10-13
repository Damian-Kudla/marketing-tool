# UI Redesign Progress - Grid/List View Toggle

## Übersicht

Implementierung eines umfassenden UI-Redesigns mit:
- Einklappbare Listen (Accordion)
- Kachel/Listenansicht Toggle
- Maximierbare Panels
- Optimiertes Scroll-Verhalten

## Abgeschlossene Schritte

### ✅ Schritt 1: ViewModeContext erstellt
**Datei**: `client/src/contexts/ViewModeContext.tsx`

Globaler State für:
- `viewMode`: 'list' | 'grid'
- `maximizedPanel`: 'location' | 'photo' | 'overlays' | 'results' | null
- `toggleMaximize(panel)`: Toggle zwischen normal und maximiert

```typescript
const { viewMode, setViewMode, maximizedPanel, toggleMaximize } = useViewMode();
```

### ✅ Schritt 2: Provider Integration
**Datei**: `client/src/App.tsx`

Provider-Hierarchie:
```
QueryClient → I18next → Auth → ViewMode → Tooltip → Router
```

### ✅ Schritt 3: View-Mode Toggle im UserButton
**Datei**: `client/src/components/UserButton.tsx`

Neuer Menüpunkt im User-Dropdown:
- Icon: `LayoutGrid` (für Grid-Ansicht) vs `List` (für Listen-Ansicht)
- Text: "Kachelansicht" vs "Listenansicht"
- Click: Toggle zwischen Modi

### ✅ Schritt 4: Einklappbare Listen (Accordion)
**Datei**: `client/src/components/ResultsDisplay.tsx`

Alle Listen sind jetzt einklappbar:
- **Alle Kunden an dieser Adresse** (allCustomers)
- **Duplikate** (duplicates)
- **Interessenten** (prospects)
- **Bestandskunden** (existing)

Standard: Alle Listen sind aufgeklappt (`defaultValue={["allCustomers", "duplicates", "prospects", "existing"]}`)

Klick auf Listenname: Toggle Expand/Collapse

## Nächste Schritte

### ⏳ Schritt 5: Grid Layout implementieren
**Datei**: `client/src/pages/scanner.tsx`

Implementierung:
```tsx
const { viewMode } = useViewMode();

return viewMode === 'list' ? (
  // Aktuelle vertikale Layout
) : (
  // Neue Grid-Layout mit 2 Spalten
  <div className="grid grid-cols-2 gap-4 h-screen p-4">
    <div className="flex flex-col gap-4">
      {/* Linke Spalte: Location, PhotoCapture, ImageWithOverlays */}
    </div>
    <div>
      {/* Rechte Spalte: ResultsDisplay (volle Höhe) */}
    </div>
  </div>
);
```

### ⏳ Schritt 6: MaximizeButton Component
**Neue Datei**: `client/src/components/MaximizeButton.tsx`

Props:
- `panel`: 'location' | 'photo' | 'overlays' | 'results'
- Position: top-right jedes Panels
- Icon: `Maximize2` (normal) vs `Minimize2` (maximiert)

Integration in:
- GPSAddressForm (location)
- PhotoCapture (photo)
- ImageWithOverlays (overlays)
- ResultsDisplay (results)

### ⏳ Schritt 7: Maximized Panel Overlay
**Komponenten**: Alle Panel-Komponenten

Wenn `maximizedPanel === panelName`:
```tsx
{maximizedPanel === 'results' && (
  <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4">
    <MaximizeButton panel="results" />
    {/* Panel Content */}
  </div>
)}
```

### ⏳ Schritt 8: Scroll-Verhalten
- Touch: `touch-action: pan-y` für vertikales Scrollen
- Desktop: Scroll nur innerhalb des Panels
- Body-Scroll verhindern wenn Panel maximiert

## Testing Checklist

- [ ] View-Toggle funktioniert (Listenansicht ↔ Kachelansicht)
- [ ] Listen lassen sich ein-/ausklappen
- [ ] Alle Listen standardmäßig aufgeklappt
- [ ] Grid-Layout: 2 Spalten korrekt angezeigt
- [ ] Maximize-Button in jedem Panel sichtbar
- [ ] Panel-Maximierung funktioniert
- [ ] Scroll-Verhalten in maximierten Panels
- [ ] Responsive auf Mobile/Tablet/Desktop
- [ ] Keine Layout-Breaks

### ✅ Schritt 5: Such-gesteuerte Accordion-Logik (BONUS)
**Datei**: `client/src/components/ResultsDisplay.tsx`

Intelligente Accordion-Steuerung:
- Suche aktiv (Suchfeld gefüllt): Alle Listen automatisch aufgeklappt
- Suche inaktiv (Suchfeld leer): Listen kehren zum vorherigen Zustand zurück
- Nutzer kann Listen manuell ein-/ausklappen wenn keine Suche aktiv

```typescript
const accordionValue = searchQuery.trim() 
  ? ["allCustomers", "duplicates", "prospects", "existing"] 
  : undefined; // undefined = use internal accordion state

<Accordion value={accordionValue} defaultValue={[...]}>
```

### ✅ Schritt 6: Grid-Layout implementiert
**Datei**: `client/src/pages/scanner.tsx`

Conditional Rendering basierend auf `viewMode`:
- **List View** (Standard): Vertikales Layout, alle Komponenten untereinander
- **Grid View**: 2-Spalten Layout
  * Linke Spalte: Location, PhotoCapture, ImageWithOverlays, AddressDatasets
  * Rechte Spalte: ResultsDisplay (volle Höhe)
  * Responsive: Mobile 1 Spalte, Desktop 2 Spalten (`lg:grid-cols-2`)

MaximizeButtons in beiden Views integriert.

### ✅ Schritt 7: Maximized-Panel-Overlay
**Datei**: `client/src/pages/scanner.tsx`

Fixed Overlays für jedes Panel:
```tsx
{maximizedPanel === 'results' && (
  <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4">
    <MaximizeButton panel="results" className="fixed top-4 right-4" />
    <div className="container mx-auto max-w-4xl pt-12">
      {/* Panel Content */}
    </div>
  </div>
)}
```

Alle 4 Panels unterstützen Maximierung:
- Location (max-w-4xl)
- Photo (max-w-4xl)
- Overlays (max-w-6xl für größere Bilder)
- Results (max-w-4xl)

### ✅ Schritt 8: Scroll-Verhalten optimiert
**Implementierung**: `overflow-y-auto` auf Overlays

Features:
- Panel-Scroll: `overflow-y-auto` ermöglicht Scrollen innerhalb des Panels
- Body-Scroll verhindert: `fixed` Positioning auf Overlays
- Touch-optimiert: Native Touch-Scrolling funktioniert automatisch
- Desktop-optimiert: Mausrad scrollt innerhalb des Panels

## Status

**Build**: ✅ Erfolgreich (keine Fehler)
**Kompilierung**: ✅ Alle TypeScript-Typen korrekt
**Features**: ✅ Alle 8 Schritte implementiert
**Laufzeit**: ⏳ Bereit zum Testen

## Commit

Alle Änderungen bereit für Git:
```bash
git add .
git commit -m "feat: Add grid/list view toggle with collapsible lists and maximizable panels

- ViewModeContext: Global state for view mode and panel maximization
- Collapsible lists: Accordion for Interessenten, Bestandskunden, Duplikate
- View toggle: Switch between list and grid layouts via user menu
- Grid layout: 2-column design (left: location/photos, right: results)
- Maximize panels: Each panel can expand to fullscreen
- Scroll behavior: Optimized scrolling in maximized panels
- Result: Enhanced UX with flexible viewing options"

git push origin main
```
