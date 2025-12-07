import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import GPSAddressForm, { type Address } from '@/components/GPSAddressForm';
import PhotoCapture from '@/components/PhotoCapture';
import ResultsDisplay, { type OCRResult } from '@/components/ResultsDisplay';

// Interface for multi-photo support
interface PhotoData {
  id: string;
  imageSrc: string;
  fullVisionResponse: any;
  residentNames: string[];
  existingCustomers: any[];
  newProspects: string[];
  allCustomersAtAddress?: any[];
}

const MAX_PHOTOS = 10; // Limit to prevent misuse
import { UserButton } from '@/components/UserButton';
import { expandHouseNumberRange } from '@/utils/addressUtils';
import { ClickableAddressHeader } from '@/components/ClickableAddressHeader';
import { AddressDatasets } from '@/components/AddressDatasets';
import { AddressOverview } from '@/components/AddressOverview';
import { MaximizeButton } from '@/components/MaximizeButton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RotateCcw, ArrowRight, ArrowLeft, X, Info, Navigation, Plus, Camera, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

/**
 * ✅ UTILITY: Sanitize single resident before saving
 * Existing customers should NOT have status set
 */
const sanitizeResident = (resident: any): any => {
  if (resident.category === 'existing_customer' && resident.status) {
    console.warn(`[sanitizeResident] ⚠️ Clearing status "${resident.status}" for existing_customer:`, resident.name);
    return {
      ...resident,
      status: undefined
    };
  }
  return resident;
};

/**
 * ✅ UTILITY: Sanitize array of residents
 */
const sanitizeResidents = (residents: any[]): any[] => {
  return residents.map(sanitizeResident);
};

