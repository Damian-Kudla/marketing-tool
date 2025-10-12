import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useToast } from '@/hooks/use-toast';
import type { EditableResident, ResidentCategory, ResidentStatus } from '@/../../shared/schema';

interface ResidentEditPopupProps {
  isOpen: boolean;
  onClose: () => void;
  resident: EditableResident | null;
  onSave: (resident: EditableResident) => Promise<void>;
  onDelete?: (resident: EditableResident) => Promise<void>; // Optional callback for deleting resident
  isEditing?: boolean; // true if editing existing, false if creating new
}

export function ResidentEditPopup({
  isOpen,
  onClose,
  resident,
  onSave,
  onDelete,
  isEditing = false,
}: ResidentEditPopupProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<EditableResident>({
    name: '',
    category: 'potential_new_customer' as ResidentCategory,
    isFixed: false,
  });

  useEffect(() => {
    if (resident && isOpen) {
      setFormData({ ...resident });
    } else if (!resident && isOpen) {
      setFormData({
        name: '',
        category: 'potential_new_customer' as ResidentCategory,
        isFixed: false,
      });
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

    // Validate floor is required if status is set
    if (formData.status && (formData.floor === undefined || formData.floor === null)) {
      toast({
        variant: 'destructive',
        title: t('resident.edit.floorRequired', 'Etage ist erforderlich'),
        description: t('resident.edit.floorRequiredDesc', 'Bitte geben Sie eine Etage an, wenn ein Status gesetzt ist'),
      });
      return;
    }

    // Validate floor range
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

    setLoading(true);
    try {
      console.log('[ResidentEditPopup] Calling onSave with:', formData);
      await onSave(formData);
      console.log('[ResidentEditPopup] onSave completed successfully');
      toast({
        title: t('resident.edit.success', 'Bewohner gespeichert'),
        description: t('resident.edit.successDesc', 'Die Änderungen wurden erfolgreich gespeichert'),
      });
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
                  <div className="space-y-2">
                    <Label htmlFor="floor">
                      {t('resident.edit.floor', 'Etage')} *
                    </Label>
                    <Input
                      id="floor"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.floor || ''}
                      onChange={(e) => 
                        setFormData({ 
                          ...formData, 
                          floor: e.target.value ? parseInt(e.target.value) : undefined 
                        })
                      }
                      placeholder={t('resident.edit.floorPlaceholder', 'z.B. 3')}
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