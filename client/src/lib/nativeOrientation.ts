// Completely library-free orientation detection
// No external dependencies to avoid "n is not defined" errors

export interface NativeOrientationInfo {
  rotation: number;
  needsCorrection: boolean;
  detectionMethod: 'exif_native' | 'dimension_analysis' | 'none';
  confidence: number;
}

export interface NativeOrientationResult {
  correctedBlob: Blob;
  orientationInfo: NativeOrientationInfo;
  originalDimensions: { width: number; height: number };
  correctedDimensions: { width: number; height: number };
}

/**
 * Read EXIF orientation using native ArrayBuffer/DataView (no external libraries)
 */
async function readEXIFOrientationNative(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          resolve(1);
          return;
        }
        
        const dataView = new DataView(arrayBuffer);
        
        // Check for JPEG header
        if (dataView.getUint16(0) !== 0xFFD8) {
          console.log('Not a JPEG file, no EXIF orientation');
          resolve(1);
          return;
        }
        
        let offset = 2;
        let marker;
        
        // Find EXIF marker (0xFFE1)
        while (offset < dataView.byteLength) {
          marker = dataView.getUint16(offset);
          
          if (marker === 0xFFE1) {
            // Found EXIF marker
            const exifLength = dataView.getUint16(offset + 2);
            const exifData = new DataView(arrayBuffer, offset + 4, exifLength - 2);
            
            // Check for EXIF header "Exif\0\0"
            if (exifData.getUint32(0) === 0x45786966 && exifData.getUint16(4) === 0x0000) {
              const orientation = parseEXIFOrientation(exifData);
              console.log('Native EXIF orientation found:', orientation);
              resolve(orientation);
              return;
            }
          }
          
          if (marker === 0xFFDA) {
            // Reached start of scan data, no more metadata
            break;
          }
          
          // Move to next marker
          const segmentLength = dataView.getUint16(offset + 2);
          offset += segmentLength + 2;
        }
        
        console.log('No EXIF orientation found in JPEG');
        resolve(1);
        
      } catch (error) {
        console.warn('Error reading EXIF with native parser:', error);
        resolve(1);
      }
    };
    
    reader.onerror = () => {
      console.warn('FileReader error while reading EXIF');
      resolve(1);
    };
    
    // Read only first 64KB to avoid loading huge files
    const blob = file.slice(0, 65536);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Parse EXIF orientation from TIFF data structure
 */
function parseEXIFOrientation(exifData: DataView): number {
  try {
    // TIFF header starts at offset 6 in EXIF data
    const tiffOffset = 6;
    
    // Check byte order (II = little endian, MM = big endian)
    const byteOrder = exifData.getUint16(tiffOffset);
    const littleEndian = byteOrder === 0x4949;
    
    // Get offset to first IFD
    const ifdOffset = exifData.getUint32(tiffOffset + 4, littleEndian);
    
    // Read IFD entries
    const entryCount = exifData.getUint16(tiffOffset + ifdOffset, littleEndian);
    
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = tiffOffset + ifdOffset + 2 + (i * 12);
      
      if (entryOffset + 12 > exifData.byteLength) break;
      
      // Tag 0x0112 = Orientation
      const tag = exifData.getUint16(entryOffset, littleEndian);
      
      if (tag === 0x0112) {
        const value = exifData.getUint16(entryOffset + 8, littleEndian);
        return value;
      }
    }
    
    return 1; // Default orientation
    
  } catch (error) {
    console.warn('Error parsing EXIF TIFF data:', error);
    return 1;
  }
}

/**
 * Detect device type without external libraries
 */
function detectDeviceTypeNative(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();
  
  if (/iphone|ipad|ipod/.test(ua)) {
    return 'ios';
  } else if (/android/.test(ua)) {
    return 'android';
  } else {
    return 'desktop';
  }
}

/**
 * Convert EXIF orientation value to rotation degrees needed to correct the image
 * EXIF orientation tells us how the image was rotated when taken,
 * so we need to apply the opposite rotation to correct it.
 */
function orientationToRotation(orientation: number): number {
  switch (orientation) {
    case 3: return 180;  // Image was rotated 180°, rotate 180° to correct
    case 6: return 270;  // Image was rotated 90° CW, rotate 270° CW (or 90° CCW) to correct  
    case 8: return 90;   // Image was rotated 270° CW, rotate 90° CW (or 270° CCW) to correct
    default: return 0;   // No rotation needed
  }
}

/**
 * Analyze image dimensions and device to determine if rotation is needed
 */
