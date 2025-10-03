import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GPSAddressForm, { type Address } from '@/components/GPSAddressForm';
import PhotoCapture from '@/components/PhotoCapture';
import ResultsDisplay, { type OCRResult } from '@/components/ResultsDisplay';
import OCRCorrection from '@/components/OCRCorrection';
import LanguageToggle from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { RotateCcw, Edit } from 'lucide-react';

export default function ScannerPage() {
  const { t } = useTranslation();
  const [address, setAddress] = useState<Address | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);

  const handlePhotoProcessed = (result: any) => {
    console.log('OCR result:', result);
    
    if (result.residentNames) {
      setOcrResult({
        residentNames: result.residentNames,
        existingCustomers: result.existingCustomers || [],
        newProspects: result.newProspects || [],
      });
      setShowCorrection(false);
    }
  };

  const handleAddressDetected = (detectedAddress: Address) => {
    console.log('Address detected:', detectedAddress);
    setAddress(detectedAddress);
  };

  const handleCorrectionComplete = (result: any) => {
    console.log('Correction result:', result);
    
    if (result.residentNames) {
      setOcrResult({
        residentNames: result.residentNames,
        existingCustomers: result.existingCustomers || [],
        newProspects: result.newProspects || [],
      });
      setShowCorrection(false);
    }
  };

  const handleReset = () => {
    setOcrResult(null);
    setShowCorrection(false);
  };

  const handleCorrect = () => {
    setShowCorrection(true);
  };

  const hasResults = ocrResult && (ocrResult.existingCustomers.length > 0 || ocrResult.newProspects.length > 0);

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
        <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
        
        {showCorrection ? (
          <OCRCorrection 
            initialNames={ocrResult?.residentNames || []}
            address={address}
            onCorrectionComplete={handleCorrectionComplete}
            onCancel={() => setShowCorrection(false)}
          />
        ) : (
          <ResultsDisplay result={ocrResult} />
        )}
      </main>

      {hasResults && !showCorrection && (
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
              variant="outline"
              size="lg"
              onClick={handleCorrect}
              className="flex-1 min-h-12 gap-2"
              data-testid="button-correct"
            >
              <Edit className="h-4 w-4" />
              {t('action.correct')}
            </Button>
            <Button
              size="lg"
              className="flex-1 min-h-12"
              data-testid="button-save"
              onClick={() => console.log('Save triggered', ocrResult)}
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
