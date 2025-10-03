import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GPSAddressForm, { type Address } from '@/components/GPSAddressForm';
import PhotoCapture from '@/components/PhotoCapture';
import ResultsDisplay, { type CustomerResult } from '@/components/ResultsDisplay';
import LanguageToggle from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

export default function ScannerPage() {
  const { t } = useTranslation();
  const [results, setResults] = useState<CustomerResult[]>([]);

  const handlePhotoProcessed = (ocrResult: any) => {
    console.log('OCR result:', ocrResult);
    
    if (ocrResult.results && ocrResult.results.length > 0) {
      setResults(ocrResult.results);
    }
  };

  const handleAddressDetected = (address: Address) => {
    console.log('Address detected:', address);
  };

  const handleReset = () => {
    setResults([]);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold" data-testid="text-app-title">
            {t('app.title')}
          </h1>
          <LanguageToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 space-y-4 pb-24">
        <GPSAddressForm onAddressDetected={handleAddressDetected} />
        <PhotoCapture onPhotoProcessed={handlePhotoProcessed} />
        <ResultsDisplay results={results} />
      </main>

      {results.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
          <div className="container mx-auto flex gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={handleReset}
              className="flex-1 min-h-12 gap-2"
              data-testid="button-reset"
            >
              <RotateCcw className="h-4 w-4" />
              {t('action.reset')}
            </Button>
            <Button
              size="lg"
              className="flex-1 min-h-12"
              data-testid="button-save"
              onClick={() => console.log('Save triggered', results)}
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
