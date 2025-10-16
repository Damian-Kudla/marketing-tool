# Anleitung: Komponenten auf Toast-Kategorie-System migrieren

## Schnellanleitung

### Vorher (ohne Kategorien)
```typescript
import { useToast } from '@/hooks/use-toast';

const { toast } = useToast();

// System-Meldung - 10 Sekunden!
toast({
  title: 'Gespeichert',
  description: 'Änderungen wurden gespeichert',
});

// Fehler-Meldung
toast({
  variant: 'destructive',
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});
```

### Nachher (mit Kategorien)
```typescript
import { useFilteredToast } from '@/hooks/use-filtered-toast';

const { toast } = useFilteredToast();

// System-Meldung - 1 Sekunde, deaktivierbar
toast({
  category: 'system',
  title: 'Gespeichert',
  description: 'Änderungen wurden gespeichert',
});

// Fehler-Meldung - 5 Sekunden, immer angezeigt
toast({
  category: 'error',
  variant: 'destructive',
  title: 'Fehler',
  description: 'Operation fehlgeschlagen',
});
```

## Schritt-für-Schritt Migration

### Schritt 1: Import ändern

**Von:**
```typescript
import { useToast } from '@/hooks/use-toast';
```

**Zu:**
```typescript
import { useFilteredToast } from '@/hooks/use-filtered-toast';
```

**Oder noch einfacher - Helper Functions:**
```typescript
import { systemToast, errorToast, successToast } from '@/lib/toast-helpers';
```

### Schritt 2: Hook-Aufruf anpassen

**Von:**
```typescript
const { toast } = useToast();
```

**Zu:**
```typescript
const { toast } = useFilteredToast();
```

### Schritt 3: Toast-Aufrufe kategorisieren

#### Routine-Systemmeldungen → `category: 'system'`

**Beispiele:**
- "Änderungen gespeichert"
- "Daten geladen"
- "Export gestartet"
- "Foto hochgeladen"

**Code:**
```typescript
toast({
  category: 'system',
  title: 'Gespeichert',
  description: 'Änderungen wurden gespeichert',
});

// ODER mit Helper:
systemToast({
  title: 'Gespeichert',
  description: 'Änderungen wurden gespeichert',
});
```

#### Fehler → `category: 'error'`

**Beispiele:**
- "Verbindung fehlgeschlagen"
- "Datei nicht gefunden"
- "Ungültige Eingabe"
- Rate Limit erreicht

**Code:**
```typescript
toast({
  category: 'error',
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

#### Erfolg → `category: 'success'`

**Beispiele:**
- "Datensatz erfolgreich erstellt"
- "Export abgeschlossen"
- "Einstellungen aktualisiert"

**Code:**
```typescript
toast({
  category: 'success',
  title: 'Erfolg!',
  description: 'Datensatz wurde erstellt',
});

// ODER mit Helper:
successToast({
  title: 'Erfolg!',
  description: 'Datensatz wurde erstellt',
});
```

#### Warnungen → `category: 'warning'`

**Beispiele:**
- "Ungespeicherte Änderungen"
- "Begrenzte Funktionalität"
- "Achtung: Alte Version"

**Code:**
```typescript
toast({
  category: 'warning',
  title: 'Warnung',
  description: 'Es gibt ungespeicherte Änderungen',
});

// ODER mit Helper:
warningToast({
  title: 'Warnung',
  description: 'Es gibt ungespeicherte Änderungen',
});
```

#### Info → `category: 'info'`

**Beispiele:**
- "Neue Funktion verfügbar"
- "Update verfügbar"
- "Tipp des Tages"

**Code:**
```typescript
toast({
  category: 'info',
  title: 'Info',
  description: 'Eine neue Funktion ist verfügbar',
});

