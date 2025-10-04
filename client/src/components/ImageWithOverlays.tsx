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
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate overlays when data changes
  useEffect(() => {
    if (!fullVisionResponse?.textAnnotations || residentNames.length === 0) {
      setOverlays([]);
      return;
    }

    const textAnnotations: TextAnnotation[] = fullVisionResponse.textAnnotations;
    const newOverlays: OverlayBox[] = [];

    // Skip first annotation (full text), process individual text blocks
    for (let i = 1; i < textAnnotations.length; i++) {
      const annotation = textAnnotations[i];
      const text = annotation.description?.toLowerCase().replace(/[-\.\/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (!text) continue;

      // Check if this text matches any resident name
      const matchedNameIndex = residentNames.findIndex(name => {
        const words = name.toLowerCase().split(/\s+/);
        const annotationWords = text.split(/\s+/);
        return words.some(word => annotationWords.includes(word));
      });

      if (matchedNameIndex === -1) continue;

      const matchedName = residentNames[matchedNameIndex];
      const isExisting = !newProspects.includes(matchedName);

      // Find matched customer for details
      const matchedCustomer = isExisting 
        ? existingCustomers.find(c => c.name.toLowerCase() === matchedName.toLowerCase())
        : undefined;

      // Calculate bounding box from vertices
      const vertices = annotation.boundingPoly.vertices;
      if (vertices.length < 3) continue;

      const xs = vertices.map(v => v.x || 0);
      const ys = vertices.map(v => v.y || 0);
      
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      newOverlays.push({
        text: matchedName,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        isExisting,
        scale: 1,
        originalIndex: matchedNameIndex,
        matchedCustomer,
      });
    }

    // Detect and handle overlaps
    const processedOverlays = handleOverlaps(newOverlays);
    setOverlays(processedOverlays);
  }, [fullVisionResponse, residentNames, existingCustomers, newProspects]);

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
        <div ref={containerRef} className="relative w-full" style={{ touchAction: 'pinch-zoom' }}>
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
                onClick={() => !isEditing && handleOverlayClick(index)}
                onMouseDown={(e) => handleLongPressStart(index, e)}
                onMouseUp={handleLongPressEnd}
                onMouseLeave={handleLongPressEnd}
                onTouchStart={(e) => handleLongPressStart(index, e)}
                onTouchEnd={handleLongPressEnd}
                data-testid={`overlay-box-${index}`}
              >
                {/* Overlay box */}
                <div
                  className={`w-full h-full flex items-center justify-center text-xs font-medium rounded border-2 ${
                    overlay.isExisting
                      ? 'bg-success/50 border-success text-success'
                      : 'bg-warning/50 border-warning text-warning'
                  }`}
                  style={{
                    backdropFilter: 'blur(2px)',
                  }}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1 px-1 w-full" onClick={(e) => e.stopPropagation()}>
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
                    <span className="px-1 truncate">{overlay.text}</span>
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
      </CardContent>
    </Card>
  );
}
