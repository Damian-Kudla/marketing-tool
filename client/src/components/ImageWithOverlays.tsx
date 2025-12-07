import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Check, Undo2, Combine } from 'lucide-react';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import { ResidentEditPopup } from './ResidentEditPopup';
import { StatusContextMenu } from './StatusContextMenu';
import { useLongPress } from '@/hooks/use-long-press';
import type { Address } from '@/components/GPSAddressForm';
import type { Customer } from '@/components/ResultsDisplay';
import type { EditableResident, ResidentStatus } from '@/../../shared/schema';
import { colorConfig } from '@/../../shared/colorConfig';

interface BoundingBox {
  vertices: Array<{ x?: number; y?: number }>;
}

interface TextAnnotation {
  description: string;
  boundingPoly: BoundingBox;
}

interface OverlayBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isExisting: boolean;
  isDuplicate?: boolean;
  scale: number;
  originalIndex: number;
  originalName: string; // Stable identifier: the original name from OCR
  matchedCustomer?: Customer;
  xOffset?: number;
  yOffset?: number;
  fontSize?: number;
  isEdited?: boolean; // Track if this overlay was manually edited
  editedText?: string; // Store the edited text separately
}

interface ImageWithOverlaysProps {
  imageSrc: string;
  fullVisionResponse?: any;
  residentNames: string[];
  existingCustomers: Customer[];
  newProspects: string[];
  allCustomersAtAddress?: Customer[];
  address?: Address | null;
  onNamesUpdated?: (updatedNames: string[]) => void;
  editableResidents?: EditableResident[];
  onResidentsUpdated?: (residents: EditableResident[]) => void;
  currentDatasetId?: string | null;
  onRequestDatasetCreation?: () => Promise<string | null>;
}

// Normalize name to extract words (match backend normalization: periods → spaces)
const normalizeToWords = (name: string): string[] => {
  return name
    .toLowerCase()
    .replace(/[-\.\/\\|]/g, ' ') // Replace periods, hyphens, slashes with spaces (match backend)
    .split(/\s+/) // Split on spaces
    .filter(word => word.length > 1); // Ignore single characters
};

// Calculate duplicates from a list of names
const calculateDuplicates = (names: string[], existingCustomerNames: string[] = []): Set<string> => {
  // Create a set of existing customer names (lowercase) for quick lookup
  const existingSet = new Set(existingCustomerNames.map(n => n.toLowerCase()));
  
  // Count exact occurrences first (for exact duplicates like "schmidt" appearing twice)
  const nameCounts = new Map<string, number>();
  names.forEach(name => {
    const lowerName = name.toLowerCase();
    nameCounts.set(lowerName, (nameCounts.get(lowerName) || 0) + 1);
  });

  // Find word-based duplicates (names sharing words)
  const wordToNames = new Map<string, string[]>();
  names.forEach(name => {
    const words = normalizeToWords(name);
    words.forEach(word => {
      if (!wordToNames.has(word)) {
        wordToNames.set(word, []);
      }
      wordToNames.get(word)!.push(name.toLowerCase());
    });
  });

  const duplicates = new Set<string>();
  
  // Add exact duplicates (same name appears multiple times)
  // BUT only if at least one occurrence is an existing customer
  nameCounts.forEach((count, name) => {
    if (count > 1 && existingSet.has(name)) {
      duplicates.add(name);
    }
  });
  
  // REMOVED: Word-based duplicates caused too many false positives (e.g. "Oguras d" marked as duplicate of "Oguras")
  // We now only check for exact full name matches
  /*
  // Add word-based duplicates (different names sharing words)
  // BUT only if at least one of the names is an existing customer
  wordToNames.forEach((nameList, word) => {
    const uniqueNames = new Set(nameList);
    if (uniqueNames.size > 1) {
      // Check if ANY of these names is an existing customer
      const hasExistingCustomer = Array.from(uniqueNames).some(name => existingSet.has(name));
      if (hasExistingCustomer) {
        // Mark all names sharing this word as duplicates
        uniqueNames.forEach(name => duplicates.add(name));
      }
    }
  });
  */
  
  return duplicates;
};

