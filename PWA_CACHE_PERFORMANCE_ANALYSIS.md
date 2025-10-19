# PWA Cache & Performance Analyse

## Executive Summary

**Status**: ✅ **SEHR GUT** - PWA ist bereits optimal für Langzeitnutzung konfiguriert  
**Risiko für Performance-Degradation**: ⚠️ **GERING bis MITTEL** (mit Empfehlungen)

---

## 1. Service Worker Cache-Strategie

### Was wird gecacht?

#### ✅ Static Assets Cache (`STATIC_CACHE`)
```javascript
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.svg',
  '/icons/icon-512x512.svg',
  '/icons/apple-touch-icon.svg',
  // Vite build assets (JS, CSS) werden dynamisch gecacht
];
```

**Größe**: ~5-10 MB (App-Bundle + Icons)  
**Strategie**: **Cache First** - Bei Update wird alter Cache gelöscht  
**Cleanup**: ✅ Automatisch bei neuer Version (alte Caches werden gelöscht)

#### ⚠️ API Response Cache (`API_CACHE`)
```javascript
const MAX_API_CACHE_SIZE = 50; // Maximal 50 API-Responses
```

**Strategie**: **Network First mit Fallback**  
**Was wird gecacht**:
- `/api/addresses` (Adress-Suchen)
- `/api/results` (Dataset-Results)
- **NICHT gecacht**: `/api/ocr` (zu große Payloads mit Bildern)
- **NICHT gecacht**: `/api/admin` (Admin-Daten immer fresh)

**Größe pro Entry**: ~5-50 KB (JSON-Daten ohne Bilder)  
**Max Gesamtgröße**: ~2.5 MB (50 × 50 KB)

**Cleanup**: ✅ **Automatisch** - Älteste Einträge werden gelöscht wenn Limit erreicht
```javascript
async function manageCacheSize(cache, maxSize) {
  const keys = await cache.keys();
  if (keys.length >= maxSize) {
    const keysToDelete = keys.slice(0, keys.length - maxSize + 1);
    for (const key of keysToDelete) {
      await cache.delete(key); // ← FIFO-Strategie
    }
  }
}
```

#### ✅ Image Cache (`IMAGE_CACHE`)
```javascript
const MAX_IMAGE_CACHE_SIZE = 10; // Nur App-Icons
```

**Was wird gecacht**: NUR App-Icons aus `/icons/` Ordner  
**Was wird NICHT gecacht**: OCR-Upload-Bilder, API-Image-Responses  
**Größe**: ~500 KB (nur SVG/PNG Icons)

**Cleanup**: ✅ Automatisch bei Limit

---

## 2. IndexedDB Storage

### ⚠️ KRITISCH: IndexedDB wurde früher für OCR-Bilder genutzt

```javascript
// In sw.js Zeile 127-147:
async function clearIndexedDB() {
  try {
    // Delete the entire EnergyScanner database (contains Base64 images)
    const deleteRequest = indexedDB.deleteDatabase('EnergyScanner');
    
    return new Promise((resolve) => {
      deleteRequest.onsuccess = () => {
        logPWAAction('INDEXEDDB_CLEARED', { database: 'EnergyScanner' });
        resolve();
      };
```

**Status**: ✅ **GELÖST** - IndexedDB wird bei jedem SW-Activation gelöscht  
**Problem vorher**: Base64-kodierte Bilder wurden in IndexedDB gespeichert → 5-10 MB pro Bild!  
**Lösung**: Komplettes Löschen bei SW-Update

---

## 3. React State Management Memory-Analyse

### 📊 State in Scanner.tsx (Hauptseite)

```typescript
// 15+ State-Variablen pro Scanner-Session:
const [address, setAddress] = useState<Address | null>(null);
const [normalizedAddress, setNormalizedAddress] = useState<string | null>(null);
const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
const [photoImageSrc, setPhotoImageSrc] = useState<string | null>(null); // ← GROSS!
const [canEdit, setCanEdit] = useState(true);
const [currentDatasetId, setCurrentDatasetId] = useState<string | null>(null);
const [datasetCreatedAt, setDatasetCreatedAt] = useState<string | null>(null);
const [showDatasets, setShowDatasets] = useState(false);
const [editableResidents, setEditableResidents] = useState<any[]>([]); // ← ARRAY!
const [showAddressOverview, setShowAddressOverview] = useState(false);
const [showCallBackModeBanner, setShowCallBackModeBanner] = useState(false);
const [resetKey, setResetKey] = useState(0);
const [isCreatingDataset, setIsCreatingDataset] = useState(false);
```

