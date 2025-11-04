# 📱 iOS Capacitor Setup Guide - Background GPS Tracking

**Ziel:** EnergyScanCapture als native iOS App mit konstantem Background-GPS-Tracking

---

## 🚀 Teil 1: Capacitor Installation & Setup

### Schritt 1: Capacitor zum Projekt hinzufügen

```bash
# Im Root-Verzeichnis des Projekts
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios

# Capacitor initialisieren
npx cap init
```

**Bei den Fragen eingeben:**
- **App name:** EnergyScanCapture
- **App Package ID:** com.energyscan.capture (oder deine Firma)
- **Web asset directory:** dist/public (das ist wo Vite die Build-Dateien ablegt)

### Schritt 2: iOS Platform hinzufügen

```bash
# iOS Platform erstellen
npx cap add ios

# Projekt bauen
npm run build

# Dateien nach iOS kopieren
npx cap sync ios
```

Dies erstellt einen `ios/` Ordner mit dem Xcode-Projekt.

---

## 📍 Teil 2: Background Geolocation Plugin installieren

### Schritt 3: Capacitor Background Geolocation Plugin

Es gibt mehrere Optionen. Ich empfehle **Capacitor Background Geolocation** (am besten für iOS):

```bash
npm install @capacitor-community/background-geolocation
npx cap sync ios
```

**Alternative** (wenn mehr Features benötigt werden):
```bash
# Transistor Software's Background Geolocation (kostenpflichtig für Production)
npm install cordova-plugin-background-geolocation-lt
npm install @transistorsoft/capacitor-background-geolocation
npx cap sync ios
```

---

## ⚙️ Teil 3: iOS Konfiguration für Background GPS

### Schritt 4: Info.plist Berechtigungen hinzufügen

Öffne `ios/App/App/Info.plist` in Xcode oder Texteditor und füge hinzu:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
</array>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Wir benötigen Ihren Standort im Hintergrund, um Ihre Route während der Arbeit zu verfolgen und Berichte zu erstellen.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Wir benötigen Ihren Standort, um Fotos mit GPS-Daten zu versehen und Ihre Position auf der Karte anzuzeigen.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>Wir benötigen dauerhaften Zugriff auf Ihren Standort, um Ihre Arbeitsroute zu verfolgen, auch wenn die App im Hintergrund läuft.</string>

<key>NSMotionUsageDescription</key>
<string>Wir verwenden Bewegungsdaten, um Ihre Aktivität während der Arbeit zu optimieren.</string>
```

### Schritt 5: Capabilities in Xcode aktivieren

1. Öffne `ios/App/App.xcworkspace` in Xcode (nicht .xcodeproj!)
2. Wähle das **App Target** links
3. Gehe zu **Signing & Capabilities**
4. Klicke **+ Capability**
5. Füge hinzu:
   - ✅ **Background Modes**
     - Location updates
     - Background fetch
     - Remote notifications (optional für Push)

---

## 💻 Teil 4: Background Geolocation Service implementieren

### Schritt 6: Service-Datei erstellen

Erstelle `client/src/services/backgroundGeolocation.ts`:

```typescript
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

// Falls du @capacitor-community/background-geolocation verwendest
import BackgroundGeolocation from '@capacitor-community/background-geolocation';

// Falls du @transistorsoft verwendet:
// import BackgroundGeolocation from '@transistorsoft/capacitor-background-geolocation';

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

class BackgroundGeolocationService {
  private isConfigured = false;
  private userId: string | null = null;
  private username: string | null = null;
  private apiBaseUrl: string = import.meta.env.VITE_API_URL || 'https://your-api.com';

