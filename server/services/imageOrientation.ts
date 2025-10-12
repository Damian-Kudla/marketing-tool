import sharp from 'sharp';

export interface BackendOrientationInfo {
  rotation: number;
  confidence: number;
  method: 'bounding_box_analysis' | 'aspect_ratio' | 'none';
  originalDimensions: { width: number; height: number };
  suggestedDimensions: { width: number; height: number };
}

export interface OrientationAnalysisResult {
  needsCorrection: boolean;
  orientationInfo: BackendOrientationInfo;
  correctedBuffer?: Buffer;
}

/**
 * Analyzes OCR bounding boxes to determine if image orientation is correct
 */
export function analyzeOCRBoundingBoxes(textAnnotations: any[]): BackendOrientationInfo {
  if (!textAnnotations || textAnnotations.length < 2) {
    return {
      rotation: 0,
      confidence: 0,
      method: 'none',
      originalDimensions: { width: 0, height: 0 },
      suggestedDimensions: { width: 0, height: 0 }
    };
  }

  // Skip the first annotation (full text) and analyze individual text blocks
  const boundingBoxes = textAnnotations.slice(1)
    .filter(annotation => annotation.boundingPoly?.vertices)
    .map(annotation => {
      const vertices = annotation.boundingPoly.vertices;
      if (vertices.length < 3) return null;

      const xs = vertices.map((v: any) => v.x || 0);
      const ys = vertices.map((v: any) => v.y || 0);
      
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        text: annotation.description || ''
      };
    })
    .filter(box => box !== null);

  if (boundingBoxes.length === 0) {
    return {
      rotation: 0,
      confidence: 0,
      method: 'none',
      originalDimensions: { width: 0, height: 0 },
      suggestedDimensions: { width: 0, height: 0 }
    };
  }

  // Calculate overall image dimensions from bounding boxes
  const allXs = boundingBoxes.flatMap(box => [box!.minX, box!.maxX]);
  const allYs = boundingBoxes.flatMap(box => [box!.minY, box!.maxY]);
  const imageWidth = Math.max(...allXs) - Math.min(...allXs);
  const imageHeight = Math.max(...allYs) - Math.min(...allYs);

  // Analyze text orientation patterns
  let horizontalBoxes = 0;
  let verticalBoxes = 0;
  let totalBoxes = 0;

  for (const box of boundingBoxes) {
    if (!box) continue;
    
    // Skip very small boxes (likely noise)
    if (box.width < 10 || box.height < 10) continue;
    
    totalBoxes++;
    
    // Determine if text appears horizontal or vertical
    if (box.width > box.height * 1.5) {
      horizontalBoxes++;
    } else if (box.height > box.width * 1.5) {
      verticalBoxes++;
    }
  }

  // Calculate confidence based on text orientation consistency
  const orientationRatio = totalBoxes > 0 ? horizontalBoxes / totalBoxes : 0;
  let suggestedRotation = 0;
  let confidence = 0;

  // Doorbell nameplates should typically have horizontal text
  if (orientationRatio < 0.3 && verticalBoxes > horizontalBoxes) {
    // Most text appears vertical, likely needs 90° rotation
    suggestedRotation = 90;
    confidence = Math.min(0.8, verticalBoxes / totalBoxes);
  } else if (orientationRatio < 0.5 && imageWidth < imageHeight) {
    // Mixed orientation but image is portrait, might need rotation
    suggestedRotation = 90;
    confidence = 0.4;
  } else if (orientationRatio > 0.7) {
    // Most text is horizontal, probably correct
    suggestedRotation = 0;
    confidence = orientationRatio;
  } else {
    // Unclear orientation
    suggestedRotation = 0;
    confidence = 0.2;
  }

  const suggestedDimensions = suggestedRotation === 90 || suggestedRotation === 270 
    ? { width: imageHeight, height: imageWidth }
    : { width: imageWidth, height: imageHeight };

  return {
    rotation: suggestedRotation,
    confidence,
    method: 'bounding_box_analysis',
    originalDimensions: { width: imageWidth, height: imageHeight },
    suggestedDimensions
  };
}

/**
 * Rotates image using Sharp
 */
export async function rotateImageSharp(buffer: Buffer, rotation: number): Promise<Buffer> {
  if (rotation === 0) return buffer;
  
  let sharpImage = sharp(buffer);
  
  switch (rotation) {
    case 90:
      sharpImage = sharpImage.rotate(90);
      break;
    case 180:
      sharpImage = sharpImage.rotate(180);
      break;
    case 270:
      sharpImage = sharpImage.rotate(270);
      break;
    default:
      // For custom angles
      sharpImage = sharpImage.rotate(rotation);
  }
  
  return sharpImage.jpeg({ quality: 85 }).toBuffer();
}