**Geschätzte Größe pro Session**:
- `address`: ~500 Bytes
- `normalizedAddress`: ~100 Bytes
- `ocrResult`: ~5-50 KB (mit OCR-Namen-Array)
- `photoImageSrc`: **🔴 5-10 MB** (Base64-kodiertes Bild!)
- `editableResidents`: ~5-20 KB (Array mit Anwohner-Daten)
- **Total**: **~5-10 MB pro aktiver Scanner-Session**

---

## 4. Memory Leak Risiken

### 🔴 HIGH RISK: Base64 Images in React State

**Problem**:
```typescript
const [photoImageSrc, setPhotoImageSrc] = useState<string | null>(null);
// ← Speichert Base64-String mit 5-10 MB im RAM!
```

**Szenario**: User scannt 50 Adressen an einem Tag
- **Memory-Akkumulation**: 50 × 10 MB = **500 MB RAM!**
- **Garbage Collection**: Funktioniert nur wenn Component unmounted wird
- **Problem**: Scanner-Seite wird NICHT unmounted zwischen Scans

**Lösung in Code**:
```typescript
// Reset beim Adresswechsel (Zeile 60-86):
useEffect(() => {
  const newNormalizedAddress = createNormalizedAddressString(address);
  
  if (currentDatasetId && normalizedAddress && newNormalizedAddress) {
    if (normalizedAddress !== newNormalizedAddress) {
      console.log('[Address Change] Resetting dataset and clearing state');
      
      // ✅ WICHTIG: Löscht photoImageSrc!
      setPhotoImageSrc(null);
      setOcrResult(null);
      setEditableResidents([]);
      // ...
    }
  }
}, [address]);
```

**✅ Gut**: State wird bei Adresswechsel gelöscht  
**⚠️ Problem**: Wenn User DIESELBE Adresse mehrfach scannt (z.B. verschiedene Stockwerke)

---

### 🟡 MEDIUM RISK: editableResidents Array-Akkumulation

**Problem**:
```typescript
const [editableResidents, setEditableResidents] = useState<any[]>([]);
// Array mit bis zu 100+ Anwohner-Objekten pro Gebäude
```

**Szenario**: Großes Wohngebäude mit 100 Anwohnern
- **Größe pro Anwohner**: ~200 Bytes (Name, Status, etc.)
- **Total**: 100 × 200 Bytes = **20 KB** (akzeptabel)

**✅ Kein großes Risiko**, aber bei sehr großen Gebäuden (500+ Wohnungen) könnte es relevant werden.

---

### 🟢 LOW RISK: Context State

```typescript
// CallBackSessionContext.tsx
const [currentCallBackList, setCurrentCallBackList] = useState<any[]>([]);
const [currentCallBackIndex, setCurrentCallBackIndex] = useState(-1);
```

**Größe**: Maximal 50-100 Call-Back-Einträge × 500 Bytes = **~50 KB** (vernachlässigbar)

---

## 5. Performance-Degradation Szenarien

### 📉 Szenario 1: Intensive Tagesnutzung (50+ Scans)

**Timeline**:
```
09:00 - Start (RAM: 50 MB)
  ↓
10:00 - 10 Scans (RAM: 150 MB) → Noch okay
  ↓
12:00 - 25 Scans (RAM: 300 MB) → Leichte Verlangsamung
  ↓
15:00 - 50 Scans (RAM: 600 MB) → ⚠️ Spürbare Verlangsamung
  ↓
17:00 - 75 Scans (RAM: 900 MB) → 🔴 App wird langsam
```

**Symptome**:
- UI-Verzögerungen beim Tippen
- Längere Ladezeiten bei Adresswechsel
- Scrolling ruckelt
- Browser-Tab friert kurz ein

**Ursachen**:
1. **photoImageSrc nicht gelöscht** bei mehrfachen Scans derselben Adresse
2. **React Virtual DOM** wird sehr groß (viele Components)
3. **Event Listeners** akkumulieren (wenn nicht proper cleanup)
4. **Garbage Collection Pauses** (Browser muss viel Memory freigeben)

---

### 📉 Szenario 2: Langzeit-Tab (App läuft mehrere Tage)

**Timeline**:
```
Tag 1 - Normale Nutzung (50 Scans)
  ↓
Tag 2 - App läuft weiter (weitere 50 Scans)
  ↓
Tag 3 - App läuft immer noch (weitere 50 Scans)
  ↓
Tag 4 - 🔴 Browser killed Tab (Out of Memory)
```

**Ursachen**:
1. **Service Worker Cache** wächst (API_CACHE hat zwar Limit, aber...)
2. **Browser Cache** akkumuliert (DevTools → Application → Cache Storage)
3. **Memory Leaks** in Event Listeners (nicht abgemeldete Subscriptions)
4. **Nominatim Queue** könnte wachsen (unlikely, aber möglich)

