import imageCompression from 'browser-image-compression';

/**
 * Professional Image Compression Utility
 *
 * Intelligently compresses images to target 500KB while preserving quality.
 * Features:
 * - Skips compression for images already under 500KB
 * - Progressive quality reduction for optimal size/quality balance
 * - Preserves EXIF metadata where possible
 * - Handles various image formats (JPEG, PNG, WebP)
 * - Memory-efficient processing
 */

const TARGET_SIZE_KB = 500;
const TARGET_SIZE_BYTES = TARGET_SIZE_KB * 1024;

// Quality presets for progressive compression
const QUALITY_PRESETS = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];

// Maximum dimension to prevent excessive memory usage
const MAX_DIMENSION = 4096;

export interface CompressionResult {
  compressedFile: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
  quality: number;
}

export interface CompressionOptions {
  targetSizeKB?: number;
  maxDimension?: number;
  preserveExif?: boolean;
  fileType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Compresses an image file to approximately 500KB while maintaining quality
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Compression result with metadata
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const {
    targetSizeKB = TARGET_SIZE_KB,
    maxDimension = MAX_DIMENSION,
    preserveExif = true,
    fileType = 'image/jpeg'
  } = options;

  const originalSize = file.size;
  const targetSizeBytes = targetSizeKB * 1024;

  console.log('[ImageCompression] Starting compression:', {
    fileName: file.name,
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
    targetSize: `${targetSizeKB} KB`,
    fileType: file.type
  });

  // Skip compression if file is already under target size
  if (originalSize <= targetSizeBytes) {
    console.log('[ImageCompression] File already under target size, skipping compression');
    return {
      compressedFile: file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      wasCompressed: false,
      quality: 1
    };
  }

  // Progressive compression - try different quality levels
  let bestResult: File = file;
  let bestQuality = 1;
  let bestSize = originalSize;

  for (const quality of QUALITY_PRESETS) {
    try {
      console.log(`[ImageCompression] Trying quality: ${quality}`);

      const options = {
        maxSizeMB: targetSizeKB / 1024, // Convert KB to MB
        maxWidthOrHeight: maxDimension,
        useWebWorker: true,
        initialQuality: quality,
        fileType: fileType,
        preserveExif: preserveExif,
        alwaysKeepResolution: false, // Allow dimension reduction if needed
      };

      const compressedFile = await imageCompression(file, options);
      const compressedSize = compressedFile.size;

      console.log(`[ImageCompression] Result at quality ${quality}:`, {
        size: `${(compressedSize / 1024).toFixed(2)} KB`,
        ratio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}% reduction`
      });

      // If we hit the target or are close enough (within 10%), use this result
      if (compressedSize <= targetSizeBytes) {
        bestResult = new File([compressedFile], file.name, { type: fileType });
        bestQuality = quality;
        bestSize = compressedSize;

        // If we're within 80-100% of target, this is optimal (not over-compressed)
        if (compressedSize >= targetSizeBytes * 0.8) {
          console.log('[ImageCompression] Found optimal compression point');
          break;
        }
      } else if (compressedSize < bestSize) {
        // Keep track of best result so far
        bestResult = new File([compressedFile], file.name, { type: fileType });
        bestQuality = quality;
        bestSize = compressedSize;
      }
    } catch (error) {
      console.error(`[ImageCompression] Failed at quality ${quality}:`, error);
      continue;
    }
  }

  // If still too large, try one more time with more aggressive settings
  if (bestSize > targetSizeBytes) {
    console.log('[ImageCompression] Still too large, applying aggressive compression');
    try {
      const aggressiveOptions = {
        maxSizeMB: targetSizeKB / 1024,
        maxWidthOrHeight: Math.min(maxDimension, 2048), // Reduce dimensions more
        useWebWorker: true,
        initialQuality: 0.5,
        fileType: fileType,
        preserveExif: false, // Remove EXIF to save space
        alwaysKeepResolution: false,
      };

      const compressedFile = await imageCompression(file, aggressiveOptions);
      bestResult = new File([compressedFile], file.name, { type: fileType });
      bestQuality = 0.5;
      bestSize = compressedFile.size;
    } catch (error) {
      console.error('[ImageCompression] Aggressive compression failed:', error);
    }
  }

  const compressionRatio = bestSize / originalSize;

  console.log('[ImageCompression] Compression complete:', {
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
    compressedSize: `${(bestSize / 1024).toFixed(2)} KB`,
    reduction: `${((1 - compressionRatio) * 100).toFixed(1)}%`,
    quality: bestQuality
  });

  return {
    compressedFile: bestResult,
    originalSize,
    compressedSize: bestSize,
    compressionRatio,
    wasCompressed: true,
    quality: bestQuality
  };
}

/**
 * Estimates if an image needs compression based on file size
 * @param file - The file to check
 * @param targetSizeKB - Target size in KB (default: 500)
 * @returns Whether compression is needed
 */
export function needsCompression(file: File, targetSizeKB: number = TARGET_SIZE_KB): boolean {
  return file.size > targetSizeKB * 1024;
}

/**
 * Gets a human-readable file size string
 * @param bytes - Size in bytes
 * @returns Formatted size string (e.g., "1.5 MB", "250 KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
