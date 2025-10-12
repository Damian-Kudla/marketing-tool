/**
 * Zentrale Farbkonfiguration für Overlay-Markierungen
 * 
 * Diese Datei definiert alle Farben für die verschiedenen Bewohner-Kategorien.
 * Änderungen hier wirken sich auf:
 * - Overlay-Boxen auf dem Bild (Hintergrund + Border)
 * - Legende über dem Bild
 * - Alle UI-Komponenten, die diese Kategorien anzeigen
 */

export interface CategoryColors {
  /** Volldeckende Farbe (für Legende) */
  solid: string;
  /** Transparente Farbe für Overlay-Hintergrund */
  background: string;
  /** Farbe für Overlay-Rahmen */
  border: string;
}

export interface ColorConfig {
  /** Farben für neue Interessenten (Prospects) */
  prospects: CategoryColors;
  /** Farben für Bestandskunden (Existing Customers) */
  existing: CategoryColors;
  /** Farben für Duplikate */
  duplicates: CategoryColors;
}

/**
 * Standard-Farbkonfiguration
 * 
 * Format: rgba(R, G, B, A) wobei:
 * - R, G, B: 0-255 (Rot, Grün, Blau)
 * - A: 0-1 (Transparenz: 0=durchsichtig, 1=volldeckend)
 */
export const colorConfig: ColorConfig = {
  // Interessenten (Prospects) - Gelb
  prospects: {
    solid: 'rgba(251, 238, 60, 1)',      // Volldeckendes Gelb für Legende
    background: 'rgba(251, 238, 60, 0.5)', // 50% transparent für Overlay-Hintergrund
    border: 'rgba(251, 238, 60, 0.8)',     // 80% deckend für Overlay-Rahmen
  },
  
  // Bestandskunden (Existing Customers) - Rot
  existing: {
    solid: 'rgba(239, 68, 68, 1)',       // Volldeckendes Rot für Legende
    background: 'rgba(239, 68, 68, 0.5)', // 50% transparent für Overlay-Hintergrund
    border: 'rgba(239, 68, 68, 0.8)',     // 80% deckend für Overlay-Rahmen
  },
  
  // Duplikate - Blau
  duplicates: {
    solid: 'rgba(59, 130, 246, 1)',      // Volldeckendes Blau für Legende
    background: 'rgba(59, 130, 246, 0.3)', // 30% transparent für Overlay-Hintergrund
    border: 'rgba(59, 130, 246, 0.8)',     // 80% deckend für Overlay-Rahmen
  },
};

/**
 * Hilfsfunktion: Gibt die Farben für eine Kategorie zurück
 */
export function getCategoryColors(
  isExisting: boolean,
  isDuplicate: boolean
): CategoryColors {
  if (isDuplicate) {
    return colorConfig.duplicates;
  }
  if (isExisting) {
    return colorConfig.existing;
  }
  return colorConfig.prospects;
}