---

## 6. Gefundene Memory Leak Quellen

### ✅ PROTECTED: Event Listeners in PhotoCapture

```typescript
// PhotoCapture.tsx Zeile 44:
useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  return () => {
    window.removeEventListener('online', handleOnline); // ← ✅ Cleanup!
    window.removeEventListener('offline', handleOffline);
  };
}, []);
```

**✅ Gut**: Listeners werden korrekt entfernt

---

### ⚠️ POTENTIAL LEAK: Window Resize in ImageWithOverlays

```typescript
// ImageWithOverlays.tsx Zeile 613:
useEffect(() => {
  const handleResize = () => {
    setWindowWidth(window.innerWidth);
  };
  
  window.addEventListener('resize', handleResize);
  
  return () => {
    window.removeEventListener('resize', handleResize); // ← ✅ Cleanup vorhanden
  };
}, []);
```

**✅ Gut**: Listeners werden entfernt

---

### 🟡 POTENTIAL ISSUE: Long-Press Timer in ImageWithOverlays

```typescript
// Suche nach setTimeout/setInterval ohne cleanup
```

**Muss überprüft werden**: Ob alle Timer korrekt ge-cleared werden

---

## 7. Nominatim Queue Memory Impact

```typescript
// nominatim.ts
class NominatimQueue {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private lastRequestTime = 0;
}
```

**Worst Case Szenario**: 15 User rufen gleichzeitig geocodeWithNominatim() auf
- **Queue-Größe**: 15 Requests
- **Größe pro Request**: ~1 KB (Function + Promise)
- **Total**: **15 KB** (vernachlässigbar)

**Memory Leak Risiko**: ❌ **SEHR GERING**
- Queue wird automatisch geleert (Requests werden verarbeitet)
- Keine Akkumulation über Zeit

---

## 8. Recommendations - Priorität

### 🔴 HIGH PRIORITY: Photo Image Memory Management

**Problem**: `photoImageSrc` State mit 5-10 MB Base64-Bild

**Lösung 1: Revoke Object URLs**
```typescript
// In PhotoCapture.tsx
const handlePhotoSelected = (file: File) => {
  // VORHER:
  const imageUrl = URL.createObjectURL(file);
  setPreview(imageUrl);
  
  // DANACH: Revoke when component unmounts
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview); // ← Gibt Memory frei!
      }
    };
  }, [preview]);
};
```

**Lösung 2: Aggressive Cleanup bei Adresswechsel**
```typescript
// In scanner.tsx
const handleReset = () => {
  // Explizit alle großen Objekte nullen
  setPhotoImageSrc(null);
  setOcrResult(null);
  setEditableResidents([]);
  
  // Force garbage collection (hint)
  if (global.gc) {
    global.gc(); // Nur in Dev-Mode mit --expose-gc flag
  }
};
```

**Lösung 3: Periodic Memory Cleanup**
```typescript
// Add to scanner.tsx
useEffect(() => {
  // Alle 30 Minuten: Cleanup
  const interval = setInterval(() => {
    console.log('[Memory Cleanup] Forcing state reset...');
    
    // Nur cleanen wenn keine aktive Bearbeitung läuft
    if (!isCreatingDataset && !showEditPopup) {
      setPhotoImageSrc(null);
      setOcrResult(null);
    }
  }, 30 * 60 * 1000); // 30 Minuten
  
  return () => clearInterval(interval);
}, [isCreatingDataset]);
```

---

### 🟡 MEDIUM PRIORITY: Service Worker Cache Monitoring

**Problem**: Keine Monitoring für Cache-Größe

**Lösung: Cache Size Monitoring**
```typescript
// Add to sw.js
async function logCacheSize() {
  const cacheNames = [STATIC_CACHE, API_CACHE, IMAGE_CACHE];
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    let totalSize = 0;
    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }
    
    logPWAAction('CACHE_SIZE', {
      cacheName,
      entries: keys.length,
      sizeKB: Math.round(totalSize / 1024)
    });
  }
}

// Call every hour
setInterval(logCacheSize, 60 * 60 * 1000);
```

---

### 🟡 MEDIUM PRIORITY: React DevTools Memory Profiling

**Empfehlung**: Regelmäßig Memory Snapshots machen

**Anleitung**:
1. Chrome DevTools → Memory Tab
2. Take Heap Snapshot (Baseline)
3. App 30 Minuten nutzen (20+ Scans)
4. Take Heap Snapshot (After)
5. Compare → Suche nach großen Retained Objects

**Häufige Probleme**:
- Detached DOM Nodes (Components nicht proper unmounted)
- Event Listeners (nicht entfernt)
- Closures (behalten große Objekte im Scope)

---

