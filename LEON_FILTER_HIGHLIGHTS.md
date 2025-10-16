# Leon Filter - Visuelle Hervorhebungen

## Übersicht

Die "Filter wie in Leon" Liste wurde um visuelle Hervorhebungen erweitert, um Datensätze zu markieren, die von der Norm abweichen.

## Features

### 1. Erstellungstag-Abweichung

**Problem:** Manchmal werden Datensätze an unterschiedlichen Tagen erstellt, was beim Durchsehen auffallen sollte.

**Lösung:** 
- Das System ermittelt automatisch, an welchem Tag die **meisten** Datensätze in der Liste erstellt wurden
- Datensätze, die **nicht an diesem Tag** erstellt wurden, werden visuell hervorgehoben

**Visuelle Markierung:**
- 🟡 **Auffälliger gelber Hintergrund** (`bg-amber-100` in Light Mode, `bg-amber-950/40` in Dark Mode)
- 🟡 **Dicker gelber Border (2px)** (`border-amber-400` in Light Mode, `border-amber-600` in Dark Mode)
- � **Badge mit Tag**: "📅 Anderer Tag" (gelber Hintergrund, neben dem Titel)
- ✨ **Shadow-Effekt** für zusätzliche Hervorhebung

### 2. Anderer Ersteller

**Problem:** Nutzer sollten erkennen können, welche Datensätze von anderen Nutzern erstellt wurden.

**Lösung:**
- Das System vergleicht den Ersteller jedes Datensatzes mit dem aktuell eingeloggten Nutzer
- Datensätze von **anderen Nutzern** werden visuell hervorgehoben

**Visuelle Markierung:**
- 🟡 **Auffälliger gelber Hintergrund** (gleich wie bei Erstellungstag-Abweichung)
- 🟡 **Dicker gelber Border (2px)**
- � **Badge mit Tag**: "👤 Von [Username]" (blauer Hintergrund, zeigt den Ersteller an)
- 📝 **Zusätzliche Info-Zeile**: "Erstellt von [Username]" unter dem Titel

### 3. Kombinierte Markierung

Wenn ein Datensatz **beide** Bedingungen erfüllt (anderer Tag UND anderer Nutzer):
- Die Markierungen werden kombiniert angezeigt
- **Beide Tags** erscheinen nebeneinander:
  - 📦 "� Anderer Tag" (gelb)
  - 📦 "👤 Von [Username]" (blau)
- Die visuelle Hervorhebung (Hintergrund + Border) ist identisch

## Implementierung

### Frontend (`client/src/components/LeonFilter.tsx`)

#### Berechnung des häufigsten Erstellungstags:

```typescript
const getMostCommonDate = (datasets: DatasetWithResidents[]): string | null => {
  if (datasets.length === 0) return null;
  
  const dateCounts = new Map<string, number>();
  datasets.forEach(dataset => {
    const dateOnly = new Date(dataset.createdAt).toDateString();
    dateCounts.set(dateOnly, (dateCounts.get(dateOnly) || 0) + 1);
  });

  let maxCount = 0;
  let mostCommonDate: string | null = null;
  dateCounts.forEach((count, date) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommonDate = date;
    }
  });

  return mostCommonDate;
};
```

#### Markierung der Datensätze:

```typescript
const datasetDate = new Date(dataset.createdAt).toDateString();
const isDifferentDate = mostCommonCreationDate && datasetDate !== mostCommonCreationDate;
const isDifferentCreator = currentUsername && dataset.createdBy !== currentUsername;
```

#### Bedingte CSS-Klassen:

```typescript
className={`w-full text-left border rounded-lg p-4 hover:bg-muted transition-colors ${
  isDifferentDate || isDifferentCreator 
    ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900' 
    : ''
}`}
```

### Legende

Eine Legende wird oberhalb der Ergebnisliste angezeigt, wenn markierte Datensätze vorhanden sind:

```
Hinweise:
📅 Datensatz wurde an einem anderen Tag erstellt als die Mehrheit
👤 Datensatz wurde von einem anderen Nutzer erstellt
```

## Beispiele

