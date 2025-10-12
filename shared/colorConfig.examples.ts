/**
 * Beispiel-Datei: Wie man die Farben aus der colorConfig verwendet
 * 
 * Diese Datei zeigt verschiedene Verwendungsmöglichkeiten der zentralen Farbkonfiguration.
 * 
 * HINWEIS: Dies ist eine reine Dokumentationsdatei mit Code-Beispielen.
 * Die Beispiele sind nicht für direkte Verwendung gedacht, sondern zeigen
 * verschiedene Muster, wie die colorConfig in echten Komponenten genutzt werden kann.
 */

import { colorConfig, getCategoryColors } from './colorConfig';

// Beispiel 1: Direkte Verwendung für eine spezifische Kategorie
export const prospectsLegendColor = colorConfig.prospects.solid;
export const prospectsOverlayBg = colorConfig.prospects.background;
export const prospectsOverlayBorder = colorConfig.prospects.border;

// Beispiel 2: Verwendung mit der Hilfsfunktion
export function renderOverlay(isExisting: boolean, isDuplicate: boolean) {
  const colors = getCategoryColors(isExisting, isDuplicate);
  
  return {
    backgroundColor: colors.background,
    border: `1px solid ${colors.border}`,
  };
}

// Beispiel 3: Dynamische Farbauswahl
export const renderCategoryBox = (overlay: { isExisting: boolean; isDuplicate: boolean }) => ({
  backgroundColor: overlay.isDuplicate
    ? colorConfig.duplicates.background
    : overlay.isExisting
    ? colorConfig.existing.background
    : colorConfig.prospects.background,
});
