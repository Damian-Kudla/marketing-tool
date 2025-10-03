import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Address } from '@/components/GPSAddressForm';

interface PhotoCaptureProps {
  onPhotoProcessed?: (results: any) => void;
  address?: Address | null;
}

export default function PhotoCapture({ onPhotoProcessed, address }: PhotoCaptureProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);

      setProcessing(true);

      try {
        const formData = new FormData();
        formData.append('image', file);
        
        // Add address to request if available
        if (address) {
          formData.append('address', JSON.stringify(address));
        }

        const response = await fetch('/api/ocr', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('OCR processing failed');
        }

        const result = await response.json();
        onPhotoProcessed?.(result);
        
        const totalNames = result.residentNames?.length || 0;
        toast({
          title: t('photo.success'),
          description: `${t('photo.found')} ${totalNames} ${t('photo.names')}`,
        });
      } catch (error) {
        console.error('OCR error:', error);
        toast({
          variant: 'destructive',
          title: t('photo.error'),
          description: t('photo.errorDesc'),
        });
      } finally {
        setProcessing(false);
      }
    }
  };

  const clearPhoto = () => {
    setPreview(null);
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
              {processing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
              {processing ? t('photo.processing') : t('photo.take')}
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
