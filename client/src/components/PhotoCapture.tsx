import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Address } from '@/components/GPSAddressForm';
import { ocrAPI } from '@/services/api';

interface PhotoCaptureProps {
  onPhotoProcessed?: (results: any, imageSrc?: string) => void;
  address?: Address | null;
}

export default function PhotoCapture({ onPhotoProcessed, address }: PhotoCaptureProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const processPhoto = async () => {
    if (!selectedFile) return;

    // Validate address fields
    if (!address || !address.street || !address.number || !address.postal) {
      toast({
        variant: 'destructive',
        title: t('photo.error'),
        description: t('photo.addressRequired'),
      });
      return;
    }

    setProcessing(true);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);
      formData.append('address', JSON.stringify(address));

      const result = await ocrAPI.processImage(formData);
      onPhotoProcessed?.(result, preview || undefined);
      
      const totalNames = result.residentNames?.length || 0;
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
    } catch (error) {
      console.error('OCR error:', error);
      const errorMessage = error instanceof Error ? error.message : t('photo.errorDesc');
      toast({
        variant: 'destructive',
        title: t('photo.error'),
        description: errorMessage,
      });
    } finally {
      setProcessing(false);
    }
  };

  const clearPhoto = () => {
    setPreview(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
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
                className="w-full h-48 object-cover rounded-lg"
                data-testid="img-preview"
              />
              {processing && (
                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                </div>
              )}
              <Button
                variant="destructive"
                size="icon"
                onClick={clearPhoto}
                className="absolute top-2 right-2"
                data-testid="button-clear-photo"
                disabled={processing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={processPhoto}
              disabled={processing}
              size="lg"
              className="w-full min-h-12 gap-2"
              data-testid="button-process-photo"
            >
              {processing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('photo.processing')}
                </>
              ) : (
                t('photo.process')
              )}
            </Button>
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
              disabled={processing}
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
              disabled={processing}
            >
              <Upload className="h-5 w-5" />
              {t('photo.upload')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
