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

  const handlePhotoCapture = async (file: File) => {
    console.log('Photo captured:', file.name);
    
    setTimeout(() => {
      const mockResults: CustomerResult[] = [
        { name: 'Max Müller', isExisting: true },
        { name: 'Anna Schmidt', isExisting: false },
        { name: 'Thomas Weber', isExisting: true },
      ];
      setResults(mockResults);
    }, 1500);
  };

  const handleAddressDetected = (address: Address) => {
    console.log('Address detected:', address);
  };

  const handleReset = () => {
    setResults([]);
    console.log('Reset triggered');
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
        <PhotoCapture onPhotoCapture={handlePhotoCapture} />
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
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
