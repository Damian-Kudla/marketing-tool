import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, X, Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Address } from '@/components/GPSAddressForm';
import { ocrAPI } from '@/services/api';

interface OCRCorrectionProps {
  initialNames: string[];
  address?: Address | null;
  onCorrectionComplete?: (results: any) => void;
  onCancel?: () => void;
}

export default function OCRCorrection({ 
  initialNames, 
  address, 
  onCorrectionComplete,
  onCancel 
}: OCRCorrectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [names, setNames] = useState<string[]>(initialNames.length > 0 ? initialNames : ['']);
  const [processing, setProcessing] = useState(false);

  const updateName = (index: number, value: string) => {
    const updated = [...names];
    updated[index] = value;
    setNames(updated);
  };

  const addName = () => {
    setNames([...names, '']);
  };

  const removeName = (index: number) => {
    if (names.length > 1) {
      setNames(names.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async () => {
    const validNames = names.filter(name => name.trim().length > 0);
    
    if (validNames.length === 0) {
      toast({
        variant: 'destructive',
        title: t('correction.noNames'),
        description: t('correction.noNamesDesc'),
      });
      return;
    }

    setProcessing(true);

    try {
      const result = await ocrAPI.correctOCR(validNames, address || undefined);
      onCorrectionComplete?.(result);
      
      toast({
        title: t('correction.success'),
        description: `${t('correction.found')} ${result.existingCustomers?.length || 0} ${t('correction.customers')}`,
      });
    } catch (error) {
      console.error('OCR correction error:', error);
      toast({
        variant: 'destructive',
        title: t('correction.error'),
        description: t('correction.errorDesc'),
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Card data-testid="card-ocr-correction">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('correction.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('correction.description')}
        </p>
        
        <div className="space-y-3">
          {names.map((name, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor={`name-${index}`} className="sr-only">
                  {t('correction.nameLabel')} {index + 1}
                </Label>
                <Input
                  id={`name-${index}`}
                  value={name}
                  onChange={(e) => updateName(index, e.target.value)}
                  placeholder={`${t('correction.namePlaceholder')} ${index + 1}`}
                  className="min-h-11"
                  data-testid={`input-name-${index}`}
                />
              </div>
              {names.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => removeName(index)}
                  data-testid={`button-remove-${index}`}
                  className="min-h-11 min-w-11"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          onClick={addName}
          className="w-full min-h-11 gap-2"
          data-testid="button-add-name"
        >
          <Plus className="h-4 w-4" />
          {t('correction.addName')}
        </Button>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1 min-h-11 gap-2"
            data-testid="button-cancel-correction"
            disabled={processing}
          >
            <X className="h-4 w-4" />
            {t('correction.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 min-h-11 gap-2"
            data-testid="button-submit-correction"
            disabled={processing}
          >
            {processing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {processing ? t('correction.processing') : t('correction.submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
