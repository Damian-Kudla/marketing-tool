import type { ResidentStatus } from "@/../../shared/schema";

/**
 * Zentrale Definition aller Status-Werte
 */
export const RESIDENT_STATUSES: ResidentStatus[] = [
  'no_interest',
  'not_reached',
  'interest_later',
  'appointment',
  'written'
];

/**
 * Zentrale Definition aller Status-Labels
 * 
 * WICHTIG: Diese Labels sind die offiziellen Bezeichnungen aus dem Vertrieb:
 * - "Kein Interesse": Kunde hat kein Interesse
 * - "Nicht erreicht": Kunde konnte nicht erreicht werden
 * - "Interesse später": Kunde hat Interesse, aber zu einem späteren Zeitpunkt
 * - "Termin": Termin mit Kunde vereinbart
 * - "Geschrieben": Vertrag mit Kunde abgeschlossen (nicht "Notiert"!)
 */
export const STATUS_LABELS: Record<ResidentStatus, string> = {
  no_interest: 'Kein Interesse',
  not_reached: 'Nicht erreicht',
  interest_later: 'Interesse später',
  appointment: 'Termin',
  written: 'Geschrieben'
};

/**
 * Hilfsfunktion für i18n-Übersetzungen
 * Gibt das Label für einen Status zurück
 */
export function getStatusLabel(status: ResidentStatus): string {
  return STATUS_LABELS[status];
}
