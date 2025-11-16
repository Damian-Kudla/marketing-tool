# Device Fingerprinting & Multi-Device Tracking

## Übersicht

Das System unterstützt jetzt Device-Fingerprinting, um zwischen mehreren Geräten zu unterscheiden, die mit demselben Benutzer eingeloggt sind. Jedes Gerät erhält eine eindeutige ID, die in den Session-Cookies gespeichert und mit allen Tracking-Daten verknüpft wird.

## Features

### 1. **Eindeutige Device-ID**
- Jedes Gerät erhält eine eindeutige Fingerprint-ID
- Die ID wird aus mehreren gerätespezifischen Merkmalen generiert:
  - User Agent
  - Screen Resolution & Color Depth
  - Timezone & Language
  - Hardware (CPU cores, RAM, Touch Points)
  - Canvas & WebGL Fingerprinting
  - Random Seed (in localStorage gespeichert)

### 2. **Persistenz**
- Device-ID wird in localStorage gespeichert
- Bleibt über Browser-Sessions hinweg erhalten
- Wird bei jedem Login automatisch initialisiert

### 3. **Cookie-Storage mit Device-Info**
- Jeder Session-Cookie wird mit Device-Info verknüpft:
  - `deviceId`: Eindeutige Fingerprint-ID
  - `deviceName`: Menschenlesbarer Name (z.B. "iPhone", "iPad", "Android Device")
  - `platform`: Betriebssystem
  - `userAgent`: Browser User-Agent
  - `screenResolution`: Bildschirmauflösung

### 4. **Google Sheets Persistierung**
- Device-Informationen werden alle 10 Minuten synchronisiert
- Format pro User:
  ```json
  {
    "userId": "abc123",
    "username": "Max Mustermann",
    "cookies": [
      {
        "sessionId": "uuid-1",
        "createdAt": "2025-01-15T10:00:00.000Z",
        "expiresAt": "2025-02-14T10:00:00.000Z",
        "deviceId": "a1b2c3d4e5f6g7h8",
        "deviceName": "iPhone",
        "platform": "iPhone"
      },
      {
        "sessionId": "uuid-2",
        "createdAt": "2025-01-15T11:00:00.000Z",
        "expiresAt": "2025-02-14T11:00:00.000Z",
        "deviceId": "x9y8z7w6v5u4t3s2",
        "deviceName": "iPad",
        "platform": "iPad"
      }
    ]
  }
  ```

### 5. **Automatische Integration**
- Device-ID wird automatisch bei jedem API-Request mitgesendet (Header: `X-Device-ID`)
- Device-Info wird automatisch beim Login gesammelt und mitgesendet
- Device-Tracking-Service inkludiert Device-ID in alle Status-Updates

## Technische Implementierung

### Frontend

#### Device Fingerprint Service
```typescript
// client/src/services/deviceFingerprint.ts
const deviceId = await deviceFingerprintService.getDeviceId();
const deviceInfo = await deviceFingerprintService.getDeviceInfo();
```

#### Login Component
```typescript
// client/src/components/Login.tsx
// Device-Info wird automatisch bei authAPI.login() mitgesendet
const response = await authAPI.login(password);
```

#### API-Service
```typescript
// client/src/services/api.ts
// Alle Requests inkludieren automatisch X-Device-ID Header
```

### Backend

#### Cookie Storage Service
```typescript
// server/services/cookieStorageService.ts
cookieStorageService.addCookie(sessionId, userId, password, username, isAdmin, deviceInfo);

// Get all devices for a user
const devices = cookieStorageService.getUserDevices(userId);
```

#### Auth Service
```typescript
// server/middleware/auth.ts
const sessionToken = AuthService.generateSessionToken(password, username, isAdmin, deviceInfo);

// Get user's devices
const devices = AuthService.getUserDevices(userId);
```

#### Auth Route
```typescript
// server/routes/auth.ts
// POST /api/auth/login
{
  "password": "secret",
  "deviceInfo": {
    "deviceId": "a1b2c3d4e5f6g7h8",
    "deviceName": "iPhone",
    "platform": "iPhone",
    "userAgent": "Mozilla/5.0...",
    "screenResolution": "375x667"
  }
}
```

## Shared Types

```typescript
// shared/trackingTypes.ts
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  userAgent: string;
  screenResolution: string;
}

export interface DeviceStatus {
  // ... existing fields
  deviceId?: string; // Device fingerprint ID
}

export interface TrackingData {
  // ... existing fields
  deviceInfo?: DeviceInfo;
}
```

## Verwendungsszenarien

### 1. Multi-Device Tracking
Ein Benutzer kann gleichzeitig auf mehreren Geräten eingeloggt sein:
- iPhone: Device-ID `abc123...`
- iPad: Device-ID `xyz789...`
- Desktop: Device-ID `def456...`

Jedes Gerät wird separat getrackt und in den Logs unterschieden.

### 2. Admin-Dashboard
Admins können sehen:
- Welche Geräte ein User verwendet
- Wann jedes Gerät zuletzt aktiv war
- Gerätespezifische Statistiken

### 3. Security & Audit
- Verdächtige Login-Aktivitäten von neuen Geräten erkennen
- Device-basierte Session-Verwaltung
- Audit-Trail mit Geräteinformationen

## Testing

### Device-ID generieren
```typescript
// In Browser Console
import { deviceFingerprintService } from './services/deviceFingerprint';
const deviceId = await deviceFingerprintService.getDeviceId();
console.log('Device ID:', deviceId);
```

### Device-ID zurücksetzen (für Testing)
```typescript
deviceFingerprintService.clearDeviceId();
```

### User-Devices abrufen
```typescript
// Backend
const devices = AuthService.getUserDevices(userId);
console.log('User devices:', devices);
```

## iOS/iPadOS PWA Kompatibilität

Das System funktioniert zuverlässig auf iOS/iPadOS PWAs:
- ✅ localStorage wird unterstützt
- ✅ Canvas Fingerprinting funktioniert
- ✅ WebGL Fingerprinting funktioniert
- ✅ Battery API (teilweise, falls verfügbar)
- ✅ Screen Resolution & Touch Points
- ✅ Timezone & Language

## Sicherheitshinweise

1. **Device-IDs sind nicht 100% eindeutig**, aber ausreichend für Tracking-Zwecke
2. **Device-IDs können sich ändern** bei:
   - Browser-Cache-Löschung (localStorage wird gelöscht)
   - Browser-Updates (Canvas/WebGL Fingerprint kann sich ändern)
   - OS-Updates
3. **Keine sensiblen Daten** werden im Fingerprint gespeichert
4. **Passwörter** werden NICHT in Google Sheets gespeichert

## Wartung

### Google Sheets Cleanup
- Alte Cookie-Sheets werden automatisch gelöscht (nur letzte 100 behalten)
- Manuelle Bereinigung bei Bedarf möglich

### Cookie-Ablauf
- Cookies laufen nach 30 Tagen ab
- Abgelaufene Cookies werden automatisch aus RAM entfernt
- Beim Serverstart werden nur gültige Cookies geladen

## Nächste Schritte

Mögliche Erweiterungen:
1. Admin-Dashboard: Device-Management-UI
2. Push-Benachrichtigungen bei neuen Geräten
3. Geräte-basierte Berechtigungen
4. Device-spezifische Analytics