export default function ScannerPage() {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const { viewMode, maximizedPanel, setMaximizedPanel } = useViewMode();
  const { callBackMode } = useUIPreferences();
  const { hasNext, hasPrevious, moveToNext, moveToPrevious, loadedFromCallBack, setLoadedFromCallBack, clearSession } = useCallBackSession();
  const [address, setAddress] = useState<Address | null>(null);
  const [normalizedAddress, setNormalizedAddress] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [photoImageSrc, setPhotoImageSrc] = useState<string | null>(null);

  // Multi-photo support
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [isAddingPhoto, setIsAddingPhoto] = useState(false); // Show PhotoCapture for additional photo
  const [canEdit, setCanEdit] = useState(true);
  const [currentDatasetId, setCurrentDatasetId] = useState<string | null>(null);
  const [datasetCreatedAt, setDatasetCreatedAt] = useState<string | null>(null);
  const [showDatasets, setShowDatasets] = useState(false);
  const [useNormalizedDatasetSearch, setUseNormalizedDatasetSearch] = useState(false); // true when "Adresse durchsuchen" is clicked
  const [editableResidents, setEditableResidents] = useState<any[]>([]);
  const [showCorrectionEffect, setShowCorrectionEffect] = useState(false); // Trigger visual effect for address correction
  // Dataset creation confirmation removed - now creates automatically
  const [showAddressOverview, setShowAddressOverview] = useState(false);
  const [showCallBackModeBanner, setShowCallBackModeBanner] = useState(false);
  const [bannerShownForSession, setBannerShownForSession] = useState(false); // Track if banner was shown for this CallBack session
  const [resetKey, setResetKey] = useState(0); // Key to force PhotoCapture remount on reset
  
  // State for dataset creation lock (prevent race conditions)
  const [isCreatingDataset, setIsCreatingDataset] = useState(false);
  
  // Debounce timer for rapid successive calls
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * ✅ FIX: Handle resident updates from AddressOverview table
   * Updates local state AND persists to database via API
   */
  const handleResidentUpdate = useCallback(async (updatedResidents: any[]) => {
    console.log('[handleResidentUpdate] Saving resident changes to database...');
    
    // Update local state immediately for responsive UI
    setEditableResidents(updatedResidents);
    
    // Persist to database
    if (currentDatasetId) {
      try {
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));
        console.log('[handleResidentUpdate] ✅ Residents saved successfully');
      } catch (error) {
        console.error('[handleResidentUpdate] ❌ Failed to save residents:', error);
        toast({
          title: t('error.saveFailed', 'Save failed'),
          description: t('error.saveFailedDesc', 'Could not save resident changes'),
          variant: 'destructive',
        });
      }
    } else {
      console.warn('[handleResidentUpdate] ⚠️ No currentDatasetId - skipping API save');
    }
  }, [currentDatasetId, toast, t]);

  // Memory Optimization: Listen for dataset creation and cleanup photo state
  // REMOVED: This caused the result lists and photo to disappear after dataset creation
  // The user wants to keep seeing the results/photo after creating the dataset
  /*
  useEffect(() => {
    const handleDatasetCreatedCleanup = () => {
      console.log('[Scanner] Dataset created - performing memory cleanup');
      setPhotoImageSrc(null); // Force garbage collection of large Base64 image
      setOcrResult(null); // Also clear OCR result to free memory
    };

    window.addEventListener('dataset-created-cleanup', handleDatasetCreatedCleanup);

    return () => {
      window.removeEventListener('dataset-created-cleanup', handleDatasetCreatedCleanup);
    };
  }, []);
  */

  // Auto-reset when address changes to a different normalized address
  useEffect(() => {
    const newNormalizedAddress = createNormalizedAddressString(address);
    
    // FIX: Hide datasets section when address is cleared
    if (!newNormalizedAddress) {
      console.log('[Address Cleared] Hiding datasets section');
      setShowDatasets(false);
      setNormalizedAddress(null);
      return;
    }
    
    // Check if we have a dataset loaded and the address has changed
    if (currentDatasetId && normalizedAddress && newNormalizedAddress) {
      if (normalizedAddress !== newNormalizedAddress) {
        console.log('[Address Change Detected] Old:', normalizedAddress, '→ New:', newNormalizedAddress);
        console.log('[Address Change] Resetting dataset and clearing state');
        
        // Clear all dataset-related state (Memory Optimization)
        setCurrentDatasetId(null);
        setDatasetCreatedAt(null);
        setEditableResidents([]);
        setOcrResult(null);
        setPhotoImageSrc(null); // ← Important for memory
        setCanEdit(true);
        
        // FIX: Hide datasets section when address changes
        setShowDatasets(false);
        
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
      
      // Clear CallBack session if NOT loaded from CallBack (e.g., from history)
      if (!fromCallBack) {
        clearSession();
        setBannerShownForSession(false); // Reset banner tracking
      }
      
      // Show Call Back Mode banner ONLY if:
      // 1. Loaded from Call Back List
      // 2. Call Back mode is not active
      // 3. Banner hasn't been shown yet in this session
      if (fromCallBack && !callBackMode && !bannerShownForSession) {
        setShowCallBackModeBanner(true);
        setBannerShownForSession(true);
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
      setShowDatasets(true); // Keep datasets visible
      setUseNormalizedDatasetSearch(false); // Use local search when loading a dataset
      
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
    // DEBOUNCE: Clear existing timer on rapid calls (300ms window)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Wait 300ms before proceeding (debounce window)
    return new Promise((resolve) => {
      debounceTimerRef.current = setTimeout(async () => {
        debounceTimerRef.current = null;

    // LOCK: Prevent concurrent calls (Race Condition Protection)
    if (isCreatingDataset) {
      console.log('[handleRequestDatasetCreation] 🔒 Already creating dataset, ignoring duplicate call');
      resolve(null);
      return;
    }

    // If dataset already exists, return it
    if (currentDatasetId) {
      resolve(currentDatasetId);
      return;
    }

    // Set lock before starting async operations
    setIsCreatingDataset(true);

    // Automatically create dataset without confirmation dialog
    try {
      if (!address) {
        console.error('[handleRequestDatasetCreation] No address available');
        toast({
          variant: 'destructive',
          title: t('dataset.createError', 'Fehler beim Erstellen'),
          description: t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
        });
        setIsCreatingDataset(false); // Release lock
        resolve(null);
        return;
      }

      // Validate required address fields before making API call
      if (!address.street || !address.number || !address.postal) {
        console.error('[handleRequestDatasetCreation] Incomplete address:', address);
        toast({
          variant: 'destructive',
          title: t('error.incompleteAddress', 'Unvollständige Adresse'),
          description: t('error.incompleteAddressDesc', 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'),
        });
        setIsCreatingDataset(false); // Release lock
        resolve(null);
        return;
      }

      console.log('[handleRequestDatasetCreation] Creating dataset for address:', address);
      
      // Process address with house number range expansion if needed
      let processedNumber = address.number;
      if (address.number.includes('-')) {
        const expanded = expandHouseNumberRange(
          address.number,
          address.onlyEven || false,
          address.onlyOdd || false
        );
        // Join expanded numbers with comma for backend processing
        processedNumber = expanded.join(',');
      }
      
      const dataset = await datasetAPI.createDataset({
        address: {
          street: address.street,
          number: processedNumber,
          city: address.city,
          postal: address.postal,
        },
        editableResidents: editableResidents,
        rawResidentData: ocrResult?.residentNames || [],
      });

      console.log('[handleRequestDatasetCreation] Dataset created:', dataset.id);
      
      // Update address state if backend returned a normalized/corrected address
      if (dataset.normalizedAddress) {
        const { street, number, city, postal } = dataset.normalizedAddress;
        console.log('[handleRequestDatasetCreation] Updating address with normalized values:', dataset.normalizedAddress);
        
        const newAddress = {
          street,
          number,
          city,
          postal,
          onlyEven: address?.onlyEven,
          onlyOdd: address?.onlyOdd
        };
        
        setAddress(newAddress);
        // FIX: Also update normalizedAddress to prevent auto-reset in useEffect
        // This ensures that when the effect runs, normalizedAddress matches the new address
        setNormalizedAddress(createNormalizedAddressString(newAddress));
      }
      
      // Update state with new dataset ID
      setCurrentDatasetId(dataset.id);
      setDatasetCreatedAt(dataset.createdAt);
      setCanEdit(true);

      toast({
        title: t('dataset.created', 'Datensatz erstellt'),
        description: t('dataset.createdDesc', 'Datensatz wurde erfolgreich erstellt'),
      });

      setIsCreatingDataset(false); // Release lock on success
      resolve(dataset.id);
    } catch (error: any) {
      console.error('[handleRequestDatasetCreation] Error creating dataset:', error);
      
      // Check if it's a 409 conflict
      if (error?.response?.status === 409) {
        const errorData = error.response?.data || {};
        const errorType = errorData.error;
        
        // SPECIAL CASE: Race condition lock - another request is already creating the dataset
        // This is expected behavior, not an error! Just silently wait and retry after a moment
        if (errorType === 'Dataset creation already in progress') {
          console.log('[handleRequestDatasetCreation] ⏳ Race condition detected - another request is creating the dataset, will retry...');
          
          // Release lock and retry after a short delay (backend lock timeout is 10s)
          setIsCreatingDataset(false);
          
          // Retry after 500ms (give the first request time to complete)
          setTimeout(() => {
            console.log('[handleRequestDatasetCreation] 🔄 Retrying dataset creation after race condition...');
            handleRequestDatasetCreation().then(resolve);
          }, 500);
          return; // Don't show error toast or resolve yet
        }
        
        // NORMAL CASE: Dataset already exists (created earlier, within 30 days)
        const errorMessage = errorData.message || 'Ein Datensatz für diese Adresse existiert bereits heute.';
        const isOwnDataset = errorData.isOwnDataset;
        
        toast({
          variant: 'destructive',
          title: isOwnDataset 
            ? t('dataset.alreadyExistsOwn', 'Datensatz bereits vorhanden')
            : t('dataset.alreadyExistsOther', 'Datensatz bereits erstellt'),
          description: errorMessage,
          duration: 8000,
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('dataset.createError', 'Fehler beim Erstellen'),
          description: error.message || t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
        });
      }
      
      // CRITICAL: Always release lock in catch block (prevents deadlock)
      setIsCreatingDataset(false);
      resolve(null);
    }
      }, 300); // 300ms debounce
    });
  };

  // confirmDatasetCreation and cancelDatasetCreation removed - dataset creation is now automatic

  const handlePhotoProcessed = (result: any, imageSrc?: string) => {
    console.log('OCR result:', result);

    if (result.residentNames !== undefined) {
      // Create new photo data
      const newPhoto: PhotoData = {
        id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        imageSrc: imageSrc || '',
        fullVisionResponse: result.fullVisionResponse,
        residentNames: result.residentNames || [],
        existingCustomers: result.existingCustomers || [],
        newProspects: result.newProspects || [],
        allCustomersAtAddress: result.allCustomersAtAddress || [],
      };

      // Add photo to array
      setPhotos(prevPhotos => {
        const updatedPhotos = [...prevPhotos, newPhoto];
        console.log('[handlePhotoProcessed] Updated photos array:', updatedPhotos.length);
        return updatedPhotos;
      });

      // Combine OCR results from all photos (including the new one)
      setOcrResult(prevResult => {
        // Combine with previous results if they exist
        const combinedResidentNames = [
          ...(prevResult?.residentNames || []),
          ...(result.residentNames || [])
        ];
        const combinedExistingCustomers = [
          ...(prevResult?.existingCustomers || []),
          ...(result.existingCustomers || [])
        ];
        const combinedNewProspects = [
          ...(prevResult?.newProspects || []),
          ...(result.newProspects || [])
        ];
        // allCustomersAtAddress should stay the same (comes from address search)
        const allCustomersAtAddress = result.allCustomersAtAddress || prevResult?.allCustomersAtAddress || [];

        // Remove duplicates by name (case-insensitive)
        const uniqueResidentNames = [...new Set(combinedResidentNames.map(n => n.toLowerCase()))]
          .map(lower => combinedResidentNames.find(n => n.toLowerCase() === lower)!);
        const uniqueNewProspects = [...new Set(combinedNewProspects.map(n => n.toLowerCase()))]
          .map(lower => combinedNewProspects.find(n => n.toLowerCase() === lower)!);

        // For existing customers, deduplicate by name
        const seenExisting = new Set<string>();
        const uniqueExistingCustomers = combinedExistingCustomers.filter(c => {
          const key = c.name.toLowerCase();
          if (seenExisting.has(key)) return false;
          seenExisting.add(key);
          return true;
        });

        return {
          residentNames: uniqueResidentNames,
          existingCustomers: uniqueExistingCustomers,
          newProspects: uniqueNewProspects,
          allCustomersAtAddress,
          fullVisionResponse: result.fullVisionResponse, // Latest photo's response
          relatedHouseNumbers: result.relatedHouseNumbers || prevResult?.relatedHouseNumbers || [],
        };
      });

      // Keep first photo's imageSrc for backward compatibility
      if (imageSrc && !photoImageSrc) {
        setPhotoImageSrc(imageSrc);
      }

      // Reset the "adding photo" state
      setIsAddingPhoto(false);
      setShowDatasets(true); // Show datasets after photo upload
      
      // Force re-render of PhotoCapture component by updating key
      setResetKey(prev => prev + 1);

      // FIX: If we have an active dataset or existing editable residents, merge new findings immediately
      // This ensures that subsequent photos add to the list even if a dataset is already created
      if (currentDatasetId || editableResidents.length > 0) {
        console.log('[handlePhotoProcessed] Merging new photo results into existing editable residents');
        
        const newResidents: any[] = [];
        
        // Helper to check existence (case-insensitive)
        const exists = (name: string) => editableResidents.some(r => r.name.toLowerCase() === name.toLowerCase());

        // Add new prospects
        result.newProspects?.forEach((name: string) => {
          if (!exists(name)) {
            newResidents.push({
              name,
              category: 'potential_new_customer',
              isFixed: false,
              originalName: name, // Store original name
              originalCategory: 'potential_new_customer'
            });
          }
        });

        // Add new existing customers
        result.existingCustomers?.forEach((customer: any) => {
           if (!exists(customer.name)) {
             newResidents.push({
               name: customer.name,
               category: 'existing_customer',
               isFixed: false,
               originalName: customer.name, // Store original name
               originalCategory: 'existing_customer'
             });
           }
        });

        if (newResidents.length > 0) {
           console.log(`[handlePhotoProcessed] Adding ${newResidents.length} new residents to list`);
           const updatedResidents = [...editableResidents, ...newResidents];
           setEditableResidents(updatedResidents);
           
           // If dataset exists, save to backend immediately
           if (currentDatasetId) {
              console.log('[handlePhotoProcessed] Saving merged residents to backend');
              datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents))
                .catch(err => console.error('[handlePhotoProcessed] Failed to save merged residents:', err));
           }
        }
      }
    }
  };

  const handleAddressDetected = useCallback((detectedAddress: Address) => {
    console.log('Address detected:', detectedAddress);
    setAddress(detectedAddress);
    setShowDatasets(true); // Show datasets to trigger local search
    setUseNormalizedDatasetSearch(false); // Use local search (no API) for +/- buttons
  }, []);

  const handleOpenNavigation = useCallback(() => {
    if (!address) {
      toast({
        variant: "destructive",
        title: "Keine Adresse",
        description: "Es ist keine Adresse geladen",
      });
      return;
    }

    // Create address string for navigation
    const addressString = `${address.street} ${address.number}, ${address.postal} ${address.city}`;
    
    // Try Apple Maps first (iOS), then fallback to Google Maps
    const appleMapsUrl = `maps://maps.apple.com/?address=${encodeURIComponent(addressString)}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressString)}`;
    
    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    if (isIOS) {
      // Try Apple Maps first
      window.location.href = appleMapsUrl;
      // Fallback to Google Maps after a short delay if Apple Maps didn't open
      setTimeout(() => {
        window.open(googleMapsUrl, '_blank');
      }, 500);
    } else {
      // For Android and desktop, use Google Maps
      window.open(googleMapsUrl, '_blank');
    }
  }, [address, toast]);

  const handleAddressSearch = useCallback((customers: any[], historicalProspects?: any[]) => {
    console.log('Address search result:', customers, 'Historical prospects:', historicalProspects?.length || 0);

    // Clear any existing photos from previous queries
    setPhotos([]);
    setPhotoImageSrc(null);
    setEditableResidents([]);
    setCurrentDatasetId(null);
    setDatasetCreatedAt(null);

    // Show results as existing customers
    // Also set allCustomersAtAddress to show the "All Customers at Address" section
    setOcrResult({
      residentNames: [],
      existingCustomers: customers,
      newProspects: [],
      allCustomersAtAddress: customers, // Include all customers to show in dedicated section
      historicalProspects: historicalProspects || [], // Neukunden vom letzten Besuch
    });
    setShowDatasets(true); // Show datasets after address search
    setUseNormalizedDatasetSearch(true); // Use normalized search (with API call) for "Adresse durchsuchen"
  }, []);

  const handleAddressCorrected = useCallback((correctedAddress: Address) => {
    console.log('[Scanner] Address corrected by backend:', correctedAddress);
    
    // Check if street was actually corrected (different from current)
    if (address && address.street !== correctedAddress.street && address.street.trim() !== '' && correctedAddress.street.trim() !== '') {
      console.log('[Scanner] Street corrected:', address.street, '→', correctedAddress.street);
      
      // Trigger visual effect
      setShowCorrectionEffect(true);
      setTimeout(() => setShowCorrectionEffect(false), 100); // Reset quickly to allow retriggering
      
      // Show toast notification with correction details
      toast({
        title: '✨ Adresse korrigiert',
        description: `Straßenname wurde von "${address.street}" zu "${correctedAddress.street}" korrigiert`,
        category: 'system',
        duration: 4000,
      });
    }
    
    setAddress(correctedAddress);
  }, [address, toast]);

  // Helper function to remove a photo and recalculate combined results
  const handleRemovePhoto = useCallback(async (photoId: string, photoIndex: number) => {
    const remainingPhotos = photos.filter(p => p.id !== photoId);

    // Update photos state
    setPhotos(remainingPhotos);

    if (remainingPhotos.length === 0) {
      // All photos removed - reset related state
      setOcrResult(null);
      setPhotoImageSrc(null);
      setEditableResidents([]);
      
      // Also clear dataset residents if dataset exists
      if (currentDatasetId) {
        try {
          await datasetAPI.bulkUpdateResidents(currentDatasetId, []);
        } catch (error) {
          console.error('Error clearing dataset residents:', error);
        }
      }

      toast({
        title: 'Foto entfernt',
        description: 'Alle Fotos wurden entfernt',
      });
    } else {
      // Recalculate ocrResult from remaining photos
      const combinedResidentNames = remainingPhotos.flatMap(p => p.residentNames);
      const combinedExistingCustomers = remainingPhotos.flatMap(p => p.existingCustomers);
      const combinedNewProspects = remainingPhotos.flatMap(p => p.newProspects);

      // Deduplicate
      const uniqueResidentNames = [...new Set(combinedResidentNames.map(n => n.toLowerCase()))]
        .map(lower => combinedResidentNames.find(n => n.toLowerCase() === lower)!);
      const uniqueNewProspects = [...new Set(combinedNewProspects.map(n => n.toLowerCase()))]
        .map(lower => combinedNewProspects.find(n => n.toLowerCase() === lower)!);
      const seenExisting = new Set<string>();
      const uniqueExistingCustomers = combinedExistingCustomers.filter(c => {
        const key = c.name.toLowerCase();
        if (seenExisting.has(key)) return false;
        seenExisting.add(key);
        return true;
      });

      setOcrResult(prev => prev ? {
        ...prev,
        residentNames: uniqueResidentNames,
        existingCustomers: uniqueExistingCustomers,
        newProspects: uniqueNewProspects,
        fullVisionResponse: remainingPhotos[remainingPhotos.length - 1]?.fullVisionResponse,
      } : null);

      // Update photoImageSrc to first remaining photo
      setPhotoImageSrc(remainingPhotos[0]?.imageSrc || null);

      // Filter editableResidents to remove those that were only in the deleted photo
      const validNamesSet = new Set(combinedResidentNames.map(n => n.toLowerCase()));
      
      const filteredResidents = editableResidents.filter(resident => {
        // Keep manually added residents (no originalName)
        if (!resident.originalName) return true;
        
        // Keep if name matches any remaining resident
        if (validNamesSet.has(resident.name.toLowerCase())) return true;
        
        // Keep if originalName matches any remaining resident
        if (validNamesSet.has(resident.originalName.toLowerCase())) return true;
        
        return false;
      });
      
      setEditableResidents(filteredResidents);
      
      // Sync with backend if dataset exists
      if (currentDatasetId) {
         try {
            await datasetAPI.bulkUpdateResidents(currentDatasetId, filteredResidents);
         } catch (error) {
            console.error('Error syncing filtered residents:', error);
         }
      }

      toast({
        title: 'Foto entfernt',
        description: `Foto ${photoIndex + 1} wurde entfernt`,
      });
    }
  }, [photos, toast, editableResidents, currentDatasetId]);

  const handleReset = () => {
    // Reset all state to initial values
    setOcrResult(null);
    setPhotoImageSrc(null);
    setPhotos([]); // Clear all photos
    setIsAddingPhoto(false); // Reset adding photo state
    setAddress(null); // This triggers GPSAddressForm to clear via initialAddress prop
    setNormalizedAddress(null);
    setCanEdit(true);
    setDatasetCreatedAt(null);
    setCurrentDatasetId(null);
    setEditableResidents([]);
    setShowDatasets(false);
    setUseNormalizedDatasetSearch(false); // Reset to local search
    setShowCorrectionEffect(false); // Reset correction effect
    setShowCallBackModeBanner(false);
    setResetKey(prev => prev + 1); // Increment key to force PhotoCapture remount

    // Log for debugging
    console.log('[Reset] All state cleared, page reset to initial state');
  };

  const handleNextCallBack = async () => {
    const nextDatasetId = moveToNext();
    if (nextDatasetId) {
      // Keep loadedFromCallBack true to maintain navigation buttons
      await handleDatasetLoadById(nextDatasetId, true); // Pass true to indicate it's from CallBack
    }
  };

  const handlePreviousCallBack = async () => {
    const prevDatasetId = moveToPrevious();
    if (prevDatasetId) {
      // Keep loadedFromCallBack true to maintain navigation buttons
      await handleDatasetLoadById(prevDatasetId, true); // Pass true to indicate it's from CallBack
    }
  };

  const handleNamesUpdated = async (updatedNames: string[], photoId?: string) => {
    if (!address) return;

    try {
      // 1. Update the specific photo in the photos array if photoId is provided
      let currentPhotos = photos;
      if (photoId) {
        currentPhotos = photos.map(p => 
          p.id === photoId 
            ? { ...p, residentNames: updatedNames }
            : p
        );
        setPhotos(currentPhotos);
      }

      // 2. Determine the full list of names to send to OCR API
      let namesToProcess = updatedNames;
      
      // If we have multiple photos and this update came from one of them,
      // we need to combine names from ALL photos to preserve data from other photos
      if (photoId && currentPhotos.length > 0) {
         namesToProcess = currentPhotos.flatMap(p => p.residentNames);
      }

      const result = await ocrAPI.correctOCR(namesToProcess, address);
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
        {/* Dataset Creation Loading Dialog */}
        {isCreatingDataset && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <Card className="w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
              <CardHeader className="relative">
                <CardTitle className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  {t('dataset.creating', 'Datensatz wird erstellt...')}
                </CardTitle>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute right-4 top-4 text-destructive hover:bg-destructive/10"
                  onClick={() => setIsCreatingDataset(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t('dataset.creatingDesc', 'Bitte warten, der Datensatz wird angelegt...')}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        <header className="sticky top-0 z-50 bg-background border-b safe-area-top">
          <div className="container mx-auto px-4 py-3 overflow-x-auto header-scroll-container">
            <div className="flex items-center justify-between gap-4 min-w-max">
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <img 
                    src="/icons/icon-192x192.svg" 
                    alt={t('app.title')} 
                    className="w-8 h-8"
                  />
                  <span className="text-xl font-bold whitespace-nowrap sr-only" data-testid="text-app-title">
                    {t('app.title')}
                  </span>
                </div>
                {address && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
                      <span className="text-sm font-medium">
                        {address.street} {address.number}, {address.postal} {address.city}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenNavigation}
                      className="gap-2"
                      title="Navigation öffnen"
                    >
                      <Navigation className="h-4 w-4" />
                      <span className="hidden sm:inline">Navigation</span>
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <UserButton onDatasetLoad={handleDatasetLoad} />
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-4">
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
              onResidentUpdate={handleResidentUpdate}
              currentDatasetId={currentDatasetId}
            />
          </div>
        </main>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
          <div className="container mx-auto">
            <div className="flex flex-col gap-2">
              {/* Navigation buttons row - only show when loaded from CallBack list */}
              {loadedFromCallBack && (hasPrevious() || hasNext()) && (
                <div className="flex gap-2">
                  {hasPrevious() && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handlePreviousCallBack}
                      className="flex-1 min-h-12 gap-2"
                      data-testid="button-previous-callback"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Vorheriger
                    </Button>
                  )}
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
              )}
              {/* Reset button row */}
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
        </div>

        {/* Dataset Creation Confirmation Dialog removed - now creates automatically */}
      </div>
    );
  }

  // Normal Mode
  return (
    <div className="min-h-screen bg-background">
      {/* Dataset Creation Loading Dialog */}
      {isCreatingDataset && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="relative">
              <CardTitle className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                {t('dataset.creating', 'Datensatz wird erstellt...')}
              </CardTitle>
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute right-4 top-4 text-destructive hover:bg-destructive/10"
                onClick={() => setIsCreatingDataset(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t('dataset.creatingDesc', 'Bitte warten, der Datensatz wird angelegt...')}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      <header className="sticky top-0 z-50 bg-background border-b safe-area-top">
        <div className="container mx-auto px-4 py-3 overflow-x-auto header-scroll-container">
          <div className="flex items-center justify-between gap-4 min-w-max">
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <img 
                  src="/icons/icon-192x192.svg" 
                  alt={t('app.title')} 
                  className="w-8 h-8"
                />
                <span className="text-xl font-bold whitespace-nowrap sr-only" data-testid="text-app-title">
                  {t('app.title')}
                </span>
              </div>
              {address && (
                <>
                  <ClickableAddressHeader 
                    address={address} 
                    residents={editableResidents} 
                    canEdit={canEdit}
                    datasetCreatedAt={datasetCreatedAt}
                    onResidentsUpdate={handleResidentUpdate}
                    currentDatasetId={currentDatasetId}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenNavigation}
                    className="gap-2"
                    title="Navigation öffnen"
                  >
                    <Navigation className="h-4 w-4" />
                    <span className="hidden sm:inline">Navigation</span>
                  </Button>
                </>
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
                initialAddress={address}
                onResetDataset={handleReset}
                showCorrectionEffect={showCorrectionEffect}
              />
            </div>
            
            {address && showDatasets && (
              <AddressDatasets 
                address={address}
                onLoadDataset={handleDatasetLoadById}
                shouldLoad={showDatasets}
                useNormalization={useNormalizedDatasetSearch}
                onAddressCorrected={handleAddressCorrected}
              />
            )}
            
            {/* PhotoCapture - show only when no photos yet (first photo) */}
            {canEdit && photos.length === 0 && (
              <div className="relative">
                <MaximizeButton panel="photo" />
                <PhotoCapture key={resetKey} onPhotoProcessed={handlePhotoProcessed} address={address} />
              </div>
            )}

            {/* Multi-Photo Display: Show all uploaded photos with their overlays */}
            {photos.length > 0 && (
              <div className="space-y-4">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative">
                    {/* Photo header with number and delete button */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        Foto {index + 1} von {photos.length}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemovePhoto(photo.id, index)}
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Entfernen
                        </Button>
                      )}
                    </div>
                    {/* ImageWithOverlays for this specific photo */}
                    {photo.imageSrc && photo.fullVisionResponse && (
                      <div className="relative">
                        <MaximizeButton panel={`overlay-${photo.id}`} className="absolute top-2 right-2 z-10" />
                        <ImageWithOverlays
                          imageSrc={photo.imageSrc}
                          fullVisionResponse={photo.fullVisionResponse}
                          residentNames={photo.residentNames}
                          existingCustomers={photo.existingCustomers}
                          newProspects={photo.newProspects}
                          allCustomersAtAddress={photo.allCustomersAtAddress}
                          address={address}
                          onNamesUpdated={(names) => handleNamesUpdated(names, photo.id)}
                          editableResidents={editableResidents}
                          onResidentsUpdated={setEditableResidents}
                          currentDatasetId={currentDatasetId}
                          onRequestDatasetCreation={handleRequestDatasetCreation}
                        />
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Another Photo Section */}
                {canEdit && photos.length < MAX_PHOTOS && (
                  <>
                    {isAddingPhoto ? (
                      // Inline PhotoCapture when adding another photo
                      <div className="relative border-2 border-dashed border-muted-foreground/25 rounded-lg p-2">
                        <PhotoCapture
                          key={`add-photo-${resetKey}`}
                          onPhotoProcessed={handlePhotoProcessed}
                          address={address}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsAddingPhoto(false)}
                          className="w-full mt-2 text-muted-foreground"
                        >
                          <X className="h-4 w-4 mr-1" />
                          Abbrechen
                        </Button>
                      </div>
                    ) : (
                      // Button to add another photo
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setIsAddingPhoto(true)}
                        className="w-full min-h-12 gap-2 border-dashed"
                      >
                        <Plus className="h-5 w-5" />
                        Weiteres Foto hinzufügen
                      </Button>
                    )}
                  </>
                )}

                {/* Info when max photos reached */}
                {photos.length >= MAX_PHOTOS && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Maximale Anzahl an Fotos erreicht ({MAX_PHOTOS})
                  </p>
                )}
              </div>
            )}

            {/* Related House Numbers Hint */}
            {ocrResult?.relatedHouseNumbers && ocrResult.relatedHouseNumbers.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-sm font-medium text-amber-900 mb-1">
                  💡 Hinweis: Weitere Hausnummern-Varianten gefunden
                </p>
                <p className="text-sm text-amber-800 mb-2">
                  Zu <strong>{address?.number}</strong> gibt es auch Kundendaten unter: <strong>{ocrResult.relatedHouseNumbers.join(', ')}</strong>
                </p>
                <p className="text-xs text-amber-700">
                  Falls du nicht alle erwarteten Anwohner findest, schau auch bei diesen Hausnummern-Varianten nach.
                </p>
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
                onRequestDatasetCreation={handleRequestDatasetCreation}
              />
            </div>
          </div>
        ) : (
          // Grid view: two-column layout (ab 700px Breite)
          <div className="grid grid-cols-1 min-[700px]:grid-cols-2 gap-4 h-[calc(100vh-12rem)]">
            {/* Left column: Location, Photo, Overlays - scrollable when content overflows */}
            <div className="flex flex-col gap-4 overflow-y-auto">
              <div className="relative">
                <MaximizeButton panel="location" />
                <GPSAddressForm 
                  onAddressDetected={handleAddressDetected}
                  onAddressSearch={handleAddressSearch}
                  initialAddress={address}
                  onResetDataset={handleReset}
                  showCorrectionEffect={showCorrectionEffect}
                />
              </div>
              
              {address && showDatasets && (
                <AddressDatasets 
                  address={address}
                  onLoadDataset={handleDatasetLoadById}
                  shouldLoad={showDatasets}
                  useNormalization={useNormalizedDatasetSearch}
                  onAddressCorrected={handleAddressCorrected}
                />
              )}
              
              {/* PhotoCapture - show only when no photos yet (first photo) */}
              {canEdit && photos.length === 0 && (
                <div className="relative">
                  <MaximizeButton panel="photo" />
                  <PhotoCapture onPhotoProcessed={handlePhotoProcessed} address={address} />
                </div>
              )}

              {/* Multi-Photo Display: Show all uploaded photos with their overlays */}
              {photos.length > 0 && (
                <div className="space-y-4">
                  {photos.map((photo, index) => (
                    <div key={photo.id} className="relative">
                      {/* Photo header with number and delete button */}
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-sm font-medium text-muted-foreground">
                          Foto {index + 1} von {photos.length}
                        </span>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemovePhoto(photo.id, index)}
                            className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Entfernen
                          </Button>
                        )}
                      </div>
                      {/* ImageWithOverlays for this specific photo */}
                      {photo.imageSrc && photo.fullVisionResponse && (
                        <div className="relative">
                          <MaximizeButton panel={`overlay-${photo.id}`} className="absolute top-2 right-2 z-10" />
                          <ImageWithOverlays
                            imageSrc={photo.imageSrc}
                            fullVisionResponse={photo.fullVisionResponse}
                            residentNames={photo.residentNames}
                            existingCustomers={photo.existingCustomers}
                            newProspects={photo.newProspects}
                            allCustomersAtAddress={photo.allCustomersAtAddress}
                            address={address}
                            onNamesUpdated={(names) => handleNamesUpdated(names, photo.id)}
                            editableResidents={editableResidents}
                            onResidentsUpdated={setEditableResidents}
                            currentDatasetId={currentDatasetId}
                            onRequestDatasetCreation={handleRequestDatasetCreation}
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add Another Photo Section */}
                  {canEdit && photos.length < MAX_PHOTOS && (
                    <>
                      {isAddingPhoto ? (
                        // Inline PhotoCapture when adding another photo
                        <div className="relative border-2 border-dashed border-muted-foreground/25 rounded-lg p-2">
                          <PhotoCapture
                            key={`add-photo-grid-${resetKey}`}
                            onPhotoProcessed={handlePhotoProcessed}
                            address={address}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsAddingPhoto(false)}
                            className="w-full mt-2 text-muted-foreground"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Abbrechen
                          </Button>
                        </div>
                      ) : (
                        // Button to add another photo
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={() => setIsAddingPhoto(true)}
                          className="w-full min-h-12 gap-2 border-dashed"
                        >
                          <Plus className="h-5 w-5" />
                          Weiteres Foto hinzufügen
                        </Button>
                      )}
                    </>
                  )}

                  {/* Info when max photos reached */}
                  {photos.length >= MAX_PHOTOS && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      Maximale Anzahl an Fotos erreicht ({MAX_PHOTOS})
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Related House Numbers Hint */}
            {ocrResult?.relatedHouseNumbers && ocrResult.relatedHouseNumbers.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-sm font-medium text-amber-900 mb-1">
                  💡 Hinweis: Weitere Hausnummern-Varianten gefunden
                </p>
                <p className="text-sm text-amber-800 mb-2">
                  Zu <strong>{address?.number}</strong> gibt es auch Kundendaten unter: <strong>{ocrResult.relatedHouseNumbers.join(', ')}</strong>
                </p>
                <p className="text-xs text-amber-700">
                  Falls du nicht alle erwarteten Anwohner findest, schau auch bei diesen Hausnummern-Varianten nach.
                </p>
              </div>
            )}

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
                onRequestDatasetCreation={handleRequestDatasetCreation}
              />
            </div>
          </div>
        )}
      </main>

      {/* Call Back Mode Banner */}
      {showCallBackModeBanner && loadedFromCallBack && !callBackMode && (
        <div className="fixed top-20 left-0 right-0 z-[60] px-4">
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
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom z-40">
          <div className="container mx-auto">
            <div className="flex flex-col gap-2">
              {/* Navigation buttons row */}
              {(hasPrevious() || hasNext()) && (
                <div className="flex gap-2">
                  {hasPrevious() && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handlePreviousCallBack}
                      className="flex-1 min-h-12 gap-2"
                      data-testid="button-previous-callback"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Vorheriger
                    </Button>
                  )}
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
              )}
              {/* Reset button row */}
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
                  initialAddress={address}
                  onResetDataset={handleReset}
                  showCorrectionEffect={showCorrectionEffect}
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

      {(() => {
        const isOverlayPanel = maximizedPanel === 'overlays' || (typeof maximizedPanel === 'string' && maximizedPanel?.startsWith('overlay-'));
        if (!isOverlayPanel) return null;

        let targetPhoto = null;
        if (maximizedPanel === 'overlays') {
             if (photoImageSrc && ocrResult?.fullVisionResponse) {
                 targetPhoto = {
                     imageSrc: photoImageSrc,
                     fullVisionResponse: ocrResult.fullVisionResponse,
                     residentNames: ocrResult.residentNames,
                     existingCustomers: ocrResult.existingCustomers,
                     newProspects: ocrResult.newProspects,
                     allCustomersAtAddress: ocrResult.allCustomersAtAddress,
                     id: undefined
                 };
             }
        } else if (typeof maximizedPanel === 'string' && maximizedPanel.startsWith('overlay-')) {
            const photoId = maximizedPanel.replace('overlay-', '');
            targetPhoto = photos.find(p => p.id === photoId);
        }

        if (!targetPhoto || !targetPhoto.imageSrc || !targetPhoto.fullVisionResponse) return null;

        return (
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
              <MaximizeButton panel={maximizedPanel} className="absolute top-4 right-4" />
              <div className="pt-8 maximized-image-container">
                <ImageWithOverlays
                  imageSrc={targetPhoto.imageSrc}
                  fullVisionResponse={targetPhoto.fullVisionResponse}
                  residentNames={targetPhoto.residentNames}
                  existingCustomers={targetPhoto.existingCustomers}
                  newProspects={targetPhoto.newProspects}
                  allCustomersAtAddress={targetPhoto.allCustomersAtAddress}
                  address={address}
                  onNamesUpdated={(names) => handleNamesUpdated(names, targetPhoto.id)}
                  editableResidents={editableResidents}
                  onResidentsUpdated={setEditableResidents}
                  currentDatasetId={currentDatasetId}
                  onRequestDatasetCreation={handleRequestDatasetCreation}
                />
              </div>
            </div>
          </div>
        </>
        );
      })()}

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
                {/* Related House Numbers Hint */}
                {ocrResult?.relatedHouseNumbers && ocrResult.relatedHouseNumbers.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                    <p className="text-sm font-medium text-amber-900 mb-1">
                      💡 Hinweis: Weitere Hausnummern-Varianten gefunden
                    </p>
                    <p className="text-sm text-amber-800 mb-2">
                      Zu <strong>{address?.number}</strong> gibt es auch Kundendaten unter: <strong>{ocrResult.relatedHouseNumbers.join(', ')}</strong>
                    </p>
                    <p className="text-xs text-amber-700">
                      Falls du nicht alle erwarteten Anwohner findest, schau auch bei diesen Hausnummern-Varianten nach.
                    </p>
                  </div>
                )}
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
                  onRequestDatasetCreation={handleRequestDatasetCreation}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Dataset Creation Confirmation Dialog removed - now creates automatically */}
    </div>
  );
}