  async configure(userId: string, username: string) {
    if (!Capacitor.isNativePlatform()) {
      console.log('[BackgroundGPS] Not on native platform, skipping configuration');
      return;
    }

    this.userId = userId;
    this.username = username;

    try {
      // Konfiguration für @capacitor-community/background-geolocation
      await BackgroundGeolocation.addWatcher(
        {
          // Hintergrund-Updates aktivieren
          backgroundMessage: "GPS-Tracking läuft im Hintergrund",
          backgroundTitle: "EnergyScanCapture",
          
          // GPS-Genauigkeit
          requestPermissions: true,
          stale: false,
          
          // Update-Intervall (in Millisekunden)
          // 300000ms = 5 Minuten (gut für Akku-Schonung)
          distanceFilter: 50, // Nur updaten wenn mindestens 50m bewegt
        },
        (location, error) => {
          if (error) {
            console.error('[BackgroundGPS] Error:', error);
            return;
          }

          if (location) {
            console.log('[BackgroundGPS] Location received:', location);
            this.sendGPSToServer({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              timestamp: location.time || Date.now(),
            });
          }
        }
      );

      this.isConfigured = true;
      console.log('[BackgroundGPS] Configured successfully');
    } catch (error) {
      console.error('[BackgroundGPS] Configuration failed:', error);
      throw error;
    }
  }

  private async sendGPSToServer(gpsPoint: GPSPoint) {
    if (!this.userId || !this.username) {
      console.warn('[BackgroundGPS] No user info, skipping GPS send');
      return;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/tracking/gps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Wichtig für Cookies/Session
        body: JSON.stringify({
          latitude: gpsPoint.latitude,
          longitude: gpsPoint.longitude,
          accuracy: gpsPoint.accuracy,
          timestamp: gpsPoint.timestamp,
        }),
      });

      if (!response.ok) {
        console.error('[BackgroundGPS] Server error:', response.status);
      } else {
        console.log('[BackgroundGPS] GPS sent successfully');
      }
    } catch (error) {
      console.error('[BackgroundGPS] Failed to send GPS:', error);
      // TODO: Queue für Offline-Modus implementieren
    }
  }

  async start() {
    if (!this.isConfigured) {
      throw new Error('BackgroundGeolocation not configured. Call configure() first.');
    }

    console.log('[BackgroundGPS] Starting...');
    // Plugin ist bereits aktiv durch addWatcher
  }

  async stop() {
    console.log('[BackgroundGPS] Stopping...');
    await BackgroundGeolocation.removeWatcher({
      id: 'background-watcher' // Falls du eine ID vergeben hast
    });
  }

  async requestPermissions() {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    try {
      // Berechtigungen werden automatisch beim addWatcher angefragt
      // wenn requestPermissions: true gesetzt ist
      return true;
    } catch (error) {
      console.error('[BackgroundGPS] Permission request failed:', error);
      return false;
    }
  }
}

export const backgroundGeolocationService = new BackgroundGeolocationService();
```

### Schritt 7: In Login-Flow integrieren

In `client/src/contexts/AuthContext.tsx` oder wo der Login erfolgt:

```typescript
import { backgroundGeolocationService } from '../services/backgroundGeolocation';
import { Capacitor } from '@capacitor/core';

// Nach erfolgreichem Login:
if (Capacitor.isNativePlatform()) {
  try {
    await backgroundGeolocationService.configure(user.id, user.username);
    await backgroundGeolocationService.requestPermissions();
    await backgroundGeolocationService.start();
    console.log('Background GPS tracking started');
  } catch (error) {
    console.error('Failed to start background GPS:', error);
  }
}

// Beim Logout:
if (Capacitor.isNativePlatform()) {
  await backgroundGeolocationService.stop();
}
```

---

## 🔋 Teil 5: Battery & Performance Optimierung

### Schritt 8: Adaptive GPS-Intervalle

Für bessere Akku-Laufzeit kannst du die GPS-Updates dynamisch anpassen:

```typescript
// Mehr Updates wenn User aktiv (App im Vordergrund)
// Weniger Updates wenn inaktiv (App im Hintergrund)

// Vordergrund: Alle 30 Sekunden, 20m Genauigkeit
// Hintergrund: Alle 5 Minuten, 50m Genauigkeit
```

### Schritt 9: Offline-Queue implementieren

```typescript
// Falls keine Internet-Verbindung, GPS-Punkte lokal speichern
// und später synchronisieren wenn Online

import { Preferences } from '@capacitor/preferences';

async function queueGPSPoint(point: GPSPoint) {
  const queue = await getOfflineQueue();
  queue.push(point);
  await Preferences.set({
    key: 'gps_offline_queue',
    value: JSON.stringify(queue)
  });
}

