---
mode: agent
---
Update die Version der Webapp per Updater Script. Beachte dabei folgende Instruktionen:

# ❌ FALSCH - nur package.json wird aktualisiert:
npm version patch

# ✅ RICHTIG - alle 5 Stellen werden synchronisiert:
npm run version:bump         # Patch (2.5.4 -> 2.5.5)
npm run version:bump:minor   # Minor (2.5.4 -> 2.6.0)
npm run version:bump:major   # Major (2.5.4 -> 3.0.0)

## Was wird automatisch aktualisiert:
1. **package.json** - Version (durch npm version)
2. **client/public/sw.js** - VERSION constant + alle Cache-Namen
3. **client/index.html** - Meta-Tag app-version
4. **client/src/components/UserButton.tsx** - Fallback-Version im useState und catch
5. **client/public/version.json** - Version + BuildTime (Features bleiben erhalten!)

## Wichtig:
- Das Script (scripts/update-sw-version.ts) läuft automatisch nach npm version
- Features in version.json müssen MANUELL eingetragen werden (werden nicht überschrieben)
- Git working directory muss clean sein (alle Änderungen committed)
- Nach dem Update: Git commit + push nicht vergessen!

## Workflow:
1. Alle Änderungen committen (git working directory clean)
2. `npm run version:bump:minor` ausführen
3. Features in version.json manuell eintragen/aktualisieren
4. Git commit mit Version-Update
5. Git push

