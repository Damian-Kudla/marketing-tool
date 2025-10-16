# 📊 Cache & Storage Audit - Akquise-Tool PWA

## Übersicht der Datenspeicherung

### ✅ **Was wird gespeichert (MINIMAL)**

#### 1. Service Worker Caches (Cache API)

**STATIC_CACHE** (`static-cache-v1.0.5`)
- `/` - Hauptseite (HTML)
- `/index.html` - App-Einstiegspunkt
- `/manifest.json` - PWA-Manifest
- `/icons/icon-192x192.svg` - App-Icon (klein)
- `/icons/icon-512x512.svg` - App-Icon (groß)
- `/icons/apple-touch-icon.svg` - iOS-Icon
- Vite Build Assets (JS, CSS) - werden dynamisch gecached beim ersten Laden

**Größe**: ~2-5 MB (statische Assets)

---

**API_CACHE** (`api-cache-v1.0.5`)
- `/api/auth` - Authentifizierung
- `/api/addresses` - Adressdaten
- `/api/results` - OCR-Ergebnisse (NUR Textdaten, KEINE Bilder!)
- **MAX 50 Einträge** - alte Einträge werden automatisch gelöscht

**Größe**: ~1-3 MB (JSON-Daten)

---

**IMAGE_CACHE** (`image-cache-v1.0.5`)
- **NUR** App-Icons von `/icons/` Verzeichnis
- **KEINE** OCR-Uploads mehr!
- **MAX 10 Einträge** - nur kleine Icons

**Größe**: ~500 KB (nur Icons)

---

#### 2. LocalStorage

**Aktive Einträge (zur Laufzeit)**:
- `app-version`: Aktuelle App-Version (für Update-Checks)

**Temporäre Einträge (werden gelöscht)**:
- ~~`pwa-logs`~~ - GELÖSCHT bei Aktivierung
- ~~`pwa-metrics`~~ - GELÖSCHT bei Aktivierung

**Größe**: < 10 KB

---

#### 3. SessionStorage

**Temporäre Einträge (nur während Session)**:
- `pwa-reload-path`: Pfad für Reload nach Update (wird nach Reload gelöscht)

**Größe**: < 1 KB

---

### ❌ **Was wird NICHT mehr gespeichert**

#### 1. IndexedDB - KOMPLETT DEAKTIVIERT
- ❌ Database `EnergyScanner` wird bei Aktivierung gelöscht
- ❌ Store `ocrResults` - **KEINE Base64-Bilder mehr!**
- ❌ Store `addresses` - KEINE Offline-Adressen
- ❌ Store `metadata` - KEINE Metadaten

**Ersparnis**: 40-100 MB pro Gerät! 🎉

#### 2. OCR-Bilder - NICHT gecached
- ❌ Hochgeladene Fotos werden NICHT gespeichert
- ❌ `/api/ocr` Responses werden NICHT gecached
- ✅ Nur während Verarbeitung im Memory, danach gelöscht

**Ersparnis**: 2-10 MB pro Foto × Anzahl Fotos

---

## 🔧 Automatische Bereinigung

### Bei jeder Service Worker Aktivierung (App-Update):

1. **Alte Caches löschen**
   - Alle Caches außer aktuelle Version werden gelöscht
   - Betrifft: `energy-scan-*`, `static-cache-*`, `api-cache-*`, `image-cache-*`

2. **IndexedDB komplett leeren**
   - Database `EnergyScanner` wird gelöscht
   - Alle Base64-Bilder werden entfernt

3. **LocalStorage bereinigen**
   - `pwa-logs` wird gelöscht
   - `pwa-metrics` wird gelöscht

---

## 📈 Gesamtspeicherverbrauch

### Vorher (alte Versionen):
- Service Worker Caches: ~10-20 MB
- IndexedDB (mit Bildern): ~40-100 MB
- LocalStorage: ~1 MB
- **GESAMT**: ~50-120 MB

