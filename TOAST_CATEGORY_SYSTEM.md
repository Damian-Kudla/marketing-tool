# Toast Kategorie-System

## Übersicht

Ein zentralisiertes Toast-Management-System mit Kategorien für einheitliche Verwaltung von Benachrichtigungen.

## Problem

Vorher:
- ❌ Systemmeldungen hatten unterschiedliche Dauern (oft 10 Sekunden)
- ❌ Keine einheitliche Kategorisierung
- ❌ Meldungen wurden einzeln deaktiviert/aktiviert
- ❌ Keine zentrale Steuerung der Eigenschaften

## Lösung

Jetzt:
- ✅ Zentrales Kategorie-System
- ✅ Einheitliche Dauern pro Kategorie
- ✅ Zentrale Steuerung über "Systemmeldungen" Schalter
- ✅ Klare Trennung zwischen deaktivierbaren und permanenten Meldungen

## Toast-Kategorien

### 1. **System** (`system`)
- **Dauer**: 1 Sekunde
- **Deaktivierbar**: ✅ Ja
- **Verwendung**: Routine-Systemmeldungen (Speichern, Laden, etc.)
- **Beispiel**: "Änderungen gespeichert"

### 2. **Error** (`error`)
- **Dauer**: 5 Sekunden
- **Deaktivierbar**: ❌ Nein (immer angezeigt)
- **Verwendung**: Fehlermeldungen
- **Beispiel**: "Verbindung fehlgeschlagen"

### 3. **Warning** (`warning`)
- **Dauer**: 4 Sekunden
- **Deaktivierbar**: ❌ Nein (immer angezeigt)
- **Verwendung**: Warnungen
- **Beispiel**: "Ungespeicherte Änderungen"

### 4. **Success** (`success`)
- **Dauer**: 2 Sekunden
- **Deaktivierbar**: ❌ Nein (immer angezeigt)
- **Verwendung**: Erfolgreiche Aktionen
- **Beispiel**: "Datensatz erfolgreich erstellt"

### 5. **Info** (`info`)
- **Dauer**: 3 Sekunden
- **Deaktivierbar**: ✅ Ja
- **Verwendung**: Informative Meldungen
- **Beispiel**: "Neue Funktion verfügbar"

## Verwendung

### Option 1: useFilteredToast Hook (Empfohlen)

```typescript
import { useFilteredToast } from '@/hooks/use-filtered-toast';

function MyComponent() {
  const { toast } = useFilteredToast();
  
  // System-Meldung (1s, deaktivierbar)
  toast({
    category: 'system',
    title: 'Gespeichert',
    description: 'Änderungen wurden gespeichert',
  });
  
  // Fehler (5s, immer angezeigt)
  toast({
    category: 'error',
    variant: 'destructive',
    title: 'Fehler',
    description: 'Etwas ist schiefgelaufen',
  });
  
  // Erfolg (2s, immer angezeigt)
  toast({
    category: 'success',
    title: 'Erfolg!',
    description: 'Operation erfolgreich',
  });
}
```

### Option 2: Helper Functions

```typescript
import { systemToast, errorToast, successToast } from '@/lib/toast-helpers';

// System-Meldung (1s)
systemToast({
  title: 'Gespeichert',
  description: 'Änderungen gespeichert',
});

// Fehler (5s)
errorToast({
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});

// Erfolg (2s)
successToast({
  title: 'Erfolg',
  description: 'Operation erfolgreich',
});
```

### Custom Duration

```typescript
// Überschreibe Standard-Duration
toast({
  category: 'system',
  duration: 3000, // 3 Sekunden statt 1 Sekunde
  title: 'Wichtige Meldung',
});
```

## Benutzer-Einstellungen

### Schalter im User-Dropdown

Der Schalter "Systemmeldungen" im User-Dropdown steuert:

**Wenn aktiviert (✅):**
- Alle Kategorien werden angezeigt
- System-Meldungen (1s)
- Info-Meldungen (3s)
- Error, Warning, Success (immer)

**Wenn deaktiviert (❌):**
- Nur wichtige Meldungen werden angezeigt:
  - ✅ Fehler (error) - 5s
  - ✅ Warnungen (warning) - 4s
  - ✅ Erfolg (success) - 2s
