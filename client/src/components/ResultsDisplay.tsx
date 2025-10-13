import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { User, AlertCircle, UserCheck, UserPlus, Edit, Trash2, X } from 'lucide-react';
import ImageWithOverlays from './ImageWithOverlays';
import { ResidentEditPopup } from './ResidentEditPopup';
import { DataStorageConfirmation } from './DataStorageConfirmation';
import { ClickableAddressHeader } from './ClickableAddressHeader';
import { MaximizeButton } from './MaximizeButton';
import { useToast } from '@/hooks/use-toast';
import { datasetAPI } from '@/services/api';
import type { Address } from '@/components/GPSAddressForm';
import type { 
  EditableResident, 
  ResidentCategory,
  AddressDataset 
} from '@/../../shared/schema';

export interface Customer {
  id?: string;
  name: string;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  isExisting: boolean;
}

export interface OCRResult {
  residentNames: string[];
  existingCustomers: Customer[];
  newProspects: string[];
  allCustomersAtAddress?: Customer[];
  fullVisionResponse?: any;
}

interface ResultsDisplayProps {
  result?: OCRResult | null;
  photoImageSrc?: string | null;
  address?: Address | null;
  onNamesUpdated?: (updatedNames: string[]) => void;
  onResidentsUpdated?: (residents: EditableResident[]) => void;
  canEdit?: boolean; // Whether the current dataset can be edited
  currentDatasetId?: string | null; // ID of currently loaded dataset
  onDatasetIdChange?: (id: string | null) => void; // Callback when dataset ID changes
  onDatasetCreatedAtChange?: (createdAt: string | null) => void; // Callback when dataset creation date changes
  initialResidents?: EditableResident[]; // Initial residents when loading an existing dataset
  hideImageOverlays?: boolean; // Hide ImageWithOverlays component (for Grid-View where it's shown in left column)
}