### Jetzt (Version 1.0.5+):
- Service Worker Caches: ~3-8 MB
- IndexedDB: ~0 MB (deaktiviert)
- LocalStorage: ~10 KB
- **GESAMT**: ~3-8 MB

### Ersparnis: 45-110 MB (90% weniger!) 🚀

---

## 🔋 Performance-Vorteile

- ✅ Weniger Storage I/O → Akku-Schonung
- ✅ Schnellere Cache-Operationen
- ✅ Kein Speicherplatz-Warnung mehr
- ✅ Schnellere App-Ladezeiten
- ✅ Weniger Speicher-Fragmentierung

---

## 🛠️ Developer Tools - Cache prüfen

### Chrome DevTools:
1. F12 → **Application** Tab
2. **Cache Storage** → Siehe aktive Caches
3. **IndexedDB** → Sollte leer sein (EnergyScanner gelöscht)
4. **Local Storage** → Minimal (nur app-version)

### Erwartete Caches:
- `akquise-tool-v1.0.5` (oder höher)
- `static-cache-v1.0.5` (oder höher)
- `api-cache-v1.0.5` (oder höher)
- `image-cache-v1.0.5` (oder höher)

### NICHT vorhanden (alte Versionen):
- ❌ `energy-scan-v*`
- ❌ `static-cache-v2.3.3` (oder älter)
- ❌ Alle anderen Versionen

---

## 📝 Migration von alten Versionen

Wenn User von alten Versionen (< 1.0.5) updaten:

1. **Automatisch beim ersten App-Start**:
   - Service Worker aktiviert neue Version
   - `clearIndexedDB()` löscht alte Bilder
   - `clearOldLocalStorage()` bereinigt Logs
   - Alle alten Caches werden gelöscht

2. **Keine Nutzer-Aktion erforderlich**
   - Update läuft im Hintergrund
   - Beim nächsten App-Start ist alles bereinigt

---

## 🎯 Empfehlungen

### Für User:
- ✅ App regelmäßig neu laden (für Cache-Updates)
- ✅ Bei Speicherproblemen: Browser-Cache manuell leeren (DevTools)

### Für Entwickler:
- ✅ Keine neuen IndexedDB-Speicherungen hinzufügen
- ✅ Nur statische Assets cachen (keine dynamischen Bilder)
- ✅ API-Cache auf max 50 Einträge begrenzt lassen
- ✅ Logs nur zur Laufzeit, nicht persistent speichern

---

## Version History

**Version 1.0.5** (2025-10-16):
- ✅ IndexedDB-Speicherung komplett deaktiviert
- ✅ OCR-Bilder werden nicht mehr gecached
- ✅ Aggressive Cache-Bereinigung bei Aktivierung
- ✅ LocalStorage-Logs werden gelöscht
- ✅ 90% weniger Speicherverbrauch

**Version 2.3.3** (vorher):
- ⚠️ OCR-Bilder wurden noch in IMAGE_CACHE gespeichert (max 20)
- ⚠️ IndexedDB speicherte Base64-Bilder
- ⚠️ Keine automatische Bereinigung alter Caches

---

## 🔍 Debugging

### Cache-Größe prüfen (Console):
```javascript
// Alle Caches auflisten
caches.keys().then(names => console.log('Caches:', names));

// Cache-Größe schätzen
caches.open('akquise-tool-v1.0.5').then(cache => 
  cache.keys().then(keys => console.log('Cache entries:', keys.length))
);

// IndexedDB prüfen
indexedDB.databases().then(dbs => console.log('Databases:', dbs));
```

### LocalStorage prüfen:
```javascript
console.log('LocalStorage:', Object.keys(localStorage));
console.log('App Version:', localStorage.getItem('app-version'));
```

---

**Fazit**: Die App speichert jetzt **minimal** nur das Nötigste für PWA-Funktionalität, aber **keine Bilder oder große Daten** mehr lokal. 🎉
