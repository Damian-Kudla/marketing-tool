// Emergency fallback for orientation detection without external libraries
// This is used if EXIF library fails to load or causes errors

export interface SimplifiedOrientationInfo {
  needsRotation: boolean;
  suggestedRotation: number;
  confidence: number;
  reason: string;
}

/**
 * Simple orientation detection based only on image dimensions and device type
 * No external libraries required - emergency fallback
 */
export async function detectOrientationSimple(file: File): Promise<SimplifiedOrientationInfo> {
  return new Promise((resolve) => {
    const img = new Image();
    
    img.onload = () => {
      const { width, height } = img;
      const aspectRatio = width / height;
      const userAgent = navigator.userAgent.toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(userAgent);
      const isAndroid = /android/.test(userAgent);
      const isMobile = isIOS || isAndroid;
      
      console.log('Simple orientation detection:', {
        width,
        height,
        aspectRatio,
        isMobile,
        deviceType: isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop'
      });
      
      // If it's a landscape image on mobile, it likely needs rotation
      if (isMobile && aspectRatio > 1.3) {
        resolve({
          needsRotation: true,
          suggestedRotation: 90,
          confidence: 0.7,
          reason: 'Landscape image on mobile device'
        });
      } else {
        resolve({
          needsRotation: false,
          suggestedRotation: 0,
          confidence: 0.8,
          reason: 'Portrait or desktop image'
        });
      }
      
      URL.revokeObjectURL(img.src);
    };
    
    img.onerror = () => {
      console.error('Failed to load image for simple orientation detection');
      resolve({
        needsRotation: false,
        suggestedRotation: 0,
        confidence: 0,
        reason: 'Failed to load image'
      });
      URL.revokeObjectURL(img.src);
    };
    
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Ultra-safe image rotation without any external dependencies
 */
export async function rotateImageSimple(file: File, degrees: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Canvas not supported'));
      return;
    }
    
    const img = new Image();
    
    img.onload = () => {
      try {
        const { width, height } = img;
        
        // For 90 or 270 degree rotations, swap dimensions
        if (degrees === 90 || degrees === 270) {
          canvas.width = height;
          canvas.height = width;
        } else {
          canvas.width = width;
          canvas.height = height;
        }
        
        // Move to center
        ctx.translate(canvas.width / 2, canvas.height / 2);
        
        // Rotate
        ctx.rotate((degrees * Math.PI) / 180);
        
        // Draw image centered
        ctx.drawImage(img, -width / 2, -height / 2);
        
        // Convert to blob
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/jpeg', 0.8);
        
      } catch (error) {
        reject(new Error(`Rotation failed: ${error}`));
      } finally {
        URL.revokeObjectURL(img.src);
      }
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    
    img.src = URL.createObjectURL(file);
  });
}