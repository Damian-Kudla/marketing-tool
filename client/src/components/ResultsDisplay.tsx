import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trackingManager } from '@/services/trackingManager';
import { debounceAsync } from '@/lib/debounce';
import { STATUS_LABELS } from '@/constants/statuses';
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
import { User, AlertCircle, UserCheck, UserPlus, Edit, Trash2, X, Loader2 } from 'lucide-react';
import ImageWithOverlays from './ImageWithOverlays';
import { ResidentEditPopup } from './ResidentEditPopup';
import { ClickableAddressHeader } from './ClickableAddressHeader';
import { MaximizeButton } from './MaximizeButton';
import { StatusContextMenu } from './StatusContextMenu';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import { useLongPress } from '@/hooks/use-long-press';
import { datasetAPI } from '@/services/api';
import { expandHouseNumberRange } from '@/utils/addressUtils';
import type { Address } from '@/components/GPSAddressForm';
import type { 
  EditableResident, 
  ResidentCategory,
  AddressDataset,
  ResidentStatus
} from '@/../../shared/schema';

/**
 * ✅ UTILITY: Sanitize resident data before sending to backend
 * Ensures status is undefined for existing_customer category
 */
const sanitizeResident = (resident: EditableResident): EditableResident => {
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
const sanitizeResidents = (residents: EditableResident[]): EditableResident[] => {
  return residents.map(sanitizeResident);
};

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
  relatedHouseNumbers?: string[];
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
  onRequestDatasetCreation?: () => Promise<string | null>; // Callback to request dataset creation (from parent)
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
  hideImageOverlays = false,
  onRequestDatasetCreation
}: ResultsDisplayProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  
  // State for editable residents
  const [editableResidents, setEditableResidentsInternal] = useState<EditableResident[]>([]);
  const [fixedCustomers, setFixedCustomers] = useState<EditableResident[]>([]);
  const [currentDatasetId, setCurrentDatasetIdInternal] = useState<string | null>(null);
  
  // Sync external dataset ID with internal state
  const setCurrentDatasetId = (id: string | null) => {
    setCurrentDatasetIdInternal(id);
    onDatasetIdChange?.(id);
  };
  
  // Sync external dataset ID to internal state using useEffect
  useEffect(() => {
    if (externalDatasetId !== currentDatasetId) {
      setCurrentDatasetIdInternal(externalDatasetId);
    }
  }, [externalDatasetId, currentDatasetId]);
  
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
  
  // State for delete confirmation
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletingResident, setDeletingResident] = useState<{ name: string; index: number } | null>(null);

  // State for status context menu (Long Press)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuPosition, setStatusMenuPosition] = useState({ x: 0, y: 0 });
  const [statusMenuResident, setStatusMenuResident] = useState<{ resident: EditableResident; index: number } | null>(null);

  // State for dataset creation lock (prevent race conditions)
  const [isCreatingDataset, setIsCreatingDataset] = useState(false);

  // Debounce timer for rapid successive calls
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous residents to prevent unnecessary parent notifications
  const prevResidentsRef = useRef<EditableResident[]>([]);

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
        // FIX: Don't call onResidentsUpdated here - will be called in separate useEffect
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
        // FIX: Don't call onResidentsUpdated here - will be called in separate useEffect
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
      originalName: name, // Store original name for category change tracking
      originalCategory: 'potential_new_customer' as ResidentCategory, // Store original category
    }));

    // Create editable residents from existing customers (these can be edited)
    const editableExisting: EditableResident[] = result.existingCustomers.map(customer => ({
      name: customer.name,
      category: 'existing_customer' as ResidentCategory,
      isFixed: false, // Make them editable
      originalName: customer.name, // Store original name for category change tracking
      originalCategory: 'existing_customer' as ResidentCategory, // Store original category
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
      // FIX: Don't call onResidentsUpdated here - will be called in separate useEffect
      return allResidents;
    });
    
    setFixedCustomers(fixedFromAll);
    
    // Only reset dataset ID if we don't have an external one
    if (!externalDatasetId) {
      setCurrentDatasetId(null);
    }
  }, [result, externalDatasetId, initialResidents, canEdit]); // onResidentsUpdated intentionally excluded to prevent infinite loops

  // FIX: Notify parent of resident changes AFTER state update (prevents React warning)
  // Only notify if residents actually changed (prevents infinite loops)
  useEffect(() => {
    // Compare with previous value using JSON.stringify (deep equality)
    const currentJSON = JSON.stringify(editableResidents);
    const prevJSON = JSON.stringify(prevResidentsRef.current);
    
    if (currentJSON !== prevJSON) {
      console.log('[ResultsDisplay] Residents changed, notifying parent:', editableResidents.length);
      prevResidentsRef.current = editableResidents; // Update ref BEFORE calling callback
      onResidentsUpdated?.(editableResidents);
    } else {
      console.log('[ResultsDisplay] Residents unchanged, skipping parent notification');
    }
  }, [editableResidents]); // Intentionally exclude onResidentsUpdated to prevent infinite loops

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
      // Use parent's dataset creation function if provided (prevents duplicate requests)
      const createDataset = onRequestDatasetCreation || handleRequestDatasetCreation;
      const createdDatasetId = await createDataset();
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

  // Request dataset creation automatically without confirmation (with debounce)
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
      // Wait for existing creation to finish by returning null
      // The calling component should handle this gracefully
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
        toast({
        variant: "destructive",
        title: t('dataset.createError', 'Error creating'),
        description: t('dataset.createErrorDesc', 'Dataset could not be created'),
      });
      setIsCreatingDataset(false); // Release lock
      resolve(null);
      return;
    }

    // Validate address completeness: street, number, and postal are required
    if (!address.street || !address.number || !address.postal) {
      toast({
        variant: "destructive",
        title: t('error.incompleteAddress', 'Unvollständige Adresse'),
        description: t('error.incompleteAddressDesc', 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'),
      });
      setIsCreatingDataset(false); // Release lock
      resolve(null);
      return;
    }      // Check if we're updating an existing editable dataset
      if (currentDatasetId && canEdit) {
        console.log('[handleRequestDatasetCreation] Updating existing dataset:', currentDatasetId);
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(editableResidents));
        
        toast({
          title: t('dataset.updated', 'Dataset updated'),
        description: t('dataset.updatedDesc', 'Dataset was updated successfully'),
      });
      
      setIsCreatingDataset(false); // Release lock
      resolve(currentDatasetId);
      return;
    }      // Create dataset with 15 second timeout
      const timeoutPromise = new Promise<AddressDataset | null>((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT_ERROR')), 15000)
      );
      
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
      
      const datasetPromise = datasetAPI.createDataset({
        address: {
          street: address.street,
          number: processedNumber,
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
          setIsCreatingDataset(false); // Release lock
          return null;
        }
        
        // Not a timeout, it's another error - handle it below
        throw raceError;
      }
      
      if (!newDataset) throw new Error('Dataset creation failed');

      setCurrentDatasetId(newDataset.id);
      onDatasetCreatedAtChange?.(newDataset.createdAt.toString());
      
      // Memory Optimization: Clear photo state after successful dataset creation
      console.log('[ResultsDisplay] Memory cleanup: Clearing photo state after dataset creation');
      if (typeof window !== 'undefined') {
        // Trigger cleanup in parent component (scanner.tsx)
        window.dispatchEvent(new CustomEvent('dataset-created-cleanup'));
      }
      
      toast({
        title: t('dataset.created', 'Dataset created'),
        description: t('dataset.createdDesc', 'New dataset was created successfully'),
      });

      setIsCreatingDataset(false); // Release lock on success
      return newDataset.id;
    
    // CRITICAL: Always release lock in catch block (prevents deadlock)
    setIsCreatingDataset(false);
    resolve(null);
  } catch (error: any) {
    console.error('Error creating dataset:', error);      // Check if it's a 429 rate limit error
      if (error?.response?.status === 429) {
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || 'Zu viele Anfragen. Bitte warte eine Minute.';
        
        toast({
          variant: "destructive",
          title: 'Rate Limit erreicht',
          description: errorMessage,
          duration: 10000, // Show longer for rate limit message
        });
      } else if (error?.response?.status === 409) {
        // Check if it's a 409 conflict (dataset already exists)
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
      } else if (error?.response?.status === 400) {
        // Handle validation errors (e.g., invalid address)
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || 'Die Adresse konnte nicht validiert werden.';
        
        toast({
          variant: "destructive",
          title: t('dataset.createError', 'Datensatz konnte nicht erstellt werden'),
          description: errorMessage,
          duration: 8000, // Show longer for validation errors
        });
      } else {
        toast({
          variant: "destructive",
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
      
      // ✅ SANITIZE: Clear status if category is existing_customer
      const sanitizedResident = sanitizeResident(updatedResident);
      
      // Update local state first
      const updatedResidents = [...editableResidents];
      
      if (editingResidentIndex === null) {
        // Adding new resident
        console.log('[handleResidentSave] Adding new resident to list');
        updatedResidents.push(sanitizedResident);
      } else {
        // Updating existing resident
        console.log('[handleResidentSave] Updating resident at index', editingResidentIndex);
        updatedResidents[editingResidentIndex] = sanitizedResident;
      }
      
      setEditableResidents(updatedResidents);

      setShowEditPopup(false);
      setEditingResident(null);
      setEditingResidentIndex(null);

      // Live-Sync: Update backend immediately if dataset exists
      if (currentDatasetId && canEdit) {
        console.log('[handleResidentSave] Live-sync: Updating dataset', currentDatasetId);
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));

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
      await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));
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

  // Handle status/category change from context menu (Long Press)
  const handleStatusChange = async (newStatus: ResidentStatus) => {
    if (!statusMenuResident) return;

    const { resident } = statusMenuResident;
    
    try {
      // FIX: If no dataset exists yet, create one first
      if (!currentDatasetId) {
        console.log('[handleStatusChange] No dataset exists, creating one first...');
        const createdDatasetId = await handleRequestDatasetCreation();
        if (!createdDatasetId) {
          console.log('[handleStatusChange] Dataset creation failed or was cancelled');
          setStatusMenuOpen(false);
          setStatusMenuResident(null);
          return;
        }
        console.log('[handleStatusChange] Dataset created:', createdDatasetId);
        
        // After dataset creation, editableResidents has been reloaded
        // Re-trigger the status change with updated state
        setTimeout(() => {
          const newIndex = editableResidents.findIndex(r => 
            r.name === resident.name && r.category === resident.category
          );
          
          if (newIndex !== -1) {
            console.log('[handleStatusChange] Re-triggering after dataset creation');
            setStatusMenuResident({ resident: editableResidents[newIndex], index: newIndex });
            handleStatusChange(newStatus);
          }
        }, 100);
        
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      // ✅ CRITICAL FIX: Find resident by name in CURRENT array (not using old index!)
      const currentIndex = editableResidents.findIndex(r => 
        r.name === resident.name && r.category === resident.category
      );
      
      if (currentIndex === -1) {
        console.error('[handleStatusChange] Resident not found in current array:', resident.name);
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      console.log('[handleStatusChange] Found resident at index:', currentIndex, 'Name:', resident.name);
      
      const oldResident = editableResidents[currentIndex];
      const oldStatus = oldResident.status;
      
      const updatedResident: EditableResident = {
        ...oldResident, // Use current resident from array
        status: newStatus
      };

      // Create updated array BEFORE setState
      const newResidents = [...editableResidents];
      newResidents[currentIndex] = updatedResident;

      // Update local state
      setEditableResidents(newResidents);

      // Live-sync to backend if dataset exists
      if (canEdit && currentDatasetId) {
        console.log('[handleStatusChange] Live-sync: Updating status for resident', resident.name);
        
        // Use the updated array for backend sync
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(newResidents));

        // Track status change action with old and new status
        trackingManager.logAction(
          'status_change',
          `Resident: ${resident.name} | Old: ${oldStatus || 'none'} → New: ${newStatus}`,
          newStatus as 'interessiert' | 'nicht_interessiert' | 'nicht_angetroffen' | 'termin_vereinbart',
          oldStatus as 'interessiert' | 'nicht_interessiert' | 'nicht_angetroffen' | 'termin_vereinbart' | undefined
        );

        toast({
          title: t('resident.status.updated', 'Status updated'),
          description: t('resident.status.updatedDescription', `Status changed to {{status}}`, { 
            status: newStatus 
          }),
        });
      }
    } catch (error) {
      console.error('[handleStatusChange] Error updating status:', error);
      toast({
        variant: 'destructive',
        title: t('resident.status.error', 'Error'),
        description: t('resident.status.errorDescription', 'Failed to update status'),
      });
    } finally {
      // Close menu
      setStatusMenuOpen(false);
      setStatusMenuResident(null);
    }
  };

  // Handle category change (for existing_customer → potential_new_customer)
  const handleCategoryChange = async (newCategory: ResidentCategory) => {
    if (!statusMenuResident) return;

    const { resident } = statusMenuResident;
    
    try {
      // FIX: If no dataset exists yet, create one first
      if (!currentDatasetId) {
        console.log('[handleCategoryChange] No dataset exists, creating one first...');
        const createdDatasetId = await handleRequestDatasetCreation();
        if (!createdDatasetId) {
          console.log('[handleCategoryChange] Dataset creation failed or was cancelled');
          setStatusMenuOpen(false);
          setStatusMenuResident(null);
          return;
        }
        console.log('[handleCategoryChange] Dataset created:', createdDatasetId);
        
        // After dataset creation, editableResidents has been reloaded
        // Re-trigger the category change with updated state
        setTimeout(() => {
          const newIndex = editableResidents.findIndex(r => 
            r.name === resident.name && r.category === resident.category
          );
          
          if (newIndex !== -1) {
            console.log('[handleCategoryChange] Re-triggering after dataset creation');
            setStatusMenuResident({ resident: editableResidents[newIndex], index: newIndex });
            handleCategoryChange(newCategory);
          }
        }, 100);
        
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      // ✅ CRITICAL FIX: Find resident by name in CURRENT array (not using old index!)
      const currentIndex = editableResidents.findIndex(r => 
        r.name === resident.name && r.category === resident.category
      );
      
      if (currentIndex === -1) {
        console.error('[handleCategoryChange] Resident not found in current array:', resident.name);
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      console.log('[handleCategoryChange] Found resident at index:', currentIndex, 'Name:', resident.name);
      
      const updatedResident: EditableResident = {
        ...editableResidents[currentIndex], // Use current resident from array
        category: newCategory,
        // Clear status when changing to existing_customer
        status: newCategory === 'existing_customer' ? undefined : editableResidents[currentIndex].status
      };

      // Create updated array
      const newResidents = [...editableResidents];
      newResidents[currentIndex] = updatedResident;

      // Update local state
      setEditableResidents(newResidents);

      // Live-sync to backend if dataset exists
      if (canEdit && currentDatasetId) {
        console.log('[handleCategoryChange] Live-sync: Updating category for resident', resident.name);
        
        // Use the updated array for backend sync
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(newResidents));

        toast({
          title: t('resident.category.updated', 'Kategorie geändert'),
          description: t('resident.category.updatedDescription', `Kategorie zu {{category}} geändert`, { 
            category: newCategory === 'existing_customer' ? 'Bestandskunde' : 'Neukunde' 
          }),
        });
      }
    } catch (error) {
      console.error('[handleCategoryChange] Error updating category:', error);
      toast({
        variant: 'destructive',
        title: t('resident.category.error', 'Fehler'),
        description: t('resident.category.errorDescription', 'Kategorie konnte nicht geändert werden'),
      });
    } finally {
      // Close menu
      setStatusMenuOpen(false);
      setStatusMenuResident(null);
    }
  };

  // ✅ NEU: Handle combined category + status change (in ONE transaction)
  const handleCategoryAndStatusChange = async (newCategory: ResidentCategory, newStatus: ResidentStatus) => {
    if (!statusMenuResident) return;

    const { resident } = statusMenuResident;
    
    try {
      // FIX: If no dataset exists yet, create one first
      if (!currentDatasetId) {
        console.log('[handleCategoryAndStatusChange] No dataset exists, creating one first...');
        const createdDatasetId = await handleRequestDatasetCreation();
        if (!createdDatasetId) {
          console.log('[handleCategoryAndStatusChange] Dataset creation failed or was cancelled');
          setStatusMenuOpen(false);
          setStatusMenuResident(null);
          return;
        }
        console.log('[handleCategoryAndStatusChange] Dataset created:', createdDatasetId);
        
        // After dataset creation, editableResidents has been reloaded
        // We need to call this function again with the new state
        // Wait a bit for state to update
        setTimeout(() => {
          // Find the resident again in the new array and trigger the change
          const newIndex = editableResidents.findIndex(r => 
            r.name === resident.name && r.category === 'existing_customer'
          );
          
          if (newIndex !== -1) {
            console.log('[handleCategoryAndStatusChange] Re-triggering after dataset creation');
            setStatusMenuResident({ resident: editableResidents[newIndex], index: newIndex });
            handleCategoryAndStatusChange(newCategory, newStatus);
          }
        }, 100);
        
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      // ✅ CRITICAL FIX: Find resident by name in CURRENT array (not using old index!)
      // The index from statusMenuResident might be stale if dataset was just created
      const currentIndex = editableResidents.findIndex(r => 
        r.name === resident.name && r.category === resident.category
      );
      
      if (currentIndex === -1) {
        console.error('[handleCategoryAndStatusChange] Resident not found in current array:', resident.name);
        setStatusMenuOpen(false);
        setStatusMenuResident(null);
        return;
      }
      
      console.log('[handleCategoryAndStatusChange] Found resident at index:', currentIndex, 'Name:', resident.name);
      
      // ✅ Update BOTH category AND status in ONE operation
      const updatedResident: EditableResident = {
        ...editableResidents[currentIndex], // Use current resident from array
        category: newCategory,
        status: newStatus
      };

      // ✅ Create new array with updated resident
      const newResidents = [...editableResidents];
      newResidents[currentIndex] = updatedResident;

      // Update local state
      setEditableResidents(newResidents);

      // Live-sync to backend if dataset exists - ONE backend call instead of two!
      if (canEdit && currentDatasetId) {
        console.log('[handleCategoryAndStatusChange] Live-sync: Updating category + status for resident', resident.name);
        console.log('[handleCategoryAndStatusChange] Checking category change:', {
          oldCategory: resident.category,
          newCategory: newCategory,
          willLog: resident.category !== newCategory
        });
        
        // Use the updated array for backend sync
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(newResidents));

        // Log category change if category was actually changed
        if (resident.category !== newCategory) {
          console.log('[handleCategoryAndStatusChange] Category changed, logging...', {
            from: resident.category,
            to: newCategory,
            resident: resident.name,
            datasetId: currentDatasetId,
            hasAddress: !!address
          });

          try {
            const logResponse = await fetch('/api/log-category-change', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                datasetId: currentDatasetId,
                residentOriginalName: updatedResident.originalName || resident.name,
                residentCurrentName: resident.name,
                oldCategory: resident.category,
                newCategory: newCategory,
                addressDatasetSnapshot: JSON.stringify(address || {})
              })
            });

            if (!logResponse.ok) {
              console.error('[handleCategoryAndStatusChange] Failed to log category change:', logResponse.status);
              const errorText = await logResponse.text();
              console.error('[handleCategoryAndStatusChange] Error response:', errorText);
            } else {
              console.log('[handleCategoryAndStatusChange] Category change logged successfully');
            }
          } catch (logError) {
            console.error('[handleCategoryAndStatusChange] Error logging category change:', logError);
            // Don't fail the operation if logging fails
          }
        } else {
          console.log('[handleCategoryAndStatusChange] ⚠️ No category change detected - skipping log');
        }

        toast({
          title: t('resident.categoryStatus.updated', 'Kategorie & Status geändert'),
          description: t('resident.categoryStatus.updatedDescription', `Zu Neukunde verschoben mit Status: ${STATUS_LABELS[newStatus]}`),
        });
      }
    } catch (error) {
      console.error('[handleCategoryAndStatusChange] Error updating category + status:', error);
      toast({
        variant: 'destructive',
        title: t('resident.categoryStatus.error', 'Fehler'),
        description: t('resident.categoryStatus.errorDescription', 'Änderung fehlgeschlagen'),
      });
    } finally {
      // Close menu
      setStatusMenuOpen(false);
      setStatusMenuResident(null);
    }
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
        await datasetAPI.bulkUpdateResidents(currentDatasetId, sanitizeResidents(updatedResidents));
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

  // Handler to create a new resident when no OCR results exist
  const handleCreateResidentWithoutPhoto = async () => {
    if (!address) {
      toast({
        variant: "destructive",
        title: t('error.noAddress', 'Keine Adresse'),
        description: t('error.noAddressDesc', 'Bitte gib zuerst eine Adresse ein'),
      });
      return;
    }
    
    // Validate address completeness: street, number, and postal are required
    if (!address.street || !address.number || !address.postal) {
      toast({
        variant: "destructive",
        title: t('error.incompleteAddress', 'Unvollständige Adresse'),
        description: t('error.incompleteAddressDesc', 'Straße, Hausnummer und Postleitzahl müssen angegeben werden'),
      });
      return;
    }
    
    // If dataset is already loaded (externalDatasetId exists), skip dataset creation
    // and directly open the resident edit popup
    if (externalDatasetId) {
      console.log('[handleCreateResidentWithoutPhoto] Dataset already loaded, opening edit popup directly');
      
      // Open edit popup to add resident to existing dataset
      const newResident: EditableResident = {
        name: '',
        category: 'potential_new_customer',
        isFixed: false,
      };
      setEditingResident(newResident);
      setEditingResidentIndex(null);
      setShowEditPopup(true);
      return;
    }
    
    // Automatically create dataset without confirmation (only if no dataset loaded)
    try {
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
      
      // Create dataset with empty residents array
      const newDataset = await datasetAPI.createDataset({
        address: {
          street: address.street,
          number: processedNumber,
          city: address.city,
          postal: address.postal,
        },
        editableResidents: [],
        rawResidentData: [],
      });

      setCurrentDatasetId(newDataset.id);
      onDatasetCreatedAtChange?.(newDataset.createdAt.toString());
      setEditableResidents([]);
      
      toast({
        title: t('dataset.created', 'Datensatz angelegt'),
        description: t('dataset.createdNoPhoto', 'Du kannst jetzt Anwohner hinzufügen'),
      });

      // Open edit popup to add first resident
      const newResident: EditableResident = {
        name: '',
        category: 'potential_new_customer',
        isFixed: false,
      };
      setEditingResident(newResident);
      setEditingResidentIndex(null);
      setShowEditPopup(true);
    } catch (error: any) {
      // Handle 429 rate limit error
      if (error.response?.status === 429) {
        const errorData = error.response?.data;
        
        toast({
          variant: "destructive",
          title: 'Rate Limit erreicht',
          description: errorData?.message || 'Zu viele Anfragen. Bitte warte eine Minute.',
          duration: 10000,
        });
      } else if (error.response?.status === 409) {
        // Handle 409 error (dataset already exists)
        const errorData = error.response?.data;
        
        toast({
          variant: "destructive",
          title: t('dataset.alreadyExists', 'Datensatz existiert bereits'),
          description: errorData?.message || t('dataset.alreadyExistsDesc', 'Ein Datensatz existiert bereits für diese Adresse heute'),
        });
      } else if (error.response?.status === 400) {
        // Handle validation errors (e.g., invalid address)
        const errorData = error.response?.data;
        
        toast({
          variant: "destructive",
          title: t('dataset.createError', 'Datensatz konnte nicht erstellt werden'),
          description: errorData?.message || 'Die Adresse ungültig zu sein scheint. Bitte prüfe die Adresse.',
          duration: 8000,
        });
      } else {
        toast({
          variant: "destructive",
          title: t('dataset.createError', 'Fehler beim Anlegen'),
          description: t('dataset.createErrorDesc', 'Datensatz konnte nicht angelegt werden'),
        });
      }
    }
  };

  // Calculate lists dynamically from editableResidents for real-time updates
  const currentExistingCustomers = useMemo(() => 
    editableResidents.filter(r => r.category === 'existing_customer'),
    [editableResidents]
  );
  
  const currentNewProspects = useMemo(() => 
    editableResidents.filter(r => r.category === 'potential_new_customer'),
    [editableResidents]
  );

  // Memoize current resident names to prevent infinite re-renders
  const currentResidentNames = useMemo(() => 
    editableResidents.map(r => r.name), 
    [editableResidents]
  );

  // Memoize existing customers array to prevent infinite re-renders
  const memoizedExistingCustomers = useMemo(() => 
    currentExistingCustomers.map(r => ({ 
      name: r.name, 
      isExisting: true,
      id: r.name 
    })),
    [currentExistingCustomers]
  );

  // Memoize new prospects array to prevent infinite re-renders
  const memoizedNewProspects = useMemo(() => 
    currentNewProspects.map(r => r.name),
    [currentNewProspects]
  );

  // Show empty state only if no results AND no dataset loaded
  if ((!result || (result.existingCustomers.length === 0 && result.newProspects.length === 0 && (!result.allCustomersAtAddress || result.allCustomersAtAddress.length === 0))) && !externalDatasetId) {
    return (
      <>
        <Card data-testid="card-results">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-empty">
                {t('results.empty')}
              </p>
              
              {/* Show "Create Resident" button only if address is complete (street, number, postal) */}
              {address && address.street && address.number && address.postal && canEdit && (
                <Button
                  onClick={handleCreateResidentWithoutPhoto}
                  disabled={isCreatingDataset}
                  className="gap-2"
                  data-testid="button-create-resident-no-photo"
                >
                  <UserPlus className="h-4 w-4" />
                  {isCreatingDataset ? t('dataset.creating', 'Erstelle Datensatz...') : t('resident.create', 'Anwohner anlegen')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // Show image with overlays if we have photo and vision response
  const showImageOverlays = photoImageSrc && result?.fullVisionResponse && result?.residentNames.length > 0;
  
  // Show resident lists if we have overlays OR if we have a loaded dataset
  const showResidentLists = showImageOverlays || externalDatasetId !== null;

  // Helper to determine what to display in the Bestandskunden section
  const getMatchedNames = (): Array<{name: string, isPhotoName: boolean}> => {
    if (result && result.residentNames.length > 0) {
      const photoMatchedNames = result.residentNames.filter(name => !result.newProspects.includes(name));
      return photoMatchedNames.map(name => ({name, isPhotoName: true}));
    } else if (result && result.existingCustomers.length > 0) {
      return result.existingCustomers.map(customer => ({name: customer.name, isPhotoName: false}));
    }
    return [];
  };

  const matchedNames = getMatchedNames();
  const searchTerm = ''; // Can be connected to a search state later

  // Internal component for Resident Row with Long Press
  const ResidentRow = ({ 
    resident, 
    index, 
    category 
  }: { 
    resident: EditableResident; 
    index: number; 
    category: ResidentCategory;
  }) => {
    // FIX: Enable Long Press for both categories (but with different menus)
    const enableLongPress = canEdit;
    
    const longPressHandlers = useLongPress({
      onLongPress: (x, y) => {
        if (!enableLongPress) return;
        setStatusMenuPosition({ x, y });
        setStatusMenuResident({ resident, index });
        setStatusMenuOpen(true);
      },
      onClick: () => {
        // Normal click behavior - optional: open edit popup
        if (canEdit) {
          handleEditResidentFromList(resident.name, category);
        }
      }
    });

    const isVisible = matchesSearch(resident.name);
    const iconColor = category === 'existing_customer' ? 'text-success' : 'text-warning';
    const iconBg = category === 'existing_customer' ? 'bg-success/10' : 'bg-warning/10';

    const { style: longPressStyle, ...restLongPressHandlers } = longPressHandlers;

    return (
      <div
        key={index}
        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate cursor-pointer"
        data-testid={`row-${category}-${index}`}
        style={{ 
          display: isVisible ? 'flex' : 'none',
          ...longPressStyle 
        }}
        {...restLongPressHandlers}
      >
        <div className={`h-9 w-9 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
          {category === 'existing_customer' ? (
            <UserCheck className={`h-4 w-4 ${iconColor}`} />
          ) : (
            <User className={`h-4 w-4 ${iconColor}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-${category}-name-${index}`}>
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
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEditResidentFromList(resident.name, category)}
              data-testid={`button-edit-${category}-${index}`}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteResidentRequest(resident.name, category)}
              data-testid={`button-delete-${category}-${index}`}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Dataset Creation Loading Dialog */}
      {isCreatingDataset && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                {t('dataset.creating', 'Datensatz wird erstellt...')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t('dataset.creatingDesc', 'Bitte warten, der Datensatz wird angelegt...')}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      
      {showImageOverlays && !hideImageOverlays && result && (
        <div className="mb-4">
          <ImageWithOverlays
            imageSrc={photoImageSrc!}
            fullVisionResponse={result.fullVisionResponse}
            residentNames={currentResidentNames}
            existingCustomers={memoizedExistingCustomers}
            newProspects={memoizedNewProspects}
            allCustomersAtAddress={result.allCustomersAtAddress}
            address={address}
            onNamesUpdated={onNamesUpdated}
            editableResidents={editableResidents}
            onResidentsUpdated={(updatedResidents) => setEditableResidents(updatedResidents)}
            currentDatasetId={currentDatasetId}
            onRequestDatasetCreation={onRequestDatasetCreation || handleRequestDatasetCreation}
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
            {/* Show "All Customers at Address" section when:
                1. No loaded dataset (not editing existing dataset)
                2. AND either:
                   - result.allCustomersAtAddress exists (from OCR/address search), OR
                   - fixedCustomers exist (from loaded dataset without photo)
            */}
            {!externalDatasetId && (
              (result?.allCustomersAtAddress && result.allCustomersAtAddress.length > 0) ||
              (fixedCustomers && fixedCustomers.length > 0)
            ) && (
              <AccordionItem value="allCustomers">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">
                      {t('results.allCustomersAtAddress')} (
                        {(result?.allCustomersAtAddress || fixedCustomers)?.length || 0}
                      )
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-3">
                    {/* Show customers from result.allCustomersAtAddress OR fixedCustomers (not both to avoid duplicates)
                        - result.allCustomersAtAddress: From OCR/photo scan or address search (type: Customer[])
                        - fixedCustomers: From loaded dataset without photo (type: EditableResident[])
                        Priority: Use allCustomersAtAddress if available, otherwise use fixedCustomers
                    */}
                    {(result?.allCustomersAtAddress || fixedCustomers)?.map((customer, index) => {
                const isVisible = matchesSearch(customer.name);
                
                // Check if multiple house numbers were queried (contains comma or hyphen)
                // Examples: "30,31,32" or "30-33" or "30, 31, 32"
                const multipleHouseNumbers = address?.number && (
                  address.number.includes(',') || 
                  address.number.includes('-')
                );
                
                // Type-safe property access (Customer has houseNumber, EditableResident doesn't)
                const houseNumber = 'houseNumber' in customer ? customer.houseNumber : undefined;
                const street = 'street' in customer ? customer.street : undefined;
                const postalCode = 'postalCode' in customer ? customer.postalCode : undefined;
                
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
                      <div className="flex items-baseline gap-2">
                        <p className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-address-customer-name-${index}`}>
                          {customer.name}
                        </p>
                        {/* Show house number when multiple numbers were queried (comma or hyphen separated) */}
                        {multipleHouseNumbers && houseNumber && (
                          <Badge variant="secondary" className="text-xs font-normal shrink-0">
                            Nr. {houseNumber}
                          </Badge>
                        )}
                      </div>
                      {(street || postalCode) && (
                        <p className="text-xs text-muted-foreground overflow-x-auto whitespace-nowrap">
                          {[street, !multipleHouseNumbers && houseNumber, postalCode]
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
          {!externalDatasetId && result && result.residentNames && result.residentNames.length > 0 && (() => {
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
              {currentNewProspects.map((resident, index) => (
                <ResidentRow
                  key={index}
                  resident={resident}
                  index={index}
                  category="potential_new_customer"
                />
              ))}
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
              {currentExistingCustomers.map((resident, index) => (
                <ResidentRow
                  key={index}
                  resident={resident}
                  index={index}
                  category="existing_customer"
                />
              ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Show prospects if no image overlays (address-only search) */}
            {/* This section is for NEW OCR results without photo - do NOT show for loaded datasets */}
            {!showImageOverlays && !externalDatasetId && result && result.newProspects.length > 0 && (
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
          
          {/* Show "Create Resident" button when dataset loaded but no residents */}
          {externalDatasetId && editableResidents.length === 0 && address && address.street && address.number && address.postal && canEdit && (
            <div className="flex flex-col items-center justify-center py-8 text-center border-t pt-6">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('results.noResidentsInDataset', 'Keine Anwohner im Datensatz')}
              </p>
              <Button
                onClick={handleCreateResidentWithoutPhoto}
                disabled={isCreatingDataset}
                className="gap-2"
                data-testid="button-create-resident-dataset-empty"
              >
                <UserPlus className="h-4 w-4" />
                {isCreatingDataset ? t('dataset.creating', 'Erstelle Datensatz...') : t('resident.create', 'Anwohner anlegen')}
              </Button>
            </div>
          )}
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
        currentDatasetId={currentDatasetId}
        addressDataset={address ? {
          address,
          editableResidents,
          fixedCustomers
        } : undefined}
      />

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

      {/* Status Context Menu (Long Press) */}
      <StatusContextMenu
        isOpen={statusMenuOpen}
        x={statusMenuPosition.x}
        y={statusMenuPosition.y}
        onClose={() => {
          setStatusMenuOpen(false);
          setStatusMenuResident(null);
        }}
        onSelectStatus={handleStatusChange}
        onSelectCategory={handleCategoryChange}
        onSelectCategoryAndStatus={handleCategoryAndStatusChange}
        currentStatus={statusMenuResident?.resident.status}
        currentCategory={statusMenuResident?.resident.category}
        mode={statusMenuResident?.resident.category === 'existing_customer' ? 'category' : 'status'}
      />
    </>
  );
}
