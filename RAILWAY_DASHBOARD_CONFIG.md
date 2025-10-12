# 🚨 Railway Healthcheck - Dashboard Konfiguration erforderlich!

## ❌ Problem

Railway nutzt **NICHT** den Pfad aus `railway.toml`!

Log zeigt:
```
Path: /api/auth/check  ❌ (braucht Auth Cookie)
```

Railway liest Healthcheck-Konfiguration aus den **Service Settings**, nicht aus der Datei!

---

## ✅ Lösung: Healthcheck im Dashboard ändern

### Schritt 1: Railway Dashboard öffnen

```
1. Gehe zu: https://railway.app
2. Login mit GitHub
3. Öffne dein Projekt: "marketing-tool" oder "energy-scan-capture"
```

### Schritt 2: Service Settings öffnen

```
1. Klick auf deinen Service (die Box mit dem App-Namen)
2. Klick auf "Settings" Tab (oben)
3. Scroll runter zu "Healthcheck" Sektion
```

### Schritt 3: Healthcheck Path ändern

**Du siehst aktuell**:
```
Healthcheck Path: /api/auth/check
```

**Ändere zu**:
```
Healthcheck Path: /api/auth/health
```

**Wichtig**: Entferne den alten Pfad und gib den neuen ein:
```
/api/auth/health
```

### Schritt 4: Speichern & Re-Deploy

```
1. Klick "Save" oder drück Enter
2. Railway startet automatisch einen neuen Deploy
3. Warte 1-2 Minuten
```

---

## 📋 Visual Guide

**Railway Settings Location**:
```
Dashboard
  └─ Your Project
      └─ Service (Click)
          └─ Settings Tab
              └─ Scroll to "Healthcheck"
                  └─ Healthcheck Path: [/api/auth/health]
                      └─ Save
```

**Healthcheck Settings Sektion sollte haben**:
```
┌─────────────────────────────────────────┐
│ Healthcheck                             │
├─────────────────────────────────────────┤
│ Healthcheck Path                        │
│ ┌─────────────────────────────────────┐ │
│ │ /api/auth/health                    │ │ ← Ändere hier!
│ └─────────────────────────────────────┘ │
│                                         │
│ Healthcheck Timeout                     │
│ ┌─────────────────────────────────────┐ │
│ │ 300 seconds                         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 🔍 Was passiert nach der Änderung

**Railway startet neuen Deploy**:
```
Building...
✅ Build successful

Starting Healthcheck
Path: /api/auth/health  ✅ (Neuer Pfad!)
Retry window: 5m0s

Attempt #1 succeeded! ✅
1/1 replicas became healthy

Deployment successful!
```

**Dann siehst du**:
```
Service Status: Running ✅
Health: Healthy ✅
URL: https://your-app.up.railway.app
```

---

## 🧪 Nach dem Deploy testen

### 1. Health Endpoint testen

```bash
# Im Browser oder mit curl:
https://your-app.up.railway.app/api/auth/health

Expected Response: 200 OK
{
  "status": "ok",
  "timestamp": "2025-10-13T...",
  "service": "energy-scan-capture-api"
}
```

### 2. PWA öffnen

```
https://your-app.up.railway.app

✅ Login-Seite sollte laden
✅ Keine Fehler in Console
✅ App funktioniert
```

---

## ⚠️ Wichtig zu wissen

### Railway Dashboard vs. railway.toml

**Railway ignoriert `railway.toml` für Healthchecks!**

```
railway.toml:
  [healthcheck]
    path = "/api/auth/health"
  
→ Wird NICHT automatisch übernommen! ❌
→ Muss im Dashboard manuell gesetzt werden! ✅
```

**Warum?**

Railway liest Konfiguration in dieser Reihenfolge:
1. **Dashboard Settings** (höchste Priorität)
2. Service Variables
3. railway.toml (nur für Builds)

### PORT Variable

Railway setzt automatisch:
```
PORT=<random-port>
```

Dein Code nutzt bereits:
```typescript
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
```

→ **Das ist korrekt!** ✅

### Healthcheck Hostname

Railway nutzt:
```
Host: healthcheck.railway.app
```

Falls deine App den Host prüft, musst du diesen erlauben.

**Check**: Hast du Host-Restrictions in deinem Code?
```typescript
// Falls du sowas hast:
if (req.headers.host !== 'my-app.com') {
  return res.status(403).send('Forbidden');
}