async function analyzeImageDimensions(file: File): Promise<{ width: number; height: number; needsRotation: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    
    img.onload = () => {
      const { width, height } = img;
      const aspectRatio = width / height;
      const deviceType = detectDeviceTypeNative();
      
      // For mobile devices, landscape images (width > height) often need rotation
      // This is especially true for doorbell nameplate photos
      const needsRotation = (deviceType === 'ios' || deviceType === 'android') && aspectRatio > 1.2;
      
      console.log('Image analysis:', {
        width,
        height,
        aspectRatio,
        deviceType,
        needsRotation
      });
      
      resolve({ width, height, needsRotation });
      URL.revokeObjectURL(img.src);
    };
    
    img.onerror = () => {
      console.error('Failed to load image for dimension analysis');
      resolve({ width: 0, height: 0, needsRotation: false });
      URL.revokeObjectURL(img.src);
    };
    
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Rotate image using canvas (no external libraries)
 */
async function rotateImageNative(file: File, degrees: number): Promise<Blob> {
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
        
        // Calculate new canvas dimensions
        if (degrees === 90 || degrees === 270) {
          canvas.width = height;
          canvas.height = width;
        } else if (degrees === 180) {
          canvas.width = width;
          canvas.height = height;
        } else {
          canvas.width = width;
          canvas.height = height;
        }
        
        // Clear canvas with white background to prevent black borders
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Set high-quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Move to center and rotate
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        
        // Draw image centered
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
        
        // Convert to blob with higher quality to prevent artifacts
        canvas.toBlob((blob) => {
          if (blob) {
            console.log(`Image rotated ${degrees}° successfully`);
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob from rotated canvas'));
          }
        }, 'image/jpeg', 0.95); // Increased quality from 0.85 to 0.95
        
      } catch (error) {
        reject(new Error(`Canvas rotation failed: ${error}`));
      } finally {
        URL.revokeObjectURL(img.src);
      }
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image for rotation'));
    };
    
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Main orientation correction function - completely library-free
 */
export async function correctImageOrientationNative(file: File): Promise<NativeOrientationResult> {
  console.log('Starting native orientation correction for:', file.name);
  
  try {
    // Step 1: Try to read EXIF orientation natively
    const exifOrientation = await readEXIFOrientationNative(file);
    const exifRotation = orientationToRotation(exifOrientation);
    
    if (exifRotation > 0) {
      console.log(`EXIF orientation ${exifOrientation} requires ${exifRotation}° rotation`);
      
      const originalDimensions = await analyzeImageDimensions(file);
      const rotatedBlob = await rotateImageNative(file, exifRotation);
      
      // Calculate corrected dimensions
      const correctedDimensions = exifRotation === 90 || exifRotation === 270 
        ? { width: originalDimensions.height, height: originalDimensions.width }
        : { width: originalDimensions.width, height: originalDimensions.height };
      
      return {
        correctedBlob: rotatedBlob,
        orientationInfo: {
          rotation: exifRotation,
          needsCorrection: true,
          detectionMethod: 'exif_native',
          confidence: 0.9
        },
        originalDimensions: { width: originalDimensions.width, height: originalDimensions.height },
        correctedDimensions
      };
    }
    
    // Step 2: Fallback to dimension analysis
    const dimensionAnalysis = await analyzeImageDimensions(file);
    
    if (dimensionAnalysis.needsRotation) {
      console.log('Dimension analysis suggests 90° rotation needed');
      
      const rotatedBlob = await rotateImageNative(file, 90);
      
      return {
        correctedBlob: rotatedBlob,
        orientationInfo: {
          rotation: 90,
          needsCorrection: true,
          detectionMethod: 'dimension_analysis',
          confidence: 0.7
        },
        originalDimensions: { width: dimensionAnalysis.width, height: dimensionAnalysis.height },
        correctedDimensions: { width: dimensionAnalysis.height, height: dimensionAnalysis.width }
      };
    }
    
    // Step 3: No correction needed
    console.log('No orientation correction needed');
    
    const originalBlob = new Blob([file], { type: file.type });
    
    return {
      correctedBlob: originalBlob,
      orientationInfo: {
        rotation: 0,
        needsCorrection: false,
        detectionMethod: 'none',
        confidence: 0.8
      },
      originalDimensions: { width: dimensionAnalysis.width, height: dimensionAnalysis.height },
      correctedDimensions: { width: dimensionAnalysis.width, height: dimensionAnalysis.height }
    };
    
  } catch (error) {
    console.error('Native orientation correction failed:', error);
    
    // Ultimate fallback - return original
    const originalBlob = new Blob([file], { type: file.type });
    
    return {
      correctedBlob: originalBlob,
      orientationInfo: {
        rotation: 0,
        needsCorrection: false,
        detectionMethod: 'none',
        confidence: 0
      },
      originalDimensions: { width: 0, height: 0 },
      correctedDimensions: { width: 0, height: 0 }
    };
  }
}

/**
 * Manually rotate an image by specified degrees (90° increments)
 * Used for manual rotation controls in the UI
 */
export async function rotateImageManually(file: File, degrees: number): Promise<File> {
  console.log(`Manual rotation: rotating image by ${degrees}°`);
  
  try {
    const rotatedBlob = await rotateImageNative(file, degrees);
    
    // Create new file with rotated content
    const rotatedFile = new File(
      [rotatedBlob], 
      file.name, 
      { type: 'image/jpeg' }
    );
    
    console.log(`Manual rotation completed: ${degrees}°`);
    return rotatedFile;
    
  } catch (error) {
    console.error('Manual rotation failed:', error);
    return file; // Return original on error
  }
}