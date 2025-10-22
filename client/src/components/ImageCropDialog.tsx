import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ImageCropDialogProps {
  isOpen: boolean;
  imageSrc: string;
  onCropComplete: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ImageCropDialog({ isOpen, imageSrc, onCropComplete, onCancel }: ImageCropDialogProps) {
  const [cropArea, setCropArea] = useState<CropArea>({ x: 50, y: 50, width: 200, height: 200 });
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isOpen && imageSrc) {
      const img = new Image();
      img.onload = () => {
        setImageSize({ width: img.width, height: img.height });
        // Initialize crop area to 80% of image
        const margin = 0.1;
        setCropArea({
          x: img.width * margin,
          y: img.height * margin,
          width: img.width * (1 - 2 * margin),
          height: img.height * (1 - 2 * margin),
        });
      };
      img.src = imageSrc;
    }
  }, [isOpen, imageSrc]);

  const handleMouseDown = (handle: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(handle);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = imageSize.width / rect.width;
    const scaleY = imageSize.height / rect.height;
    
    // Support both mouse and touch events
    let clientX: number, clientY: number;
    if ('touches' in e) {
      // Touch event
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      // Mouse event
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const mouseX = (clientX - rect.left) * scaleX;
    const mouseY = (clientY - rect.top) * scaleY;

    const newCrop = { ...cropArea };
    const minSize = 50;

    switch (isDragging) {
      case 'tl': // Top-left corner
        newCrop.width = Math.max(minSize, cropArea.x + cropArea.width - mouseX);
        newCrop.height = Math.max(minSize, cropArea.y + cropArea.height - mouseY);
        newCrop.x = cropArea.x + cropArea.width - newCrop.width;
        newCrop.y = cropArea.y + cropArea.height - newCrop.height;
        break;
      case 'tr': // Top-right corner
        newCrop.width = Math.max(minSize, mouseX - cropArea.x);
        newCrop.height = Math.max(minSize, cropArea.y + cropArea.height - mouseY);
        newCrop.y = cropArea.y + cropArea.height - newCrop.height;
        break;
      case 'bl': // Bottom-left corner
        newCrop.width = Math.max(minSize, cropArea.x + cropArea.width - mouseX);
        newCrop.height = Math.max(minSize, mouseY - cropArea.y);
        newCrop.x = cropArea.x + cropArea.width - newCrop.width;
        break;
      case 'br': // Bottom-right corner
        newCrop.width = Math.max(minSize, mouseX - cropArea.x);
        newCrop.height = Math.max(minSize, mouseY - cropArea.y);
        break;
      case 't': // Top edge
        newCrop.height = Math.max(minSize, cropArea.y + cropArea.height - mouseY);
        newCrop.y = cropArea.y + cropArea.height - newCrop.height;
        break;
      case 'b': // Bottom edge
        newCrop.height = Math.max(minSize, mouseY - cropArea.y);
        break;
      case 'l': // Left edge
        newCrop.width = Math.max(minSize, cropArea.x + cropArea.width - mouseX);
        newCrop.x = cropArea.x + cropArea.width - newCrop.width;
        break;
      case 'r': // Right edge
        newCrop.width = Math.max(minSize, mouseX - cropArea.x);
        break;
    }

    // Constrain to image bounds
    newCrop.x = Math.max(0, Math.min(newCrop.x, imageSize.width - newCrop.width));
    newCrop.y = Math.max(0, Math.min(newCrop.y, imageSize.height - newCrop.height));
    newCrop.width = Math.min(newCrop.width, imageSize.width - newCrop.x);
    newCrop.height = Math.min(newCrop.height, imageSize.height - newCrop.y);

    setCropArea(newCrop);
  };

  const handleMouseUp = () => {
    setIsDragging(null);
  };

  const createCroppedImage = async () => {
    try {
      const image = new Image();
      image.src = imageSrc;
      
      await new Promise((resolve) => {
        image.onload = resolve;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      canvas.width = cropArea.width;
      canvas.height = cropArea.height;

      ctx.drawImage(
        image,
        cropArea.x,
        cropArea.y,
        cropArea.width,
        cropArea.height,
        0,
        0,
        cropArea.width,
        cropArea.height
      );

      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/jpeg', 0.95);
      });
    } catch (error) {
      console.error('Error cropping image:', error);
      throw error;
    }
  };

  const handleSave = async () => {
    try {
      const croppedBlob = await createCroppedImage();
      if (croppedBlob) {
        onCropComplete(croppedBlob);
      }
    } catch (error) {
      console.error('Error saving cropped image:', error);
    }
  };

  const getDisplayScale = () => {
    if (!imageRef.current) return 1;
    const rect = imageRef.current.getBoundingClientRect();
    return rect.width / imageSize.width;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>Bild zuschneiden</DialogTitle>
        </DialogHeader>
        
        <div 
          ref={containerRef}
          className="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          style={{ userSelect: 'none', cursor: isDragging ? 'grabbing' : 'default', touchAction: 'none' }}
        >
          {imageSrc && (
            <div className="relative">
              <img 
                ref={imageRef}
                src={imageSrc} 
                alt="Crop preview"
                className="max-w-full max-h-[70vh] block"
                draggable={false}
              />
              
              {/* Crop overlay */}
              {imageSize.width > 0 && (
                <div
                  className="absolute border-2 border-white shadow-lg"
                  style={{
                    left: `${(cropArea.x / imageSize.width) * 100}%`,
                    top: `${(cropArea.y / imageSize.height) * 100}%`,
                    width: `${(cropArea.width / imageSize.width) * 100}%`,
                    height: `${(cropArea.height / imageSize.height) * 100}%`,
                    pointerEvents: 'none',
                  }}
                >
                  {/* Corner handles */}
                  <div
                    className="absolute w-8 h-8 bg-white rounded-full border-2 border-blue-500 -left-4 -top-4 cursor-nw-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('tl')}
                    onTouchStart={handleMouseDown('tl')}
                  />
                  <div
                    className="absolute w-8 h-8 bg-white rounded-full border-2 border-blue-500 -right-4 -top-4 cursor-ne-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('tr')}
                    onTouchStart={handleMouseDown('tr')}
                  />
                  <div
                    className="absolute w-8 h-8 bg-white rounded-full border-2 border-blue-500 -left-4 -bottom-4 cursor-sw-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('bl')}
                    onTouchStart={handleMouseDown('bl')}
                  />
                  <div
                    className="absolute w-8 h-8 bg-white rounded-full border-2 border-blue-500 -right-4 -bottom-4 cursor-se-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('br')}
                    onTouchStart={handleMouseDown('br')}
                  />
                  
                  {/* Edge handles */}
                  <div
                    className="absolute w-full h-2 bg-blue-500 bg-opacity-50 left-0 -top-1 cursor-n-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('t')}
                    onTouchStart={handleMouseDown('t')}
                  />
                  <div
                    className="absolute w-full h-2 bg-blue-500 bg-opacity-50 left-0 -bottom-1 cursor-s-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('b')}
                    onTouchStart={handleMouseDown('b')}
                  />
                  <div
                    className="absolute h-full w-2 bg-blue-500 bg-opacity-50 -left-1 top-0 cursor-w-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('l')}
                    onTouchStart={handleMouseDown('l')}
                  />
                  <div
                    className="absolute h-full w-2 bg-blue-500 bg-opacity-50 -right-1 top-0 cursor-e-resize"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    onMouseDown={handleMouseDown('r')}
                    onTouchStart={handleMouseDown('r')}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button onClick={handleSave}>
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
