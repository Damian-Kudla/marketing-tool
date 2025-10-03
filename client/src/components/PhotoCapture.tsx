import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Loader2, X } from 'lucide-react';

interface PhotoCaptureProps {
  onPhotoCapture?: (file: File) => void;
}

export default function PhotoCapture({ onPhotoCapture }: PhotoCaptureProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProcessing(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
        setProcessing(false);
        onPhotoCapture?.(file);
      };
      reader.readAsDataURL(file);
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
            <Button
              variant="destructive"
              size="icon"
              onClick={clearPhoto}
              className="absolute top-2 right-2"
              data-testid="button-clear-photo"
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
