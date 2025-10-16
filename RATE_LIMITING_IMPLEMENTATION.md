# Rate Limiting Implementation

## Übersicht

Dieses Dokument beschreibt das implementierte Rate Limiting System für Google API Aufrufe (Geocoding und Vision API).

## Limitierungen

Pro Benutzer und Minute:
- **Geocoding API (Standortabfragen)**: Maximal 10 Anfragen
- **Vision API (Bildübermittlungen)**: Maximal 10 Anfragen

## Architektur

### Backend

#### Middleware (`server/middleware/rateLimit.ts`)

Die Rate Limiting Middleware bietet:

1. **`rateLimitMiddleware(type)`**: Express Middleware für Route-Level Rate Limiting
   - Parameter: `'geocoding'` oder `'vision'`
   - Prüft automatisch das Limit und blockiert bei Überschreitung
   - Gibt 429 Status mit spezifischer Fehlermeldung zurück

2. **`checkRateLimit(username, type)`**: Interne Funktion zum Prüfen des Limits
   - Gibt zurück: `{ limited: boolean, message?: string }`

3. **`incrementRateLimit(username, type)`**: Interne Funktion zum Inkrementieren des Zählers

4. **In-Memory Store**: 
   - Speichert Rate Limit Daten pro Benutzer
   - Automatische Cleanup-Funktion alle 5 Minuten

#### Integration in Routes

**Geocoding API** (`server/routes.ts`):
```typescript
app.post("/api/geocode", requireAuth, rateLimitMiddleware('geocoding'), async ...)
```

**Vision API** (`server/routes.ts`):
```typescript
app.post("/api/ocr", requireAuth, rateLimitMiddleware('vision'), upload.single("image"), async ...)
```

**Address Normalization** (`server/services/googleSheets.ts`):
- `normalizeAddress()` Funktion erweitert mit `username` Parameter
- Nutzt `checkRateLimit()` und `incrementRateLimit()` intern
- Wird in `server/routes/addressDatasets.ts` mit Username aufgerufen

### Frontend

#### Fehlerbehandlung (429 Status)

Alle relevanten Komponenten behandeln jetzt 429 Fehler:

**ResultsDisplay.tsx**:
- `handleCreateResidentWithoutPhoto()`: Rate Limit für Geocoding
- Zeigt Toast mit spezifischer Fehlermeldung (10 Sekunden)

**GPSAddressForm.tsx**:
- Geocoding bei GPS-Standortabfrage
- Zeigt Toast mit Rate Limit Nachricht

**PhotoCapture.tsx**:
- Vision API bei Bildübermittlung
- Zeigt Toast mit Rate Limit Nachricht
- Verhindert Offline-Fallback bei Rate Limit

## Fehlermeldung

Bei Überschreitung des Limits erhält der Benutzer folgende Nachricht:

### Geocoding (Standortabfragen):
```
"Wegen Einschränkungen sind leider nur 10 Standortabfragen pro Minute pro Nutzer möglich. 
Du hast das Limit für diese Minute erreicht. Bitte warte X Sekunden. 
Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael."
```

### Vision API (Bildübermittlungen):
```
"Wegen Einschränkungen sind leider nur 10 Bildübermittlungen pro Minute pro Nutzer möglich. 
Du hast das Limit für diese Minute erreicht. Bitte warte X Sekunden. 
Das sollte sehr selten vorkommen. Wenn das öfter vorkommt, meld das bitte Michael."
```

## API Response

Bei Rate Limit Überschreitung:

**Status Code**: 429 (Too Many Requests)

**Response Body**:
```json
{
  "error": "Rate limit exceeded",
  "message": "Wegen Einschränkungen sind leider nur 10 Standortabfragen...",
  "type": "geocoding" | "vision",
  "limit": 10,
  "retryAfter": 45  // Sekunden bis Reset
}
```

## Besonderheiten

1. **Tracking über alle Ereignisse**: Das System trackt alle Geocoding-Anfragen gesamtheitlich, egal ob sie durch:
   - GPS-Standortabfrage ausgelöst werden
   - Manueller Adresseingabe erfolgen
   - Address Normalisierung (Backend-intern) durchgeführt werden

2. **In-Memory Store**: 
   - Einfache Implementierung ohne externe Datenbank
   - Funktioniert in Single-Instance Deployments
   - Bei Multi-Instance Deployments sollte Redis verwendet werden

3. **Automatische Cleanup**: 
   - Alte Einträge werden alle 5 Minuten gelöscht
   - Verhindert Memory Leaks

4. **Username-basiert**: 
   - Jeder authentifizierte Benutzer hat sein eigenes Limit
   - Kein globales Limit pro IP (verhindert Probleme bei geteilten IPs)

## Zukünftige Erweiterungen

Für Produktionsumgebungen mit mehreren Server-Instanzen:

1. **Redis Integration**:
   ```typescript
   import Redis from 'ioredis';
   const redis = new Redis(process.env.REDIS_URL);
   ```

2. **Persistent Storage**: Rate Limit Daten in Redis statt In-Memory

3. **Distributed Rate Limiting**: Koordination zwischen mehreren Server-Instanzen

4. **Monitoring**: Logging von Rate Limit Hits für Analytics
