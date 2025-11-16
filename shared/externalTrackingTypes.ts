/**
 * External Tracking App Location Data Types
 *
 * Diese Typen definieren das JSON-Schema für Location-Daten,
 * die von der externen Tracking-App an den API-Endpunkt gesendet werden.
 */

export interface LocationData {
  // Zeitstempel & Koordinaten (REQUIRED)
  timestamp: string;          // ISO 8601 UTC (z.B. "2025-01-15T14:23:45.678Z")
  latitude: number;           // Breitengrad (-90 bis +90)
  longitude: number;          // Längengrad (-180 bis +180)

  // Position Details (OPTIONAL)
  altitude: number | null;    // Höhe in Metern über Meeresspiegel
  accuracy: number | null;    // Horizontale Genauigkeit in Metern
  altitudeAccuracy: number | null;  // Vertikale Genauigkeit in Metern
  heading: number | null;     // Bewegungsrichtung in Grad (0-360°, 0=Nord)
  speed: number | null;       // Geschwindigkeit in m/s

  // Nutzer-Info (REQUIRED)
  userName: string;

  // Batterie-Status (OPTIONAL)
  batteryLevel: number | null;  // Batteriestand in Prozent (0-100)
  batteryState: "CHARGING" | "UNPLUGGED" | "FULL" | "UNKNOWN" | null;
  isCharging: boolean;

  // Geräte-Info (OPTIONAL)
  deviceName: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  deviceUniqueId: string | null;      // Eindeutige Geräte-ID (UUID - IMMER verfügbar)
  deviceSerialNumber: string | null;  // Hardware-Seriennummer (meist null)

  // Netzwerk-Info (OPTIONAL)
  isConnected: boolean;
  connectionType: "wifi" | "cellular" | "none" | "unknown" | null;
}
