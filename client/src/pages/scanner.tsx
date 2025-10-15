import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import GPSAddressForm, { type Address } from '@/components/GPSAddressForm';
import PhotoCapture from '@/components/PhotoCapture';
import ResultsDisplay, { type OCRResult } from '@/components/ResultsDisplay';
import { UserButton } from '@/components/UserButton';
import { ClickableAddressHeader } from '@/components/ClickableAddressHeader';
import { AddressDatasets } from '@/components/AddressDatasets';
import { AddressOverview } from '@/components/AddressOverview';
import { MaximizeButton } from '@/components/MaximizeButton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DataStorageConfirmation } from '@/components/DataStorageConfirmation';
import { RotateCcw, ArrowRight, X, Info } from 'lucide-react';
import { ocrAPI, datasetAPI } from '@/services/api';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import { useViewMode } from '@/contexts/ViewModeContext';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import { useCallBackSession } from '@/contexts/CallBackSessionContext';
import ImageWithOverlays from '@/components/ImageWithOverlays';

// Helper function to create normalized address string for comparison
const createNormalizedAddressString = (address: Address | null): string | null => {
  if (!address) return null;
  // Create a normalized string from the address (similar to backend normalization)
  return `${address.street || ''} ${address.number || ''} ${address.postal || ''} ${address.city || ''}`.toLowerCase().trim();
};

