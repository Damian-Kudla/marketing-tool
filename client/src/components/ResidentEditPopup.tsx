import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import type { EditableResident, ResidentCategory, ResidentStatus } from '@/../../shared/schema';

interface ResidentEditPopupProps {
  isOpen: boolean;
  onClose: () => void;
  resident: EditableResident | null;
  onSave: (resident: EditableResident) => Promise<void>;
  onDelete?: (resident: EditableResident) => Promise<void>; // Optional callback for deleting resident
  isEditing?: boolean; // true if editing existing, false if creating new
  currentDatasetId?: string | null; // For category change logging
  addressDataset?: any; // For category change logging snapshot
}

export function ResidentEditPopup({
  isOpen,
  onClose,
  resident,
  onSave,
  onDelete,
  isEditing = false,
  currentDatasetId,
  addressDataset,
}: ResidentEditPopupProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<EditableResident>({
    name: '',
    category: 'potential_new_customer' as ResidentCategory,
    isFixed: false,
  });
  
  // Track the initial category when popup opens (for change logging)
  const [initialCategory, setInitialCategory] = useState<ResidentCategory | null>(null);
  
  // Additional state for appointment details and general notes
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');

  useEffect(() => {
    if (resident && isOpen) {
      setFormData({ ...resident });
      setInitialCategory(resident.category); // Store initial category
      // Reset appointment fields when opening popup
      setAppointmentDate('');
      setAppointmentTime('');
      setGeneralNotes(resident.notes || ''); // Load existing notes
    } else if (!resident && isOpen) {
      setFormData({
        name: '',
        category: 'potential_new_customer' as ResidentCategory,
        isFixed: false,
      });
      setInitialCategory(null);
      setAppointmentDate('');
      setAppointmentTime('');
      setGeneralNotes('');
    }
  }, [resident, isOpen]);

  const handleSave = async () => {
    console.log('[ResidentEditPopup] handleSave called with:', formData);
    
    if (!formData.name.trim()) {
      toast({
        variant: 'destructive',
        title: t('resident.edit.nameRequired', 'Name ist erforderlich'),
        description: t('resident.edit.nameRequiredDesc', 'Bitte geben Sie einen Namen ein'),
      });
      return;
    }

    // Validate floor range (only if floor is provided)
    if (formData.floor !== undefined && (formData.floor < 0 || formData.floor > 100)) {
      toast({
        variant: 'destructive',
        title: t('resident.edit.floorRange', 'Ungültige Etage'),
        description: t('resident.edit.floorRangeDesc', 'Etage muss zwischen 0 und 100 liegen'),
      });
      return;
    }

    // Validate door length
    if (formData.door && formData.door.length > 30) {
      toast({
        variant: 'destructive',
        title: t('resident.edit.doorLength', 'Tür zu lang'),
        description: t('resident.edit.doorLengthDesc', 'Tür darf maximal 30 Zeichen haben'),
      });
      return;
    }

    // Validate appointment fields if status is 'appointment'
    // BUT: Only if category is 'potential_new_customer' (status will be cleared for existing_customer anyway)
    if (formData.status === 'appointment' && formData.category === 'potential_new_customer') {
      if (!appointmentDate || !appointmentTime) {
        toast({
          variant: 'destructive',
          title: 'Termin-Daten erforderlich',
          description: 'Bitte geben Sie Datum und Uhrzeit für den Termin an',
        });
        return;
      }
    }

    setLoading(true);
    try {
      console.log('[ResidentEditPopup] Calling onSave with:', formData);
      
      // Check if category was changed (use initialCategory from popup open, not originalCategory from OCR)
      if (initialCategory && initialCategory !== formData.category && currentDatasetId) {
        console.log('[ResidentEditPopup] Category change detected:', {
          from: initialCategory,
          to: formData.category,
          resident: formData.name
        });
        
        try {
          // Log category change to backend
          const logResponse = await fetch('/api/log-category-change', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              datasetId: currentDatasetId,
              residentOriginalName: resident?.originalName || formData.name,
              residentCurrentName: formData.name,
              oldCategory: initialCategory,
              newCategory: formData.category,
              addressDatasetSnapshot: JSON.stringify(addressDataset || {})
            })
          });
          
          if (!logResponse.ok) {
            console.error('[ResidentEditPopup] Failed to log category change:', logResponse.status, logResponse.statusText);
            const errorText = await logResponse.text();
            console.error('[ResidentEditPopup] Error response:', errorText);
          } else {
            console.log('[ResidentEditPopup] Category change logged successfully');
          }
        } catch (logError) {
          console.error('[ResidentEditPopup] Failed to log category change:', logError);
          // Don't fail the save if logging fails
        }
      }
      
      // Save general notes to formData before saving
      const residentToSave = {
        ...formData,
        notes: generalNotes.trim() || undefined, // Only save notes if non-empty
      };
      
      await onSave(residentToSave);
      console.log('[ResidentEditPopup] onSave completed successfully with notes:', residentToSave.notes);
      
      // If status is 'appointment', create appointment in backend
      if (residentToSave.status === 'appointment' && appointmentDate && appointmentTime && 
          currentDatasetId && addressDataset) {
        try {
          // Build address string from addressDataset
          const addressString = typeof addressDataset.address === 'string' 
            ? addressDataset.address 
            : `${addressDataset.address?.street || ''} ${addressDataset.address?.number || ''}, ${addressDataset.address?.city || ''} ${addressDataset.address?.postal || ''}`.trim();
          
          const appointmentResponse = await fetch('/api/appointments', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              datasetId: currentDatasetId,
              residentName: residentToSave.name,
              address: addressString,
              appointmentDate,
              appointmentTime,
              notes: generalNotes, // Use general notes for appointment as well
            }),
          });

          if (!appointmentResponse.ok) {
            throw new Error('Failed to create appointment');
          }

          console.log('[ResidentEditPopup] Appointment created successfully');
          
          // Invalidate appointments queries to refresh the list
          queryClient.invalidateQueries({ queryKey: ['/api/appointments/upcoming'] });
          queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
          
          console.log('[ResidentEditPopup] Invalidated appointment queries');
        } catch (appointmentError) {
          console.error('[ResidentEditPopup] Error creating appointment:', appointmentError);
          toast({
            variant: 'destructive',
            title: 'Termin konnte nicht erstellt werden',
            description: 'Der Bewohner wurde gespeichert, aber der Termin konnte nicht angelegt werden',
          });
        }
      }
      
      // Toast message is shown by parent component (ResultsDisplay.handleResidentSave)
      onClose();
    } catch (error) {
      console.error('[ResidentEditPopup] Failed to save resident:', error);
      toast({
        variant: 'destructive',
        title: t('resident.edit.error', 'Fehler beim Speichern'),
        description: t('resident.edit.errorDesc', 'Die Änderungen konnten nicht gespeichert werden'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !resident) return;

    setLoading(true);
    try {
      console.log('[ResidentEditPopup] Calling onDelete with:', resident);
      await onDelete(resident);
      console.log('[ResidentEditPopup] onDelete completed successfully');
      toast({
        title: t('resident.delete.success', 'Resident deleted'),
        description: t('resident.delete.successDesc', 'Resident was deleted successfully'),
      });
      onClose();
    } catch (error) {
      console.error('[ResidentEditPopup] Failed to delete resident:', error);
      toast({
        variant: 'destructive',
        title: t('resident.delete.error', 'Error deleting'),
        description: t('resident.delete.errorDesc', 'Resident could not be deleted'),
      });
    } finally {
      setLoading(false);
    }
  };

  const categoryOptions = [
    { value: 'existing_customer', label: t('resident.category.existing', 'Bestandskunde') },
    { value: 'potential_new_customer', label: t('resident.category.potential', 'Potentieller Neukunde') },
  ];

  const statusOptions = [
    { value: 'no_interest', label: t('resident.status.noInterest', 'Kein Interesse') },
    { value: 'not_reached', label: t('resident.status.notReached', 'Nicht erreicht') },
    { value: 'interest_later', label: t('resident.status.interestLater', 'Interesse später') },
    { value: 'appointment', label: t('resident.status.appointment', 'Termin') },
    { value: 'written', label: t('resident.status.written', 'Geschrieben') },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing 
              ? t('resident.edit.titleEdit', 'Bewohner bearbeiten')
              : t('resident.edit.titleNew', 'Neuen Bewohner hinzufügen')
            }
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('resident.edit.name', 'Name')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('resident.edit.namePlaceholder', 'Bewohnername eingeben')}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t('resident.edit.category', 'Kategorie')}</Label>
            <Select
              value={formData.category}
              onValueChange={(value: ResidentCategory) => 
                setFormData({ ...formData, category: value })
              }
              disabled={loading || formData.isFixed}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formData.category === 'potential_new_customer' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="status">{t('resident.edit.status', 'Status')}</Label>
                <Select
                  value={formData.status || ''}
                  onValueChange={(value) => 
                    setFormData({ 
                      ...formData, 
                      status: value ? (value as ResidentStatus) : undefined,
                      // Clear floor and door if status is cleared
                      ...(value ? {} : { floor: undefined, door: undefined })
                    })
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('resident.status.none', 'Kein Status')} />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.status && (
                <>
                  {/* Show appointment fields if status is 'appointment' */}
                  {formData.status === 'appointment' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="appointmentDate">
                          Termin-Datum <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          id="appointmentDate"
                          type="date"
                          value={appointmentDate}
                          onChange={(e) => setAppointmentDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          disabled={loading}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="appointmentTime">
                          Termin-Uhrzeit <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          id="appointmentTime"
                          type="time"
                          value={appointmentTime}
                          onChange={(e) => setAppointmentTime(e.target.value)}
                          disabled={loading}
                          required
                        />
                      </div>
                    </>
                  )}
                  
                  {/* General notes field for all statuses */}
                  <div className="space-y-2">
                    <Label htmlFor="generalNotes">
                      Notizen <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                    <Input
                      id="generalNotes"
                      value={generalNotes}
                      onChange={(e) => setGeneralNotes(e.target.value)}
                      placeholder="z.B. Zusätzliche Informationen"
                      disabled={loading}
                    />
                  </div>
                  
                  {/* Floor and door fields for all statuses */}
                  <div className="space-y-2">
                    <Label htmlFor="floor">
                      {t('resident.edit.floor', 'Etage')} <span className="text-muted-foreground text-xs">(0 = Erdgeschoss, optional)</span>
                    </Label>
                    <Input
                      id="floor"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.floor !== undefined ? formData.floor : ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFormData({ 
                          ...formData, 
                          floor: value === '' ? undefined : parseInt(value)
                        });
                      }}
                      placeholder={t('resident.edit.floorPlaceholder', '0 für Erdgeschoss')}
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="door">{t('resident.edit.door', 'Tür (optional)')}</Label>
                    <Input
                      id="door"
                      value={formData.door || ''}
                      onChange={(e) => setFormData({ ...formData, door: e.target.value })}
                      placeholder={t('resident.edit.doorPlaceholder', 'z.B. A, B, Links')}
                      maxLength={30}
                      disabled={loading}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {/* Delete button - only show if editing existing resident and onDelete callback provided */}
          <div className="flex-1">
            {isEditing && onDelete && resident && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                {t('action.delete', 'Delete')}
              </Button>
            )}
          </div>
          
          {/* Cancel and Save buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t('action.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading}
            >
              {loading 
                ? t('action.saving', 'Saving...') 
                : t('action.save', 'Save')
              }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}