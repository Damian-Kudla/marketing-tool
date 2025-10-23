import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Loader2, X, RotateCw, RotateCcw, Wifi, WifiOff, Crop } from 'lucide-react';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import type { Address } from '@/components/GPSAddressForm';
import { ocrAPI } from '@/services/api';
import { trackingManager } from '@/services/trackingManager';
import { expandHouseNumberRange, validateHouseNumber } from '@/utils/addressUtils';
import { 
  correctImageOrientationNative,
  rotateImageManually,
  type NativeOrientationResult 
} from '@/lib/nativeOrientation';
import OrientationLoggingService from '@/services/orientationLogging';
import { offlineStorage } from '@/services/offlineStorage';
import { pwaService } from '@/services/pwa';
import { ImageCropDialog } from './ImageCropDialog';

interface PhotoCaptureProps {
  onPhotoProcessed?: (results: any, imageSrc?: string) => void;
  address?: Address | null;
}

export default function PhotoCapture({ onPhotoProcessed, address }: PhotoCaptureProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);
  const [orientationInfo, setOrientationInfo] = useState<NativeOrientationResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [manualRotation, setManualRotation] = useState(0); // Track manual rotation steps
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Crop dialog state
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);

  // Setup online/offline listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Memory Optimization: Revoke Object URLs when preview changes
  useEffect(() => {
    return () => {
      if (preview) {
        console.log('[PhotoCapture] Revoking Object URL to free memory:', preview);
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setCorrecting(true);

    try {
      const startTime = Date.now();
      
      console.log('Starting native orientation correction for iPhone image...');
      
      // Use completely library-free approach to avoid "n is not defined" error
      const correctionResult = await correctImageOrientationNative(file);
      
      const processingTime = Date.now() - startTime;
      
      console.log('Native orientation correction completed:', {
        needsCorrection: correctionResult.orientationInfo.needsCorrection,
        rotation: correctionResult.orientationInfo.rotation,
        method: correctionResult.orientationInfo.detectionMethod,
        confidence: correctionResult.orientationInfo.confidence
      });
      
      // Log the correction for analytics using comprehensive service
      OrientationLoggingService.logOrientationCorrection(
        'ios', // Assume iOS since iPhone was mentioned in the error
        correctionResult.orientationInfo.detectionMethod,
        correctionResult.orientationInfo.rotation,
        true, // frontend correction
        false, // backend correction
        file.size,
        correctionResult.correctedBlob.size,
        processingTime,
        true, // assume OCR success for now, will be updated after processing
        0 // text blocks detected will be updated after OCR
      );

      // Convert blob to file
      const correctedFile = new File(
        [correctionResult.correctedBlob], 
        file.name, 
        { type: 'image/jpeg' }
      );
      
      setCorrectedFile(correctedFile);
      setOrientationInfo(correctionResult);

      // Create preview from corrected image
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(correctedFile);

      // No automatic rotation toast - users can manually rotate if needed
    } catch (error) {
      console.error('Native orientation correction failed:', error);
      
      // Ultimate fallback - use original file
      setCorrectedFile(file);
      setOrientationInfo(null);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      
      toast({
        title: t('photo.orientationWarning', 'Orientation Detection Failed'),
        description: t('photo.orientationWarningDesc', 'Using original image. Manual rotation may be needed'),
        duration: 5000,
      });
    } finally {
      setCorrecting(false);
    }
  };

  const rotateImage = async (direction: 'clockwise' | 'counterclockwise') => {
    const currentFile = correctedFile || selectedFile;
    if (!currentFile || rotating) return;

    setRotating(true);

    try {
      const degrees = direction === 'clockwise' ? 90 : -90;
      const newManualRotation = manualRotation + degrees;
      
      console.log(`Manual rotation: ${direction} (${degrees}°), total: ${newManualRotation}°`);
      
      // Rotate the image
      const rotatedFile = await rotateImageManually(currentFile, degrees);
      
      // Update state
      setCorrectedFile(rotatedFile);
      setManualRotation(newManualRotation);
      
      // Update preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(rotatedFile);

      // Show feedback to user
      toast({
        title: t('photo.manualRotation', 'Image Rotated'),
        description: t('photo.rotatedManually', 'Image rotated {{direction}} by 90°', { 
          direction: direction === 'clockwise' ? t('photo.clockwise', 'clockwise') : t('photo.counterclockwise', 'counterclockwise')
        }),
        duration: 2000,
      });
      
    } catch (error) {
      console.error('Manual rotation failed:', error);
      toast({
        variant: 'destructive',
        title: t('photo.rotationError', 'Rotation Failed'),
        description: t('photo.rotationErrorDesc', 'Could not rotate image. Please try again.'),
      });
    } finally {
      setRotating(false);
    }
  };

  const processPhoto = async () => {
    const fileToProcess = correctedFile || selectedFile;
    if (!fileToProcess) return;

    // Validate address fields
    if (!address || !address.street || !address.number || !address.postal) {
      toast({
        variant: 'destructive',
        title: t('photo.error'),
        description: t('photo.addressRequired'),
      });
      return;
    }

    // Validate house number format
    const houseNumberError = validateHouseNumber(address.number);
    if (houseNumberError) {
      toast({
        variant: 'destructive',
        title: 'Ungültige Hausnummer',
        description: houseNumberError,
        duration: 8000,
      });
      return;
    }

    setProcessing(true);

    try {
      // Convert file to base64 for storage
      const imageDataUrl = await fileToBase64(fileToProcess);
      
      if (!isOnline) {
        // Handle offline mode - save to IndexedDB
        await handleOfflineProcessing(fileToProcess, imageDataUrl);
        return;
      }

      // Process address with house number range expansion if needed
      const processedAddress = { ...address };
      if (address.number.includes('-')) {
        const expanded = expandHouseNumberRange(
          address.number,
          address.onlyEven || false,
          address.onlyOdd || false
        );
        // Join expanded numbers with comma for backend processing
        processedAddress.number = expanded.join(',');
      }
      
      const formData = new FormData();
      formData.append('image', fileToProcess);
      formData.append('address', JSON.stringify(processedAddress));
      
      // Include orientation info if available for backend logging
      if (orientationInfo) {
        formData.append('orientationInfo', JSON.stringify(orientationInfo.orientationInfo));
      }

      const result = await ocrAPI.processImage(formData);
      
      // Save successful result to offline storage for caching
      await saveResultToOfflineStorage(result, imageDataUrl);
      
      // Track scan action
      trackingManager.logAction('scan', `Address: ${address.street} ${address.number}`);
      
      onPhotoProcessed?.(result, preview || undefined);
      
      const totalNames = result.residentNames?.length || 0;
      const totalTextBlocks = result.fullVisionResponse?.textAnnotations?.length || 0;
      
      // Log successful OCR completion with orientation info
      if (orientationInfo) {
        OrientationLoggingService.logOrientationCorrection(
          'ios', // Default to iOS for now since the issue was with iPhone photos
          orientationInfo.orientationInfo.detectionMethod,
          orientationInfo.orientationInfo.rotation,
          true, // frontend correction
          result.orientationCorrectionApplied || false, // backend correction from response
          fileToProcess.size,
          fileToProcess.size, // corrected size (frontend already corrected)
          0, // processing time not available here
          totalNames > 0, // OCR success based on names found
          totalTextBlocks
        );
      }
      
      if (totalNames === 0) {
        toast({
          title: t('photo.warning'),
          description: t('photo.noTextExtracted'),
        });
      } else {
        toast({
          title: t('photo.success'),
          description: `${t('photo.found')} ${totalNames} ${t('photo.names')}`,
        });
      }
    } catch (error: any) {
      console.error('OCR error:', error);
      
      // Check for rate limit error (429)
      if (error?.response?.status === 429) {
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || 'Zu viele Bildübermittlungen. Bitte warte eine Minute.';
        
        toast({
          variant: 'destructive',
          title: 'Rate Limit erreicht',
          description: errorMessage,
          duration: 10000,
        });
      } else if (isOnline) {
        // If online request fails (but not rate limit), try offline fallback
        const imageDataUrl = await fileToBase64(fileToProcess);
        await handleOfflineProcessing(fileToProcess, imageDataUrl, error as Error);
      } else {
        const errorMessage = error instanceof Error ? error.message : t('photo.errorDesc');
        toast({
          variant: 'destructive',
          title: t('photo.error'),
          description: errorMessage,
        });
      }
    } finally {
      setProcessing(false);
    }
  };

  // Handle offline processing
  const handleOfflineProcessing = async (file: File, imageDataUrl: string, onlineError?: Error) => {
    // ⚠️ DISABLED: IndexedDB storage removed to save storage space
    // OCR images are NOT stored offline anymore - only works with server connection
    
    try {
      // Show offline error message (no offline storage anymore)
      toast({
        variant: 'destructive',
        title: t('photo.offlineError', 'Offline - Not Available'),
        description: t('photo.offlineErrorDesc', 'OCR processing requires internet connection. Please connect and try again.'),
        duration: 5000,
      });
      
    } catch (error) {
      console.error('Offline handling error:', error);
    }
  };

  // Save successful result to offline storage
  const saveResultToOfflineStorage = async (result: any, imageDataUrl: string) => {
    // ⚠️ DISABLED: IndexedDB storage removed to save storage space
    // Results are stored on server only - no local caching of images
    // This saves 40-100 MB of storage space per user
    console.log('Offline storage disabled - results stored on server only');
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const clearPhoto = () => {
    setPreview(null);
    setSelectedFile(null);
    setCorrectedFile(null);
    setOrientationInfo(null);
    setManualRotation(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCropCancel = () => {
    setShowCropDialog(false);
    setImageToCrop(null);
  };

  const handleCropClick = () => {
    if (!preview) return;
    setImageToCrop(preview);
    setShowCropDialog(true);
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setShowCropDialog(false);
    setImageToCrop(null);
    
    // Convert blob to file
    const croppedFile = new File([croppedBlob], 'cropped-image.jpg', { type: 'image/jpeg' });
    setCorrecting(true);

    try {
      const startTime = Date.now();
      
      console.log('Starting native orientation correction for cropped image...');
      
      const correctionResult = await correctImageOrientationNative(croppedFile);
      
      const processingTime = Date.now() - startTime;
      
      console.log('Native orientation correction completed:', {
        needsCorrection: correctionResult.orientationInfo.needsCorrection,
        rotation: correctionResult.orientationInfo.rotation,
        detectionMethod: correctionResult.orientationInfo.detectionMethod,
        processingTime: `${processingTime}ms`
      });

      const correctedFile = new File([correctionResult.correctedBlob], 'cropped-corrected-image.jpg', { type: 'image/jpeg' });
      
      setSelectedFile(croppedFile);
      setCorrectedFile(correctedFile);
      setOrientationInfo(correctionResult);
      setManualRotation(0); // Reset manual rotation

      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(correctedFile);

    } catch (error) {
      console.error('Native orientation correction failed:', error);
      
      setCorrectedFile(croppedFile);
      setOrientationInfo(null);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(croppedFile);
      
      toast({
        title: t('photo.orientationWarning', 'Orientation Detection Failed'),
        description: t('photo.orientationWarningDesc', 'Using cropped image. Manual rotation may be needed'),
        duration: 5000,
      });
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <>
      <ImageCropDialog
        isOpen={showCropDialog}
        imageSrc={imageToCrop || ''}
        onCropComplete={handleCropComplete}
        onCancel={handleCropCancel}
      />
      
      <Card data-testid="card-photo-capture">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('photo.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview ? (
          <div className="space-y-4">
            <div className="relative">
              <img 
                src={preview} 
                alt="Nameplate preview" 
                className="w-full h-auto max-h-[60vh] object-contain rounded-lg"
                data-testid="img-preview"
                style={{
                  aspectRatio: 'auto',
                  maxWidth: '100%',
                  display: 'block',
                }}
              />
              {(processing || correcting || rotating) && (
                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                  <div className="text-center text-white">
                    <Loader2 className="h-8 w-8 text-white animate-spin mx-auto mb-2" />
                    <p className="text-sm">
                      {rotating 
                        ? t('photo.rotating', 'Rotating image...')
                        : correcting 
                        ? t('photo.correctingOrientation', 'Correcting orientation...') 
                        : t('photo.processing')
                      }
                    </p>
                  </div>
                </div>
              )}
              <Button
                variant="destructive"
                size="icon"
                onClick={clearPhoto}
                className="absolute top-2 right-2"
                data-testid="button-clear-photo"
                disabled={processing || correcting || rotating}
              >
                <X className="h-4 w-4" />
              </Button>
              
              {/* Manual rotation and crop controls */}
              <div className="absolute bottom-2 right-2 flex gap-1">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => rotateImage('counterclockwise')}
                  disabled={processing || correcting || rotating}
                  className="h-8 w-8 bg-black/50 hover:bg-black/70"
                  data-testid="button-rotate-left"
                  title={t('photo.rotateLeft', 'Rotate counterclockwise')}
                >
                  <RotateCcw className="h-4 w-4 text-white" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => rotateImage('clockwise')}
                  disabled={processing || correcting || rotating}
                  className="h-8 w-8 bg-black/50 hover:bg-black/70"
                  data-testid="button-rotate-right"
                  title={t('photo.rotateRight', 'Rotate clockwise')}
                >
                  <RotateCw className="h-4 w-4 text-white" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleCropClick}
                  disabled={processing || correcting || rotating}
                  className="h-8 w-8 bg-black/50 hover:bg-black/70"
                  title="Bild zuschneiden"
                >
                  <Crop className="h-4 w-4 text-white" />
                </Button>
              </div>
            </div>
            
            {/* Orientation info display */}
            {(orientationInfo?.orientationInfo.needsCorrection || manualRotation !== 0) && (
              <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm">
                <RotateCw className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-green-700 dark:text-green-300">
                  {orientationInfo?.orientationInfo.needsCorrection && (
                    <>
                      {t('photo.rotatedBy', 'Rotated by {{degrees}}°', { 
                        degrees: orientationInfo.orientationInfo.rotation 
                      })} 
                      <span className="text-green-600 dark:text-green-400 ml-1">
                        (iOS, {orientationInfo.orientationInfo.detectionMethod})
                      </span>
                    </>
                  )}
                  {manualRotation !== 0 && (
                    <>
                      {orientationInfo?.orientationInfo.needsCorrection && ' + '}
                      {t('photo.manuallyRotated', 'Manual: {{degrees}}°', { 
                        degrees: manualRotation 
                      })}
                    </>
                  )}
                </span>
              </div>
            )}
            
            {/* Offline Status Indicator */}
            {!isOnline && (
              <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-sm border border-orange-200 dark:border-orange-800">
                <WifiOff className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <span className="text-orange-700 dark:text-orange-300">
                  {t('photo.offlineMode', 'Offline Mode - Photos will be processed when connection is restored')}
                </span>
              </div>
            )}
            
            <div className="space-y-2">
              <Button
                onClick={processPhoto}
                disabled={processing || correcting || rotating}
                size="lg"
                className="w-full min-h-12 gap-2"
                data-testid="button-process-photo"
              >
                {processing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {isOnline ? t('photo.processing') : t('photo.savingOffline', 'Saving offline...')}
                  </>
                ) : correcting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t('photo.correctingOrientation', 'Correcting orientation...')}
                </>
              ) : rotating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('photo.rotating', 'Rotating image...')}
                </>
              ) : (
                <>
                  {!isOnline && <WifiOff className="h-4 w-4" />}
                  {isOnline ? t('photo.process') : t('photo.saveOffline', 'Save Offline')}
                </>
              )}
              </Button>
              
              {/* New Image Button - triggers camera for new photo */}
              <Button
                onClick={() => {
                  // Clear current photo first
                  clearPhoto();
                  // Then trigger camera
                  setTimeout(() => {
                    const input = fileInputRef.current;
                    if (input) {
                      input.setAttribute('capture', 'environment');
                      input.click();
                    }
                  }, 100);
                }}
                variant="outline"
                size="lg"
                className="w-full min-h-12 gap-2"
                disabled={processing || correcting || rotating}
              >
                <Camera className="h-5 w-5" />
                Neues Bild
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              id="photo-input"
              data-testid="input-file"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || correcting || rotating}
              size="lg"
              className="w-full min-h-11 gap-2"
              data-testid="button-take-photo"
            >
              <Camera className="h-5 w-5" />
              {t('photo.take')}
            </Button>
            <Button
              onClick={() => {
                const input = fileInputRef.current;
                if (input) {
                  input.removeAttribute('capture');
                  input.click();
                }
              }}
              variant="outline"
              size="lg"
              className="w-full min-h-11 gap-2"
              data-testid="button-upload-photo"
              disabled={processing || correcting || rotating}
            >
              <Upload className="h-5 w-5" />
              {t('photo.upload')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}
