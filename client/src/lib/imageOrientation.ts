// Backward compatibility wrapper for the native orientation implementation
// This file provides compatibility with the old imageOrientation API
// while using the new native implementation that doesn't require exif-js

export { 
  correctImageOrientationNative as correctImageOrientation,
  correctImageOrientationNative as correctImageOrientationAdvanced,
  rotateImageManually as rotateImage,
  type NativeOrientationResult as OrientationCorrectionResult
} from './nativeOrientation';

// Legacy interface for backward compatibility
export interface OrientationInfo {
  orientation: number;
  rotation: number;
  needsCorrection: boolean;
  detectionMethod: 'exif' | 'device' | 'manual' | 'none';
  deviceType: 'ios' | 'android' | 'desktop' | 'unknown';
}

// Simple utility functions
export function detectDeviceType(): OrientationInfo['deviceType'] {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) return 'ios';
  if (/android/.test(userAgent)) return 'android';
  if (/mobile/.test(userAgent)) return 'android';
  return 'desktop';
}

export function orientationToRotation(orientation: number): number {
  switch (orientation) {
    case 3: return 180;  // Image was rotated 180°, rotate 180° to correct
    case 6: return 270;  // Image was rotated 90° CW, rotate 270° CW (or 90° CCW) to correct  
    case 8: return 90;   // Image was rotated 270° CW, rotate 90° CW (or 270° CCW) to correct
    default: return 0;   // No rotation needed
  }
}