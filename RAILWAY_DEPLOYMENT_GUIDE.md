# 🚂 Railway.app Deployment - Schritt für Schritt

## Warum Railway?

- ✅ **Einfachstes Deployment** für Node.js Apps
- ✅ **$5 Free Credit** jeden Monat (reicht für deine App!)
- ✅ **Automatisches Deployment** von GitHub
- ✅ **PostgreSQL** inklusive (falls später benötigt)
- ✅ **Automatisches HTTPS**
- ✅ **Custom Domains** möglich
- ✅ **Environment Variables** einfach zu setzen

---

## Schritt 1: Railway Account erstellen

1. Gehe zu: **https://railway.app**
2. Klick: **"Start a New Project"**
3. Sign up mit **GitHub**
4. Authorisiere Railway für GitHub Zugriff

✅ **Fertig!** - Du hast jetzt ein Railway Dashboard

---

## Schritt 2: Projekt deployen

### Option A: Über Railway Dashboard (Empfohlen)

1. **Im Railway Dashboard**:
   - Klick: **"New Project"**
   - Wähle: **"Deploy from GitHub repo"**

2. **Repository auswählen**:
   - Suche: `marketing-tool`
   - Oder: `Damian-Kudla/marketing-tool`
   - Klick auf das Repository

3. **Deployment startet automatisch!** 🎉
   - Railway erkennt automatisch: Node.js Project
   - Installiert Dependencies: `npm install`
   - Buildet App: `npm run build`
   - Startet Server: `npm start`

4. **Warte 2-3 Minuten**
   - Du siehst Live-Logs im Dashboard
   - Status: "Building" → "Deploying" → "Success" ✅

5. **URL öffnen**:
   - Klick auf dein Projekt
   - Klick: **"Settings"** → **"Domains"**
   - Klick: **"Generate Domain"**
   - Railway erstellt URL: `https://your-app.up.railway.app`
   - **Kopiere die URL und öffne sie!** 🚀

### Option B: Über Railway CLI (Fortgeschritten)

```bash
# 1. Railway CLI installieren
npm install -g @railway/cli

# 2. Login
railway login

# 3. In dein Projekt-Verzeichnis
cd "C:\Users\damia\Documents\Marketing Tool\EnergyScanCapture"

# 4. Railway Projekt erstellen und deployen
railway init
railway up

# 5. URL generieren
railway domain

# Fertig! ✅
```

---

## Schritt 3: Environment Variables setzen (Optional)

Deine App **funktioniert auch ohne diese**, aber für Google Services:

1. **Im Railway Dashboard**:
   - Klick auf dein Projekt
   - Klick: **"Variables"** Tab

2. **Füge Variables hinzu**:

   **Klick: "New Variable"** für jede:

   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL
   Wert: dein-service-account@project.iam.gserviceaccount.com
   ```

   ```
   GOOGLE_PRIVATE_KEY
   Wert: -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
   ```

   ```
   GOOGLE_SPREADSHEET_ID
   Wert: deine-spreadsheet-id
   ```

3. **App wird automatisch neu deployed!**
   - Railway detected Variables changed
   - Rebuild & Redeploy automatisch

---

## Schritt 4: Custom Domain (Optional)

### Kostenlose Railway Domain

Bereits automatisch erstellt:
```
https://energy-scan-capture.up.railway.app
```

### Eigene Domain verbinden

1. **Domain kaufen** (z.B. bei Namecheap, GoDaddy)

2. **In Railway**:
   - Settings → Domains
   - Klick: **"Custom Domain"**
   - Eingabe: `app.deine-domain.com`

3. **DNS Settings bei Domain-Provider**:
   ```
   Type: CNAME
   Name: app
   Value: [Railway gibt dir die URL]
   TTL: 3600
   ```

4. **Warte 5-10 Minuten**
   - DNS Propagation
   - Railway verified Domain
   - HTTPS automatisch aktiviert! ✅

---

## Schritt 5: Automatic Deployments

### GitHub Integration (Automatisch aktiv)

Railway deployt **automatisch** bei jedem Git Push:

```bash
# Lokal Änderungen machen
git add .
git commit -m "feat: neue Funktion"
git push origin main

# Railway erkennt Push → Automatic Deployment! 🚀
```

### Deployment Status prüfen

1. **Railway Dashboard öffnen**
2. **"Deployments"** Tab
3. Siehst alle Deployments:
   - ✅ Success
   - ⏳ Building
   - ❌ Failed (mit Logs)

### Logs ansehen

```bash
# Im Railway Dashboard:
- Klick auf Deployment
- Sieh Build Logs & Runtime Logs