// ODER mit Helper:
infoToast({
  title: 'Info',
  description: 'Eine neue Funktion ist verfügbar',
});
```

## Häufige Muster

### Pattern 1: Erfolgreiche API-Operation

**Vorher:**
```typescript
await createDataset(data);
toast({
  title: 'Datensatz erstellt',
  description: 'Der Datensatz wurde erfolgreich erstellt',
  duration: 3000,
});
```

**Nachher:**
```typescript
await createDataset(data);
successToast({
  title: 'Datensatz erstellt',
  description: 'Der Datensatz wurde erfolgreich erstellt',
});
// Automatisch 2 Sekunden, immer angezeigt
```

### Pattern 2: Fehlerbehandlung

**Vorher:**
```typescript
try {
  await saveData();
} catch (error) {
  toast({
    variant: 'destructive',
    title: 'Fehler beim Speichern',
    description: error.message,
    duration: 5000,
  });
}
```

**Nachher:**
```typescript
try {
  await saveData();
} catch (error) {
  errorToast({
    title: 'Fehler beim Speichern',
    description: error.message,
  });
}
// Automatisch 5 Sekunden, immer angezeigt
```

### Pattern 3: Rate Limit Fehler

**Vorher:**
```typescript
if (error?.response?.status === 429) {
  toast({
    variant: 'destructive',
    title: 'Rate Limit erreicht',
    description: errorMessage,
    duration: 10000,
  });
}
```

**Nachher:**
```typescript
if (error?.response?.status === 429) {
  errorToast({
    title: 'Rate Limit erreicht',
    description: errorMessage,
    duration: 10000, // Custom duration für wichtige Meldung
  });
}
// Custom duration überschreibt Standard (5s)
```

### Pattern 4: Auto-Save Feedback

**Vorher:**
```typescript
// Auto-save nach Änderung
const handleChange = async (data) => {
  await save(data);
  toast({
    title: 'Gespeichert',
    duration: 2000,
  });
};
```

**Nachher:**
```typescript
const handleChange = async (data) => {
  await save(data);
  systemToast({
    title: 'Gespeichert',
  });
};
// Automatisch 1 Sekunde, kann deaktiviert werden
```

## Entscheidungshilfe

### Wann welche Kategorie?

| Situation | Kategorie | Duration | Deaktivierbar |
|-----------|-----------|----------|---------------|
| Routine-Operation erfolgreich | `system` | 1s | ✅ Ja |
| Wichtige Aktion erfolgreich | `success` | 2s | ❌ Nein |
| Fehler aufgetreten | `error` | 5s | ❌ Nein |
| Warnung/Vorsicht | `warning` | 4s | ❌ Nein |
| Informative Nachricht | `info` | 3s | ✅ Ja |

### Faustregel

1. **Häufige Routine-Aktionen** → `system` (z.B. Auto-Save, Daten laden)
2. **Benutzer muss es sehen** → `error`, `warning`, `success`
3. **Nice-to-know** → `info`

## Beispiel: PhotoCapture.tsx

**Vorher:**
```typescript
toast({
  title: t('photo.success'),
  description: `${t('photo.found')} ${totalNames} ${t('photo.names')}`,
});
```

**Nachher:**
```typescript
successToast({
  title: t('photo.success'),
  description: `${t('photo.found')} ${totalNames} ${t('photo.names')}`,
});
// 2 Sekunden, immer angezeigt (wichtige Aktion)
```

## Beispiel: ResultsDisplay.tsx

**Vorher:**
```typescript
toast({
  variant: "destructive",
  title: 'Rate Limit erreicht',
  description: errorMessage,
  duration: 10000,
});
```

**Nachher:**
```typescript
errorToast({
  title: 'Rate Limit erreicht',
  description: errorMessage,
  duration: 10000, // Behalte custom duration für wichtige Fehler
});
```

## Checkliste für Migration

- [ ] Import von `useToast` auf `useFilteredToast` ändern
- [ ] Alle Toast-Aufrufe durchgehen
- [ ] Kategorie für jeden Toast festlegen
- [ ] Optional: Helper Functions verwenden
- [ ] Testen: Systemmeldungen deaktivieren im User-Menu
- [ ] Verifizieren: Fehler werden immer angezeigt
- [ ] Prüfen: Dauern sind passend

## Testen

1. **Mit aktivierten Systemmeldungen:**
   - Alle Toast-Typen sollten angezeigt werden
   - System-Toasts verschwinden nach 1s
   - Error-Toasts verschwinden nach 5s

2. **Mit deaktivierten Systemmeldungen:**
   - System-Toasts (`category: 'system'`) werden NICHT angezeigt
   - Info-Toasts (`category: 'info'`) werden NICHT angezeigt
   - Error/Warning/Success werden IMMER angezeigt

3. **Custom Duration:**
   - Toast mit `duration: 3000` bleibt 3 Sekunden
   - Überschreibt Kategorie-Standard
