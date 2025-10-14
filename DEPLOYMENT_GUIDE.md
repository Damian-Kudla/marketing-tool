# 🚀 Deployment Guide - Cache-Busting & Auto-Updates

## Problem
Benutzer haben die alte Version im Browser-Cache und sehen keine neuen Features nach dem Deployment.

## Lösung
Automatisches Versions-Management mit PWA Service Worker Updates.

---

## 📦 Vor jedem Deployment

### Option 1: Automatisches Deployment (Empfohlen)
```bash
# Patch-Version erhöhen (2.1.0 → 2.1.1)
npm run deploy:patch

# Minor-Version erhöhen (2.1.0 → 2.2.0)  
npm run deploy:minor
```

Das macht automatisch:
1. ✅ Version in `sw.js` erhöhen
2. ✅ Version in `version.json` erhöhen  
3. ✅ App builden
4. ✅ Git commit & push

### Option 2: Manuelles Deployment
```bash
# 1. Version erhöhen
node scripts/update-version.js

# 2. Build erstellen
npm run build

# 3. Zu Git hinzufügen
git add .
git commit -m "Release v2.1.1"
git push origin main
```

---

## 🔄 Wie funktioniert das Auto-Update?

### 1. Service Worker erkennt neue Version
```javascript
// sw.js - Neue CACHE_NAME = neue Version
const CACHE_NAME = 'energy-scan-v2.1.0';
```

### 2. PWA Update Manager prüft regelmäßig
```typescript
// Prüft alle 30 Sekunden auf Updates
pwaUpdateManager.checkForUpdates();
```

### 3. Benutzer sieht Update-Prompt
```
┌─────────────────────────────────┐
│ 🎉 Neue Version verfügbar!      │
│ Version: 2.1.0 → 2.1.1          │
│                                 │
│ [Jetzt aktualisieren] [Später] │
└─────────────────────────────────┘
```

### 4. Update wird automatisch angewendet
- Alte Caches werden gelöscht
- Neue Version wird geladen
- Seite wird automatisch neu geladen

---

## 🎯 Best Practices

### Wann Version erhöhen?

**Patch (x.x.1)** - Bugfixes & kleine Änderungen
```bash
npm run deploy:patch
```
Beispiele:
- Fehler behoben
- Text korrigiert
- Performance-Verbesserung

**Minor (x.1.0)** - Neue Features
```bash
npm run deploy:minor
```
Beispiele:
- Termine-Feature hinzugefügt
- CallBack-Liste implementiert
- Neue UI-Komponente

**Major (1.0.0)** - Breaking Changes
```bash
npm run version:bump:major
npm run build
git add .
git commit -m "Release v2.0.0 - Major update"
git push origin main
```
Beispiele:
- Komplettes Redesign
- API-Änderungen
- Datenbank-Migration

---

## 🛠️ Troubleshooting

### Problem: Benutzer sieht Update-Prompt nicht

**Lösung 1**: Cache manuell löschen
```javascript
// Im Browser Console ausführen
await pwaUpdateManager.forceClearAndReload();
```

**Lösung 2**: Hard Refresh
- **Windows**: `Ctrl + Shift + R`
- **Mac**: `Cmd + Shift + R`

**Lösung 3**: Service Worker neu registrieren
1. DevTools öffnen (F12)
2. Application → Service Workers
3. "Unregister" klicken
4. Seite neu laden

### Problem: Alte Version wird immer noch angezeigt

**Ursache**: Version wurde nicht erhöht

**Lösung**:
```bash
# Version prüfen
cat client/public/version.json

# Version manuell erhöhen
node scripts/update-version.js

# Build und Deploy
npm run build
git add .
git commit -m "Version bump"
git push origin main
```

### Problem: Service Worker funktioniert nicht

**Lösung**: Service Worker-Cache komplett löschen
```javascript
// In Browser Console
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  });
}
```

---

## 📋 Deployment Checkliste

Vor dem Deployment:

- [ ] Alle Features getestet
- [ ] Build erfolgreich (`npm run build`)
- [ ] Keine TypeScript Fehler (`npm run check`)
- [ ] Git status clean

Deployment:

- [ ] `npm run deploy:patch` ausgeführt
- [ ] Railway/Hosting automatisch deployed
- [ ] Version auf Production überprüft

Nach dem Deployment:

- [ ] Update-Prompt erscheint für Benutzer
- [ ] Neue Features funktionieren
- [ ] Keine Console-Fehler

---

## 🔍 Version überprüfen

### Im Browser
```javascript
// Console
fetch('/version.json').then(r => r.json()).then(console.log)
```

### Service Worker Version
```javascript
// Console
navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' });
```

### Aktuell deployed
Öffne: `https://your-app.com/version.json`

---

## 💡 Tipps

1. **Immer Version erhöhen** vor Deployment
2. **Sinnvolle Commit-Messages** verwenden
3. **Features dokumentieren** in version.json
4. **Benutzer testen lassen** vor Production-Deploy

### Beispiel version.json
```json
{
  "version": "2.1.0",
  "buildTime": "2025-10-14T12:00:00.000Z",
  "buildNumber": "appointments-callback-release",
  "features": [
    "Termine-Feature vollständig",
    "CallBack-Liste mit Datensatz-Laden",
    "Deutsche Zeitzone (MEZ/MESZ)",
    "Optimierte Tabellenansicht"
  ]
}
```

---

## 🚨 Notfall: Sofortiges Force-Update

Falls kritischer Bug und Benutzer müssen SOFORT updaten:

```javascript
// In main.tsx oder App.tsx
useEffect(() => {
  // Force update check on every load
  pwaUpdateManager.checkForUpdates();
  
  // Auto-apply update after 5 seconds
  setTimeout(() => {
    if (pwaUpdateManager.hasUpdate()) {
      pwaUpdateManager.applyUpdate();
    }
  }, 5000);
}, []);
```

---

## 📚 Weitere Infos

- [PWA Update Strategies](https://web.dev/service-worker-lifecycle/)
- [Cache Busting Best Practices](https://web.dev/http-cache/)
- [Service Worker Updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates/)
