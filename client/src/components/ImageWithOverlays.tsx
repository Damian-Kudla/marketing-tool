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
    
    // Build all possible (resident, annotation) matches with scores
    type Match = {
      residentIndex: number;
      residentName: string;
      annotationIndex: number;
      annotation: TextAnnotation;
      matchScore: number;
    };
    
    const allMatches: Match[] = [];

    // Skip first annotation (full text), process individual text blocks
    for (let i = 1; i < textAnnotations.length; i++) {
      const annotation = textAnnotations[i];
      const text = annotation.description?.toLowerCase().replace(/[-\.\/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (!text) continue;
      const annotationWords = text.split(/\s+/);

      // Check against all resident names
      residentNames.forEach((residentName, nameIndex) => {
        const nameWords = residentName.toLowerCase().split(/\s+/);
        const matchingWords = nameWords.filter(word => annotationWords.includes(word));
        const matchScore = matchingWords.length;

        if (matchScore > 0) {
          allMatches.push({
            residentIndex: nameIndex,
            residentName,
            annotationIndex: i,
            annotation,
            matchScore,
          });
        }
      });
    }

    // Sort matches by score descending, then by resident name length descending (prefer longer names)
    allMatches.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b.residentName.length - a.residentName.length;
    });

    // Greedy assignment: pick best matches ensuring each annotation used once
    const usedAnnotations = new Set<number>();
    const usedResidents = new Set<number>();
    const newOverlays: OverlayBox[] = [];

    for (const match of allMatches) {
      // Skip if this annotation or resident already assigned
      if (usedAnnotations.has(match.annotationIndex) || usedResidents.has(match.residentIndex)) {
        continue;
      }

      // Assign this match
      usedAnnotations.add(match.annotationIndex);
      usedResidents.add(match.residentIndex);

      const isExisting = !newProspects.includes(match.residentName);
      const matchedCustomer = isExisting 
        ? existingCustomers.find(c => c.name.toLowerCase() === match.residentName.toLowerCase())
        : undefined;

      // Calculate bounding box from vertices
      const vertices = match.annotation.boundingPoly.vertices;
      if (vertices.length >= 3) {
        const xs = vertices.map(v => v.x || 0);
        const ys = vertices.map(v => v.y || 0);
        
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        // Add padding to frame text properly (extend box by 10% on each side)
        const padding = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1);
        
        newOverlays.push({
          text: match.residentName,
          x: minX - padding,
          y: minY - padding,
          width: (maxX - minX) + (padding * 2),
          height: (maxY - minY) + (padding * 2),
          isExisting,
          scale: 1,
          originalIndex: match.residentIndex,
          matchedCustomer,
        });
      }
    }

    // Preserve edited overlays - merge them with new overlays using stable identifier
    setOverlays(prevOverlays => {
      const editedOverlays = prevOverlays.filter(o => o.isEdited);
      const processedNewOverlays = handleOverlaps(newOverlays);
      
      // Create a map of edited overlays by their originalIndex (stable identifier)
      const editedByIndex = new Map<number, OverlayBox>();
      editedOverlays.forEach(edited => {
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
            isExisting: newOverlay.isExisting,
            matchedCustomer: newOverlay.matchedCustomer,
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
    
    // Estimate character width (approximate, will be refined)
    // Reduce padding significantly - only 4px total (2px each side)
    const availableWidth = boxWidth - 4;
    const availableHeight = boxHeight - 4;
    
    // Average character width is approximately 0.6 * fontSize for normal weight font
    // We'll use thinner font (font-normal) so it's closer to 0.55
    const avgCharWidthRatio = 0.55;
    
    // Calculate required width for text
    const textLength = text.length;
    
    // Binary search for optimal font size
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
    updatedNames[originalIndex] = editValue.trim().toLowerCase();

    // Mark this overlay as edited so it persists
    setOverlays(prev => prev.map((overlay, idx) => 
      idx === editingIndex 
        ? { ...overlay, isEdited: true, editedText: editValue.trim().toLowerCase(), text: editValue.trim().toLowerCase() }
        : overlay
    ));

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

  return (
    <Card data-testid="card-image-overlays">
      <CardContent className="p-0">
        <div ref={containerRef} className="relative w-full" style={{ touchAction: 'pan-y' }}>
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
            const optimalFontSize = calculateFontSize(overlay.text, scaledWidth, scaledHeight);

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
              >
                {/* Overlay box */}
                <div
                  className={`w-full h-full flex items-center justify-center font-normal rounded border-2 text-black ${
                    overlay.isExisting
                      ? 'bg-success/50 border-success'
                      : 'bg-warning/50 border-warning'
                  }`}
                  style={{
                    backdropFilter: 'blur(2px)',
                    backgroundColor: overlay.isExisting 
                      ? 'rgba(34, 197, 94, 0.5)'  // Green with 50% opacity
                      : 'rgba(251, 146, 60, 0.5)', // Orange with 50% opacity
                    padding: '2px',
                  }}
                >
                  {isEditing && windowWidth >= 1000 ? (
                    // Desktop inline editing
                    <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()} style={{ padding: '1px' }}>
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
                      className="w-full text-center leading-tight"
                      style={{
                        fontSize: `${optimalFontSize}px`,
                        lineHeight: '1.1',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
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
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={saveEdit}
                  variant="default"
                  size="lg"
                  className="flex-1 h-12 text-base gap-2 bg-success hover:bg-success/90 border-success"
                  data-testid="button-mobile-save-edit"
                >
                  <Check className="h-5 w-5" />
                  {t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
