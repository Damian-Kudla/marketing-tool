---
mode: agent
---
Update die Version der Webapp per Updater Script. Beachte dabei folgende Instruktionen:
# ❌ FALSCH - nur package.json wird aktualisiert:
npm version patch

# ✅ RICHTIG - alle 6 Stellen werden synchronisiert:
npm run version:bump         # Patch (2.5.4 -> 2.5.5)
npm run version:bump:minor   # Minor (2.5.4 -> 2.6.0)
npm run version:bump:major   # Major (2.5.4 -> 3.0.0)