### Szenario 1: Normale Datensätze
Alle Datensätze vom 16.10.2025, alle vom User "Michael":
- ✅ Keine Hervorhebungen
- ⚪ Standard-Hintergrund
- 🔲 Normaler Border

```
┌─────────────────────────────────────────┐
│ Hauptstraße 5                           │
│ 16.10.2025 • Erstellt von Michael      │
│ 3 Anwohner                              │
└─────────────────────────────────────────┘
```

### Szenario 2: Abweichender Erstellungstag
- 5 Datensätze vom 16.10.2025
- 2 Datensätze vom 15.10.2025
- Alle von "Michael"

**Ergebnis:**
- Die 2 Datensätze vom 15.10.2025 werden markiert
- 🟡 Auffälliger gelber Hintergrund
- � Dicker gelber Border (2px)
- 📦 Badge "📅 Anderer Tag" neben dem Titel

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ 🟡 Gelber Border (2px)
┃ Hauptstraße 7  [📅 Anderer Tag]        ┃ 🟡 Gelber Hintergrund
┃ 15.10.2025 • Erstellt von Michael      ┃
┃ 2 Anwohner                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### Szenario 3: Anderer Ersteller
- Alle Datensätze vom 16.10.2025
- 3 von "Michael", 2 von "Leon"
- Aktueller User: "Michael"

**Ergebnis:**
- Die 2 Datensätze von "Leon" werden markiert
- 🟡 Auffälliger gelber Hintergrund
- � Dicker gelber Border (2px)
- 📦 Badge "👤 Von Leon" neben dem Titel (blau)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ 🟡 Gelber Border (2px)
┃ Hauptstraße 9  [👤 Von Leon]           ┃ 🟡 Gelber Hintergrund
┃ 16.10.2025 • Erstellt von Leon         ┃ 🔵 Blaues Badge
┃ 2 Anwohner                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### Szenario 4: Beides kombiniert
- 5 Datensätze vom 16.10.2025 von "Michael"
- 1 Datensatz vom 15.10.2025 von "Leon"
- Aktueller User: "Michael"

**Ergebnis:**
- Der 1 Datensatz wird markiert
- 🟡 Auffälliger gelber Hintergrund
- � Dicker gelber Border (2px)
- 📦 **Beide Badges** erscheinen nebeneinander

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ � Gelber Border (2px)
┃ Hauptstraße 11  [📅 Anderer Tag] [👤 Von Leon] ┃ 🟡 Gelber Hintergrund
┃ 15.10.2025 • Erstellt von Leon                 ┃ 🟡 Gelbes + 🔵 Blaues Badge
┃ 1 Anwohner                                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

## Design-Entscheidungen

### Visuelle Hierarchie
- **Border (2px)**: Sofort erkennbar beim Scrollen durch die Liste
- **Hintergrundfarbe**: Deutliche Abhebung von normalen Datensätzen
- **Badges/Tags**: Präzise Information auf einen Blick
- **Shadow-Effekt**: Zusätzliche visuelle Tiefe

### Farbschema
- **Gelbes Tag** (📅 Anderer Tag): Warnung/Hinweis auf zeitliche Abweichung
- **Blaues Tag** (👤 Von [User]): Information über anderen Ersteller
- **Gelber Hintergrund + Border**: Universelle Hervorhebung für beide Fälle

### Legende
Eine auffällige Legende wird oberhalb der Ergebnisse angezeigt:
- 🟡 Gelber Hintergrund mit dickem Border
- Zeigt Beispiel-Badges
- Erklärt die Bedeutung jeder Markierung

## Zugänglichkeit

- Die Markierungen sind **sehr auffällig** und sofort erkennbar
- Dark Mode wird vollständig unterstützt (angepasste Farben)
- Icons in den Badges für zusätzliche visuelle Hinweise
- Klare Farbdifferenzierung zwischen den Tag-Typen (gelb vs. blau)

## Zukünftige Erweiterungen

Mögliche Verbesserungen:
1. **Tooltip**: Hover über die Icons zeigt detaillierte Information
2. **Filteroptionen**: "Nur abweichende Datensätze anzeigen"
3. **Statistik**: Anzeige wie viele Datensätze von welchem Nutzer/Tag sind
4. **Sortierung**: Nach Erstellungstag oder Ersteller sortieren