export default function ImageWithOverlays({
  imageSrc,
  fullVisionResponse,
  residentNames,
  existingCustomers,
  newProspects,
  allCustomersAtAddress,
  address,
  onNamesUpdated,
  editableResidents = [],
  onResidentsUpdated,
  currentDatasetId,
  onRequestDatasetCreation,
}: ImageWithOverlaysProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const [overlays, setOverlays] = useState<OverlayBox[]>([]);
  const [longPressIndex, setLongPressIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  // State for new resident edit popup
  const [editingResident, setEditingResident] = useState<EditableResident | null>(null);
  const [showEditPopup, setShowEditPopup] = useState(false);

  // State for status context menu (Long Press)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuPosition, setStatusMenuPosition] = useState({ x: 0, y: 0 });
  const [statusMenuOverlay, setStatusMenuOverlay] = useState<{ overlay: OverlayBox; index: number } | null>(null);

  // Drag & Drop state for overlay fusion
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isFusing, setIsFusing] = useState(false);
  const [fusingIndices, setFusingIndices] = useState<{ source: number; target: number } | null>(null);

  // Multi-phase touch interaction state
  const [wobblingIndex, setWobblingIndex] = useState<number | null>(null); // Index of wobbling overlay
  const wobblingIndexRef = useRef<number | null>(null); // Ref for event handlers to avoid stale closures
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const statusMenuTriggeredRef = useRef(false); // Track if status menu was triggered
  const [hasMoved, setHasMoved] = useState(false); // Track if user moved after wobble started
  const wobbleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const statusMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const containerTouchTimerRef = useRef<NodeJS.Timeout | null>(null); // Timer for container-level long press
  const [selectedByProximity, setSelectedByProximity] = useState(false); // Track if overlay was selected by proximity (not direct hit)

  // Undo history for fusion operations
  interface FusionHistory {
    targetName: string; // The name that was extended
    sourceName: string; // The name that was merged into target
    resultName?: string; // The combined name (stored to handle renames)
    originalTargetResident: EditableResident; // Original state of target resident
    originalSourceResident: EditableResident; // Original state of source resident
    timestamp: number;
  }
  const [fusionHistory, setFusionHistory] = useState<FusionHistory[]>([]);

  // Track window width for responsive edit modal
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate overlays when data changes
  useEffect(() => {
    if (!fullVisionResponse?.textAnnotations || residentNames.length === 0) {
      setOverlays([]);
      return;
    }

    const textAnnotations: TextAnnotation[] = fullVisionResponse.textAnnotations;
    
    // For each resident name, find ALL matching annotations and merge bounding boxes
    type ResidentMatch = {
      residentIndex: number;
      residentName: string;
      annotations: TextAnnotation[];
      totalMatchScore: number;
    };
    
    const residentMatches: ResidentMatch[] = [];
    const usedAnnotations = new Set<number>();

    // Sort residents by word count (more words first), then by length (longer first)
    // This ensures multi-word names like "von brandt" are processed before "brandt"
    const sortedResidents = residentNames.map((name, idx) => ({ 
      name, 
      originalIndex: idx,
      wordCount: name.split(/\s+/).length 
    }))
      .sort((a, b) => {
        if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
        return b.name.length - a.name.length;
      });

    // Process each resident name (longer names first)
    sortedResidents.forEach(({ name: residentName, originalIndex: nameIndex }) => {
      const nameWords = residentName.toLowerCase().split(/\s+/);
      const matchingAnnotations: TextAnnotation[] = [];
      const matchedIndices: number[] = [];
      let totalScore = 0;

      // Skip first annotation (full text), process individual text blocks
      for (let i = 1; i < textAnnotations.length; i++) {
        if (usedAnnotations.has(i)) continue; // Skip if already used
        
        const annotation = textAnnotations[i];
        const text = annotation.description?.toLowerCase()
        .replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕ×ØÙÚÛÝÞàáâãåæçèéêëìíîïðñòóôõ÷øùúûýþÿ€‰′″‵‹›⁄⁰¹²³⁴⁵⁶⁷⁸⁹⅓⅔←↑→↓↔∅∞∩∪√≈≠≡≤≥⊂⊃⋂⋃∂∇∏∑−×÷∫∬∮πστφχψωΓΔΘΛΞΠΣΥΦΨΩαβγδεζηθικλμνξοπρςστυφχψω]/g, ' ')
        .replace(/\s+/g, ' ')  // Normalisiert mehrere Leerzeichen
        .trim();  // Entfernt führende/nachfolgende Leerzeichen
        
        if (!text) continue;
        const annotationWords = text.split(/\s+/);
        // if (residentName.toLowerCase() === "schmidt" && text === "e schmidt") { // i=101
        //   console.log("stop"); // Hier kannst du einen Breakpoint setzen
        // }
        // For single-word names, only match if annotation is EXACTLY that word
        // Only take the FIRST match to prevent oversized boxes from multiple detections
        if (nameWords.length === 1) {
          const singleWord = nameWords[0];
          if (annotationWords.includes(singleWord) && matchingAnnotations.length === 0) {
            matchingAnnotations.push(annotation);
            matchedIndices.push(i);
            totalScore += 1;
          }
        } else {
          // For multi-word names, check if ANY word from the name matches this annotation
          const matchingWords = nameWords.filter(word => annotationWords.includes(word));
          
          if (matchingWords.length > 0) {
            matchingAnnotations.push(annotation);
            matchedIndices.push(i);
            totalScore += matchingWords.length;
          }
        }
      }

      if (matchingAnnotations.length > 0) {
        residentMatches.push({
          residentIndex: nameIndex,
          residentName,
          annotations: matchingAnnotations,
          totalMatchScore: totalScore,
        });
        
        // Mark all matched annotations as used
        matchedIndices.forEach(idx => usedAnnotations.add(idx));
      }
    });

    // Calculate duplicates from resident names
    // Only mark as duplicate if at least one occurrence is an existing customer
    const existingCustomerNames = existingCustomers.map(c => c.name);
    const duplicateNames = calculateDuplicates(residentNames, existingCustomerNames);
    
    // Track which resident indices have been used to create overlays
    const usedResidentIndices = new Set<number>();
    
    // Create overlays with merged bounding boxes for multi-part names
    const newOverlays: OverlayBox[] = [];
    
    residentMatches.forEach(match => {
      const isDuplicate = duplicateNames.has(match.residentName.toLowerCase());
      const isExisting = !newProspects.includes(match.residentName);
      const matchedCustomer = isExisting 
        ? existingCustomers.find(c => c.name.toLowerCase() === match.residentName.toLowerCase())
        : undefined;

      // Collect all vertices from all matching annotations
      const allVertices: Array<{ x: number; y: number }> = [];
      match.annotations.forEach(annotation => {
        if (annotation.boundingPoly?.vertices) {
          annotation.boundingPoly.vertices.forEach(v => {
            allVertices.push({ x: v.x || 0, y: v.y || 0 });
          });
        }
      });

      if (allVertices.length >= 3) {
        const xs = allVertices.map(v => v.x);
        const ys = allVertices.map(v => v.y);
        
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        // Add conservative padding (5% instead of 10% to avoid edge issues)
        const baseWidth = maxX - minX;
        const baseHeight = maxY - minY;
        const padding = Math.min(
          Math.max(baseWidth * 0.05, baseHeight * 0.05),
          10 // Cap padding at 10px to avoid extending too far
        );
        
        // Create overlay for this match's resident index
        newOverlays.push({
          text: match.residentName,
          x: Math.max(0, minX - padding),
          y: Math.max(0, minY - padding),
          width: baseWidth + (padding * 2),
          height: baseHeight + (padding * 2),
          isExisting,
          isDuplicate,
          scale: 1,
          originalIndex: match.residentIndex,
          originalName: match.residentName, // Store original name as stable ID
          matchedCustomer,
        });
        usedResidentIndices.add(match.residentIndex);
      }
    });
    
    // For duplicate names where some occurrences didn't get matched to an annotation,
    // create overlays at the same location as the first matched occurrence
    if (newOverlays.length > 0) {
      residentNames.forEach((name, idx) => {
        if (usedResidentIndices.has(idx)) return; // Already has overlay
        
        const lowerName = name.toLowerCase();
        const isDuplicate = duplicateNames.has(lowerName);
        
        if (isDuplicate) {
          // This is a duplicate that didn't get matched - find an overlay that shares a word with this name
          const nameWords = normalizeToWords(name);
          const matchedOverlay = newOverlays.find(overlay => {
            const overlayWords = normalizeToWords(overlay.text);
            return nameWords.some(word => overlayWords.includes(word));
          });
          
          if (matchedOverlay) {
            const isExisting = !newProspects.includes(name);
            const matchedCustomer = isExisting 
              ? existingCustomers.find(c => c.name.toLowerCase() === lowerName)
              : undefined;
            
            newOverlays.push({
              text: name,
              x: matchedOverlay.x,
              y: matchedOverlay.y,
              width: matchedOverlay.width,
              height: matchedOverlay.height,
              isExisting,
              isDuplicate: true,
              scale: 1,
              originalIndex: idx,
              originalName: name, // Store original name as stable ID
              matchedCustomer,
            });
          }
        }
      });
    }

    // Preserve edited overlays - merge them with new overlays using stable identifier
    setOverlays(prevOverlays => {
      // Create a set of current resident names (lowercase) for quick lookup
      const currentResidentNamesSet = new Set(residentNames.map(n => n.toLowerCase()));
      
      // Create a mapping of originalName -> currentName from editableResidents
      const originalToCurrentName = new Map<string, string>();
      editableResidents.forEach(r => {
        if (r.originalName) {
          originalToCurrentName.set(r.originalName.toLowerCase(), r.name);
        }
      });
      
      // Keep ALL edited overlays - don't filter them out!
      // They will be updated by the second useEffect based on editableResidents
      const editedOverlays = prevOverlays.filter(o => o.isEdited);
      
      const processedNewOverlays = handleOverlaps(newOverlays);
      
      // Collect all current names (original + edited) for duplicate detection
      const allCurrentNames: string[] = [];
      
      // Add non-edited original names
      processedNewOverlays.forEach(overlay => {
        const existingEdit = editedOverlays.find(e => e.originalName.toLowerCase() === overlay.originalName.toLowerCase());
        if (!existingEdit) {
          allCurrentNames.push(overlay.text);
        }
      });
      
      // Add edited names
      editedOverlays.forEach(edited => {
        const editedName = edited.editedText || edited.text;
        allCurrentNames.push(editedName);
      });
      
      // Calculate duplicates from ALL current names (including edited ones)
      // Only mark as duplicate if at least one occurrence is an existing customer
      const existingCustomerNames = existingCustomers.map(c => c.name);
      const currentDuplicateNames = calculateDuplicates(allCurrentNames, existingCustomerNames);
      
      const updatedEditedOverlays = editedOverlays.map(edited => {
        const editedName = edited.editedText || edited.text;
        const isDuplicate = currentDuplicateNames.has(editedName.toLowerCase());
        
        // FIX: Use editableResidents to determine status if available
        // This prevents edited names from incorrectly turning red (existing) just because they aren't in the original newProspects list
        let isExisting = false;
        
        const matchingResident = editableResidents.find(r => 
            r.name.toLowerCase() === editedName.toLowerCase() || 
            (r.originalName && r.originalName.toLowerCase() === edited.originalName.toLowerCase())
        );
        
        if (matchingResident) {
            isExisting = matchingResident.category === 'existing_customer';
        } else {
            // Fallback: Only mark as existing if it matches a known existing customer
            // Otherwise default to prospect (yellow) to avoid "red by default" behavior
            // This handles renamed prospects that don't match any existing customer
            const matchesExisting = existingCustomers.some(c => c.name.toLowerCase() === editedName.toLowerCase());
            const matchesAll = allCustomersAtAddress?.some(c => c.name.toLowerCase() === editedName.toLowerCase());
            
            isExisting = matchesExisting || !!matchesAll;
        }
        
        const matchedCustomer = isExisting 
          ? existingCustomers.find(c => c.name.toLowerCase() === editedName.toLowerCase())
          : undefined;
        return { ...edited, isDuplicate, isExisting, matchedCustomer };
      });
      
      // Create a map of edited overlays by their originalName (stable identifier)
      const editedByName = new Map<string, OverlayBox>();
      updatedEditedOverlays.forEach(edited => {
        editedByName.set(edited.originalName.toLowerCase(), edited);
      });
      
      // Merge: use edited version if exists for this originalName, otherwise use new overlay
      const merged: OverlayBox[] = [];
      processedNewOverlays.forEach(newOverlay => {
        // Try to find matching edited overlay by originalName
        let editedVersion = editedByName.get(newOverlay.originalName.toLowerCase());
        
        // If not found by originalName, try to find by current text (in case originalName was updated in residentNames)
        if (!editedVersion) {
            // Check if this newOverlay corresponds to a resident that has an originalName in editedByName
            const matchingResident = editableResidents.find(r => r.name.toLowerCase() === newOverlay.text.toLowerCase());
            if (matchingResident && matchingResident.originalName) {
                editedVersion = editedByName.get(matchingResident.originalName.toLowerCase());
            }
        }

        if (editedVersion) {
          // Use edited version without updating bounding box
          merged.push({
            ...editedVersion,
            // Use recalculated status from edited version (not newOverlay)
            isExisting: editedVersion.isExisting,
            isDuplicate: editedVersion.isDuplicate,
            matchedCustomer: editedVersion.matchedCustomer,
          });
          // Mark as used (delete from map so we don't add it again in the orphaned check)
          editedByName.delete(editedVersion.originalName.toLowerCase()); 
        } else {
          // This is a new overlay (or one that wasn't edited before)
          // Check status against editableResidents to ensure correct color
          let isExisting = newOverlay.isExisting;
          
          const matchingResident = editableResidents.find(r => 
            r.name.toLowerCase() === newOverlay.text.toLowerCase() ||
            (r.originalName && r.originalName.toLowerCase() === newOverlay.originalName.toLowerCase())
          );
          
          if (matchingResident) {
             isExisting = matchingResident.category === 'existing_customer';
          }

          merged.push({
            ...newOverlay,
            isExisting
          });
        }
      });
      
      // Don't add remaining edited overlays - they should be deleted if their name is gone
      // (Previously we added them here, but now we filter them out at the beginning)
      
      // FIX: If an edited overlay was NOT matched with a new overlay (because the name changed and OCR didn't find it),
      // we should still keep it IF the resident still exists in editableResidents.
      editedByName.forEach((editedOverlay) => {
        const stillExists = editableResidents.some(r => 
          (r.originalName && r.originalName.toLowerCase() === editedOverlay.originalName.toLowerCase()) ||
          r.name.toLowerCase() === (editedOverlay.editedText || editedOverlay.text).toLowerCase()
        );
        
        if (stillExists) {
          console.log('[ImageWithOverlays] Keeping orphaned edited overlay:', editedOverlay.text);
          merged.push(editedOverlay);
        } else {
          console.log('[ImageWithOverlays] Dropping orphaned edited overlay (resident deleted):', editedOverlay.text);
        }
      });
      
      return merged;
    });
  }, [fullVisionResponse, residentNames, existingCustomers, newProspects, editableResidents]);

  // Calculate optimal font size for text to fit in box without truncation
  const calculateFontSize = (text: string, boxWidth: number, boxHeight: number): number => {
    // Start with base font size in pixels
    let fontSize = 12;
    const minFontSize = 6;
    
    // Account for border (1px each side) and padding (1px each side) = 4px total
    const availableWidth = boxWidth - 4;
    const availableHeight = boxHeight - 4;
    
    // Conservative character width ratio
    const avgCharWidthRatio = 0.65;
    
    // Calculate required width for text
    const textLength = text.length;
    
    // Find optimal font size by reducing until it fits
    while (fontSize > minFontSize) {
      const estimatedWidth = textLength * fontSize * avgCharWidthRatio;
      const estimatedHeight = fontSize * 1.2; // line height
      
      if (estimatedWidth <= availableWidth && estimatedHeight <= availableHeight) {
        break;
      }
      fontSize -= 0.5;
    }
    
    return Math.max(fontSize, minFontSize);
  };

  // Update overlay properties when editableResidents changes (name, category, etc.)
  // Also REMOVE overlays whose corresponding resident was deleted (e.g., after fusion)
  useEffect(() => {
    if (overlays.length === 0) return;
    // Allow editableResidents to be empty - this means all overlays should be removed

    setOverlays(prevOverlays => {
      // First, filter out overlays whose residents no longer exist
      const filteredOverlays = prevOverlays.filter(overlay => {
        // Try multiple matching strategies to find the corresponding resident
        // Strategy 1: Match by current displayed text
        let matchingResident = editableResidents.find(r =>
          r.name.toLowerCase() === (overlay.editedText || overlay.text).toLowerCase()
        );

        // Strategy 2: Match by originalName if Strategy 1 failed
        if (!matchingResident) {
          matchingResident = editableResidents.find(r =>
            r.originalName?.toLowerCase() === overlay.originalName.toLowerCase()
          );
        }

        // Strategy 3: Match by original text if both failed
        if (!matchingResident) {
          matchingResident = editableResidents.find(r =>
            r.name.toLowerCase() === overlay.text.toLowerCase()
          );
        }

        if (!matchingResident) {
          // Resident was deleted - REMOVE this overlay
          console.log('[ImageWithOverlays] Removing overlay for deleted resident:', overlay.text);
          return false; // Filter out
        }
        return true; // Keep
      });

      // Then, update the remaining overlays
      return filteredOverlays.map(overlay => {
        // Find matching resident (we know it exists from the filter above)
        let matchingResident = editableResidents.find(r =>
          r.name.toLowerCase() === (overlay.editedText || overlay.text).toLowerCase()
        );
        if (!matchingResident) {
          matchingResident = editableResidents.find(r =>
            r.originalName?.toLowerCase() === overlay.originalName.toLowerCase()
          );
        }
        if (!matchingResident) {
          matchingResident = editableResidents.find(r =>
            r.name.toLowerCase() === overlay.text.toLowerCase()
          );
        }

        if (!matchingResident) return overlay; // Should not happen after filter

        // Update text if name changed
        const updatedText = matchingResident.name;
        const isExisting = matchingResident.category === 'existing_customer';
        const isDuplicate = overlay.isDuplicate; // Keep duplicate status

        // Only update if something actually changed (prevent unnecessary re-renders)
        if (overlay.text === updatedText &&
            overlay.isExisting === isExisting &&
            overlay.isDuplicate === isDuplicate) {
          return overlay; // No changes needed
        }

        return {
          ...overlay,
          text: updatedText,
          editedText: updatedText !== overlay.originalName ? updatedText : undefined,
          isExisting,
          isDuplicate,
          isEdited: updatedText !== overlay.originalName
        };
      });
    });
  }, [editableResidents]);

  // Handle overlapping boxes by downscaling and offsetting
  const handleOverlaps = (boxes: OverlayBox[]): OverlayBox[] => {
    const result = boxes.map(box => ({ ...box, xOffset: 0, yOffset: 0 }));
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      let hasOverlap = false;
      iterations++;

      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const box1 = result[i];
          const box2 = result[j];

          // Calculate scaled dimensions and positions
          const b1x = box1.x + (box1.xOffset || 0);
          const b1y = box1.y + (box1.yOffset || 0);
          const b1w = box1.width * box1.scale;
          const b1h = box1.height * box1.scale;
          
          const b2x = box2.x + (box2.xOffset || 0);
          const b2y = box2.y + (box2.yOffset || 0);
          const b2w = box2.width * box2.scale;
          const b2h = box2.height * box2.scale;

          // Check for overlap using scaled dimensions
          const overlap = !(
            b1x + b1w <= b2x ||
            b2x + b2w <= b1x ||
            b1y + b1h <= b2y ||
            b2y + b2h <= b1y
          );

          if (overlap) {
            hasOverlap = true;
            
            // Calculate overlap amounts
            const overlapX = Math.min(b1x + b1w, b2x + b2w) - Math.max(b1x, b2x);
            const overlapY = Math.min(b1y + b1h, b2y + b2h) - Math.max(b1y, b2y);
            
            // If boxes are heavily overlapped (>70% in both directions), use offsets
            if (overlapX > Math.min(b1w, b2w) * 0.7 && overlapY > Math.min(b1h, b2h) * 0.7) {
              // Boxes are very overlapped, offset them vertically apart to fully separate
              result[i] = { ...box1, yOffset: (box1.yOffset || 0) - (overlapY / 2 + 1) };
              result[j] = { ...box2, yOffset: (box2.yOffset || 0) + (overlapY / 2 + 1) };
            } else {
              // Scale down each box independently from its own center
              const newScale1 = box1.scale * 0.9;
              const oldWidth1 = box1.width * box1.scale;
              const oldHeight1 = box1.height * box1.scale;
              const newWidth1 = box1.width * newScale1;
              const newHeight1 = box1.height * newScale1;
              const centerOffsetX1 = (oldWidth1 - newWidth1) / 2;
              const centerOffsetY1 = (oldHeight1 - newHeight1) / 2;
              
              result[i] = { 
                ...box1, 
                scale: newScale1,
                xOffset: (box1.xOffset || 0) + centerOffsetX1,
                yOffset: (box1.yOffset || 0) + centerOffsetY1
              };
              
              const newScale2 = box2.scale * 0.9;
              const oldWidth2 = box2.width * box2.scale;
              const oldHeight2 = box2.height * box2.scale;
              const newWidth2 = box2.width * newScale2;
              const newHeight2 = box2.height * newScale2;
              const centerOffsetX2 = (oldWidth2 - newWidth2) / 2;
              const centerOffsetY2 = (oldHeight2 - newHeight2) / 2;
              
              result[j] = { 
                ...box2, 
                scale: newScale2,
                xOffset: (box2.xOffset || 0) + centerOffsetX2,
                yOffset: (box2.yOffset || 0) + centerOffsetY2
              };
            }
          }
        }
      }
      
      // If no overlap found in this iteration, we're done
      if (!hasOverlap) break;
    }

    return result;
  };

  // Calculate actual rendered image dimensions with object-fit: contain
  const calculateRenderedImageDimensions = (img: HTMLImageElement): { width: number; height: number; offsetX: number; offsetY: number } => {
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    const containerWidth = img.offsetWidth;
    const containerHeight = img.offsetHeight;
    
    // Calculate aspect ratios
    const imageAspect = naturalWidth / naturalHeight;
    const containerAspect = containerWidth / containerHeight;
    
    let renderedWidth: number;
    let renderedHeight: number;
    let offsetX: number = 0;
    let offsetY: number = 0;
    
    // object-fit: contain logic
    if (imageAspect > containerAspect) {
      // Image is wider than container - fit to width
      renderedWidth = containerWidth;
      renderedHeight = containerWidth / imageAspect;
      offsetY = (containerHeight - renderedHeight) / 2;
    } else {
      // Image is taller than container - fit to height
      renderedHeight = containerHeight;
      renderedWidth = containerHeight * imageAspect;
      offsetX = (containerWidth - renderedWidth) / 2;
    }
    
    return { width: renderedWidth, height: renderedHeight, offsetX, offsetY };
  };

  // Update dimensions when image loads or window resizes
  const updateDimensions = () => {
    if (imageRef.current) {
      // Wait for the image to fully load before getting dimensions
      const img = imageRef.current;
      if (img.complete && img.naturalHeight !== 0) {
        const rendered = calculateRenderedImageDimensions(img);
        setImageDimensions({
          width: rendered.width,
          height: rendered.height,
        });
        setOriginalDimensions({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } else {
        // If image isn't loaded, wait for it
        img.onload = () => {
          const rendered = calculateRenderedImageDimensions(img);
          setImageDimensions({
            width: rendered.width,
            height: rendered.height,
          });
          setOriginalDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
      }
    }
  };

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Re-update dimensions when imageSrc changes (after rotation)
  useEffect(() => {
    updateDimensions();
  }, [imageSrc]);

  // Calculate scale factor
  const scaleX = imageDimensions.width / (originalDimensions.width || 1);
  const scaleY = imageDimensions.height / (originalDimensions.height || 1);

  // Calculate image offset (for centering with object-fit: contain)
  const imageOffset = imageRef.current ? calculateRenderedImageDimensions(imageRef.current) : { offsetX: 0, offsetY: 0 };

  // Handle click to edit - always opens ResidentEditPopup
  const handleOverlayClick = async (index: number) => {
    // Clear any lingering interaction state
    clearInteractionTimers();
    setWobblingIndex(null);
    setLongPressIndex(null);
    touchStartPosRef.current = null;

    // Don't open edit popup if we're dragging or fusing
    if (draggingIndex !== null || isFusing) return;

    // Find the corresponding editable resident by originalName (stable identifier)
    const overlay = overlays[index];
    const originalName = overlay.originalName;
    
    // Find resident by original name OR current text
    // This handles cases where originalName might be lost in the resident object
    let matchingResident = editableResidents.find(r => 
      (r.originalName && r.originalName.toLowerCase() === originalName.toLowerCase()) ||
      r.name.toLowerCase() === overlay.text.toLowerCase() ||
      (overlay.editedText && r.name.toLowerCase() === overlay.editedText.toLowerCase())
    );
    
    if (!matchingResident) return;

    // FIX: Restore originalName if missing in resident but present in overlay
    // This prevents the overlay from being removed after subsequent edits
    if (!matchingResident.originalName && overlay.originalName) {
        console.log('[ImageWithOverlays] Restoring missing originalName from overlay:', overlay.originalName);
        const restoredResident = { ...matchingResident, originalName: overlay.originalName };
        
        // Update local state immediately to ensure consistency
        const residentIndex = editableResidents.findIndex(r => r === matchingResident);
        if (residentIndex >= 0) {
            const newResidents = [...editableResidents];
            newResidents[residentIndex] = restoredResident;
            onResidentsUpdated?.(newResidents);
            
            // Also update backend if possible
            if (currentDatasetId) {
                 import('@/services/api').then(({ datasetAPI }) => {
                     datasetAPI.bulkUpdateResidents(currentDatasetId, newResidents).catch(console.error);
                 });
            }
        }
        
        matchingResident = restoredResident;
    }
    
    // If no dataset exists yet, automatically create it without confirmation
    if (!currentDatasetId && onRequestDatasetCreation) {
      const createdDatasetId = await onRequestDatasetCreation();
      if (!createdDatasetId) {
        // Creation failed (not cancelled, as there's no dialog anymore)
        return;
      }
    }
    
    // Open the ResidentEditPopup
    setEditingResident(matchingResident);
    setShowEditPopup(true);
  };

  // Sync wobblingIndex state to ref
  useEffect(() => {
    wobblingIndexRef.current = wobblingIndex;
  }, [wobblingIndex]);

  // Multi-phase touch interaction constants
  const WOBBLE_DELAY = 200; // ms before wobble starts (allows scroll detection)
  const STATUS_MENU_DELAY = 2000; // ms total before status menu shows (if no movement)
  const SCROLL_THRESHOLD = 10; // pixels - movement less than this is not considered drag
  const NEAREST_OVERLAY_THRESHOLD = 150; // pixels - max distance to select nearest overlay on miss

  // Find the nearest overlay to a given point (in client coordinates)
  const findNearestOverlay = useCallback((clientX: number, clientY: number): { index: number; distance: number } | null => {
    if (overlays.length === 0 || !containerRef.current) return null;

    const containerRect = containerRef.current.getBoundingClientRect();
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    overlays.forEach((overlay, index) => {
      // Calculate the center of this overlay in client coordinates
      const scaledX = (overlay.x + (overlay.xOffset || 0)) * scaleX + imageOffset.offsetX + containerRect.left;
      const scaledY = (overlay.y + (overlay.yOffset || 0)) * scaleY + imageOffset.offsetY + containerRect.top;
      const scaledWidth = overlay.width * scaleX * overlay.scale;
      const scaledHeight = overlay.height * scaleY * overlay.scale;

      const centerX = scaledX + scaledWidth / 2;
      const centerY = scaledY + scaledHeight / 2;

      // Calculate distance from touch point to overlay center
      const distance = Math.sqrt(
        Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2)
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (nearestIndex >= 0 && nearestDistance <= NEAREST_OVERLAY_THRESHOLD) {
      return { index: nearestIndex, distance: nearestDistance };
    }
    return null;
  }, [overlays, scaleX, scaleY, imageOffset]);

  // Clear all interaction timers (defined early so container handlers can use it)
  const clearInteractionTimers = useCallback(() => {
    if (wobbleTimerRef.current) {
      clearTimeout(wobbleTimerRef.current);
      wobbleTimerRef.current = null;
    }
    if (statusMenuTimerRef.current) {
      clearTimeout(statusMenuTimerRef.current);
      statusMenuTimerRef.current = null;
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (containerTouchTimerRef.current) {
      clearTimeout(containerTouchTimerRef.current);
      containerTouchTimerRef.current = null;
    }
  }, []);

  // Handle container-level touch start (for selecting nearest overlay on miss)
  const handleContainerTouchStart = useCallback((e: React.TouchEvent) => {
    // Only process if touch target is the container or image (not an overlay)
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid^="overlay-box-"]')) {
      // Touch is on an overlay - let the overlay's handler deal with it
      return;
    }

    if (isFusing || statusMenuOpen) return;

    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;

    // Store start position
    touchStartPosRef.current = { x: clientX, y: clientY };
    statusMenuTriggeredRef.current = false;
    setSelectedByProximity(false);
    setHasMoved(false);

    // Start timer to find nearest overlay after WOBBLE_DELAY
    containerTouchTimerRef.current = setTimeout(() => {
      // Check if user has moved (scrolling)
      if (!touchStartPosRef.current) return;

      // Find nearest overlay
      const nearest = findNearestOverlay(clientX, clientY);
      if (nearest) {
        // Haptic feedback
        if ('vibrate' in navigator) {
          try { navigator.vibrate(30); } catch (err) { /* ignore */ }
        }

        // Mark as selected by proximity (overlay will be moved to finger)
        setSelectedByProximity(true);

        // Calculate drag offset to position overlay above finger
        const overlay = overlays[nearest.index];
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const scaledWidth = overlay.width * scaleX * overlay.scale;
          const scaledHeight = overlay.height * scaleY * overlay.scale;

          // Offset so overlay appears above the finger (80px up)
          setDragOffset({
            x: 0,
            y: 80, // Above finger
          });
          setDragPosition({ x: clientX, y: clientY });
        }

        // Start wobbling this overlay
        setWobblingIndex(nearest.index);
        setLongPressIndex(nearest.index);

        // Set up status menu timer for 2 seconds of no movement
        statusMenuTimerRef.current = setTimeout(() => {
          setWobblingIndex(currentWobbling => {
            if (currentWobbling === nearest.index) {
              if ('vibrate' in navigator) {
                try { navigator.vibrate(50); } catch (err) { /* ignore */ }
              }
              statusMenuTriggeredRef.current = true;
              setStatusMenuPosition({ x: clientX, y: clientY });
              setStatusMenuOverlay({ overlay: overlays[nearest.index], index: nearest.index });
              setStatusMenuOpen(true);
              setWobblingIndex(null);
              setLongPressIndex(null);
              setSelectedByProximity(false);
            }
            return null;
          });
          statusMenuTimerRef.current = null;
        }, STATUS_MENU_DELAY - WOBBLE_DELAY);
      }
      containerTouchTimerRef.current = null;
    }, WOBBLE_DELAY);
  }, [isFusing, statusMenuOpen, findNearestOverlay, overlays, scaleX, scaleY]);

  // Handle container-level touch move
  const handleContainerTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;

    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;

    const deltaX = Math.abs(clientX - touchStartPosRef.current.x);
    const deltaY = Math.abs(clientY - touchStartPosRef.current.y);
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // If movement exceeds threshold before wobble phase, cancel (user is scrolling)
    if (totalMovement > SCROLL_THRESHOLD && wobblingIndexRef.current === null && draggingIndex === null && !selectedByProximity) {
      clearInteractionTimers();
      touchStartPosRef.current = null;
      setSelectedByProximity(false);
      return;
    }

    // Prevent scrolling when overlay is selected (wobbling or dragging)
    if (wobblingIndexRef.current !== null || draggingIndex !== null || selectedByProximity) {
      e.preventDefault();
    }

    // If wobbling (selected by proximity) and user moves, start drag mode
    if (wobblingIndexRef.current !== null && selectedByProximity && totalMovement > SCROLL_THRESHOLD) {
      // Cancel status menu timer
      if (statusMenuTimerRef.current) {
        clearTimeout(statusMenuTimerRef.current);
        statusMenuTimerRef.current = null;
      }

      // Enter drag mode
      setHasMoved(true);
      setDraggingIndex(wobblingIndexRef.current);
      setWobblingIndex(null);
      setLongPressIndex(null);
    }

    // Update drag position if dragging
    if (draggingIndex !== null) {
      setDragPosition({ x: clientX, y: clientY });
    }
  }, [draggingIndex, selectedByProximity, clearInteractionTimers]);

  // Handle container-level touch end
  const handleContainerTouchEnd = useCallback(() => {
    clearInteractionTimers();

    if (!touchStartPosRef.current) {
      setSelectedByProximity(false);
      return;
    }

    // Reset all state
    setWobblingIndex(null);
    setLongPressIndex(null);
    touchStartPosRef.current = null;
    setSelectedByProximity(false);
    setHasMoved(false);
  }, [clearInteractionTimers]);

  // Handle touch/mouse down - start the multi-phase interaction
  const handleInteractionStart = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
    if (isFusing || statusMenuOpen) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const overlay = overlays[index];

    // Store start position to detect movement
    touchStartPosRef.current = { x: clientX, y: clientY };
    statusMenuTriggeredRef.current = false;
    setHasMoved(false);

    // Calculate offset for potential drag
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isTouch = 'touches' in e;
    // On touch, shift the drag center up so the element appears above the finger
    const touchYOffset = isTouch ? 80 : 0;

    setDragOffset({
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2 + touchYOffset,
    });
    setDragPosition({ x: clientX, y: clientY });

    // Phase 1: After WOBBLE_DELAY, start wobbling (indicates drag is possible)
    wobbleTimerRef.current = setTimeout(() => {
      // Haptic feedback to indicate wobble/drag mode
      if ('vibrate' in navigator) {
        try { navigator.vibrate(30); } catch (err) { /* ignore */ }
      }
      setWobblingIndex(index);
      setLongPressIndex(index);
      wobbleTimerRef.current = null;
    }, WOBBLE_DELAY);

    // Phase 2: After STATUS_MENU_DELAY, show status menu (only if no movement)
    statusMenuTimerRef.current = setTimeout(() => {
      // Only show status menu if user hasn't moved (hasMoved will be checked in the callback)
      // We use a ref check pattern here since state might not be up to date
      setWobblingIndex(currentWobbling => {
        if (currentWobbling === index) {
          // User is still holding without dragging - show status menu
          // Haptic feedback
          if ('vibrate' in navigator) {
            try { navigator.vibrate(50); } catch (err) { /* ignore */ }
          }

          statusMenuTriggeredRef.current = true;
          setStatusMenuPosition({ x: clientX, y: clientY });
          setStatusMenuOverlay({ overlay, index });
          setStatusMenuOpen(true);

          // Reset interaction state
          setWobblingIndex(null);
          setLongPressIndex(null);
        }
        return null; // Reset wobbling regardless
      });
      statusMenuTimerRef.current = null;
    }, STATUS_MENU_DELAY);

    // Don't preventDefault here - allow scroll detection
  }, [isFusing, statusMenuOpen, overlays]);

  // Handle touch/mouse move during interaction
  const handleInteractionMove = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (!touchStartPosRef.current) return;

    const deltaX = Math.abs(clientX - touchStartPosRef.current.x);
    const deltaY = Math.abs(clientY - touchStartPosRef.current.y);
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // If movement exceeds threshold before wobble phase, cancel everything (user is scrolling)
    if (totalMovement > SCROLL_THRESHOLD && wobblingIndexRef.current === null && !draggingIndex) {
      clearInteractionTimers();
      touchStartPosRef.current = null;
      return;
    }

    // If wobbling and user moves significantly, start drag mode
    if (wobblingIndexRef.current === index && totalMovement > SCROLL_THRESHOLD) {
      // Cancel status menu timer - user is dragging
      if (statusMenuTimerRef.current) {
        clearTimeout(statusMenuTimerRef.current);
        statusMenuTimerRef.current = null;
      }

      // Enter drag mode
      setHasMoved(true);
      setDraggingIndex(index);
      setWobblingIndex(null);
      setLongPressIndex(null);

      // Prevent scrolling now that we're dragging
      e.preventDefault();
    }

    // Update drag position if already dragging
    if (draggingIndex === index) {
      setDragPosition({ x: clientX, y: clientY });
      e.preventDefault();
    }
  }, [draggingIndex, clearInteractionTimers]);

  // Handle touch/mouse end
  const handleInteractionEnd = useCallback((index: number) => {
    clearInteractionTimers();

    // If touchStartPosRef.current is null, it means the interaction was cancelled (e.g. scrolled)
    if (!touchStartPosRef.current) {
      return;
    }

    // If status menu was triggered, do NOT treat as click
    if (statusMenuTriggeredRef.current) {
      setWobblingIndex(null);
      setLongPressIndex(null);
      touchStartPosRef.current = null;
      return;
    }

    // If we were just wobbling (not dragging), it was a long press that didn't reach menu yet
    // We should NOT treat this as a click, just reset.
    if (wobblingIndexRef.current === index && !draggingIndex) {
      setWobblingIndex(null);
      setLongPressIndex(null);
      touchStartPosRef.current = null;
      return;
    }

    // If we weren't wobbling or dragging yet, it's a quick tap
    if (wobblingIndexRef.current === null && draggingIndex === null) {
      touchStartPosRef.current = null;
      handleOverlayClick(index);
      return;
    }

    // Reset interaction state
    setWobblingIndex(null);
    setLongPressIndex(null);
    touchStartPosRef.current = null;
    setHasMoved(false);
  }, [draggingIndex, clearInteractionTimers, handleOverlayClick]);



  // Handle status change from context menu (Long Press)
  const handleStatusChange = async (newStatus: ResidentStatus) => {
    if (!statusMenuOverlay || !editableResidents || !onResidentsUpdated) return;

    const { overlay } = statusMenuOverlay;
    
    try {
      // Find the resident matching this overlay
      // Try matching by originalName first, then by current name (fallback)
      const residentIndex = editableResidents.findIndex(r => 
        (r.originalName && r.originalName === overlay.originalName) ||
        r.name === overlay.text ||
        r.name === overlay.originalName
      );
      
      if (residentIndex >= 0) {
        const updatedResidents = [...editableResidents];
        updatedResidents[residentIndex] = {
          ...updatedResidents[residentIndex],
          status: newStatus
        };

        // Update local state
        onResidentsUpdated(updatedResidents);

        // Save to backend if dataset exists
        if (currentDatasetId) {
          const { datasetAPI } = await import('@/services/api');
          await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);

          toast({
            title: t('resident.status.updated', 'Status updated'),
            description: t('resident.status.updatedDescription', `Status changed for ${overlay.text}`),
          });
        }
      }
    } catch (error) {
      console.error('[handleStatusChange] Error updating status:', error);
      toast({
        variant: 'destructive',
        title: t('resident.status.error', 'Error'),
        description: t('resident.status.errorDescription', 'Failed to update status'),
      });
    } finally {
      // Close menu
      setStatusMenuOpen(false);
      setStatusMenuOverlay(null);
    }
  };

  // Handlers for new resident edit popup
  const handleResidentSave = async (updatedResident: EditableResident) => {
    console.log('[ImageWithOverlays.handleResidentSave] 🎯 CALLED! updatedResident:', updatedResident);
    if (!editingResident || !onResidentsUpdated) return;

    // Find the index of the resident being edited by name and category
    const residentIndex = editableResidents.findIndex(r => 
      r.name === editingResident.name && r.category === editingResident.category
    );

    if (residentIndex >= 0) {
      // Update the residents list
      const updatedResidents = [...editableResidents];
      updatedResidents[residentIndex] = updatedResident;
      
      // Update local state first
      onResidentsUpdated(updatedResidents);

      // 🔥 NEW: Save to backend if we have a dataset ID
      if (currentDatasetId) {
        console.log('[ImageWithOverlays.handleResidentSave] 💾 Saving to backend, datasetId:', currentDatasetId);
        try {
          const { datasetAPI } = await import('@/services/api');
          await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
          console.log('[ImageWithOverlays.handleResidentSave] ✅ Backend save successful!');
        } catch (error) {
          console.error('[ImageWithOverlays.handleResidentSave] ❌ Backend save failed:', error);
          toast({
            variant: 'destructive',
            title: t('resident.edit.error', 'Error saving'),
            description: t('resident.edit.errorDesc', 'Changes could not be saved'),
          });
          return; // Don't close popup on error
        }
      } else {
        console.log('[ImageWithOverlays.handleResidentSave] ⚠️ No dataset ID, skipping backend save');
      }

      // Update overlay text if name changed
      if (updatedResident.name !== editingResident.name) {
        const updatedNames = [...residentNames];
        // Find the index in residentNames that matches the old name
        const nameIndex = updatedNames.findIndex(name => name === editingResident.name);
        if (nameIndex >= 0) {
          updatedNames[nameIndex] = updatedResident.name;
          onNamesUpdated?.(updatedNames);
        }
      }

      toast({
        title: t('photo.success'),
        description: t('photo.nameUpdated'),
      });
    }

    setShowEditPopup(false);
    setEditingResident(null);
  };

  const handleResidentCancel = () => {
    setShowEditPopup(false);
    setEditingResident(null);
  };

  const handleResidentDelete = async (resident: EditableResident) => {
    console.log('[ImageWithOverlays.handleResidentDelete] 🗑️ CALLED! resident:', resident);
    
    // Find the resident in editableResidents
    const residentIndex = editableResidents.findIndex(r => r.name === resident.name);
    if (residentIndex === -1) {
      console.error('[ImageWithOverlays.handleResidentDelete] ❌ Resident not found:', resident.name);
      throw new Error('Resident not found');
    }

    // Remove from editable residents list
    const updatedResidents = editableResidents.filter((_, index) => index !== residentIndex);
    if (onResidentsUpdated) {
      onResidentsUpdated(updatedResidents);
    }

    // Save to backend if we have a dataset ID
    if (currentDatasetId) {
      console.log('[ImageWithOverlays.handleResidentDelete] 💾 Saving to backend, datasetId:', currentDatasetId);
      try {
        const { datasetAPI } = await import('@/services/api');
        await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
        console.log('[ImageWithOverlays.handleResidentDelete] ✅ Backend save successful!');
      } catch (error) {
        console.error('[ImageWithOverlays.handleResidentDelete] ❌ Backend save failed:', error);
        toast({
          variant: 'destructive',
          title: t('resident.delete.error', 'Error deleting'),
          description: t('resident.delete.errorDesc', 'Resident could not be deleted'),
        });
        throw error; // Re-throw to prevent popup from closing
      }
    } else {
      console.log('[ImageWithOverlays.handleResidentDelete] ⚠️ No dataset ID, skipping backend save');
    }

    // Update overlay names list to remove deleted resident
    const updatedNames = residentNames.filter(name => name !== resident.name);
    onNamesUpdated?.(updatedNames);
  };

  // Drag & Drop handlers for overlay fusion (global listeners for drag movement)
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (draggingIndex === null || isFusing) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragPosition({ x: clientX, y: clientY });

    // Find potential drop target (another overlay)
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    let foundTarget: number | null = null;
    overlays.forEach((overlay, index) => {
      if (index === draggingIndex) return;

      const scaledX = (overlay.x + (overlay.xOffset || 0)) * scaleX + imageOffset.offsetX + containerRect.left;
      const scaledY = (overlay.y + (overlay.yOffset || 0)) * scaleY + imageOffset.offsetY + containerRect.top;
      const scaledWidth = overlay.width * scaleX * overlay.scale;
      const scaledHeight = overlay.height * scaleY * overlay.scale;

      // Check if drag position is within this overlay
      if (
        clientX >= scaledX &&
        clientX <= scaledX + scaledWidth &&
        clientY >= scaledY &&
        clientY <= scaledY + scaledHeight
      ) {
        foundTarget = index;
      }
    });

    setDropTargetIndex(foundTarget);
  }, [draggingIndex, overlays, scaleX, scaleY, imageOffset, isFusing]);

  const handleDragEnd = useCallback(async () => {
    if (draggingIndex === null || isFusing) {
      setDraggingIndex(null);
      setDropTargetIndex(null);
      return;
    }

    if (dropTargetIndex !== null && dropTargetIndex !== draggingIndex) {
      // Perform fusion!
      const sourceOverlay = overlays[draggingIndex];
      const targetOverlay = overlays[dropTargetIndex];

      // Find corresponding residents
      // Try matching by originalName first, then by current name (fallback)
      const sourceResident = editableResidents.find(r => 
        (r.originalName && r.originalName === sourceOverlay.originalName) ||
        r.name === sourceOverlay.text ||
        r.name === sourceOverlay.originalName
      );
      const targetResident = editableResidents.find(r => 
        (r.originalName && r.originalName === targetOverlay.originalName) ||
        r.name === targetOverlay.text ||
        r.name === targetOverlay.originalName
      );

      if (sourceResident && targetResident) {
        // Combine names (source name goes below target name visually, but stored with space)
        const combinedName = `${targetResident.name} ${sourceResident.name}`;

        // Save to history for undo
        setFusionHistory(prev => [...prev, {
          targetName: targetResident.name,
          sourceName: sourceResident.name,
          resultName: combinedName,
          originalTargetResident: { ...targetResident },
          originalSourceResident: { ...sourceResident },
          timestamp: Date.now(),
        }]);

        // Start fusion animation
        setIsFusing(true);
        setFusingIndices({ source: draggingIndex, target: dropTargetIndex });

        // Wait for animation
        await new Promise(resolve => setTimeout(resolve, 400));

        // Update editableResidents: update target, remove source
        const updatedResidents = editableResidents
          .map(r => {
            if (r.name === targetResident.name) {
              return { ...r, name: combinedName };
            }
            return r;
          })
          .filter(r => r.name !== sourceResident.name);

        onResidentsUpdated?.(updatedResidents);

        // Update names list
        const updatedNames = residentNames
          .map(name => (name === targetResident.name ? combinedName : name))
          .filter(name => name !== sourceResident.name);
        onNamesUpdated?.(updatedNames);

        // Save to backend if we have a dataset ID
        if (currentDatasetId) {
          try {
            const { datasetAPI } = await import('@/services/api');
            await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
          } catch (error) {
            console.error('[ImageWithOverlays.handleFusion] Backend save failed:', error);
          }
        }

        toast({
          title: 'Textfelder fusioniert',
          description: `"${sourceResident.name}" wurde mit "${targetResident.name}" zusammengeführt`,
        });

        // End fusion animation
        setTimeout(() => {
          setIsFusing(false);
          setFusingIndices(null);
        }, 100);
      }
    }

    setDraggingIndex(null);
    setDropTargetIndex(null);
  }, [draggingIndex, dropTargetIndex, overlays, editableResidents, residentNames, onResidentsUpdated, onNamesUpdated, currentDatasetId, toast, isFusing]);

  // Undo last fusion
  const handleUndoFusion = useCallback(async () => {
    if (fusionHistory.length === 0) return;

    const lastFusion = fusionHistory[fusionHistory.length - 1];

    // Restore the original residents
    const updatedResidents = editableResidents
      .map(r => {
        // Try to match by ID first (if available) - this handles renamed residents
        if ((lastFusion.originalTargetResident as any).id && (r as any).id && (r as any).id === (lastFusion.originalTargetResident as any).id) {
             return { ...lastFusion.originalTargetResident };
        }

        // Fallback to name match (using stored resultName or reconstructed name)
        const targetName = lastFusion.resultName || `${lastFusion.originalTargetResident.name} ${lastFusion.originalSourceResident.name}`;
        if (r.name === targetName) {
          return { ...lastFusion.originalTargetResident };
        }
        return r;
      });

    // Re-add the source resident
    updatedResidents.push({ ...lastFusion.originalSourceResident });

    onResidentsUpdated?.(updatedResidents);

    // Update names list - Use local residentNames to avoid pulling in residents from other photos
    // Find the current name of the resident we are undoing (it might have been renamed)
    let currentFusedName = lastFusion.resultName || `${lastFusion.originalTargetResident.name} ${lastFusion.originalSourceResident.name}`;
    
    // If we have IDs, we can find the current name even if it changed
    if ((lastFusion.originalTargetResident as any).id) {
        const currentResident = editableResidents.find(r => (r as any).id === (lastFusion.originalTargetResident as any).id);
        if (currentResident) {
            currentFusedName = currentResident.name;
        }
    }

    const updatedLocalNames = residentNames.flatMap(name => {
        if (name === currentFusedName) {
             // Replace fused name with original target and source
             return [lastFusion.originalTargetResident.name, lastFusion.originalSourceResident.name];
        }
        return [name];
    });
    
    onNamesUpdated?.(updatedLocalNames);

    // Save to backend
    if (currentDatasetId) {
      try {
        const { datasetAPI } = await import('@/services/api');
        await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
      } catch (error) {
        console.error('[ImageWithOverlays.handleUndoFusion] Backend save failed:', error);
      }
    }

    // Remove from history
    setFusionHistory(prev => prev.slice(0, -1));

    toast({
      title: 'Fusion rückgängig gemacht',
      description: `"${lastFusion.sourceName}" wurde wiederhergestellt`,
    });
  }, [fusionHistory, editableResidents, residentNames, onResidentsUpdated, onNamesUpdated, currentDatasetId, toast]);

  // Add global mouse/touch event listeners for drag
  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => handleDragMove(e);
    const handleTouchMove = (e: TouchEvent) => handleDragMove(e);
    const handleMouseUp = () => handleDragEnd();
    const handleTouchEnd = () => handleDragEnd();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [draggingIndex, handleDragMove, handleDragEnd]);

  // Only render if we have an image
  if (!imageSrc) {
    console.log('[ImageWithOverlays] Not rendering: No image source');
    return null;
  }

  // Calculate which types of overlays are present
  const hasProspects = overlays.some(o => !o.isExisting && !o.isDuplicate);
  const hasExisting = overlays.some(o => o.isExisting && !o.isDuplicate);
  const hasDuplicates = overlays.some(o => o.isDuplicate);

  return (
    <Card data-testid="card-image-overlays">
      <CardContent className="p-0">
        {/* Legend with Undo Button */}
        {(hasProspects || hasExisting || hasDuplicates) && (
          <div className="flex flex-col border-b">
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex items-center gap-4 flex-wrap">
                {hasProspects && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorConfig.prospects.solid }} />
                    <span>{t('photo.legend.prospects', 'Prospects')}</span>
                  </div>
                )}
                {hasExisting && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorConfig.existing.solid }} />
                    <span>{t('photo.legend.existing', 'Existing Customers')}</span>
                  </div>
                )}
                {hasDuplicates && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorConfig.duplicates.solid }} />
                    <span>{t('photo.legend.duplicates', 'Duplicates')}</span>
                  </div>
                )}
                {/* Fusion hint */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Combine className="w-3 h-3" />
                  <span className="hidden sm:inline">Ziehen zum Fusionieren</span>
                </div>
              </div>
              {/* Undo button */}
              {fusionHistory.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndoFusion}
                  className="h-7 gap-1 text-muted-foreground hover:text-foreground"
                  title="Letzte Fusion rückgängig machen"
                >
                  <Undo2 className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">Rückgängig</span>
                </Button>
              )}
            </div>
          </div>
        )}
        
        <div
          ref={containerRef}
          className="relative w-full select-none"
          style={{
            // Disable scrolling when wobbling/dragging (proximity selection or direct hit)
            touchAction: (wobblingIndex !== null || draggingIndex !== null || selectedByProximity) ? 'none' : 'pan-y',
            WebkitTouchCallout: 'none', // iOS: Disable magnifying glass/context menu
            WebkitUserSelect: 'none',   // iOS: Disable text selection
            userSelect: 'none'          // Standard: Disable text selection
          }}
          onContextMenu={(e) => {
            // Prevent native context menu (Save Image, Share, etc.)
            e.preventDefault();
            return false;
          }}
          onTouchStart={handleContainerTouchStart}
          onTouchMove={handleContainerTouchMove}
          onTouchEnd={handleContainerTouchEnd}
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Nameplate with overlays"
            className="w-full h-auto select-none"
            onLoad={updateDimensions}
            data-testid="img-with-overlays"
            style={{ 
              objectFit: 'contain', 
              display: 'block',
              maxHeight: '80vh',
              maxWidth: '100%',
              aspectRatio: 'auto',
              WebkitTouchCallout: 'none', // iOS: Disable context menu on image
              pointerEvents: 'none'       // Prevent image dragging/selection
            }}
          />
          
          {overlays.map((overlay, index) => {
            const isShowingDetails = longPressIndex === index;
            const isDragging = draggingIndex === index;
            const isDropTarget = dropTargetIndex === index;
            const isFusingSource = fusingIndices?.source === index;
            const isFusingTarget = fusingIndices?.target === index;
            const isWobbling = wobblingIndex === index;

            // Apply scale and add offset for object-fit: contain centering
            const scaledX = (overlay.x + (overlay.xOffset || 0)) * scaleX + imageOffset.offsetX;
            const scaledY = (overlay.y + (overlay.yOffset || 0)) * scaleY + imageOffset.offsetY;
            const scaledWidth = overlay.width * scaleX * overlay.scale;
            const scaledHeight = overlay.height * scaleY * overlay.scale;

            // Check if this is a fused name (contains space = two names)
            const nameParts = overlay.text.split(' ');
            const isFusedName = nameParts.length >= 2 && nameParts.every(part => part.length > 1);

            // Calculate optimal font size for this overlay
            // Text area extends 8px on each side (16px total) for better visibility
            // For fused names, use the longest part for sizing
            const displayText = isFusedName ? nameParts.reduce((a, b) => a.length > b.length ? a : b) : overlay.text;
            const optimalFontSize = calculateFontSize(displayText, scaledWidth + 16, scaledHeight / (isFusedName ? 2 : 1));

            // Calculate position (override if dragging or selected by proximity)
            let finalX = scaledX;
            let finalY = scaledY;

            if (isDragging && containerRef.current) {
               const containerRect = containerRef.current.getBoundingClientRect();
               // Center of the element in client coords
               const centerX = dragPosition.x - dragOffset.x;
               const centerY = dragPosition.y - dragOffset.y;

               // Top-Left in client coords
               const leftClient = centerX - scaledWidth / 2;
               const topClient = centerY - scaledHeight / 2;

               // Relative to container
               finalX = leftClient - containerRect.left;
               finalY = topClient - containerRect.top;
            } else if (isWobbling && selectedByProximity && containerRef.current) {
               // When selected by proximity (long press miss), move overlay to finger position
               const containerRect = containerRef.current.getBoundingClientRect();
               // Position overlay centered horizontally and 80px above the finger
               const centerX = dragPosition.x;
               const centerY = dragPosition.y - dragOffset.y; // 80px above finger

               // Top-Left in client coords
               const leftClient = centerX - scaledWidth / 2;
               const topClient = centerY - scaledHeight / 2;

               // Relative to container
               finalX = leftClient - containerRect.left;
               finalY = topClient - containerRect.top;
            }

            // Don't render source overlay during fusion animation (it's flying to target)
            if (isFusingSource) {
              return (
                <div
                  key={index}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${scaledX}px`,
                    top: `${scaledY}px`,
                    width: `${scaledWidth}px`,
                    height: `${scaledHeight}px`,
                    animation: 'fusionFlyToTarget 0.4s ease-out forwards',
                    zIndex: 100,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded"
                    style={{
                      backgroundColor: overlay.isDuplicate
                        ? colorConfig.duplicates.background
                        : overlay.isExisting
                        ? colorConfig.existing.background
                        : colorConfig.prospects.background,
                      border: `1px solid ${
                        overlay.isDuplicate
                          ? colorConfig.duplicates.border
                          : overlay.isExisting
                          ? colorConfig.existing.border
                          : colorConfig.prospects.border
                      }`,
                      transform: 'scale(0.8)',
                      opacity: 0.8,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-center text-black font-medium" style={{ fontSize: `${optimalFontSize}px` }}>
                      {overlay.text}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={index}
                className={`absolute cursor-grab transition-all duration-200 select-none touch-none ${
                  isDragging ? 'opacity-0' : ''
                } ${isDropTarget ? 'ring-4 ring-primary ring-offset-2 scale-125 z-40' : ''} ${
                  isFusingTarget ? 'animate-pulse ring-4 ring-green-500' : ''
                }`}
                style={{
                  left: `${finalX}px`,
                  top: `${finalY}px`,
                  width: `${scaledWidth}px`,
                  height: `${scaledHeight}px`,
                  zIndex: isDragging ? 50 : isWobbling ? 50 : isDropTarget ? 40 : 10,
                  transition: isDragging ? 'none' : 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  WebkitTouchCallout: 'none', // iOS: Disable context menu
                  WebkitUserSelect: 'none',   // iOS: Disable selection
                  userSelect: 'none',
                  touchAction: 'none',        // iOS: Disable scrolling while dragging
                  // Pop up effect when holding (before drag starts)
                  ...(isWobbling && !isDragging ? {
                    transform: 'scale(1.3) translateY(-60px)',
                    filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.4))',
                  } : {}),
                }}
                onMouseDown={(e) => {
                  handleInteractionStart(index, e);
                }}
                onMouseMove={(e) => {
                  handleInteractionMove(index, e);
                }}
                onMouseUp={() => {
                  handleInteractionEnd(index);
                }}
                onMouseLeave={() => {
                  // Only end if not dragging (drag continues via global listeners)
                  if (!isDragging) {
                    handleInteractionEnd(index);
                  }
                }}
                onTouchStart={(e) => {
                  // Prevent default to ensure no scrolling happens on any device
                  // This is safe because we handle clicks manually in handleInteractionEnd
                  if (e.cancelable) e.preventDefault();
                  handleInteractionStart(index, e);
                }}
                onTouchMove={(e) => {
                  handleInteractionMove(index, e);
                }}
                onTouchEnd={() => {
                  handleInteractionEnd(index);
                }}
                data-testid={`overlay-box-${index}`}
                data-is-duplicate={overlay.isDuplicate ? 'true' : 'false'}
                data-is-existing={overlay.isExisting ? 'true' : 'false'}
                data-is-dragging={isDragging ? 'true' : 'false'}
                data-is-wobbling={isWobbling ? 'true' : 'false'}
              >
                {/* Background box with rounded corners and border */}
                <div
                  className={`absolute inset-0 rounded transition-all duration-150 touch-none ${
                    isDropTarget ? 'shadow-xl bg-primary/10' : ''
                  }`}
                  style={{
                    touchAction: 'none',
                    backgroundColor: overlay.isDuplicate
                      ? colorConfig.duplicates.background
                      : overlay.isExisting
                      ? colorConfig.existing.background
                      : colorConfig.prospects.background,
                    border: `${isDropTarget ? '3px' : '1px'} solid ${
                      isDropTarget
                        ? 'hsl(var(--primary))'
                        : overlay.isDuplicate
                        ? colorConfig.duplicates.border
                        : overlay.isExisting
                        ? colorConfig.existing.border
                        : colorConfig.prospects.border
                    }`,
                  }}
                />

                {/* Text container - extends horizontally to avoid rounded corner clipping */}
                <div
                  className="absolute inset-0 flex items-center justify-center touch-none"
                  style={{
                    touchAction: 'none',
                    left: '-8px',
                    right: '-8px',
                    paddingLeft: '8px',
                    paddingRight: '8px',
                  }}
                >
                  {/* Show text - two lines for fused names */}
                  {isFusedName ? (
                    <div className="flex flex-col items-center justify-center">
                      {nameParts.map((part, partIndex) => (
                        <span
                          key={partIndex}
                          className="text-center leading-tight text-black font-medium"
                          style={{
                            fontSize: `${optimalFontSize * 0.85}px`,
                            lineHeight: '1.1',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {part}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span
                      className="text-center leading-tight text-black font-medium"
                      style={{
                        fontSize: `${optimalFontSize}px`,
                        lineHeight: '1.1',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {overlay.text}
                    </span>
                  )}
                </div>

                {/* Drop target indicator */}
                {isDropTarget && (
                  <div className="absolute inset-0 flex items-center justify-center bg-primary/20 rounded pointer-events-none">
                    <Combine className="h-6 w-6 text-primary animate-bounce" />
                  </div>
                )}

                {/* Long press popup */}
                {isShowingDetails && overlay.matchedCustomer && !isDragging && (
                  <div
                    className="absolute z-50 bg-card border rounded-lg shadow-lg p-3 min-w-[200px] pointer-events-none"
                    style={{
                      top: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      marginTop: '4px',
                    }}
                    data-testid={`popup-details-${index}`}
                  >
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold">{overlay.matchedCustomer.name}</p>
                      {overlay.matchedCustomer.street && (
                        <p className="text-muted-foreground">
                          {overlay.matchedCustomer.street} {overlay.matchedCustomer.houseNumber}
                        </p>
                      )}
                      {overlay.matchedCustomer.postalCode && (
                        <p className="text-muted-foreground">{overlay.matchedCustomer.postalCode}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Dragging ghost overlay */}
          {draggingIndex !== null && !isFusing && (
            <div
              className="fixed pointer-events-none z-[1000]"
              style={{
                left: `${dragPosition.x - dragOffset.x}px`,
                top: `${dragPosition.y - dragOffset.y}px`,
                transform: 'translate(-50%, -50%) scale(1.5)',
                transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <div
                className="px-3 py-1.5 rounded shadow-2xl"
                style={{
                  backgroundColor: overlays[draggingIndex]?.isDuplicate
                    ? colorConfig.duplicates.solid
                    : overlays[draggingIndex]?.isExisting
                    ? colorConfig.existing.solid
                    : colorConfig.prospects.solid,
                  border: '2px solid white',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                }}
              >
                <span className="text-white font-bold text-lg whitespace-nowrap">
                  {overlays[draggingIndex]?.text}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* New Resident Edit Popup */}
        <ResidentEditPopup
          isOpen={showEditPopup}
          onClose={handleResidentCancel}
          onSave={handleResidentSave}
          onDelete={handleResidentDelete}
          resident={editingResident}
          isEditing={editingResident !== null}
        />

        {/* Status Context Menu (Long Press) */}
        <StatusContextMenu
          isOpen={statusMenuOpen}
          x={statusMenuPosition.x}
          y={statusMenuPosition.y}
          onClose={() => {
            setStatusMenuOpen(false);
            setStatusMenuOverlay(null);
          }}
          onSelectStatus={handleStatusChange}
          currentStatus={
            statusMenuOverlay && editableResidents
              ? editableResidents.find(r => r.name === statusMenuOverlay.overlay.originalName)?.status
              : undefined
          }
        />

        {/* Fusion Preview - Fixed position to avoid layout shifts */}
        {draggingIndex !== null && dropTargetIndex !== null && (
          <div
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[1001] pointer-events-none"
            style={{
              animation: 'fadeIn 0.15s ease-out',
            }}
          >
            <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg">
              <Combine className="w-4 h-4 animate-pulse" />
              <span className="font-semibold whitespace-nowrap">
                {overlays[dropTargetIndex]?.text}
              </span>
              <span className="opacity-70">+</span>
              <span className="font-semibold whitespace-nowrap">
                {overlays[draggingIndex]?.text}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}