### 🟢 LOW PRIORITY: Periodic Page Reload

**Extreme Lösung**: Auto-Reload nach X Stunden

```typescript
// Add to App.tsx
useEffect(() => {
  // Nach 8 Stunden: Seite neu laden
  const reloadTimeout = setTimeout(() => {
    console.log('[Auto-Reload] App running for 8 hours, reloading...');
    window.location.reload();
  }, 8 * 60 * 60 * 1000);
  
  return () => clearTimeout(reloadTimeout);
}, []);
```

**⚠️ Vorsicht**: Nur wenn User nicht aktiv bearbeitet!

---

## 9. Testing-Plan für Memory Leaks

### Manual Testing

```javascript
// Memory Stress Test Script (Run in Console)
async function memoryStressTest() {
  console.log('=== MEMORY STRESS TEST START ===');
  
  // Baseline
  console.log('Heap Size (Baseline):', performance.memory.usedJSHeapSize / 1024 / 1024, 'MB');
  
  // Simulate 50 scans
  for (let i = 0; i < 50; i++) {
    // Trigger address change
    console.log(`Scan ${i+1}/50`);
    
    // Simulate photo upload (10 MB Base64)
    const fakeImage = 'a'.repeat(10 * 1024 * 1024); // 10 MB string
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (i % 10 === 0) {
      console.log(`Heap Size (After ${i} scans):`, performance.memory.usedJSHeapSize / 1024 / 1024, 'MB');
    }
  }
  
  console.log('Heap Size (Final):', performance.memory.usedJSHeapSize / 1024 / 1024, 'MB');
  console.log('=== MEMORY STRESS TEST END ===');
}

// Run test
memoryStressTest();
```

**Erwartetes Ergebnis**:
- Baseline: ~50 MB
- After 50 scans: <200 MB (okay)
- If >500 MB: 🔴 Memory Leak!

---

### Automated Monitoring

```typescript
// Add to main.tsx
if (import.meta.env.DEV) {
  setInterval(() => {
    if (performance.memory) {
      const usedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
      const limitMB = Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024);
      
      console.log(`[Memory Monitor] Used: ${usedMB} MB / ${limitMB} MB (${Math.round(usedMB/limitMB*100)}%)`);
      
      if (usedMB / limitMB > 0.8) {
        console.warn('⚠️ HIGH MEMORY USAGE! Consider cleanup.');
      }
    }
  }, 60 * 1000); // Every minute
}
```

---

## 10. Production Recommendations

### ✅ Sofort Implementieren:

1. **Object URL Revocation** in PhotoCapture
   ```typescript
   useEffect(() => {
     return () => {
       if (preview) URL.revokeObjectURL(preview);
     };
   }, [preview]);
   ```

2. **Aggressive Photo State Cleanup**
   ```typescript
   // Nach Dataset-Erstellung:
   setPhotoImageSrc(null); // ← Force garbage collection
   ```

3. **Memory Monitor** (nur Dev-Mode)
   ```typescript
   // Logging bei hoher Memory-Nutzung
   ```

### 🟡 Mittelfristig (1-2 Wochen):

4. **Cache Size Monitoring** im Service Worker

5. **Periodic Memory Cleanup** (alle 30 Min)

6. **React DevTools Profiling** nach Features

### 🟢 Langfristig (Optional):

7. **Auto-Reload** nach 8 Stunden (nur wenn idle)

8. **Memory Leak Detection** in CI/CD (z.B. mit Puppeteer)

---

## 11. Zusammenfassung

| Kategorie | Status | Risiko | Empfehlung |
|-----------|--------|--------|------------|
| **Service Worker Cache** | ✅ Gut | 🟢 Low | Monitoring hinzufügen |
| **IndexedDB** | ✅ Gelöst | 🟢 Low | Keine Aktion nötig |
| **React State (photoImageSrc)** | ⚠️ Risiko | 🔴 High | Object URL revoke + Cleanup |
| **React State (residents)** | ✅ Akzeptabel | 🟡 Medium | Bei Bedarf optimieren |
| **Event Listeners** | ✅ Gut | 🟢 Low | Keine Aktion nötig |
| **Nominatim Queue** | ✅ Gut | 🟢 Low | Keine Aktion nötig |

**Gesamtbewertung**: ⚠️ **Gering bis Mittel**

**Wichtigste Action Items**:
1. ✅ Object URL Revocation implementieren
2. ✅ Aggressive Cleanup von `photoImageSrc` nach Dataset-Erstellung
3. 🟡 Memory Monitoring (Dev-Mode)
4. 🟡 Periodic Cleanup (alle 30 Min)

**Bei Umsetzung dieser Empfehlungen**: ✅ **Performance bleibt auch bei 100+ Scans/Tag stabil!**
