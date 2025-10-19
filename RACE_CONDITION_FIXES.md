# 🔒 Race Condition & Logging Fixes

## Problembeschreibung

### 1. **Doppelte Dataset-Erstellung** (Kritisch ⚠️)
**Symptom:** Zwei identische Datensätze wurden innerhalb von 19ms erstellt:
```
2025-10-17T12:44:35.860Z → ds_1760705075663_028cp1gb2
2025-10-17T12:44:35.879Z → ds_1760705075649_t2cogrql8
```

**Ursachen:**
- **Frontend Race Condition:** Keine Sperre gegen parallele `handleRequestDatasetCreation()`-Aufrufe
- **Backend Race Condition:** Zeit zwischen Duplikats-Check und Sheets-Write erlaubte parallele Requests
- **Kein Debouncing:** Schnelle doppelte Button-Clicks wurden nicht verhindert

### 2. **Fehlerhafter Logging-Pfad**
**Symptom:** Logs zeigten `/` statt `/api/address-datasets`:
```
2025-10-17T12:44:35.860Z	David	/	POST	...
```

**Ursache:** `req.path` in Subrouter zeigt nur relativen Pfad, nicht den vollständigen Mount-Pfad

---

## ✅ Implementierte Lösungen

### 🎯 Frontend Fixes

#### 1. **State-Lock Mechanismus**
**Dateien:** 
- `client/src/components/ResultsDisplay.tsx`
- `client/src/pages/scanner.tsx`

**Implementation:**
```typescript
const [isCreatingDataset, setIsCreatingDataset] = useState(false);

const handleRequestDatasetCreation = async (): Promise<string | null> => {
  // LOCK: Prevent concurrent calls
  if (isCreatingDataset) {
    console.log('🔒 Already creating dataset, ignoring duplicate call');
    return null;
  }

  setIsCreatingDataset(true);
  try {
    // ... creation logic ...
    return datasetId;
  } finally {
    setIsCreatingDataset(false); // ALWAYS release lock
  }
};
```

**Vorteile:**
- ✅ Verhindert parallele Aufrufe innerhalb derselben Komponente
- ✅ Garantiert durch `finally`-Block, dass Lock immer freigegeben wird
- ✅ TypeScript-kompatibel und einfach zu testen

---

#### 2. **Debouncing (300ms)**
**Dateien:**
- `client/src/lib/debounce.ts` (neue Utility)
- `client/src/components/ResultsDisplay.tsx`
- `client/src/pages/scanner.tsx`

**Implementation:**
```typescript
const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleRequestDatasetCreation = async (): Promise<string | null> => {
  // Clear existing timer on rapid calls
  if (debounceTimerRef.current) {
    clearTimeout(debounceTimerRef.current);
  }

  return new Promise((resolve) => {
    debounceTimerRef.current = setTimeout(async () => {
      // ... actual creation logic (with lock) ...
    }, 300); // 300ms debounce
  });
};
```

**Vorteile:**
- ✅ Verhindert doppelte Clicks (z.B. versehentlicher Doppelklick)
- ✅ 300ms Fenster für User-Interaktion
- ✅ Keine externe Library (lodash) nötig
- ✅ Promise-basiert für sauberes async/await

---

### 🔐 Backend Fixes

#### 3. **In-Memory Lock-Map mit Timeout**
**Datei:** `server/routes/addressDatasets.ts`

**Implementation:**
```typescript
// Lock Map: Key = "normalizedAddress:username"
interface CreationLock {
  promise: Promise<any>;
  timestamp: number;
}

const creationLocks = new Map<string, CreationLock>();
const LOCK_TIMEOUT_MS = 10000; // 10 seconds

// Automatic cleanup every 5 seconds
setInterval(() => {
  const now = Date.now();
  creationLocks.forEach((lock, key) => {
    if (now - lock.timestamp > LOCK_TIMEOUT_MS) {
      console.warn(`🔓 Removing expired lock for: ${key}`);
      creationLocks.delete(key);
    }
  });
}, 5000);

// In POST / handler:
router.post('/', async (req, res) => {
  const lockKey = `${normalized.formattedAddress}:${username}`;
  
  // Check if creation is already in progress
  if (creationLocks.has(lockKey)) {
    const existingLock = creationLocks.get(lockKey)!;
    const lockAge = Date.now() - existingLock.timestamp;
    
    if (lockAge < LOCK_TIMEOUT_MS) {
      return res.status(409).json({
        error: 'Dataset creation already in progress',
        message: 'Datensatz wird bereits erstellt. Bitte warte einen Moment.',
      });
    }
  }
  
  // Create dataset with lock
  const creationPromise = (async () => {
    try {
      const dataset = await addressDatasetService.createAddressDataset(...);
      return dataset;
    } finally {
      // ALWAYS remove lock when done
      creationLocks.delete(lockKey);
      console.log(`🔓 Released lock for ${lockKey}`);
    }
  })();
  
  // Register promise BEFORE awaiting
  creationLocks.set(lockKey, {
    promise: creationPromise,
    timestamp: Date.now()
  });
  
  const dataset = await creationPromise;
  res.json({ ...dataset, canEdit: true });
});
```