// Dann musst du erlauben:
const allowedHosts = [
  'my-app.com',
  'healthcheck.railway.app'  // ← Railway Healthcheck
];
```

**In deinem Code**: Kein Host-Check → **Sollte OK sein** ✅

---

## 🐛 Troubleshooting

### Problem 1: Healthcheck Path nicht gefunden im Dashboard

**Falls du keine "Healthcheck" Sektion siehst**:

1. Stelle sicher du bist im **Service Settings** (nicht Project Settings)
2. Scroll weiter runter - manchmal weiter unten
3. Oder: Gehe zu "Deployments" → Click auf failed deployment → "Configure Healthcheck"

### Problem 2: Health Endpoint antwortet nicht

**Check ob Server überhaupt startet**:

```
Railway Dashboard → Deployments → Click deployment → "View Logs"

Look for:
✅ "Server running on port 5000"
✅ "Environment: production"

Or errors like:
❌ "Error: Cannot find module..."
❌ "TypeError: ..."
```

**Falls Server nicht startet**:

```
Check Runtime Logs für Error Messages
Dann sag mir den Error - ich helfe!
```

### Problem 3: Port-Probleme

**Falls "service unavailable" weiterhin**:

Railway Dashboard → Variables → Check:
```
PORT: Should be auto-set by Railway
NODE_ENV: production
```

**Manually set if needed**:
```
PORT = 5000
```

### Problem 4: Build erfolgreich aber Server startet nicht

**Check Start Command**:
```
Railway Settings → Start Command

Should be: npm start
```

**Check dass dist/index.js existiert**:
```
Railway Logs → Build Logs

Should see:
npm run build
✅ Built dist/index.js
```

---

## 📊 Expected Behavior

### Successful Deploy Timeline:

```
[0s]   Starting build...
[30s]  npm ci
[40s]  npm run build
[45s]  Build complete ✅

[46s]  Starting healthcheck
[46s]  Path: /api/auth/health
[47s]  Attempt #1 succeeded! ✅

[47s]  Routing traffic to new deployment
[48s]  Deployment successful! ✅
```

### Failed Deploy (current):

```
[0s]   Starting build...
[40s]  Build complete ✅

[46s]  Starting healthcheck
[46s]  Path: /api/auth/check  ❌ (Wrong path!)
[47s]  Attempt #1 failed: service unavailable
[...] Retrying 13 times...
[5m]  Healthcheck failed! ❌
```

---

## 🎯 Quick Fix Summary

```
1. Railway Dashboard öffnen
2. Service → Settings
3. Healthcheck Path: /api/auth/health
4. Save
5. Warte auf neuen Deploy
6. ✅ Should work now!
```

---

## 🔄 Alternative: Healthcheck komplett deaktivieren

**Falls du den Health-Endpoint nicht nutzen willst**:

```
Railway Dashboard → Settings → Healthcheck

Option 1: Lass "Healthcheck Path" leer
→ Railway nutzt TCP Port Check

Option 2: Setze sehr langen Timeout
→ RAILWAY_HEALTHCHECK_TIMEOUT_SEC = 600
```

**Aber**: Ich empfehle den Health-Endpoint zu nutzen!
- ✅ Sauberer
- ✅ Garantiert Zero-Downtime
- ✅ Bessere Fehler-Detection

---

## 📞 Next Steps

1. **Jetzt**: Healthcheck Path im Dashboard ändern
2. **Warten**: 2-3 Minuten für neuen Deploy
3. **Check**: Logs sollten "Attempt #1 succeeded!" zeigen
4. **Test**: URL öffnen → App sollte laden
5. **Report**: Sag mir ob es funktioniert! 🎉

---

## 💡 Pro Tip: Health Endpoint erweitern

**Optional** - Für noch bessere Healthchecks:

```typescript
// server/routes/auth.ts
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Check verschiedene Services
    const checks = {
      server: 'ok',
      googleSheets: googleSheetsService ? 'ok' : 'disabled',
      timestamp: new Date().toISOString()
    };
    
    res.status(200).json({
      status: 'healthy',
      checks,
      service: 'energy-scan-capture-api'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
```

**Aber für jetzt**: Simple Version reicht! ✅

---

**Created**: 2025-10-13  
**Status**: 🔴 Requires Manual Dashboard Configuration  
**Action**: Change Healthcheck Path in Railway Dashboard to `/api/auth/health`