# Oder via CLI:
railway logs
```

---

## Kosten & Free Tier

### Free Tier

- **$5 Free Credit** jeden Monat
- Reicht für:
  - **~700 Stunden** App-Laufzeit
  - **Kleine bis mittlere** Traffic-Mengen
  - **Development & Testing**

### Was kostet deine App?

**Geschätzt**: ~$3-5/Monat bei normaler Nutzung

- **Always-on**: ~$2-3/Monat
- **Traffic**: ~$1/Monat (100GB Free, danach $0.10/GB)
- **Builds**: Kostenlos

**Tipp**: Free $5 Credit deckt das komplett ab! 🎉

### Wenn Free Credit aufgebraucht

- Railway schickt Email-Warnung bei 80%
- Du kannst Kreditkarte hinzufügen
- Oder: App geht in "sleep mode" bis nächster Monat

---

## Troubleshooting

### App startet nicht

**Check Build Logs**:
```
Railway Dashboard → Deployments → Click failed deployment → View logs
```

**Häufige Probleme**:

1. **Dependencies fehlen**:
   ```bash
   # Lösung: Sicherstellen dass package.json committed ist
   git add package.json package-lock.json
   git commit -m "fix: add dependencies"
   git push
   ```

2. **Build Command falsch**:
   ```bash
   # Railway sollte automatisch erkennen, aber manuell setzen:
   Settings → Build Command → npm run build
   Settings → Start Command → npm start
   ```

3. **Port Problem**:
   ```bash
   # Railway setzt automatisch PORT Variable
   # Dein Code nutzt bereits: process.env.PORT || 5000
   # Sollte funktionieren ✅
   ```

### App läuft aber zeigt Fehler

**Check Runtime Logs**:
```
Railway Dashboard → Deployments → View Logs → Runtime
```

**Häufige Fehler**:

1. **Google Services Error**:
   ```
   Warning: Google Sheets credentials missing
   ```
   - **Ignorieren!** - App funktioniert auch ohne
   - Oder: Environment Variables setzen (siehe Schritt 3)

2. **Database Connection Error**:
   ```
   Error: Cannot connect to database
   ```
   - **Normal!** - Du nutzt in-memory Storage
   - Oder: PostgreSQL Database hinzufügen (optional)

### Domain funktioniert nicht

**Check DNS**:
```bash
# Windows PowerShell:
nslookup app.deine-domain.com

# Sollte zeigen: Railway IP/CNAME
```

**Warte**: DNS braucht 5-60 Minuten

**Check Railway**:
- Settings → Domains → Status muss "Active" sein

---

## PWA auf Railway

### Funktioniert alles automatisch! ✅

- ✅ HTTPS automatisch aktiv
- ✅ Service Worker funktioniert
- ✅ Manifest.json wird ausgeliefert
- ✅ Icons laden korrekt
- ✅ Installierbar auf iOS & Android

### PWA testen:

1. **Öffne Railway URL** in Chrome/Safari
2. **"Zum Home-Bildschirm" / "Install"**
3. **Öffne PWA vom Home Screen**
4. **Teste Offline-Modus**
5. **Test Update-Mechanismus**:
   ```bash
   # Lokal Version bumpen
   npm run version:bump
   
   # Commit & Push
   git add .
   git commit -m "chore: bump version"
   git push
   
   # Railway deployt automatisch
   # PWA zeigt Update-Notification! ✅
   ```

---

## Monitoring & Logs

### Live Logs ansehen

```bash
# Via Railway CLI:
railway logs --follow

# Oder im Dashboard:
Deployments → Click deployment → Logs Tab
```

### Metrics ansehen

```bash
Railway Dashboard → Metrics Tab

Zeigt:
- CPU Usage
- Memory Usage  
- Network Traffic
- Request Count
```

### Alerts einrichten

```bash
Settings → Notifications
- Email bei Failed Deployments
- Slack Webhook möglich
- Discord Webhook möglich
```

---

## Nächste Schritte

### Nach erstem Deployment:

1. ✅ **Teste die App**
   - Öffne Railway URL
   - Login testen
   - Foto Capture testen
   - OCR testen
   - Daten speichern testen

2. ✅ **PWA installieren**
   - iPhone: Safari → "Zum Home-Bildschirm"
   - Android: Chrome → "Install App"

3. ✅ **Auto-Deployment testen**
   - Kleine Änderung machen
   - Git Push
   - Railway deployt automatisch
   - PWA Update-Notification erscheint

4. ✅ **Environment Variables** (optional)
   - Google Services konfigurieren
   - Teste erweiterte Features

### Weitere Features:

- **PostgreSQL hinzufügen**: Railway Dashboard → New → Database → PostgreSQL
- **Redis hinzufügen**: Für Session Storage
- **Custom Domain**: Eigene Domain verbinden
- **Backups**: Automatische Backups aktivieren

---

## Support

### Railway Docs
https://docs.railway.app

### Railway Discord
https://discord.gg/railway

### Probleme?
- Check Deployment Logs
- Check Runtime Logs
- Sag mir Bescheid - ich helfe! 💪

---

## Zusammenfassung

```bash
1. railway.app → "New Project" → "Deploy from GitHub"
2. Wähle: Damian-Kudla/marketing-tool
3. Warte 2-3 Minuten
4. Generate Domain
5. Fertig! 🎉

Optional:
- Environment Variables setzen
- Custom Domain verbinden
- Monitoring einrichten
```

**So einfach ist Deployment auf Railway!** 🚂✨

---

**Erstellt**: 2025-10-12  
**Status**: ✅ Production Ready  
**Geschätzte Kosten**: $3-5/Monat (Free $5 Credit verfügbar!)