async function syncOfflineQueue() {
  const queue = await getOfflineQueue();
  
  for (const point of queue) {
    await sendGPSToServer(point);
  }
  
  // Queue leeren
  await Preferences.remove({ key: 'gps_offline_queue' });
}
```

---

## 🛠️ Teil 6: Build & Deployment

### Schritt 10: iOS Build

```bash
# 1. React App bauen
npm run build

# 2. Assets nach iOS kopieren
npx cap sync ios

# 3. Xcode öffnen
npx cap open ios
```

In Xcode:
1. **Signing:** Apple Developer Account eintragen
2. **Build Target:** iPhone auswählen
3. **Run:** App auf physischem iPhone testen (Simulator hat kein GPS)

### Schritt 11: TestFlight Deployment

1. **Archive** in Xcode erstellen (Product → Archive)
2. **Upload to App Store Connect**
3. **TestFlight** aktivieren
4. **Externe Tester** einladen (Team-Mitarbeiter)

---

## ⚠️ Wichtige iOS-Besonderheiten

### Background GPS Einschränkungen:

1. **iOS 11+:** Background-GPS funktioniert nur wenn:
   - User "Always Allow" Location-Permission erteilt hat
   - App mindestens einmal im Vordergrund geöffnet wurde
   - Background Modes korrekt konfiguriert sind

2. **iOS 13+:** User muss explizit "Always Allow" nach erstem "When In Use" bestätigen

3. **iOS 14+:** Approximate Location kann gewählt werden (niedrigere Genauigkeit)

4. **Akku-Warnung:** Bei intensivem Background-GPS zeigt iOS eine Warnung
   - Lösung: Längere Intervalle (5-10 Minuten)
   - Oder: `ActivityType` auf `.automotiveNavigation` setzen

### Apple Review Guidelines:

- **Begründung nötig:** Warum Background GPS?
  - ✅ "Route-Tracking für Außendienstmitarbeiter"
  - ✅ "Arbeitszeit-Dokumentation"
  - ❌ "Überwachung" (wird abgelehnt)

- **Privacy Policy** erforderlich
- **Transparente Kommunikation** in App-Beschreibung

---

## 📋 Checkliste für Production

- [ ] Capacitor installiert & konfiguriert
- [ ] iOS Platform hinzugefügt
- [ ] Background Geolocation Plugin installiert
- [ ] Info.plist Berechtigungen gesetzt
- [ ] Background Modes in Xcode aktiviert
- [ ] Service implementiert & getestet
- [ ] Offline-Queue implementiert
- [ ] Battery-Optimierung getestet
- [ ] Auf physischem iPhone getestet
- [ ] Apple Developer Account eingerichtet
- [ ] Privacy Policy erstellt
- [ ] TestFlight Deployment durchgeführt
- [ ] Team-Feedback eingeholt

---

## 🆘 Troubleshooting

### Problem: GPS funktioniert nicht im Hintergrund

**Lösung:**
1. Prüfe Background Modes in Xcode
2. Prüfe Info.plist Berechtigungen
3. Teste auf echtem iPhone (nicht Simulator)
4. Prüfe ob "Always Allow" erteilt wurde

### Problem: App stürzt beim GPS-Update ab

**Lösung:**
1. Prüfe Console-Logs in Xcode
2. Stelle sicher, dass API-Endpoint erreichbar ist
3. Implementiere Error-Handling in sendGPSToServer()

### Problem: Akku entlädt sich zu schnell

**Lösung:**
1. Erhöhe GPS-Intervall (5-10 Minuten)
2. Erhöhe distanceFilter (100-200m)
3. Verwende `.automotiveNavigation` ActivityType
4. Implementiere "Pause"-Funktion

---

## 🚀 Nächste Schritte

Soll ich dir helfen mit:

1. **Capacitor Installation** durchführen?
2. **Background GPS Service** implementieren?
3. **iOS Xcode-Projekt** konfigurieren?
4. **TestFlight Deployment** vorbereiten?

Lass mich wissen, womit ich anfangen soll! 🎯