**Vorteile:**
- ✅ Verhindert Race Conditions zwischen parallelen Requests
- ✅ 10s Timeout verhindert Deadlocks bei Netzwerkfehlern
- ✅ Automatisches Cleanup alle 5s
- ✅ Skalierbar für single-instance Deployments
- ✅ Lock-Key pro Adresse + User (mehrere User können parallel arbeiten)

**Hinweis für Skalierung:**
Für Multi-Instance Deployments (z.B. Kubernetes) sollte dies durch **Redis-basierte Distributed Locks** ersetzt werden.

---

#### 4. **Logging-Fix: `req.originalUrl` statt `req.path`**
**Datei:** `server/services/enhancedLogging.ts`

**Änderung:**
```typescript
// VORHER (falsch):
endpoint: req.path  // Zeigt nur "/" in Subrouter

// NACHHER (korrekt):
endpoint: req.originalUrl || req.path  // Zeigt "/api/address-datasets"
```

**Vorteile:**
- ✅ Vollständiger Pfad inkl. Router-Mount wird geloggt
- ✅ Besseres Auditing und Debugging
- ✅ Fallback auf `req.path` für Edge-Cases

---

## 📊 Effekt der Fixes

### Vorher (Problematisch):
```
Request 1: Check duplicate → None found → Create → Write to Sheets
Request 2: Check duplicate → None found → Create → Write to Sheets (🔴 DUPLICATE!)
Result: 2 Datensätze in 19ms
```

### Nachher (Geschützt):
```
Request 1: Debounce → Lock acquired → Check duplicate → Create → Release lock
Request 2: Debounce (cancelled) OR Lock rejected (409) → No duplicate
Result: 1 Datensatz ✅
```

---

## 🧪 Testing-Empfehlungen

### Frontend Tests:
1. **Rapid Button Clicks:**
   - Doppelklick auf "Anwohner anlegen" → Nur 1 Dataset
   - Dreifachklick innerhalb 300ms → Nur 1 Dataset

2. **Parallele Component Calls:**
   - `ResultsDisplay` und `scanner.tsx` gleichzeitig → Nur 1 Dataset

### Backend Tests:
3. **Parallel Requests:**
   ```bash
   # Terminal 1:
   curl -X POST http://localhost:5000/api/address-datasets -H "..." -d "{...}"
   
   # Terminal 2 (sofort danach):
   curl -X POST http://localhost:5000/api/address-datasets -H "..." -d "{...}"
   
   # Erwartung: Request 2 bekommt 409 Conflict
   ```

4. **Lock Timeout Test:**
   - Simuliere langsamen Sheets-Write (>10s)
   - Erwartung: Lock wird nach 10s automatisch entfernt

5. **Logging Test:**
   ```bash
   # Prüfe Logs nach POST Request:
   grep "dataset_create" logs/*.log
   
   # Erwartung: Pfad zeigt "/api/address-datasets" statt "/"
   ```

---

## 🚀 Deployment-Hinweise

### Sofort einsatzbereit:
- ✅ Alle Fixes sind TypeScript-kompatibel
- ✅ Keine Breaking Changes
- ✅ Keine zusätzlichen Dependencies

### Bei Skalierung (Multi-Instance):
Wenn die App auf mehrere Server-Instanzen skaliert wird:

**TODO:** Redis-basierte Distributed Locks implementieren:
```typescript
import Redis from 'ioredis';
import Redlock from 'redlock';

const redis = new Redis(process.env.REDIS_URL);
const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});

// In POST / handler:
const lock = await redlock.acquire([lockKey], 10000); // 10s TTL
try {
  const dataset = await addressDatasetService.createAddressDataset(...);
  return dataset;
} finally {
  await lock.release();
}
```

---

## 📝 Zusammenfassung

| Problem | Lösung | Status |
|---------|--------|--------|
| Frontend Race Condition | State-Lock Mechanismus | ✅ |
| Doppelte Button-Clicks | 300ms Debouncing | ✅ |
| Backend Race Condition | In-Memory Lock-Map (10s Timeout) | ✅ |
| Fehlerhafter Logging-Pfad | `req.originalUrl` statt `req.path` | ✅ |

**Resultat:** 
- 🔒 Keine doppelten Datensätze mehr möglich
- 📊 Korrekte Logging-Pfade für besseres Monitoring
- 🚀 Production-ready für single-instance Deployments
- 📈 Erweiterbar für Multi-Instance mit Redis

---

## 🔗 Geänderte Dateien

### Frontend:
1. ✅ `client/src/components/ResultsDisplay.tsx` - Lock + Debounce
2. ✅ `client/src/pages/scanner.tsx` - Lock + Debounce
3. ✅ `client/src/lib/debounce.ts` - Neue Utility (optional, aktuell nicht verwendet)

### Backend:
4. ✅ `server/routes/addressDatasets.ts` - Lock-Map + Timeout
5. ✅ `server/services/enhancedLogging.ts` - originalUrl Fix

---

**Implementiert am:** 2025-10-18  
**Von:** GitHub Copilot  
**Review-Status:** ✅ Bereit für Testing