export default function ResultsDisplay({ 
  result, 
  photoImageSrc, 
  address, 
  onNamesUpdated, 
  onResidentsUpdated,
  canEdit = true,
  currentDatasetId: externalDatasetId = null,
  onDatasetIdChange,
  onDatasetCreatedAtChange,
  initialResidents = [],
  hideImageOverlays = false
}: ResultsDisplayProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  // State for editable residents
  const [editableResidents, setEditableResidentsInternal] = useState<EditableResident[]>([]);
  const [fixedCustomers, setFixedCustomers] = useState<EditableResident[]>([]);
  const [currentDatasetId, setCurrentDatasetIdInternal] = useState<string | null>(null);
  
  // Sync external dataset ID with internal state
  const setCurrentDatasetId = (id: string | null) => {
    setCurrentDatasetIdInternal(id);
    onDatasetIdChange?.(id);
  };
  
  // Sync external dataset ID to internal state
  if (externalDatasetId !== currentDatasetId) {
    setCurrentDatasetIdInternal(externalDatasetId);
  }
  
  // Wrapper to update both internal state and parent
  const setEditableResidents = (residents: EditableResident[] | ((prev: EditableResident[]) => EditableResident[])) => {
    if (typeof residents === 'function') {
      setEditableResidentsInternal(prev => {
        const newResidents = residents(prev);
        onResidentsUpdated?.(newResidents);
        return newResidents;
      });
    } else {
      setEditableResidentsInternal(residents);
      onResidentsUpdated?.(residents);
    }
  };
  
  // State for real-time search
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Accordion state: automatically expand all when searching
  const accordionValue = searchQuery.trim() 
    ? ["allCustomers", "duplicates", "prospects", "existing", "addressProspects"] 
    : undefined; // undefined = use internal accordion state (user can collapse/expand)
  
  // State for editing
  const [showEditPopup, setShowEditPopup] = useState(false);
  const [editingResident, setEditingResident] = useState<EditableResident | null>(null);
  const [editingResidentIndex, setEditingResidentIndex] = useState<number | null>(null);
  
  // State for data storage confirmation
  const [showDataStorageConfirmation, setShowDataStorageConfirmation] = useState(false);
  
  // State for delete confirmation
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletingResident, setDeletingResident] = useState<{ name: string; index: number } | null>(null);

  // Initialize editable residents from OCR result or initialResidents
  useEffect(() => {
    console.log('[ResultsDisplay useEffect] Triggered with:', {
      hasResult: !!result,
      initialResidentsCount: initialResidents?.length || 0,
      externalDatasetId,
      canEdit,
    });
    
    // Priority 1: If we have a loaded dataset with initialResidents, use them
    if (externalDatasetId && initialResidents !== undefined) {
      console.log('[ResultsDisplay useEffect] Using initialResidents from loaded dataset:', {
        count: initialResidents.length,
        datasetId: externalDatasetId,
        canEdit,
      });
      
      // Only update if residents actually changed (prevent infinite loops)
      setEditableResidentsInternal(prev => {
        if (JSON.stringify(prev) === JSON.stringify(initialResidents)) {
          return prev; // No change, return same reference
        }
        onResidentsUpdated?.(initialResidents);
        return initialResidents;
      });
      
      // Create fixed customers from result if available
      if (result?.allCustomersAtAddress) {
        const fixedFromAll: EditableResident[] = result.allCustomersAtAddress.map(customer => ({
          name: customer.name,
          category: 'existing_customer' as ResidentCategory,
          isFixed: true,
        }));
        setFixedCustomers(fixedFromAll);
      } else {
        setFixedCustomers([]);
      }
      
      return;
    }
    
    // Priority 2: No result = clear everything
    if (!result) {
      console.log('[ResultsDisplay useEffect] No result, clearing residents');
      // Only clear if not already empty (prevent infinite loops)
      setEditableResidentsInternal(prev => {
        if (prev.length === 0) return prev;
        onResidentsUpdated?.([]);
        return [];
      });
      setFixedCustomers([]);
      // Only reset dataset ID if we don't have an external one
      if (!externalDatasetId) {
        setCurrentDatasetId(null);
      }
      return;
    }

    // Priority 3: New OCR result = create residents from OCR data
    console.log('[ResultsDisplay useEffect] Creating residents from OCR result');
    
    // Create editable residents from new prospects
    const prospects: EditableResident[] = result.newProspects.map(name => ({
      name,
      category: 'potential_new_customer' as ResidentCategory,
      isFixed: false,
    }));

    // Create editable residents from existing customers (these can be edited)
    const editableExisting: EditableResident[] = result.existingCustomers.map(customer => ({
      name: customer.name,
      category: 'existing_customer' as ResidentCategory,
      isFixed: false, // Make them editable
    }));

    // Create fixed customers from allCustomersAtAddress (these are read-only)
    const fixedFromAll: EditableResident[] = result.allCustomersAtAddress?.map(customer => ({
      name: customer.name,
      category: 'existing_customer' as ResidentCategory,
      isFixed: true,
    })) || [];

    console.log('[ResultsDisplay useEffect] Setting residents from OCR result:', {
      prospects: prospects.length,
      editableExisting: editableExisting.length,
      fixed: fixedFromAll.length,
    });

    const allResidents = [...prospects, ...editableExisting];
    
    // Only update if residents actually changed (prevent infinite loops)
    setEditableResidentsInternal(prev => {
      if (JSON.stringify(prev) === JSON.stringify(allResidents)) {
        return prev; // No change, return same reference
      }
      onResidentsUpdated?.(allResidents);
      return allResidents;
    });
    
    setFixedCustomers(fixedFromAll);
    
    // Only reset dataset ID if we don't have an external one
    if (!externalDatasetId) {
      setCurrentDatasetId(null);
    }
  }, [result, externalDatasetId, initialResidents, canEdit]); // onResidentsUpdated intentionally excluded to prevent infinite loops

  // Handle editing a resident from the list
  const handleEditResidentFromList = async (residentName: string, category: ResidentCategory) => {
    console.log('[handleEditResidentFromList] 📝 Editing resident:', residentName, 'category:', category);
    const residentIndex = editableResidents.findIndex(
      r => r.name === residentName && r.category === category
    );
    
    if (residentIndex === -1) {
      console.log('[handleEditResidentFromList] ❌ Resident not found!');
      return;
    }
    
    const resident = editableResidents[residentIndex];
    
    // If no dataset exists yet, request dataset creation first
    if (!currentDatasetId) {
      const createdDatasetId = await handleRequestDatasetCreation();
      if (!createdDatasetId) {
        // User cancelled or creation failed
        return;
      }
    }
    
    // Dataset exists, open edit popup directly
    setEditingResident(resident);
    setEditingResidentIndex(residentIndex);
    setShowEditPopup(true);
  };

  // Request dataset creation with confirmation and loading state
  const handleRequestDatasetCreation = async (): Promise<string | null> => {
    // If dataset already exists, return it
    if (currentDatasetId) {
      return currentDatasetId;
    }
    
    // Show confirmation dialog and wait for user response
    return new Promise((resolve) => {
      // Set a flag to indicate we're in dataset creation mode
      const confirmDatasetCreation = async () => {
        setShowDataStorageConfirmation(false);
        
        try {
          if (!address) {
            toast({
              variant: "destructive",
              title: t('dataset.createError', 'Error creating'),
              description: t('dataset.createErrorDesc', 'Dataset could not be created'),
            });
            resolve(null);
            return;
          }

          // Check if we're updating an existing editable dataset
          if (currentDatasetId && canEdit) {
            console.log('[confirmDatasetCreation] Updating existing dataset:', currentDatasetId);
            await datasetAPI.bulkUpdateResidents(currentDatasetId, editableResidents);
            
            toast({
              title: t('dataset.updated', 'Dataset updated'),
              description: t('dataset.updatedDesc', 'Dataset was updated successfully'),
            });
            
            resolve(currentDatasetId);
            return;
          }

          // Create dataset with 15 second timeout
          const timeoutPromise = new Promise<AddressDataset | null>((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT_ERROR')), 15000)
          );
          
          const datasetPromise = datasetAPI.createDataset({
            address: {
              street: address.street,
              number: address.number,
              city: address.city,
              postal: address.postal,
            },
            editableResidents: editableResidents,
            rawResidentData: result?.residentNames || [],
          });

          let newDataset: AddressDataset | null = null;
          try {
            newDataset = await Promise.race([datasetPromise, timeoutPromise]);
          } catch (raceError: any) {
            // Check if it's actually a timeout or another error
            if (raceError.message === 'TIMEOUT_ERROR') {
              // Real timeout occurred
              toast({
                variant: "destructive",
                title: t('dataset.timeout', 'Timeout'),
                description: t('dataset.timeoutDesc', 'Dataset creation took too long. Please try again.'),
              });
              setShowDataStorageConfirmation(true);
              resolve(null);
              return;
            }
            
            // Not a timeout, it's another error - handle it below
            throw raceError;
          }
          
          if (!newDataset) throw new Error('Dataset creation failed');

          setCurrentDatasetId(newDataset.id);
          onDatasetCreatedAtChange?.(newDataset.createdAt.toString());
          
          toast({
            title: t('dataset.created', 'Dataset created'),
            description: t('dataset.createdDesc', 'New dataset was created successfully'),
          });

          resolve(newDataset.id);
        } catch (error: any) {
          console.error('Error creating dataset:', error);
          
          // Check if it's a 409 conflict (dataset already exists)
          if (error?.response?.status === 409) {
            const errorData = error.response?.data || {};
            const errorMessage = errorData.message || 'Ein Datensatz für diese Adresse existiert bereits heute.';
            const isOwnDataset = errorData.isOwnDataset;
            
            toast({
              variant: "destructive",
              title: isOwnDataset 
                ? t('dataset.alreadyExistsOwn', 'Datensatz bereits vorhanden')
                : t('dataset.alreadyExistsOther', 'Datensatz bereits erstellt'),
              description: errorMessage,
              duration: 8000, // Show longer for important message
            });
          } else {
            toast({
              variant: "destructive",
              title: t('dataset.createError', 'Fehler beim Erstellen'),
              description: error.message || t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
            });
          }
          resolve(null);
        }
      };
      
      const cancelDatasetCreation = () => {
        setShowDataStorageConfirmation(false);
        resolve(null);
      };
      
      // Store the callbacks temporarily
      (window as any).__datasetCreationResolve = confirmDatasetCreation;
      (window as any).__datasetCreationReject = cancelDatasetCreation;
      
      // Show confirmation dialog
      setShowDataStorageConfirmation(true);
    });
  };

  // Handle data storage confirmation
  const handleDataStorageConfirm = async () => {
    setShowDataStorageConfirmation(false);
    
    try {
      if (!address) {
        toast({
          variant: "destructive",
          title: t('dataset.createError', 'Fehler beim Erstellen'),
          description: t('dataset.createErrorDesc', 'Datensatz konnte nicht erstellt werden'),
        });
        return;
      }

      // Check if we're updating an existing editable dataset
      if (currentDatasetId && canEdit) {
        console.log('[handleDataStorageConfirm] Updating existing dataset:', currentDatasetId);
        await datasetAPI.bulkUpdateResidents(currentDatasetId, editableResidents);
        
        toast({
          title: t('dataset.updated', 'Dataset updated'),
          description: t('dataset.updatedDesc', 'Dataset was updated successfully'),
        });
        return;
      }

      // Create new dataset
      console.log('[handleDataStorageConfirm] Creating dataset with residents:', JSON.stringify(editableResidents, null, 2));
      
      const newDataset = await datasetAPI.createDataset({
        address: {
          street: address.street,
          number: address.number,
          city: address.city,
          postal: address.postal,
        },
        editableResidents: editableResidents,
        rawResidentData: result?.residentNames || [],
      });

      console.log('[handleDataStorageConfirm] Dataset created successfully:', newDataset.id);
      setCurrentDatasetId(newDataset.id);
      onDatasetCreatedAtChange?.(newDataset.createdAt.toString());
      
      toast({
        title: t('dataset.created', 'Datensatz erstellt'),
        description: t('dataset.createdDesc', 'Neuer Datensatz wurde erfolgreich erstellt'),
      });
    } catch (error: any) {
      console.error('Error saving dataset:', error);
      
      // Check if it's a 409 conflict (dataset already exists)
      if (error?.response?.status === 409) {
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || 'Ein Datensatz für diese Adresse existiert bereits heute.';
        const isOwnDataset = errorData.isOwnDataset;
        
        toast({
          variant: "destructive",
          title: isOwnDataset 
            ? t('dataset.alreadyExistsOwn', 'Datensatz bereits vorhanden')
            : t('dataset.alreadyExistsOther', 'Datensatz bereits erstellt'),
          description: errorMessage,
          duration: 8000, // Show longer for important message
        });
      } else {
        toast({
          variant: "destructive",
          title: t('dataset.createError', 'Fehler beim Speichern'),
          description: error.message || t('dataset.createErrorDesc', 'Datensatz konnte nicht gespeichert werden'),
        });
      }
    }
  };

  const handleDataStorageCancel = () => {
    setShowDataStorageConfirmation(false);
  };

  // Filter function for real-time search (substring matching)
  const matchesSearch = (text: string): boolean => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  // Handle saving resident edit
  const handleResidentSave = async (updatedResident: EditableResident) => {
    console.log('[ResultsDisplay.handleResidentSave] ✅ FUNCTION CALLED! updatedResident:', updatedResident);
    try {
      console.log('[handleResidentSave] Saving resident:', JSON.stringify(updatedResident, null, 2));
      
      // Update local state first
      const updatedResidents = [...editableResidents];
      
      if (editingResidentIndex === null) {
        // Adding new resident
        console.log('[handleResidentSave] Adding new resident to list');
        updatedResidents.push(updatedResident);
      } else {
        // Updating existing resident
        console.log('[handleResidentSave] Updating resident at index', editingResidentIndex);
        updatedResidents[editingResidentIndex] = updatedResident;
      }
      
      setEditableResidents(updatedResidents);

      setShowEditPopup(false);
      setEditingResident(null);
      setEditingResidentIndex(null);

      // Live-Sync: Update backend immediately if dataset exists
      if (currentDatasetId && canEdit) {
        console.log('[handleResidentSave] Live-sync: Updating dataset', currentDatasetId);
        await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);

        toast({
          title: t('resident.edit.success', 'Resident saved'),
          description: t('resident.edit.successDesc', 'Changes were saved successfully'),
        });
      } else {
        console.log('[handleResidentSave] Dataset not editable or does not exist, skipping backend update');
      }
    } catch (error) {
      console.error('Error saving resident:', error);
      toast({
        variant: "destructive",
        title: t('resident.edit.error', 'Error saving'),
        description: t('resident.edit.errorDesc', 'Changes could not be saved'),
      });
    }
  };

  const handleResidentCancel = () => {
    setShowEditPopup(false);
    setEditingResident(null);
    setEditingResidentIndex(null);
  };

  // Handle delete from ResidentEditPopup
  const handleResidentDelete = async (resident: EditableResident) => {
    console.log('[handleResidentDelete] Deleting resident:', resident);
    
    // Find the actual index in editableResidents
    const actualIndex = editableResidents.findIndex(
      r => r.name === resident.name && r.category === resident.category
    );
    
    if (actualIndex === -1) {
      toast({
        variant: "destructive",
        title: t('resident.delete.error', 'Error deleting'),
        description: t('resident.delete.errorDesc', 'Resident could not be deleted'),
      });
      throw new Error('Resident not found');
    }

    // Remove from local state
    const updatedResidents = editableResidents.filter((_, index) => index !== actualIndex);
    setEditableResidents(updatedResidents);

    // Live-Sync: Update entire resident list in backend if dataset exists and is editable
    if (currentDatasetId && canEdit) {
      console.log('[handleResidentDelete] Live-sync: Deleting resident and updating dataset', currentDatasetId);
      await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
    }

    // Update the names list to remove deleted resident from overlays
    if (result && result.residentNames && onNamesUpdated) {
      const updatedNames = result.residentNames.filter(name => name !== resident.name);
      onNamesUpdated(updatedNames);
    }
  };

  // Handle delete resident request
  const handleDeleteResidentRequest = (residentName: string, category: ResidentCategory) => {
    // Find the actual index in editableResidents
    const actualIndex = editableResidents.findIndex(
      r => r.name === residentName && r.category === category
    );
    
    if (actualIndex === -1) {
      toast({
        variant: "destructive",
        title: t('resident.delete.error', 'Error deleting'),
        description: t('resident.delete.notFound', 'Resident not found'),
      });
      return;
    }
    
    setDeletingResident({ name: residentName, index: actualIndex });
    setShowDeleteConfirmation(true);
  };

  // Handle delete confirmation
  const handleDeleteConfirm = async () => {
    if (!deletingResident) return;
    
    try {
      // Remove from local state
      const updatedResidents = editableResidents.filter((_, index) => index !== deletingResident.index);
      setEditableResidents(updatedResidents);

      // Live-Sync: Update entire resident list in backend if dataset exists and is editable
      if (currentDatasetId && canEdit) {
        console.log('[handleDeleteConfirm] Live-sync: Deleting resident and updating dataset', currentDatasetId);
        await datasetAPI.bulkUpdateResidents(currentDatasetId, updatedResidents);
      }

      // Update the names list to remove deleted resident from overlays
      if (result && result.residentNames && onNamesUpdated) {
        const updatedNames = result.residentNames.filter(name => name !== deletingResident.name);
        onNamesUpdated(updatedNames);
      }

      toast({
        title: t('resident.delete.success', 'Resident deleted'),
        description: t('resident.delete.successDesc', 'Resident was successfully deleted'),
      });

      setShowDeleteConfirmation(false);
      setDeletingResident(null);
    } catch (error) {
      console.error('Error deleting resident:', error);
      toast({
        variant: "destructive",
        title: t('resident.delete.error', 'Error deleting'),
        description: t('resident.delete.errorDesc', 'Resident could not be deleted'),
      });
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirmation(false);
    setDeletingResident(null);
  };

  // Helper to highlight search terms (if search feature is added later)
  const highlightSearchTerm = (text: string, searchTerm: string = '') => {
    if (!searchTerm) return text;
    // Implementation for highlighting can be added here
    return text;
  };

  if (!result || (result.existingCustomers.length === 0 && result.newProspects.length === 0 && (!result.allCustomersAtAddress || result.allCustomersAtAddress.length === 0))) {
    return (
      <Card data-testid="card-results">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="text-empty">
              {t('results.empty')}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show image with overlays if we have photo and vision response
  const showImageOverlays = photoImageSrc && result.fullVisionResponse && result.residentNames.length > 0;
  
  // Show resident lists if we have overlays OR if we have a loaded dataset
  const showResidentLists = showImageOverlays || externalDatasetId !== null;

  // Calculate lists dynamically from editableResidents for real-time updates
  const currentExistingCustomers = editableResidents.filter(r => r.category === 'existing_customer');
  const currentNewProspects = editableResidents.filter(r => r.category === 'potential_new_customer');

  // Helper to determine what to display in the Bestandskunden section
  const getMatchedNames = (): Array<{name: string, isPhotoName: boolean}> => {
    if (result.residentNames.length > 0) {
      const photoMatchedNames = result.residentNames.filter(name => !result.newProspects.includes(name));
      return photoMatchedNames.map(name => ({name, isPhotoName: true}));
    } else if (result.existingCustomers.length > 0) {
      return result.existingCustomers.map(customer => ({name: customer.name, isPhotoName: false}));
    }
    return [];
  };

  const matchedNames = getMatchedNames();
  const searchTerm = ''; // Can be connected to a search state later

  return (
    <>
      {showImageOverlays && !hideImageOverlays && (
        <div className="mb-4">
          <ImageWithOverlays
            imageSrc={photoImageSrc!}
            fullVisionResponse={result.fullVisionResponse}
            residentNames={result.residentNames}
            existingCustomers={currentExistingCustomers.map(r => ({ 
              name: r.name, 
              isExisting: true,
              id: r.name // Use name as ID for matching
            }))}
            newProspects={currentNewProspects.map(r => r.name)}
            allCustomersAtAddress={result.allCustomersAtAddress}
            address={address}
            onNamesUpdated={onNamesUpdated}
            editableResidents={editableResidents}
            onResidentsUpdated={(updatedResidents) => setEditableResidents(updatedResidents)}
            currentDatasetId={currentDatasetId}
            onRequestDatasetCreation={handleRequestDatasetCreation}
          />
        </div>
      )}
      
      <Card data-testid="card-results">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
          
          {/* Real-time Search Input with Clear Button */}
          <div className="mt-4 relative">
            <Input
              type="text"
              placeholder={t('results.search', 'Search residents...')}
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full pr-10"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Accordion 
            type="multiple" 
            defaultValue={["allCustomers", "duplicates", "prospects", "existing", "addressProspects"]}
            value={accordionValue}
          >
            {/* Show all customers at address from Google Sheets first */}
            {/* Only show this list when NOT loading a dataset (externalDatasetId is null) */}
            {/* When a dataset is loaded, show only editable lists below */}
            {!externalDatasetId && result.allCustomersAtAddress && result.allCustomersAtAddress.length > 0 && (
              <AccordionItem value="allCustomers">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">
                      {t('results.allCustomersAtAddress')} ({result.allCustomersAtAddress.length})
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    {result.allCustomersAtAddress.map((customer, index) => {
                const isVisible = matchesSearch(customer.name);
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                    data-testid={`row-address-customer-${index}`}
                    style={{ display: isVisible ? 'flex' : 'none' }}
                  >
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-address-customer-name-${index}`}>
                        {customer.name}
                      </p>
                      {(customer.street || customer.houseNumber || customer.postalCode) && (
                        <p className="text-xs text-muted-foreground overflow-x-auto whitespace-nowrap">
                          {[customer.street, customer.houseNumber, customer.postalCode]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Show duplicate names */}
          {/* Only show when we have residentNames (from OCR), not when loading a dataset */}
          {!externalDatasetId && result.residentNames && result.residentNames.length > 0 && (() => {
            const normalizeToWords = (name: string): string[] => {
              return name
                .toLowerCase()
                .replace(/[-\.\/\\|]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 1);
            };

            const nameCounts = new Map<string, number>();
            result.residentNames.forEach(name => {
              const lowerName = name.toLowerCase();
              nameCounts.set(lowerName, (nameCounts.get(lowerName) || 0) + 1);
            });

            const wordToNames = new Map<string, string[]>();
            result.residentNames.forEach(name => {
              const words = normalizeToWords(name);
              words.forEach(word => {
                if (!wordToNames.has(word)) {
                  wordToNames.set(word, []);
                }
                wordToNames.get(word)!.push(name.toLowerCase());
              });
            });

            const duplicateNamesSet = new Set<string>();
            
            nameCounts.forEach((count, name) => {
              if (count > 1) {
                duplicateNamesSet.add(name);
              }
            });
            
            wordToNames.forEach((nameList, word) => {
              const uniqueNames = new Set(nameList);
              if (uniqueNames.size > 1) {
                uniqueNames.forEach(name => duplicateNamesSet.add(name));
              }
            });
            
            const duplicates = result.residentNames.filter(name => 
              duplicateNamesSet.has(name.toLowerCase())
            );
            
            if (duplicates.length === 0) return null;
            
            return (
              <AccordionItem value="duplicates">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-blue-500" />
                    <p className="text-sm font-medium">
                      {t('results.duplicateNames', 'Duplicate Names')} ({duplicates.length})
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    {duplicates.map((duplicate, index) => {
                  const isVisible = matchesSearch(duplicate);
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                      data-testid={`row-duplicate-${index}`}
                      style={{ display: isVisible ? 'flex' : 'none' }}
                    >
                      <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-duplicate-name-${index}`}>
                          {duplicate}
                        </p>
                      </div>
                    </div>
                  );
                })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })()}

            {/* Show prospects with edit button */}
            {showResidentLists && currentNewProspects.length > 0 && (
              <AccordionItem value="prospects">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-warning" />
                    <p className="text-sm font-medium">
                      {t('results.newProspects')} ({currentNewProspects.length})
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    <div className="flex items-center justify-end mb-3">
                      {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      // If no dataset exists yet, request dataset creation first
                      if (!currentDatasetId) {
                        const createdDatasetId = await handleRequestDatasetCreation();
                        if (!createdDatasetId) {
                          // User cancelled or creation failed
                          return;
                        }
                      }
                      
                      // Add new resident logic
                      const newResident: EditableResident = {
                        name: '',
                        category: 'potential_new_customer',
                        isFixed: false,
                      };
                      setEditingResident(newResident);
                      setEditingResidentIndex(null);
                      setShowEditPopup(true);
                    }}
                    className="text-xs"
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    {t('resident.addNew', 'Add Resident')}
                  </Button>
                )}
              </div>
              {currentNewProspects.map((resident, index) => {
                const isVisible = matchesSearch(resident.name);
                
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                    data-testid={`row-prospect-${index}`}
                    style={{ display: isVisible ? 'flex' : 'none' }}
                  >
                    <div className="h-9 w-9 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-prospect-name-${index}`}>
                        {resident.name}
                      </span>
                      {/* Show status, floor, and door if available */}
                      {resident && (resident.status || resident.floor !== undefined || resident.door) && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {resident.status && (
                            <span className="mr-2">
                              {t('resident.status.status', 'Status')}: {t(`resident.status.${resident.status}`, resident.status)}
                            </span>
                          )}
                          {resident.floor !== undefined && (
                            <span className="mr-2">
                              {t('resident.floor', 'Floor')}: {resident.floor}
                            </span>
                          )}
                          {resident.door && (
                            <span>
                              {t('resident.door', 'Door')}: {resident.door}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditResidentFromList(resident.name, 'potential_new_customer')}
                          data-testid={`button-edit-prospect-${index}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteResidentRequest(resident.name, 'potential_new_customer')}
                          data-testid={`button-delete-prospect-${index}`}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Show existing customers (matched from photo) with edit button */}
            {currentExistingCustomers.length > 0 && (
              <AccordionItem value="existing">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-success" />
                    <p className="text-sm font-medium">
                      {t('results.existingCustomers')} ({currentExistingCustomers.length})
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    <div className="flex items-center justify-end mb-3">
                      {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      // If no dataset exists yet, request dataset creation first
                      if (!currentDatasetId) {
                        const createdDatasetId = await handleRequestDatasetCreation();
                        if (!createdDatasetId) {
                          // User cancelled or creation failed
                          return;
                        }
                      }
                      
                      // Add new resident logic
                      const newResident: EditableResident = {
                        name: '',
                        category: 'existing_customer',
                        isFixed: false,
                      };
                      setEditingResident(newResident);
                      setEditingResidentIndex(null);
                      setShowEditPopup(true);
                    }}
                    className="text-xs"
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    {t('resident.addNew', 'Add Resident')}
                  </Button>
                )}
              </div>
              {currentExistingCustomers.map((resident, index) => {
                const isVisible = matchesSearch(resident.name);
                
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                    data-testid={`row-existing-${index}`}
                    style={{ display: isVisible ? 'flex' : 'none' }}
                  >
                    <div className="h-9 w-9 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-customer-name-${index}`}>
                        {resident.name}
                      </p>
                      {/* Show status, floor, and door if available */}
                      {resident && (resident.status || resident.floor !== undefined || resident.door) && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {resident.status && (
                            <span className="mr-2">
                              {t('resident.status.status', 'Status')}: {t(`resident.status.${resident.status}`, resident.status)}
                            </span>
                          )}
                          {resident.floor !== undefined && (
                            <span className="mr-2">
                              {t('resident.floor', 'Floor')}: {resident.floor}
                            </span>
                          )}
                          {resident.door && (
                            <span>
                              {t('resident.door', 'Door')}: {resident.door}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditResidentFromList(resident.name, 'existing_customer')}
                          data-testid={`button-edit-existing-${index}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteResidentRequest(resident.name, 'existing_customer')}
                          data-testid={`button-delete-existing-${index}`}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Show prospects if no image overlays (address-only search) */}
            {/* This section is for NEW OCR results without photo - do NOT show for loaded datasets */}
            {!showImageOverlays && !externalDatasetId && result.newProspects.length > 0 && (
              <AccordionItem value="addressProspects">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-warning" />
                    <p className="text-sm font-medium">
                      {t('results.newProspects')} ({result.newProspects.length})
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    {result.newProspects.map((prospect, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                        data-testid={`row-prospect-${index}`}
                      >
                        <div className="h-9 w-9 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-warning" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-prospect-name-${index}`}>
                            {prospect}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </CardContent>
      </Card>

      {/* Resident Edit Popup */}
      <ResidentEditPopup
        isOpen={showEditPopup}
        onClose={() => {
          console.log('[ResultsDisplay] 🔴 ResidentEditPopup onClose called');
          handleResidentCancel();
        }}
        onSave={(resident) => {
          console.log('[ResultsDisplay] 🟢 ResidentEditPopup onSave called with:', resident);
          return handleResidentSave(resident);
        }}
        onDelete={(resident) => {
          console.log('[ResultsDisplay] 🗑️ ResidentEditPopup onDelete called with:', resident);
          return handleResidentDelete(resident);
        }}
        resident={editingResident}
        isEditing={editingResident !== null}
      />

      {/* Data Storage Confirmation */}
      {address && (
        <DataStorageConfirmation
          isOpen={showDataStorageConfirmation}
          onConfirm={async () => {
            // Check if there's a promise-based callback waiting
            if ((window as any).__datasetCreationResolve) {
              await (window as any).__datasetCreationResolve();
              delete (window as any).__datasetCreationResolve;
              delete (window as any).__datasetCreationReject;
            } else {
              // Fall back to original handler
              await handleDataStorageConfirm();
            }
          }}
          onCancel={() => {
            // Check if there's a promise-based callback waiting
            if ((window as any).__datasetCreationReject) {
              (window as any).__datasetCreationReject();
              delete (window as any).__datasetCreationResolve;
              delete (window as any).__datasetCreationReject;
            } else {
              // Fall back to original handler
              handleDataStorageCancel();
            }
          }}
          address={address}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resident.delete.title', 'Delete Resident')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('resident.delete.message', 'Do you really want to delete the resident {{name}}?', { 
                name: deletingResident?.name || '' 
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>
              {t('action.no', 'No')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('action.yes', 'Yes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
