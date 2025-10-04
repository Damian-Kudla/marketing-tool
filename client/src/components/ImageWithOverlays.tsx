import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Address } from '@/components/GPSAddressForm';
import type { Customer } from '@/components/ResultsDisplay';

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
}

// Normalize name to extract words (remove periods, split on spaces/hyphens/slashes)
const normalizeToWords = (name: string): string[] => {
  return name
    .toLowerCase()
    .replace(/\./g, '') // Remove periods (e.g., "L." -> "L")
    .split(/[\s\-\/]+/) // Split on spaces, hyphens, slashes
    .filter(word => word.length > 1); // Ignore single characters
};

// Calculate duplicates from a list of names
const calculateDuplicates = (names: string[]): Set<string> => {
  const wordToNames = new Map<string, Set<string>>();
  names.forEach(name => {
    const words = normalizeToWords(name);
    words.forEach(word => {
      if (!wordToNames.has(word)) {
        wordToNames.set(word, new Set());
      }
      wordToNames.get(word)!.add(name.toLowerCase());
    });
  });

  const duplicates = new Set<string>();
  wordToNames.forEach((nameSet, word) => {
    if (nameSet.size > 1) {
      nameSet.forEach(name => duplicates.add(name));
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
}: ImageWithOverlaysProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [overlays, setOverlays] = useState<OverlayBox[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [longPressIndex, setLongPressIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

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
        const text = annotation.description?.toLowerCase().replace(/[-\.\/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
        
        if (!text) continue;
        const annotationWords = text.split(/\s+/);

        // For single-word names, only match if annotation is EXACTLY that word
        // Only take the FIRST match to prevent oversized boxes from multiple detections
        if (nameWords.length === 1) {
          const singleWord = nameWords[0];
          if (annotationWords.length === 1 && annotationWords[0] === singleWord && matchingAnnotations.length === 0) {
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
    const duplicateNames = calculateDuplicates(residentNames);
    
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
              matchedCustomer,
            });
          }
        }
      });
    }

    // Preserve edited overlays - merge them with new overlays using stable identifier
    setOverlays(prevOverlays => {
      const editedOverlays = prevOverlays.filter(o => o.isEdited);
      const processedNewOverlays = handleOverlaps(newOverlays);
      
      // Collect all current names (original + edited) for duplicate detection
      const allCurrentNames: string[] = [];
      
      // Add non-edited original names
      processedNewOverlays.forEach(overlay => {
        const existingEdit = editedOverlays.find(e => e.originalIndex === overlay.originalIndex);
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
      const currentDuplicateNames = calculateDuplicates(allCurrentNames);
      
      const updatedEditedOverlays = editedOverlays.map(edited => {
        const editedName = edited.editedText || edited.text;
        const isDuplicate = currentDuplicateNames.has(editedName.toLowerCase());
        const isExisting = !newProspects.includes(editedName);
        const matchedCustomer = isExisting 
          ? existingCustomers.find(c => c.name.toLowerCase() === editedName.toLowerCase())
          : undefined;
        return { ...edited, isDuplicate, isExisting, matchedCustomer };
      });
      
      // Create a map of edited overlays by their originalIndex (stable identifier)
      const editedByIndex = new Map<number, OverlayBox>();
      updatedEditedOverlays.forEach(edited => {
        editedByIndex.set(edited.originalIndex, edited);
      });
      
      // Merge: use edited version if exists for this originalIndex, otherwise use new overlay
      const merged: OverlayBox[] = [];
      processedNewOverlays.forEach(newOverlay => {
        const editedVersion = editedByIndex.get(newOverlay.originalIndex);
        if (editedVersion) {
          // Use edited version but update bounding box from new overlay (in case of resize)
          merged.push({
            ...editedVersion,
            x: newOverlay.x,
            y: newOverlay.y,
            width: newOverlay.width,
            height: newOverlay.height,
            scale: newOverlay.scale,
            xOffset: newOverlay.xOffset,
            yOffset: newOverlay.yOffset,
            // Use recalculated status from edited version (not newOverlay)
            isExisting: editedVersion.isExisting,
            isDuplicate: editedVersion.isDuplicate,
            matchedCustomer: editedVersion.matchedCustomer,
          });
          editedByIndex.delete(newOverlay.originalIndex); // Mark as used
        } else {
          merged.push(newOverlay);
        }
      });
      
      // Add any remaining edited overlays that don't have a new match
      // (This preserves edits even if the overlay no longer matches OCR)
      editedByIndex.forEach(edited => {
        merged.push(edited);
      });
      
      return merged;
    });
  }, [fullVisionResponse, residentNames, existingCustomers, newProspects]);

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
              // Boxes are very overlapped, offset them vertically apart
              const offsetAmount = Math.max(5, Math.min(b1h, b2h) * 0.1);
              result[i] = { ...box1, yOffset: (box1.yOffset || 0) - offsetAmount };
              result[j] = { ...box2, yOffset: (box2.yOffset || 0) + offsetAmount };
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

  // Update dimensions when image loads or window resizes
  const updateDimensions = () => {
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.offsetWidth,
        height: imageRef.current.offsetHeight,
      });
      setOriginalDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
  };

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Calculate scale factor
  const scaleX = imageDimensions.width / (originalDimensions.width || 1);
  const scaleY = imageDimensions.height / (originalDimensions.height || 1);

  // Handle click to edit
  const handleOverlayClick = (index: number) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setLongPressIndex(null);
    setEditingIndex(index);
    setEditValue(overlays[index].text);
  };

  // Handle long press start
  const handleLongPressStart = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    longPressTimerRef.current = setTimeout(() => {
      setLongPressIndex(index);
      longPressTimerRef.current = null;
    }, 500);
  };

  // Handle long press end
  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Save edited name
  const saveEdit = () => {
    if (editingIndex === null || !editValue.trim()) return;

    const updatedNames = [...residentNames];
    const originalIndex = overlays[editingIndex].originalIndex;
    const trimmedValue = editValue.trim();
    updatedNames[originalIndex] = trimmedValue;

    // Mark this overlay as edited so it persists
    setOverlays(prev => {
      const newOverlays = prev.map((overlay, idx) => 
        idx === editingIndex 
          ? { ...overlay, isEdited: true, editedText: trimmedValue, text: trimmedValue }
          : overlay
      );
      
      // Recalculate duplicate status for all overlays after edit
      const allNames = newOverlays.map(o => o.editedText || o.text);
      const duplicates = calculateDuplicates(allNames);
      
      return newOverlays.map(overlay => ({
        ...overlay,
        isDuplicate: duplicates.has((overlay.editedText || overlay.text).toLowerCase()),
        isExisting: !newProspects.includes(overlay.editedText || overlay.text),
        matchedCustomer: !newProspects.includes(overlay.editedText || overlay.text)
          ? existingCustomers.find(c => c.name.toLowerCase() === (overlay.editedText || overlay.text).toLowerCase())
          : undefined,
      }));
    });

    // Notify parent component which will handle the API call
    onNamesUpdated?.(updatedNames);
    
    toast({
      title: t('photo.success'),
      description: t('photo.nameUpdated'),
    });

    setEditingIndex(null);
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

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
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgba(251, 146, 60, 1)' }} />
                <span>{t('photo.legend.prospects', 'Prospects')}</span>
              </div>
            )}
            {hasExisting && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgba(34, 197, 94, 1)' }} />
                <span>{t('photo.legend.existing', 'Existing Customers')}</span>
              </div>
            )}
            {hasDuplicates && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgba(59, 130, 246, 1)' }} />
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
          />
          
          {overlays.map((overlay, index) => {
            const isEditing = editingIndex === index;
            const isShowingDetails = longPressIndex === index;
            const scaledX = (overlay.x + (overlay.xOffset || 0)) * scaleX;
            const scaledY = (overlay.y + (overlay.yOffset || 0)) * scaleY;
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
                  if (!isEditing) handleOverlayClick(index);
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
                      ? 'rgba(59, 130, 246, 0.3)'  // Blue with 30% opacity (duplicates)
                      : overlay.isExisting 
                      ? 'rgba(34, 197, 94, 0.3)'  // Green with 30% opacity (existing)
                      : 'rgba(251, 146, 60, 0.3)', // Orange with 30% opacity (prospects)
                    border: `1px solid ${
                      overlay.isDuplicate
                        ? 'rgba(59, 130, 246, 0.8)'  // Blue with 80% opacity (duplicates)
                        : overlay.isExisting
                        ? 'rgba(34, 197, 94, 0.8)'  // Green with 80% opacity (existing)
                        : 'rgba(251, 146, 60, 0.8)'  // Orange with 80% opacity (prospects)
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
                  {isEditing && windowWidth >= 1000 ? (
                    // Desktop inline editing
                    <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-6 text-xs px-1 flex-1 min-w-0"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        data-testid={`input-edit-name-${index}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={saveEdit}
                        data-testid={`button-save-edit-${index}`}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={cancelEdit}
                        data-testid={`button-cancel-edit-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
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

        {/* Mobile Edit Modal - Full screen overlay for screens < 1000px */}
        {editingIndex !== null && windowWidth < 1000 && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(4px)'
            }}
            onClick={cancelEdit}
            data-testid="mobile-edit-modal"
          >
            <div 
              className="bg-card border-2 rounded-lg p-6 w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold mb-4 text-center">
                {t('photo.editName', 'Edit Name')}
              </h3>
              
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-lg h-12 px-4 mb-6"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                data-testid="input-mobile-edit-name"
              />
              
              <div className="flex gap-3 justify-center">
                <Button
                  onClick={cancelEdit}
                  variant="destructive"
                  size="lg"
                  className="flex-1 h-12 text-base gap-2"
                  data-testid="button-mobile-cancel-edit"
                >
                  <X className="h-5 w-5" />
                  {t('correction.cancel', 'Abbrechen')}
                </Button>
                <Button
                  onClick={saveEdit}
                  variant="default"
                  size="lg"
                  className="flex-1 h-12 text-base gap-2 bg-success hover:bg-success/90 border-success"
                  data-testid="button-mobile-save-edit"
                >
                  <Check className="h-5 w-5" />
                  {t('action.save', 'Speichern')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
