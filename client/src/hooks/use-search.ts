import React, { useState, useMemo, useCallback } from 'react';

export interface SearchableItem {
  name: string;
  type: 'customer' | 'prospect' | 'duplicate' | 'address-customer';
  originalIndex: number;
  additionalData?: any;
  normalizedName?: string; // Pre-computed for performance
}

/**
 * Lightweight, fast search hook with instant substring matching
 * Optimized for real-time filtering on keystroke with memoization
 */
export function useSearch(items: SearchableItem[]) {
  const [searchTerm, setSearchTerm] = useState('');

  // Pre-compute normalized names for better performance
  const itemsWithNormalizedNames = useMemo(() => {
    return items.map(item => ({
      ...item,
      normalizedName: item.name.toLowerCase()
    }));
  }, [items]);

  // Normalize search term for consistent matching
  const normalizedSearchTerm = useMemo(() => {
    return searchTerm.toLowerCase().trim();
  }, [searchTerm]);

  // Perform fast substring search with memoization
  const filteredItems = useMemo(() => {
    if (!normalizedSearchTerm) {
      return itemsWithNormalizedNames; // Return all items if no search term
    }

    // Optimized substring search - pre-computed normalized names
    return itemsWithNormalizedNames.filter(item => 
      item.normalizedName!.includes(normalizedSearchTerm)
    );
  }, [itemsWithNormalizedNames, normalizedSearchTerm]);

  // Optimized search function that doesn't re-render unnecessarily
  const updateSearch = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  // Clear search function
  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  return {
    searchTerm,
    filteredItems,
    updateSearch,
    clearSearch,
    hasActiveSearch: normalizedSearchTerm.length > 0,
    resultCount: filteredItems.length,
    totalCount: itemsWithNormalizedNames.length
  };
}

/**
 * Transform OCR results into searchable items for the search hook
 */
export function transformOCRResultsToSearchable(result: any): SearchableItem[] {
  const searchableItems: SearchableItem[] = [];

  // Add all customers at address
  if (result.allCustomersAtAddress) {
    result.allCustomersAtAddress.forEach((customer: any, index: number) => {
      searchableItems.push({
        name: customer.name,
        type: 'address-customer',
        originalIndex: index,
        additionalData: customer
      });
    });
  }

  // Add existing customers (matched from photo)
  if (result.residentNames && result.residentNames.length > 0) {
    const photoMatchedNames = result.residentNames.filter((name: string) => 
      !result.newProspects.includes(name)
    );
    
    photoMatchedNames.forEach((name: string, index: number) => {
      searchableItems.push({
        name,
        type: 'customer',
        originalIndex: index,
        additionalData: null
      });
    });
  } else if (result.existingCustomers) {
    // Address-only search - show customer names from database
    result.existingCustomers.forEach((customer: any, index: number) => {
      searchableItems.push({
        name: customer.name,
        type: 'customer',
        originalIndex: index,
        additionalData: customer
      });
    });
  }

  // Add new prospects
  if (result.newProspects) {
    result.newProspects.forEach((prospect: string, index: number) => {
      searchableItems.push({
        name: prospect,
        type: 'prospect',
        originalIndex: index,
        additionalData: null
      });
    });
  }

  // Add duplicates
  if (result.residentNames) {
    // Same duplicate logic as in ResultsDisplay
    const normalizeToWords = (name: string): string[] => {
      return name
        .toLowerCase()
        .replace(/[-\.\/\\|]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1);
    };

    const nameCounts = new Map<string, number>();
    result.residentNames.forEach((name: string) => {
      const lowerName = name.toLowerCase();
      nameCounts.set(lowerName, (nameCounts.get(lowerName) || 0) + 1);
    });

    const wordToNames = new Map<string, string[]>();
    result.residentNames.forEach((name: string) => {
      const words = normalizeToWords(name);
      words.forEach(word => {
        if (!wordToNames.has(word)) {
          wordToNames.set(word, []);
        }
        wordToNames.get(word)!.push(name.toLowerCase());
      });
    });

    const duplicateNamesSet = new Set<string>();
    
    nameCounts.forEach((count, name) => {
      if (count > 1) {
        duplicateNamesSet.add(name);
      }
    });
    
    wordToNames.forEach((nameList, word) => {
      const uniqueNames = new Set(nameList);
      if (uniqueNames.size > 1) {
        uniqueNames.forEach(name => duplicateNamesSet.add(name));
      }
    });
    
    const duplicates = result.residentNames.filter((name: string) => 
      duplicateNamesSet.has(name.toLowerCase())
    );
    
    duplicates.forEach((duplicate: string, index: number) => {
      searchableItems.push({
        name: duplicate,
        type: 'duplicate',
        originalIndex: index,
        additionalData: null
      });
    });
  }

  return searchableItems;
}