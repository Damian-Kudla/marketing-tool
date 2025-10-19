import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Check } from 'lucide-react';
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
        const isExisting = !newProspects.includes(editedName);
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
        const editedVersion = editedByName.get(newOverlay.originalName.toLowerCase());
        if (editedVersion) {
          // Use edited version without updating bounding box
          merged.push({
            ...editedVersion,
            // Use recalculated status from edited version (not newOverlay)
            isExisting: editedVersion.isExisting,
            isDuplicate: editedVersion.isDuplicate,
            matchedCustomer: editedVersion.matchedCustomer,
          });
          editedByName.delete(newOverlay.originalName.toLowerCase()); // Mark as used
        } else {
          merged.push(newOverlay);
        }
      });
      
      // Don't add remaining edited overlays - they should be deleted if their name is gone
      // (Previously we added them here, but now we filter them out at the beginning)
      
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
  useEffect(() => {
    if (overlays.length === 0 || editableResidents.length === 0) return;

    setOverlays(prevOverlays => {
      return prevOverlays.map(overlay => {
        // Try multiple matching strategies to find the corresponding resident
        // Strategy 1: Match by current displayed text (most reliable for repeated edits)
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
          // Resident was deleted - keep overlay as is but maybe mark it
          console.log('[ImageWithOverlays] No matching resident found for overlay:', overlay.text);
          return overlay;
        }

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
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setLongPressIndex(null);
    
    // Find the corresponding editable resident by originalName (stable identifier)
    const overlay = overlays[index];
    const originalName = overlay.originalName;
    
    // Find resident by original name
    const matchingResident = editableResidents.find(r => 
      r.name.toLowerCase() === originalName.toLowerCase()
    );
    
    if (!matchingResident) return;
    
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

  // Handle long press start - now opens status context menu
  const handleLongPressStart = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    
    longPressTimerRef.current = setTimeout(() => {
      const overlay = overlays[index];
      
      // Get position from event
      let x: number, y: number;
      if ('touches' in e.nativeEvent && e.nativeEvent.touches.length > 0) {
        const touch = e.nativeEvent.touches[0];
        x = touch.clientX;
        y = touch.clientY;
      } else if ('clientX' in e.nativeEvent) {
        x = e.nativeEvent.clientX;
        y = e.nativeEvent.clientY;
      } else {
        // Fallback to overlay position
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }

      // Haptic feedback
      if ('vibrate' in navigator) {
        try {
          navigator.vibrate(50);
        } catch (err) {
          console.debug('Haptic feedback not available');
        }
      }

      // Open status context menu
      setStatusMenuPosition({ x, y });
      setStatusMenuOverlay({ overlay, index });
      setStatusMenuOpen(true);
      
      longPressTimerRef.current = null;
    }, 600); // 600ms for consistent long press timing
  };

  // Handle long press end
  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };



  // Handle status change from context menu (Long Press)
  const handleStatusChange = async (newStatus: ResidentStatus) => {
    if (!statusMenuOverlay || !editableResidents || !onResidentsUpdated) return;

    const { overlay } = statusMenuOverlay;
    
    try {
      // Find the resident matching this overlay
      const residentIndex = editableResidents.findIndex(r => r.name === overlay.originalName);
      
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

  // Only render if we have both an image AND overlays
  // This prevents duplicate lists when loading datasets without photos
  if (!imageSrc || overlays.length === 0) {
    return null;
  }

  // Calculate which types of overlays are present
  const hasProspects = overlays.some(o => !o.isExisting && !o.isDuplicate);
  const hasExisting = overlays.some(o => o.isExisting && !o.isDuplicate);
  const hasDuplicates = overlays.some(o => o.isDuplicate);

  return (
    <Card data-testid="card-image-overlays">
      <CardContent className="p-0">
        {/* Legend */}
        {(hasProspects || hasExisting || hasDuplicates) && (
          <div className="flex items-center gap-4 px-4 py-2 text-sm border-b">
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
          </div>
        )}
        
        <div ref={containerRef} className="relative w-full" style={{ touchAction: 'auto' }}>
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Nameplate with overlays"
            className="w-full h-auto"
            onLoad={updateDimensions}
            data-testid="img-with-overlays"
            style={{ 
              objectFit: 'contain', 
              display: 'block',
              maxHeight: '80vh',
              maxWidth: '100%',
              aspectRatio: 'auto',
            }}
          />
          
          {overlays.map((overlay, index) => {
            const isShowingDetails = longPressIndex === index;
            // Apply scale and add offset for object-fit: contain centering
            const scaledX = (overlay.x + (overlay.xOffset || 0)) * scaleX + imageOffset.offsetX;
            const scaledY = (overlay.y + (overlay.yOffset || 0)) * scaleY + imageOffset.offsetY;
            const scaledWidth = overlay.width * scaleX * overlay.scale;
            const scaledHeight = overlay.height * scaleY * overlay.scale;
            
            // Calculate optimal font size for this overlay
            // Text area extends 8px on each side (16px total) for better visibility
            const optimalFontSize = calculateFontSize(overlay.text, scaledWidth + 16, scaledHeight);

            return (
              <div
                key={index}
                className="absolute cursor-pointer transition-all"
                style={{
                  left: `${scaledX}px`,
                  top: `${scaledY}px`,
                  width: `${scaledWidth}px`,
                  height: `${scaledHeight}px`,
                }}
                onClick={(e) => {
                  handleOverlayClick(index);
                }}
                onMouseDown={(e) => handleLongPressStart(index, e)}
                onMouseUp={handleLongPressEnd}
                onMouseLeave={handleLongPressEnd}
                onTouchStart={(e) => {
                  handleLongPressStart(index, e);
                }}
                onTouchEnd={(e) => {
                  handleLongPressEnd();
                }}
                data-testid={`overlay-box-${index}`}
                data-is-duplicate={overlay.isDuplicate ? 'true' : 'false'}
                data-is-existing={overlay.isExisting ? 'true' : 'false'}
              >
                {/* Background box with rounded corners and border */}
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
                  }}
                />
                
                {/* Text container - extends horizontally to avoid rounded corner clipping */}
                <div 
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    left: '-8px',
                    right: '-8px',
                    paddingLeft: '8px',
                    paddingRight: '8px',
                  }}
                >
                  {/* Always show text, no inline editing */}
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
                </div>

                {/* Long press popup */}
                {isShowingDetails && overlay.matchedCustomer && (
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
      </CardContent>
    </Card>
  );
}