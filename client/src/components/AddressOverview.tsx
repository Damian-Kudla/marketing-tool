import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ResidentEditPopup } from './ResidentEditPopup';
import type { EditableResident, ResidentStatus } from '@/../../shared/schema';
import { STATUS_LABELS } from '@/constants/statuses';

interface AddressOverviewProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  residents: EditableResident[];
  asDialog?: boolean; // Optional: render as Dialog (default) or Card
  onResidentClick?: (resident: EditableResident, index: number) => void; // Optional: callback when resident is clicked
  canEdit?: boolean; // Optional: whether editing is allowed
  onResidentUpdate?: (residents: EditableResident[]) => void; // Optional: callback when residents are updated
  currentDatasetId?: string | null; // Optional: dataset ID for saving changes
}

interface FloorData {
  floor: number;
  residents: EditableResident[];
}

export function AddressOverview({ isOpen, onClose, address, residents, asDialog = true, onResidentClick, canEdit = false, onResidentUpdate, currentDatasetId }: AddressOverviewProps) {
  const { t } = useTranslation();
  
  // State for editing
  const [showEditPopup, setShowEditPopup] = useState(false);
  const [editingResident, setEditingResident] = useState<EditableResident | null>(null);
  const [editingResidentIndex, setEditingResidentIndex] = useState<number | null>(null);

  // Group residents by floor and organize data
  const floorData = useMemo(() => {
    const floors = new Map<number, EditableResident[]>();
    const residentsWithoutFloor: EditableResident[] = [];
    
    // Filter out residents without status
    const residentsWithStatus = residents.filter(resident => resident.status);
    
    // Group residents by floor
    residentsWithStatus.forEach(resident => {
      if (resident.floor !== undefined && resident.floor !== null) {
        if (!floors.has(resident.floor)) {
          floors.set(resident.floor, []);
        }
        floors.get(resident.floor)!.push(resident);
      } else {
        // Residents without floor go into special collection
        residentsWithoutFloor.push(resident);
      }
    });

    // Convert to array and sort by floor descending (highest floor at top)
    const floorArray: FloorData[] = Array.from(floors.entries())
      .map(([floor, residents]) => ({ floor, residents }))
      .sort((a, b) => b.floor - a.floor);

    // Add "Sammeletage" at the end if there are residents without floor
    if (residentsWithoutFloor.length > 0) {
      floorArray.push({
        floor: -1, // Special marker for "no floor"
        residents: residentsWithoutFloor
      });
    }

    return floorArray;
  }, [residents]);

  // Find maximum residents per floor for table layout
  const maxResidentsPerFloor = useMemo(() => {
    return Math.max(1, ...floorData.map(floor => floor.residents.length));
  }, [floorData]);

  // Get status color
  const getStatusColor = (status?: ResidentStatus) => {
    switch (status) {
      case 'no_interest':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'not_reached':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'interest_later':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'appointment':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'written':
        return 'bg-green-800 text-white border-green-900'; // Dunkelgrün für "Geschrieben"
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status?: ResidentStatus) => {
    if (!status) return '';
    return STATUS_LABELS[status] || t(`resident.status.${status}`, status);
  };

  // Handle resident click for editing
  const handleResidentClick = (resident: EditableResident, index: number) => {
    if (canEdit) {
      setEditingResident(resident);
      setEditingResidentIndex(index);
      setShowEditPopup(true);
      
      // Also call the external callback if provided
      onResidentClick?.(resident, index);
    }
  };

  // Handle resident save
  const handleResidentSave = async (updatedResident: EditableResident) => {
    if (editingResidentIndex !== null && onResidentUpdate) {
      const updatedResidents = [...residents];
      updatedResidents[editingResidentIndex] = updatedResident;
      onResidentUpdate(updatedResidents);
    }
    setShowEditPopup(false);
    setEditingResident(null);
    setEditingResidentIndex(null);
  };

  // Content component (shared between Dialog and Card view)
  const OverviewContent = () => {
    if (floorData.length === 0) {
      return (
        <div className="py-8 text-center text-muted-foreground">
          {t('address.overview.noFloorData', 'Keine Etagendaten verfügbar')}
        </div>
      );
    }

    return (
      <>
        <div className="max-h-[60vh] w-full table-scroll-container">
          <table className="w-full border-collapse border border-gray-300 min-w-max">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-300 px-3 py-2 text-left font-medium text-sm">
                  {t('address.overview.floor', 'Etage')}
                </th>
                {Array.from({ length: maxResidentsPerFloor }, (_, index) => (
                  <th 
                    key={index} 
                    className="border border-gray-300 px-3 py-2 text-left font-medium text-sm min-w-[120px] max-w-[200px]"
                  >
                    {t('address.overview.resident', 'Bewohner')} {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
              <tbody>
                {floorData.map(({ floor, residents: floorResidents }) => (
                  <tr key={floor} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium text-center">
                      {floor === -1 ? '-*' : floor}
                    </td>
                    {Array.from({ length: maxResidentsPerFloor }, (_, index) => {
                      const resident = floorResidents[index];
                      // Find original index in full residents array
                      const originalIndex = resident ? residents.findIndex(r => 
                        r.name === resident.name && 
                        r.floor === resident.floor && 
                        r.door === resident.door
                      ) : -1;
                      
                      return (
                        <td key={index} className="border border-gray-300 px-1 py-1">
                          {resident ? (
                            <div 
                              className={`
                                p-2 rounded border transition-all duration-200 
                                hover:shadow-md hover:scale-105 max-w-[180px]
                                ${canEdit && onResidentClick ? 'cursor-pointer' : 'cursor-default'}
                                ${getStatusColor(resident.status)}
                              `}
                              onClick={() => {
                                if (canEdit && originalIndex !== -1) {
                                  handleResidentClick(resident, originalIndex);
                                }
                              }}
                              title={`${resident.name}${resident.status ? ` - ${getStatusText(resident.status)}` : ''}${canEdit ? ' (Klicken zum Bearbeiten)' : ''}`}
                            >
                              <div className="text-sm font-medium truncate leading-tight">
                                {resident.name}
                              </div>
                              {resident.status && (
                                <div className="text-xs mt-1 leading-tight">
                                  {getStatusText(resident.status)}
                                </div>
                              )}
                              {resident.notes && (
                                <div className="text-xs text-muted-foreground mt-1 leading-tight truncate" title={resident.notes}>
                                  {resident.notes.length > 15 ? `${resident.notes.substring(0, 15)}...` : resident.notes}
                                </div>
                              )}
                              {resident.door && (
                                <div className="text-xs text-muted-foreground mt-1 leading-tight">
                                  {t('address.overview.door', 'Tür')}: {resident.door}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="h-16 w-full"></div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
        </div>

        <div className="mt-4 text-sm text-muted-foreground space-y-2">
          <div className="font-medium">{t('address.overview.legend', 'Legende')}:</div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-red-100 text-red-800 border-red-200">
              Kein Interesse
            </Badge>
            <Badge className="bg-orange-100 text-orange-800 border-orange-200">
              Nicht erreicht
            </Badge>
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
              Interesse später
            </Badge>
            <Badge className="bg-green-100 text-green-800 border-green-200">
              Termin
            </Badge>
            <Badge className="bg-green-800 text-white border-green-900">
              Geschrieben
            </Badge>
          </div>
          <div className="space-y-1 text-xs">
            <div>{t('address.overview.clickInstruction', 'Klicken Sie auf eine Zelle, um Details anzuzeigen')}</div>
            <div className="italic">*Den Anwohnern in dieser Zeile wurde keine Etage zugeordnet.</div>
          </div>
        </div>
      </>
    );
  };

  // Render as Dialog or Card depending on asDialog prop
  if (!isOpen && asDialog) return null;

  if (asDialog) {
    return (
      <>
        <Dialog open={isOpen} onOpenChange={onClose}>
          <DialogContent className="max-w-6xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="text-lg">
                {t('address.overview.title', 'Adressübersicht')}: {address}
              </DialogTitle>
            </DialogHeader>
            <OverviewContent />
          </DialogContent>
        </Dialog>
        
        {/* Edit Popup */}
        {editingResident && (
          <ResidentEditPopup
            isOpen={showEditPopup}
            onClose={() => {
              setShowEditPopup(false);
              setEditingResident(null);
              setEditingResidentIndex(null);
            }}
            resident={editingResident}
            onSave={handleResidentSave}
            isEditing={true}
            currentDatasetId={currentDatasetId}
            addressDataset={{
              address,
              editableResidents: residents
            }}
          />
        )}
      </>
    );
  }

  // Card view for Call Back mode
  return (
    <>
      <div className="border rounded-lg p-4 bg-card">
        <h3 className="text-lg font-semibold mb-4">
          {t('address.overview.title', 'Adressübersicht')}: {address}
        </h3>
        <OverviewContent />
      </div>
      
      {/* Edit Popup */}
      {editingResident && (
        <ResidentEditPopup
          isOpen={showEditPopup}
          onClose={() => {
            setShowEditPopup(false);
            setEditingResident(null);
            setEditingResidentIndex(null);
          }}
          resident={editingResident}
          onSave={handleResidentSave}
          isEditing={true}
          currentDatasetId={currentDatasetId}
          addressDataset={{
            address,
            editableResidents: residents
          }}
        />
      )}
    </>
  );
}