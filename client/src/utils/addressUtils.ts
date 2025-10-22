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