- System-Meldungen werden unterdrückt
- Info-Meldungen werden unterdrückt

## Technische Details

### Dateien

1. **`client/src/lib/toast-categories.ts`**
   - Zentrale Definition der Kategorien
   - Dauern-Konfiguration
   - Helper-Funktionen

2. **`client/src/hooks/use-filtered-toast.ts`**
   - Hook mit Kategoriefilterung
   - Automatische Duration-Zuweisung
   - Benutzer-Präferenz-Integration

3. **`client/src/lib/toast-helpers.ts`**
   - Convenience Functions
   - Vordefinierte Kategorie-Toasts

4. **`client/src/hooks/use-toast.ts`**
   - Basis-Toast-System
   - Duration-Support
   - Standard-Duration: 1 Sekunde

### Konfiguration

```typescript
// toast-categories.ts
export const TOAST_DURATIONS: Record<ToastCategory, number> = {
  system: 1000,    // 1 Sekunde
  error: 5000,     // 5 Sekunden
  warning: 4000,   // 4 Sekunden
  success: 2000,   // 2 Sekunden
  info: 3000,      // 3 Sekunden
};
```

### Kategorien-Konfiguration

```typescript
export const TOAST_CATEGORIES: Record<ToastCategory, ToastConfig> = {
  system: {
    category: 'system',
    defaultDuration: 1000,
    canBeDisabled: true,  // ✅ Kann deaktiviert werden
  },
  error: {
    category: 'error',
    defaultDuration: 5000,
    canBeDisabled: false, // ❌ Immer angezeigt
  },
  // ...
};
```

## Migration

### Bestehenden Code anpassen

**Vorher:**
```typescript
toast({
  title: 'Gespeichert',
  description: 'Änderungen gespeichert',
  duration: 10000, // 10 Sekunden
});
```

**Nachher:**
```typescript
toast({
  category: 'system', // Automatisch 1 Sekunde
  title: 'Gespeichert',
  description: 'Änderungen gespeichert',
});
```

### Fehler-Meldungen

**Vorher:**
```typescript
toast({
  variant: 'destructive',
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});
```

**Nachher:**
```typescript
toast({
  category: 'error', // Automatisch 5 Sekunden
  variant: 'destructive',
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});

// ODER mit Helper:
errorToast({
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});
```

## Vorteile

1. **Einheitlichkeit**: Alle Systemmeldungen haben dieselbe Dauer (1s)
2. **Zentrale Verwaltung**: Dauern können an einem Ort geändert werden
3. **Bessere UX**: Kürzere Dauern für Routine-Meldungen
4. **Kategorisierung**: Klare Trennung zwischen Meldungstypen
5. **Flexibilität**: Custom Duration weiterhin möglich
6. **Benutzer-Kontrolle**: Systemmeldungen können deaktiviert werden
7. **Fehler immer sichtbar**: Wichtige Meldungen werden nie unterdrückt

## Anpassungen

### Dauern ändern

Alle Dauern zentral in `toast-categories.ts` anpassen:

```typescript
export const TOAST_DURATIONS: Record<ToastCategory, number> = {
  system: 2000,    // Auf 2 Sekunden ändern
  error: 6000,     // Auf 6 Sekunden ändern
  // ...
};
```

### Neue Kategorie hinzufügen

```typescript
// 1. Type erweitern
export type ToastCategory = 
  | 'system'
  | 'error'
  | 'warning'
  | 'success'
  | 'info'
  | 'custom'; // NEU

// 2. Duration hinzufügen
export const TOAST_DURATIONS: Record<ToastCategory, number> = {
  // ... bestehende
  custom: 1500, // NEU
};

// 3. Config hinzufügen
export const TOAST_CATEGORIES: Record<ToastCategory, ToastConfig> = {
  // ... bestehende
  custom: {
    category: 'custom',
    defaultDuration: 1500,
    canBeDisabled: true,
  },
};

// 4. Helper erstellen (optional)
export const customToast = createCategorizedToast('custom', 'default');
```
