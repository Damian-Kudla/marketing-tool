/**
 * Validates house number format
 * Returns error message if invalid, null if valid
 */
export function validateHouseNumber(houseNumber: string): string | null {
  if (!houseNumber || !houseNumber.trim()) {
    return null; // Empty is allowed
  }

  const normalized = houseNumber.toLowerCase().trim().replace(/\s+/g, '');
  
  // Check for non-latin letters (umlauts)
  if (/[äöüßÄÖÜ]/.test(normalized)) {
    return 'Umlaute (ä, ö, ü) sind nicht erlaubt. Bitte nur lateinische Buchstaben (a-z) verwenden.';
  }
  
  // Split by comma and slash
  const parts = normalized.split(/[,\/]/).map(p => p.trim()).filter(p => p.length > 0);
  
  for (const part of parts) {
    // Check for letter range (e.g., "20a-c")
    const letterRangePattern = /^(\d+)([a-z])-([a-z])$/;
    const letterMatch = part.match(letterRangePattern);
    
    if (letterMatch) {
      const startLetter = letterMatch[2];
      const endLetter = letterMatch[3];
      
      const startCode = startLetter.charCodeAt(0);
      const endCode = endLetter.charCodeAt(0);
      
      // Validate: start must be <= end
      if (startCode > endCode) {
        return `Ungültiger Buchstaben-Bereich: "${part}" - Der Bereich ist umgekehrt (${startLetter} > ${endLetter})`;
      }
      
      // Validate: max 30 letters
      const rangeSize = endCode - startCode + 1;
      if (rangeSize > 30) {
        return `Ungültiger Buchstaben-Bereich: "${part}" - Der Bereich ist zu groß (${rangeSize} Buchstaben, max. 30 erlaubt)`;
      }
      
      continue;
    }
    
    // Check for ambiguous format like "20-22a"
    if (part.includes('-')) {
      const rangeParts = part.split('-');
      if (rangeParts.length === 2 && rangeParts[1].match(/[a-z]/)) {
        return `Mehrdeutige Schreibweise: "${part}". Bitte entweder Zahlen-Bereich "20-22" oder Buchstaben-Bereich "20a-c" verwenden.`;
      }
    }
  }
  
  return null; // Valid
}

/**
 * Expands a house number range (e.g., "1-15") into individual numbers
 * Applies even/odd filters if specified
 * 
 * @param rangeStr - The house number string (can be a single number or range like "1-15")
 * @param onlyEven - If true, only include even numbers
 * @param onlyOdd - If true, only include odd numbers
 * @returns Array of house number strings
 */
export function expandHouseNumberRange(
  rangeStr: string,
  onlyEven: boolean = false,
  onlyOdd: boolean = false
): string[] {
  const parts = rangeStr.split('-').map(p => p.trim());
  
  // Must have exactly 2 parts for a range
  if (parts.length !== 2) return [rangeStr];
  
  // Both parts must be valid integers
  const start = parseInt(parts[0]);
  const end = parseInt(parts[1]);
  
  if (isNaN(start) || isNaN(end)) return [rangeStr];
  
  // Start must be less than end
  if (start >= end) return [rangeStr];
  
  // Start must be positive
  if (start < 1) return [rangeStr];
  
  // Generate range
  const numbers: number[] = [];
  for (let i = start; i <= end; i++) {
    // Apply even/odd filters
    if (onlyEven && i % 2 !== 0) continue;
    if (onlyOdd && i % 2 === 0) continue;
    numbers.push(i);
  }
  
  return numbers.map(n => n.toString());
}
