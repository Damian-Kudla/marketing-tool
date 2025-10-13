import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import GPSAddressForm, { type Address } from '@/components/GPSAddressForm';
import PhotoCapture from '@/components/PhotoCapture';
import ResultsDisplay, { type OCRResult } from '@/components/ResultsDisplay';
import LanguageToggle from '@/components/LanguageToggle';
import { UserButton } from '@/components/UserButton';
import { ClickableAddressHeader } from '@/components/ClickableAddressHeader';
import { AddressDatasets } from '@/components/AddressDatasets';
import { MaximizeButton } from '@/components/MaximizeButton';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RotateCcw, Edit } from 'lucide-react';
import { ocrAPI, datasetAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { useViewMode } from '@/contexts/ViewModeContext';
import ImageWithOverlays from '@/components/ImageWithOverlays';

// Helper function to create normalized address string for comparison
const createNormalizedAddressString = (address: Address | null): string | null => {
  if (!address) return null;
  // Create a normalized string from the address (similar to backend normalization)
  return `${address.street || ''} ${address.number || ''} ${address.postal || ''} ${address.city || ''}`.toLowerCase().trim();
};

export default function ScannerPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { viewMode, maximizedPanel } = useViewMode();
  const [address, setAddress] = useState<Address | null>(null);
  const [normalizedAddress, setNormalizedAddress] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [photoImageSrc, setPhotoImageSrc] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [currentDatasetId, setCurrentDatasetId] = useState<string | null>(null);
  const [datasetCreatedAt, setDatasetCreatedAt] = useState<string | null>(null);
  const [showDatasets, setShowDatasets] = useState(false);
  const [editableResidents, setEditableResidents] = useState<any[]>([]);
  const [showDataStorageConfirmation, setShowDataStorageConfirmation] = useState(false);
  const [datasetCreationResolver, setDatasetCreationResolver] = useState<((value: string | null) => void) | null>(null);

  // Auto-reset when address changes to a different normalized address
  useEffect(() => {
    const newNormalizedAddress = createNormalizedAddressString(address);
    
    // Check if we have a dataset loaded and the address has changed
    if (currentDatasetId && normalizedAddress && newNormalizedAddress) {
      if (normalizedAddress !== newNormalizedAddress) {
        console.log('[Address Change Detected] Old:', normalizedAddress, '→ New:', newNormalizedAddress);
        console.log('[Address Change] Resetting dataset and clearing state');
        
        // Clear all dataset-related state
        setCurrentDatasetId(null);
        setDatasetCreatedAt(null);
        setEditableResidents([]);
        setOcrResult(null);
        setPhotoImageSrc(null);
        setCanEdit(true);
        
        // Update the datasets list for the new address
        setShowDatasets(true);
        
        toast({
          title: t('dataset.addressChanged', 'Address changed'),
          description: t('dataset.addressChangedDesc', 'Previous dataset was removed'),
        });
      }
    }
    
    // Update normalized address
    setNormalizedAddress(newNormalizedAddress);
  }, [address, currentDatasetId, normalizedAddress, t, toast]);

  const handleDatasetLoad = (dataset: any) => {
    try {
      console.log('[handleDatasetLoad] Loading dataset:', dataset);
      
      // Validate dataset structure
      if (!dataset || !dataset.street || !dataset.houseNumber) {
        console.error('[handleDatasetLoad] Invalid dataset structure:', dataset);
        throw new Error('Invalid dataset structure');
      }
      
      // Load dataset into the current state
      const address: Address = {
        street: dataset.street,
        number: dataset.houseNumber,
        city: dataset.city || '',
        postal: dataset.postalCode || '',
        country: 'Deutschland',
      };
      
      console.log('[handleDatasetLoad] Setting address:', address);
      setAddress(address);
      
      // Update normalized address to prevent auto-reset
      setNormalizedAddress(createNormalizedAddressString(address));
      
      // Set edit permissions
      const canEditDataset = dataset.canEdit !== undefined ? dataset.canEdit : false;
      console.log('[handleDatasetLoad] Edit permissions check:', {
        'dataset.canEdit': dataset.canEdit,
        'canEditDataset': canEditDataset,
        'dataset.createdBy': dataset.createdBy,
        'dataset.createdAt': dataset.createdAt,
      });
      setCanEdit(canEditDataset);
      setCurrentDatasetId(dataset.id);
      setDatasetCreatedAt(dataset.createdAt);
      
      // Ensure editableResidents is an array
      const editableResidentsList = Array.isArray(dataset.editableResidents) 
        ? dataset.editableResidents 
        : [];
      
      const fixedCustomersList = Array.isArray(dataset.fixedCustomers)
        ? dataset.fixedCustomers
        : [];
      
      console.log('[handleDatasetLoad] Residents:', {
        editableCount: editableResidentsList.length,
        fixedCount: fixedCustomersList.length,
      });
      
      // Set editableResidents directly from dataset
      console.log('[handleDatasetLoad] Setting editableResidents:', editableResidentsList);
      setEditableResidents(editableResidentsList);
      
      // Convert dataset residents to OCR result format
      const existingCustomersData = editableResidentsList
        .filter((r: any) => r.category === 'existing_customer')
        .map((r: any) => ({
          name: r.name,
          isExisting: true,
        }));
      
      const newProspectsData = editableResidentsList
        .filter((r: any) => r.category === 'potential_new_customer')
        .map((r: any) => r.name);
      
      const fixedCustomersData = fixedCustomersList.map((r: any) => ({
        name: r.name,
        isExisting: true,
      }));
      
      console.log('[handleDatasetLoad] Converted data:', {
        existingCustomers: existingCustomersData.length,
        newProspects: newProspectsData.length,
        fixedCustomers: fixedCustomersData.length,
      });
      
      setOcrResult({
        residentNames: Array.isArray(dataset.rawResidentData) ? dataset.rawResidentData : [],
        existingCustomers: existingCustomersData,
        newProspects: newProspectsData,
        allCustomersAtAddress: fixedCustomersData,
      });
      
      setPhotoImageSrc(null); // No photo available for loaded datasets
      setShowDatasets(true); // Keep datasets visible
      
      console.log('[handleDatasetLoad] Dataset loaded successfully');
      console.log('[handleDatasetLoad] Final state:', {
        canEdit: canEditDataset,
        ocrResult: {
          residentNames: Array.isArray(dataset.rawResidentData) ? dataset.rawResidentData.length : 0,
          existingCustomers: existingCustomersData.length,
          newProspects: newProspectsData.length,
          fixedCustomers: fixedCustomersData.length,
        }
      });
      
      toast({
        title: t('dataset.loaded', 'Dataset loaded'),
        description: canEditDataset 
          ? t('dataset.loadedEditable', 'You can edit this dataset')
          : t('dataset.loadedReadOnly', 'This dataset is read-only'),
      });
    } catch (error) {
      console.error('[handleDatasetLoad] Error loading dataset:', error);
      toast({
        variant: 'destructive',
        title: t('dataset.loadError', 'Fehler beim Laden'),
        description: t('dataset.loadErrorDesc', 'Datensatz konnte nicht geladen werden'),
      });
    }
  };

  const handleDatasetLoadById = async (datasetId: string) => {
    try {
      console.log('[handleDatasetLoadById] Loading dataset with ID:', datasetId);
      const dataset = await datasetAPI.getDatasetById(datasetId);
      console.log('[handleDatasetLoadById] Received dataset:', JSON.stringify(dataset, null, 2));
      handleDatasetLoad(dataset);
    } catch (error) {
      console.error('[handleDatasetLoadById] Error loading dataset by ID:', error);
      toast({
        variant: 'destructive',
        title: t('dataset.loadError', 'Fehler beim Laden'),
        description: t('dataset.loadErrorDesc', 'Datensatz konnte nicht geladen werden'),
      });
    }
  };

  const handleRequestDatasetCreation = async (): Promise<string | null> => {
    // If dataset already exists, return it
    if (currentDatasetId) {
      return currentDatasetId;
    }

    // Show confirmation dialog and wait for user response
    return new Promise((resolve) => {
      setDatasetCreationResolver(() => resolve);
      setShowDataStorageConfirmation(true);
    });
  };

  const confirmDatasetCreation = async () => {
    setShowDataStorageConfirmation(false);
    
    try {
      if (!address) {
        console.error('[confirmDatasetCreation] No address available');
        toast({
          variant: 'destructive',
          title: t('dataset.createError', 'Fehler beim Erstellen'),
          description: t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
        });
        datasetCreationResolver?.(null);
        return;
      }

      console.log('[confirmDatasetCreation] Creating dataset for address:', address);
      
      const dataset = await datasetAPI.createDataset({
        address: {
          street: address.street,
          number: address.number,
          city: address.city,
          postal: address.postal,
        },
        editableResidents: editableResidents,
        rawResidentData: ocrResult?.residentNames || [],
      });

      console.log('[confirmDatasetCreation] Dataset created:', dataset.id);
      
      // Update state with new dataset ID
      setCurrentDatasetId(dataset.id);
      setDatasetCreatedAt(dataset.createdAt);
      setCanEdit(true);

      toast({
        title: t('dataset.created', 'Datensatz erstellt'),
        description: t('dataset.createdDesc', 'Datensatz wurde erfolgreich erstellt'),
      });

      datasetCreationResolver?.(dataset.id);
    } catch (error: any) {
      console.error('[confirmDatasetCreation] Error creating dataset:', error);
      
      // Check if it's a 409 conflict (dataset already exists)
      if (error?.response?.status === 409) {
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || 'Ein Datensatz für diese Adresse existiert bereits heute.';
        const isOwnDataset = errorData.isOwnDataset;
        
        toast({
          variant: 'destructive',
          title: isOwnDataset 
            ? t('dataset.alreadyExistsOwn', 'Datensatz bereits vorhanden')
            : t('dataset.alreadyExistsOther', 'Datensatz bereits erstellt'),
          description: errorMessage,
          duration: 8000, // Show longer for important message
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('dataset.createError', 'Fehler beim Erstellen'),
          description: error.message || t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
        });
      }
      datasetCreationResolver?.(null);
    }
  };

  const cancelDatasetCreation = () => {
    setShowDataStorageConfirmation(false);
    datasetCreationResolver?.(null);
  };

  const handlePhotoProcessed = (result: any, imageSrc?: string) => {
    console.log('OCR result:', result);
    
    if (result.residentNames !== undefined) {
      setOcrResult({
        residentNames: result.residentNames,
        existingCustomers: result.existingCustomers || [],
        newProspects: result.newProspects || [],
        allCustomersAtAddress: result.allCustomersAtAddress || [],
        fullVisionResponse: result.fullVisionResponse,
      });
      if (imageSrc) {
        setPhotoImageSrc(imageSrc);
      }
      setShowDatasets(true); // Show datasets after photo upload
    }
  };

  const handleAddressDetected = useCallback((detectedAddress: Address) => {
    console.log('Address detected:', detectedAddress);
    setAddress(detectedAddress);
  }, []);

  const handleAddressSearch = useCallback((customers: any[]) => {
    console.log('Address search result:', customers);
    
    // Show results as existing customers (since all customers at an address are existing)
    // For address-only search, don't show allCustomersAtAddress section (would be redundant)
    setOcrResult({
      residentNames: [],
      existingCustomers: customers,
      newProspects: [],
    });
    setShowDatasets(true); // Show datasets after address search
  }, []);

  const handleReset = () => {
    setOcrResult(null);
    setPhotoImageSrc(null);
    setCanEdit(true);
    setDatasetCreatedAt(null);
    setCurrentDatasetId(null);
    setEditableResidents([]);
    setAddress(null);
    setNormalizedAddress(null);
    setShowDatasets(false);
  };

  const handleNamesUpdated = async (updatedNames: string[]) => {
    if (!address) return;

    try {
      const result = await ocrAPI.correctOCR(updatedNames, address);
        setOcrResult({
          residentNames: result.residentNames,
          existingCustomers: result.existingCustomers || [],
          newProspects: result.newProspects || [],
          allCustomersAtAddress: result.allCustomersAtAddress || [],
          fullVisionResponse: ocrResult?.fullVisionResponse,
        });
    } catch (error) {
      console.error('Update error:', error);
      const { toast } = await import('@/hooks/use-toast');
      toast({
        variant: 'destructive',
        title: t('photo.error'),
        description: t('photo.updateFailed'),
      });
    }
  };

  const hasResults = ocrResult && (ocrResult.existingCustomers.length > 0 || ocrResult.newProspects.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold" data-testid="text-app-title">
              {t('app.title')}
            </h1>
            {address && (
              <ClickableAddressHeader 
                address={address} 
                residents={editableResidents} 
                canEdit={canEdit}
                datasetCreatedAt={datasetCreatedAt}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <UserButton onDatasetLoad={handleDatasetLoad} />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 pb-24">
        {viewMode === 'list' ? (
          // List view: vertical layout (current design)
          <div className="space-y-4">
            <div className="relative">
              <MaximizeButton panel="location" />
              <GPSAddressForm 
                onAddressDetected={handleAddressDetected}
                onAddressSearch={handleAddressSearch}
              />
            </div>
            
            {canEdit && (
              <div className="relative">
                <MaximizeButton panel="photo" />
                <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
              </div>
            )}
            
            {address && showDatasets && (
              <AddressDatasets 
                address={address}
                onLoadDataset={handleDatasetLoadById}
              />
            )}
            
            <div className="relative">
              <MaximizeButton panel="results" />
              <ResultsDisplay 
                result={ocrResult} 
                photoImageSrc={photoImageSrc}
                address={address}
                onNamesUpdated={handleNamesUpdated}
                canEdit={canEdit}
                currentDatasetId={currentDatasetId}
                onDatasetIdChange={setCurrentDatasetId}
                onDatasetCreatedAtChange={setDatasetCreatedAt}
                onResidentsUpdated={setEditableResidents}
                initialResidents={editableResidents}
              />
            </div>
          </div>
        ) : (
          // Grid view: two-column layout (ab 700px Breite)
          <div className="grid grid-cols-1 min-[700px]:grid-cols-2 gap-4 h-[calc(100vh-12rem)]">
            {/* Left column: Location, Photo, Overlays - NO SCROLL, auto-scale */}
            <div className="flex flex-col gap-4">
              <div className="relative">
                <MaximizeButton panel="location" />
                <GPSAddressForm 
                  onAddressDetected={handleAddressDetected}
                  onAddressSearch={handleAddressSearch}
                />
              </div>
              
              {address && showDatasets && (
                <AddressDatasets 
                  address={address}
                  onLoadDataset={handleDatasetLoadById}
                />
              )}
              
              {canEdit && (
                <div className="relative">
                  <MaximizeButton panel="photo" />
                  <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
                </div>
              )}

              {/* ImageWithOverlays at bottom of left column */}
              {photoImageSrc && ocrResult?.fullVisionResponse && (
                <div className="relative">
                  <MaximizeButton panel="overlays" />
                  <ImageWithOverlays
                    imageSrc={photoImageSrc}
                    fullVisionResponse={ocrResult.fullVisionResponse}
                    residentNames={ocrResult.residentNames}
                    existingCustomers={ocrResult.existingCustomers}
                    newProspects={ocrResult.newProspects}
                    allCustomersAtAddress={ocrResult.allCustomersAtAddress}
                    address={address}
                    onNamesUpdated={handleNamesUpdated}
                    editableResidents={editableResidents}
                    onResidentsUpdated={setEditableResidents}
                    currentDatasetId={currentDatasetId}
                    onRequestDatasetCreation={handleRequestDatasetCreation}
                  />
                </div>
              )}
            </div>
            
            {/* Right column: Results lists only (no ImageWithOverlays) */}
            <div className="relative overflow-y-auto">
              <MaximizeButton panel="results" />
              <ResultsDisplay 
                result={ocrResult} 
                photoImageSrc={photoImageSrc}
                address={address}
                onNamesUpdated={handleNamesUpdated}
                canEdit={canEdit}
                currentDatasetId={currentDatasetId}
                onDatasetIdChange={setCurrentDatasetId}
                onDatasetCreatedAtChange={setDatasetCreatedAt}
                onResidentsUpdated={setEditableResidents}
                initialResidents={editableResidents}
                hideImageOverlays={true}
              />
            </div>
          </div>
        )}
      </main>

      {hasResults && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
          <div className="container mx-auto">
            <Button
              variant="outline"
              size="lg"
              onClick={handleReset}
              className="w-full min-h-12 gap-2"
              data-testid="button-reset"
            >
              <RotateCcw className="h-4 w-4" />
              {t('action.reset')}
            </Button>
          </div>
        </div>
      )}

      {/* Maximized Panel Overlays */}
      {maximizedPanel === 'location' && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4 animate-in fade-in zoom-in-95 duration-200">
          <MaximizeButton panel="location" className="fixed top-4 right-4" />
          <div className="container mx-auto max-w-4xl pt-12">
            <GPSAddressForm 
              onAddressDetected={handleAddressDetected}
              onAddressSearch={handleAddressSearch}
            />
          </div>
        </div>
      )}

      {maximizedPanel === 'photo' && canEdit && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4 animate-in fade-in zoom-in-95 duration-200">
          <MaximizeButton panel="photo" className="fixed top-4 right-4" />
          <div className="container mx-auto max-w-4xl pt-12">
            <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
          </div>
        </div>
      )}

      {maximizedPanel === 'overlays' && photoImageSrc && ocrResult?.fullVisionResponse && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4 animate-in fade-in zoom-in-95 duration-200">
          <MaximizeButton panel="overlays" className="fixed top-4 right-4" />
          <div className="container mx-auto max-w-6xl pt-12">
            <ImageWithOverlays
              imageSrc={photoImageSrc}
              fullVisionResponse={ocrResult.fullVisionResponse}
              residentNames={ocrResult.residentNames}
              existingCustomers={ocrResult.existingCustomers}
              newProspects={ocrResult.newProspects}
              allCustomersAtAddress={ocrResult.allCustomersAtAddress}
              address={address}
              onNamesUpdated={handleNamesUpdated}
              editableResidents={editableResidents}
              onResidentsUpdated={setEditableResidents}
              currentDatasetId={currentDatasetId}
              onRequestDatasetCreation={handleRequestDatasetCreation}
            />
          </div>
        </div>
      )}

      {maximizedPanel === 'results' && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto p-4 animate-in fade-in zoom-in-95 duration-200">
          <MaximizeButton panel="results" className="fixed top-4 right-4" />
          <div className="container mx-auto max-w-4xl pt-12">
            <ResultsDisplay 
              result={ocrResult} 
              photoImageSrc={photoImageSrc}
              address={address}
              onNamesUpdated={handleNamesUpdated}
              canEdit={canEdit}
              currentDatasetId={currentDatasetId}
              onDatasetIdChange={setCurrentDatasetId}
              onDatasetCreatedAtChange={setDatasetCreatedAt}
              onResidentsUpdated={setEditableResidents}
              initialResidents={editableResidents}
            />
          </div>
        </div>
      )}

      {/* Dataset Creation Confirmation Dialog */}
      <AlertDialog open={showDataStorageConfirmation} onOpenChange={setShowDataStorageConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dataset.confirmTitle', 'Datensatz erstellen?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dataset.confirmDescription', 'Möchten Sie diese Daten speichern? Ein neuer Datensatz wird für diese Adresse erstellt.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDatasetCreation}>
              {t('action.cancel', 'Abbrechen')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDatasetCreation}>
              {t('action.confirm', 'Bestätigen')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
