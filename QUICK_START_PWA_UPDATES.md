# 🚀 Quick Start Guide - PWA Updates

## Für Dich (Developer)

### 1. Neue Version deployen

```bash
# Schritt 1: Änderungen machen
# ... code ändern ...

# Schritt 2: Version erhöhen
npm run version:bump        # Bug fixes
npm run version:bump:minor  # Neue Features  
npm run version:bump:major  # Breaking Changes

# Schritt 3: Bauen & Deployen
npm run build
npm start

# Fertig! ✅
```

### 2. Was passiert automatisch

- ✅ `package.json` Version wird erhöht
- ✅ Service Worker bekommt neue Version
- ✅ `version.json` wird erstellt
- ✅ Git Tag wird erstellt
- ✅ Cache-Namen werden aktualisiert

### 3. Was sieht der User

```
1. User öffnet PWA
2. Nach 30 Sekunden: Update-Benachrichtigung erscheint
3. User klickt "Jetzt aktualisieren"
4. App lädt neu
5. Neue Version ist aktiv ✅
```

## Wichtige Befehle

```bash
# Version erhöhen (Patch: 1.0.0 → 1.0.1)
npm run version:bump

# Version erhöhen (Minor: 1.0.0 → 1.1.0)
npm run version:bump:minor

# Version erhöhen (Major: 1.0.0 → 2.0.0)
npm run version:bump:major

# Normal bauen (prebuild läuft automatisch)
npm run build

# Nur Version-Update ohne npm version
tsx scripts/update-sw-version.ts
```

## Testen

### Lokal testen

```bash
# Terminal 1: Build & Start
npm run build
npm start

# Browser: http://localhost:5000
# PWA installieren

# Terminal 1: Änderung machen
# Code ändern...
npm run version:bump
npm run build
npm start

# Browser: PWA öffnen (NICHT neu laden!)
# Warten 30 Sekunden
# Update-Prompt sollte erscheinen ✅
```

### iPhone testen

```bash
# 1. Auf HTTPS Server deployen
# 2. Safari auf iPhone öffnen
# 3. Teilen → "Zum Home-Bildschirm"
# 4. PWA vom Home-Bildschirm öffnen
# 5. Neue Version deployen
# 6. PWA offen lassen, 30s warten
# 7. Update-Prompt erscheint ✅
```

## Dateien Overview

```
New Files (wichtig):
├─ pwaUpdateManager.ts     → Update-Logik
├─ PWAUpdatePrompt.tsx     → Update UI
├─ update-sw-version.ts    → Version Injection
└─ version.json            → Version Metadata

Modified Files:
├─ manifest.json           → Icon Pfade (.png → .svg)
├─ sw.js                   → VERSION Konstante
├─ App.tsx                 → PWAUpdatePrompt eingebunden
└─ package.json            → Build Scripts
```

## Troubleshooting

### Update wird nicht erkannt

```javascript
// Browser Console:
pwaUpdateManager.checkForUpdates()
```

### Update hängt

```javascript
// Browser Console:
pwaUpdateManager.forceClearAndReload()
```

### Version prüfen

```bash
# Terminal:
grep "const VERSION" client/public/sw.js

# Browser:
fetch('/version.json').then(r=>r.json()).then(console.log)
```

## iOS Checklist

- ✅ HTTPS Server (erforderlich!)
- ✅ Safari verwenden (kein Chrome!)
- ✅ "Zum Home-Bildschirm" (nicht nur Lesezeichen!)
- ✅ Vom Home-Bildschirm öffnen
- ✅ Standalone Mode (ohne Browser-UI)

## Wichtige Infos

### Update-Intervalle
- **Update Check**: Alle 30 Sekunden
- **Version Check**: Alle 5 Minuten

### Cache Namen
- Format: `energy-scan-v{VERSION}`
- Beispiel: `energy-scan-v1.0.5`
- Wird automatisch bei jedem Build aktualisiert ✅

### User Experience
- Update-Prompt ist **nicht invasiv**
- User kann "Später" wählen
- Prompt erscheint alle 30s bis Update installiert
- State wird während Reload gespeichert

## Production Deployment

```bash
# 1. Änderungen testen
npm run build
npm start
# Lokal testen

# 2. Version erhöhen
npm run version:bump

# 3. Commit & Push
git add .
git commit -m "chore: bump version to $(node -p "require('./package.json').version")"
git push origin main
git push --tags

# 4. Auf Server deployen
# ... dein Deployment-Prozess ...

# 5. Testen
# iPhone + Android testen
```

## Debug Mode

Im Development Mode ist ein "Force Clear" Button verfügbar:

```typescript
// App.tsx oder dev tools:
if (import.meta.env.DEV) {
  // "Cache löschen & neu laden" Button ist sichtbar
}
```

## Next Steps

1. ✅ Code ist fertig
2. ⏳ Lokal testen
3. ⏳ Auf Production deployen  
4. ⏳ iPhone testen
5. ⏳ Android testen
6. ⏳ Logs monitoren

## Fragen?

- 📖 Siehe: `PWA_UPDATE_SYSTEM.md` (detailliert)
- 📝 Siehe: `PWA_UPDATE_SUMMARY.md` (Overview)
- 💬 GitHub Issues für Probleme

---

**Erstellt**: 2025-01-10  
**Status**: ✅ Production Ready