/**
 * Performs orientation correction with multiple rotation attempts
 */
export async function performOrientationCorrection(
  imageBuffer: Buffer,
  visionClient: any
): Promise<OrientationAnalysisResult> {
  try {
    // First, try OCR on original image
    const [originalResult] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });

    const originalAnalysis = analyzeOCRBoundingBoxes(originalResult.textAnnotations);
    
    // If confidence is high that no rotation is needed, return original
    if (originalAnalysis.confidence > 0.6 && originalAnalysis.rotation === 0) {
      return {
        needsCorrection: false,
        orientationInfo: originalAnalysis
      };
    }

    // If analysis suggests rotation, try it
    if (originalAnalysis.rotation > 0 && originalAnalysis.confidence > 0.3) {
      const rotatedBuffer = await rotateImageSharp(imageBuffer, originalAnalysis.rotation);
      
      // Verify the rotation improved things by doing OCR again
      const [rotatedResult] = await visionClient.textDetection({
        image: { content: rotatedBuffer },
      });

      const rotatedAnalysis = analyzeOCRBoundingBoxes(rotatedResult.textAnnotations);
      
      // If the rotated version has better text orientation, use it
      if (rotatedAnalysis.confidence > originalAnalysis.confidence + 0.1) {
        return {
          needsCorrection: true,
          orientationInfo: {
            ...originalAnalysis,
            confidence: rotatedAnalysis.confidence
          },
          correctedBuffer: rotatedBuffer
        };
      }
    }

    // Try 90° rotation as fallback for landscape images
    const imageMetadata = await sharp(imageBuffer).metadata();
    if (imageMetadata.width && imageMetadata.height && imageMetadata.width > imageMetadata.height) {
      const rotated90Buffer = await rotateImageSharp(imageBuffer, 90);
      const [rotated90Result] = await visionClient.textDetection({
        image: { content: rotated90Buffer },
      });

      const rotated90Analysis = analyzeOCRBoundingBoxes(rotated90Result.textAnnotations);
      
      if (rotated90Analysis.confidence > originalAnalysis.confidence + 0.2) {
        return {
          needsCorrection: true,
          orientationInfo: {
            rotation: 90,
            confidence: rotated90Analysis.confidence,
            method: 'bounding_box_analysis',
            originalDimensions: { 
              width: imageMetadata.width, 
              height: imageMetadata.height 
            },
            suggestedDimensions: { 
              width: imageMetadata.height, 
              height: imageMetadata.width 
            }
          },
          correctedBuffer: rotated90Buffer
        };
      }
    }

    // No improvement found, return original
    return {
      needsCorrection: false,
      orientationInfo: originalAnalysis
    };

  } catch (error) {
    console.error('Orientation correction failed:', error);
    
    // Fallback: return original image without correction
    const imageMetadata = await sharp(imageBuffer).metadata();
    return {
      needsCorrection: false,
      orientationInfo: {
        rotation: 0,
        confidence: 0,
        method: 'none',
        originalDimensions: { 
          width: imageMetadata.width || 0, 
          height: imageMetadata.height || 0 
        },
        suggestedDimensions: { 
          width: imageMetadata.width || 0, 
          height: imageMetadata.height || 0 
        }
      }
    };
  }
}

/**
 * Simple aspect ratio check for quick orientation detection
 */
export async function checkImageAspectRatio(buffer: Buffer): Promise<BackendOrientationInfo> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    if (width === 0 || height === 0) {
      return {
        rotation: 0,
        confidence: 0,
        method: 'none',
        originalDimensions: { width, height },
        suggestedDimensions: { width, height }
      };
    }

    // For mobile photos of doorbell nameplates, landscape format might indicate rotation needed
    if (width > height * 1.3) {
      return {
        rotation: 90,
        confidence: 0.3,
        method: 'aspect_ratio',
        originalDimensions: { width, height },
        suggestedDimensions: { width: height, height: width }
      };
    }

    return {
      rotation: 0,
      confidence: 0.7,
      method: 'aspect_ratio',
      originalDimensions: { width, height },
      suggestedDimensions: { width, height }
    };

  } catch (error) {
    console.error('Aspect ratio check failed:', error);
    return {
      rotation: 0,
      confidence: 0,
      method: 'none',
      originalDimensions: { width: 0, height: 0 },
      suggestedDimensions: { width: 0, height: 0 }
    };
  }
}