import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { EditableResident, ResidentStatus } from '@/../../shared/schema';

interface AddressOverviewProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  residents: EditableResident[];
}

interface FloorData {
  floor: number;
  residents: EditableResident[];
}

export function AddressOverview({ isOpen, onClose, address, residents }: AddressOverviewProps) {
  const { t } = useTranslation();

  // Group residents by floor and organize data
  const floorData = useMemo(() => {
    const floors = new Map<number, EditableResident[]>();
    
    // Group residents by floor (only those with floor data)
    residents.forEach(resident => {
      if (resident.floor !== undefined && resident.floor !== null) {
        if (!floors.has(resident.floor)) {
          floors.set(resident.floor, []);
        }
        floors.get(resident.floor)!.push(resident);
      }
    });

    // Convert to array and sort by floor descending (highest floor at top)
    const floorArray: FloorData[] = Array.from(floors.entries())
      .map(([floor, residents]) => ({ floor, residents }))
      .sort((a, b) => b.floor - a.floor);

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
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status?: ResidentStatus) => {
    if (!status) return '';
    return t(`resident.status.${status}`, status);
  };

  if (floorData.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {t('address.overview.title', 'Adressübersicht')}: {address}
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-muted-foreground">
            {t('address.overview.noFloorData', 'Keine Etagendaten verfügbar')}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {t('address.overview.title', 'Adressübersicht')}: {address}
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="h-full max-h-[60vh] w-full">
          <div className="overflow-x-auto overflow-y-auto">
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
                      {floor}
                    </td>
                    {Array.from({ length: maxResidentsPerFloor }, (_, index) => {
                      const resident = floorResidents[index];
                      return (
                        <td key={index} className="border border-gray-300 px-1 py-1">
                          {resident ? (
                            <div 
                              className={`
                                p-2 rounded border cursor-pointer transition-all duration-200 
                                hover:shadow-md hover:scale-105 max-w-[180px]
                                ${getStatusColor(resident.status)}
                              `}
                              onClick={(e) => {
                                // Toggle highlight on click
                                const target = e.currentTarget;
                                if (target.classList.contains('ring-2')) {
                                  target.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1');
                                } else {
                                  // Remove highlight from other cells
                                  document.querySelectorAll('.ring-2').forEach(el => {
                                    el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1');
                                  });
                                  // Add highlight to clicked cell
                                  target.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1');
                                }
                              }}
                              title={`${resident.name}${resident.status ? ` - ${getStatusText(resident.status)}` : ''}`}
                            >
                              <div className="text-sm font-medium truncate leading-tight">
                                {resident.name}
                              </div>
                              {resident.status && (
                                <div className="text-xs mt-1 leading-tight">
                                  {getStatusText(resident.status)}
                                </div>
                              )}
                              {resident.door && (
                                <div className="text-xs text-muted-foreground mt-1 leading-tight">
                                  {t('address.overview.door', 'Tür')}: {resident.door}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="h-16 w-full"></div> // Empty cell placeholder
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>

        <div className="mt-4 text-sm text-muted-foreground space-y-2">
          <div className="font-medium">{t('address.overview.legend', 'Legende')}:</div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-red-100 text-red-800 border-red-200">
              {t('resident.status.noInterest', 'Kein Interesse')}
            </Badge>
            <Badge className="bg-orange-100 text-orange-800 border-orange-200">
              {t('resident.status.notReached', 'Nicht erreicht')}
            </Badge>
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
              {t('resident.status.interestLater', 'Interesse später')}
            </Badge>
            <Badge className="bg-green-100 text-green-800 border-green-200">
              {t('resident.status.appointment', 'Termin')}
            </Badge>
          </div>
          <div className="text-xs">
            {t('address.overview.clickInstruction', 'Klicken Sie auf eine Zelle, um Details anzuzeigen')}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}