export default function ScannerPage() {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const { viewMode, maximizedPanel, setMaximizedPanel } = useViewMode();
  const { callBackMode } = useUIPreferences();
  const { hasNext, moveToNext, loadedFromCallBack, setLoadedFromCallBack } = useCallBackSession();
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
  const [showAddressOverview, setShowAddressOverview] = useState(false);
  const [showCallBackModeBanner, setShowCallBackModeBanner] = useState(false);

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

  const handleDatasetLoad = (dataset: any, fromCallBack: boolean = false) => {
    try {
      console.log('[handleDatasetLoad] Loading dataset:', dataset);
      
      // Show Call Back Mode banner if loaded from Call Back List and mode is not active
      if (fromCallBack && !callBackMode) {
        setShowCallBackModeBanner(true);
      }
      
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

  const handleDatasetLoadById = async (datasetId: string, fromCallBack: boolean = false) => {
    try {
      console.log('[handleDatasetLoadById] Loading dataset with ID:', datasetId);
      const dataset = await datasetAPI.getDatasetById(datasetId);
      console.log('[handleDatasetLoadById] Received dataset:', JSON.stringify(dataset, null, 2));
      handleDatasetLoad(dataset, fromCallBack);
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
    setShowCallBackModeBanner(false);
  };

  const handleNextCallBack = async () => {
    const nextDatasetId = moveToNext();
    if (nextDatasetId) {
      setLoadedFromCallBack(false); // Don't show banner again on "Nächster" click
      await handleDatasetLoadById(nextDatasetId);
    }
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
  const hasResidents = editableResidents && editableResidents.length > 0;

  // Call Back Mode: Show only the table
  if (callBackMode && address && hasResidents) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background border-b safe-area-top">
          <div className="container mx-auto px-4 py-3 overflow-x-auto header-scroll-container">
            <div className="flex items-center justify-between gap-4 min-w-max">
              <div className="flex items-center gap-4 flex-shrink-0">
                <h1 className="text-xl font-bold whitespace-nowrap" data-testid="text-app-title">
                  {t('app.title')}
                </h1>
                {address && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
                    <span className="text-sm font-medium">
                      {address.street} {address.number}, {address.postal} {address.city}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <UserButton onDatasetLoad={handleDatasetLoad} />
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-4 pb-32">
          {/* Call Back Mode: Show editable list and table side by side */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-4">
              {address.street} {address.number}, {address.postal} {address.city}
            </h2>
            
            {/* Table Overview (full width in Call Back Mode) */}
            <AddressOverview
              isOpen={true}
              onClose={() => {}}
              address={`${address.street} ${address.number}, ${address.postal} ${address.city}`}
              residents={editableResidents}
              asDialog={false}
              canEdit={canEdit}
              onResidentUpdate={setEditableResidents}
              currentDatasetId={currentDatasetId}
            />
          </div>
        </main>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
          <div className="container mx-auto">
            <div className="flex gap-2">
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
              {hasNext() && (
                <Button
                  variant="default"
                  size="lg"
                  onClick={handleNextCallBack}
                  className="flex-1 min-h-12 gap-2 bg-blue-600 hover:bg-blue-700"
                  data-testid="button-next-callback"
                >
                  Nächster
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Dataset Creation Confirmation Dialog */}
        {address && (
          <DataStorageConfirmation
            isOpen={showDataStorageConfirmation}
            onConfirm={confirmDatasetCreation}
            onCancel={cancelDatasetCreation}
            address={address}
          />
        )}
      </div>
    );
  }

  // Normal Mode
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b safe-area-top">
        <div className="container mx-auto px-4 py-3 overflow-x-auto header-scroll-container">
          <div className="flex items-center justify-between gap-4 min-w-max">
            <div className="flex items-center gap-4 flex-shrink-0">
              <h1 className="text-xl font-bold whitespace-nowrap" data-testid="text-app-title">
                {t('app.title')}
              </h1>
              {address && (
                <ClickableAddressHeader 
                  address={address} 
                  residents={editableResidents} 
                  canEdit={canEdit}
                  datasetCreatedAt={datasetCreatedAt}
                  onResidentsUpdate={setEditableResidents}
                  currentDatasetId={currentDatasetId}
                />
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <UserButton onDatasetLoad={handleDatasetLoad} />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 pb-32">
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
            
            {/* Image with Overlays in List view - with maximize button */}
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
            
            {/* Results Display without maximize button and without embedded image */}
            <div>
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

      {/* Call Back Mode Banner */}
      {showCallBackModeBanner && loadedFromCallBack && !callBackMode && (
        <div className="fixed top-20 left-0 right-0 z-40 px-4">
          <div className="container mx-auto">
            <Alert className="bg-blue-50 border-blue-200 relative">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900 pr-8">
                Es wird empfohlen für eine bessere Übersichtlichkeit den Call Back Modus zu aktivieren, wenn du eine Call Back runde startest. Klicke dafür auf den Nutzernamen oben und aktiviere den Call Back Modus.
              </AlertDescription>
              <button
                onClick={() => setShowCallBackModeBanner(false)}
                className="absolute top-3 right-3 p-1 rounded-md hover:bg-blue-100 transition-colors"
                aria-label="Banner schließen"
              >
                <X className="h-4 w-4 text-blue-600" />
              </button>
            </Alert>
          </div>
        </div>
      )}

      {hasResults && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
          <div className="container mx-auto">
            <div className="flex gap-2">
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
              {hasNext() && (
                <Button
                  variant="default"
                  size="lg"
                  onClick={handleNextCallBack}
                  className="flex-1 min-h-12 gap-2 bg-blue-600 hover:bg-blue-700"
                  data-testid="button-next-callback"
                >
                  Nächster
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Maximized Panel Overlays */}
      {maximizedPanel === 'location' && (
        <>
          {/* Backdrop - click to close */}
          <div 
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setMaximizedPanel(null)}
          />
          {/* Content */}
          <div className="fixed inset-0 z-[51] flex items-start justify-center pointer-events-none overflow-y-auto p-4">
            <div 
              className="relative w-full max-w-4xl mt-12 pointer-events-auto bg-background rounded-lg shadow-lg border p-6 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <MaximizeButton panel="location" className="absolute top-4 right-4" />
              <div className="pt-8">
                <GPSAddressForm 
                  onAddressDetected={handleAddressDetected}
                  onAddressSearch={handleAddressSearch}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {maximizedPanel === 'photo' && canEdit && (
        <>
          {/* Backdrop - click to close */}
          <div 
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setMaximizedPanel(null)}
          />
          {/* Content */}
          <div className="fixed inset-0 z-[51] flex items-start justify-center pointer-events-none overflow-y-auto p-4">
            <div 
              className="relative w-full max-w-4xl mt-12 pointer-events-auto bg-background rounded-lg shadow-lg border p-6 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <MaximizeButton panel="photo" className="absolute top-4 right-4" />
              <div className="pt-8">
                <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
              </div>
            </div>
          </div>
        </>
      )}

      {maximizedPanel === 'overlays' && photoImageSrc && ocrResult?.fullVisionResponse && (
        <>
          {/* Backdrop - click to close */}
          <div 
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setMaximizedPanel(null)}
          />
          {/* Content - with pinch-to-zoom support */}
          <div className="fixed inset-0 z-[51] flex items-start justify-center pointer-events-none overflow-y-auto p-4">
            <div 
              className="relative w-full max-w-6xl mt-12 pointer-events-auto bg-background rounded-lg shadow-lg border p-6 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <MaximizeButton panel="overlays" className="absolute top-4 right-4" />
              <div className="pt-8 maximized-image-container">
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
          </div>
        </>
      )}

      {maximizedPanel === 'results' && (
        <>
          {/* Backdrop - click to close */}
          <div 
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setMaximizedPanel(null)}
          />
          {/* Content */}
          <div className="fixed inset-0 z-[51] flex items-start justify-center pointer-events-none overflow-y-auto p-4">
            <div 
              className="relative w-full max-w-4xl mt-12 pointer-events-auto bg-background rounded-lg shadow-lg border p-6 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <MaximizeButton panel="results" className="absolute top-4 right-4" />
              <div className="pt-8">
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
          </div>
        </>
      )}

      {/* Dataset Creation Confirmation Dialog */}
      {address && (
        <DataStorageConfirmation
          isOpen={showDataStorageConfirmation}
          onConfirm={confirmDatasetCreation}
          onCancel={cancelDatasetCreation}
          address={address}
        />
      )}
    </div>
  );
}
