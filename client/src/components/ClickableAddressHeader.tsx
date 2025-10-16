import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AddressOverview } from './AddressOverview';
import type { Address } from '@/components/GPSAddressForm';
import type { EditableResident } from '@/../../shared/schema';

interface ClickableAddressHeaderProps {
  address: Address;
  residents?: EditableResident[];
  canEdit?: boolean;
  datasetCreatedAt?: string | null;
  onResidentsUpdate?: (residents: EditableResident[]) => void;
  currentDatasetId?: string | null;
}

export function ClickableAddressHeader({ 
  address, 
  residents = [], 
  canEdit, 
  datasetCreatedAt,
  onResidentsUpdate,
  currentDatasetId
}: ClickableAddressHeaderProps) {
  const { t } = useTranslation();
  const [showOverview, setShowOverview] = useState(false);

  // Format address for display in header with street truncation
  const truncateStreet = (street: string) => {
    if (street.length <= 10) return street;
    return `${street.slice(0, 10)}...`;
  };
  
  const displayAddress = `${truncateStreet(address.street)} ${address.number}`;
  const fullAddressString = `${address.street} ${address.number}, ${address.postal} ${address.city || ''}`.trim();

  // Filter residents that have status (floor is now optional)
  const residentsWithStatus = residents.filter(r => r.status);

  // Determine dataset state message - split into date part and status part
  const getDatasetStateText = () => {
    // Don't show any status if no dataset exists yet
    if (!datasetCreatedAt) {
      return null;
    }
    
    const createdDate = new Date(datasetCreatedAt);
    const formattedDate = createdDate.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    if (canEdit) {
      return {
        prefix: `Datensatz vom ${formattedDate} -`,
        suffix: 'Bearbeitung möglich'
      };
    } else {
      return {
        prefix: `Datensatz vom ${formattedDate} -`,
        suffix: 'Bearbeitung nicht mehr möglich'
      };
    }
  };

  const getDatasetStateColor = () => {
    if (!datasetCreatedAt) return '';
    if (canEdit) return 'text-blue-600';
    return 'text-gray-500';
  };

  const datasetStateText = getDatasetStateText();

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-1 text-left hover:bg-muted/50"
        onClick={() => setShowOverview(true)}
        title={t('address.header.clickToView', 'Klicken für Übersicht')}
      >
        <div className="flex flex-col items-start gap-0.5 min-w-fit">
          <div className="flex items-center gap-1 whitespace-nowrap">
            <span className="text-sm font-medium">📍</span>
            <div className="text-sm">
              {displayAddress}
            </div>
            {residentsWithStatus.length > 0 && (
              <span className="text-xs text-blue-600 ml-1">
                ({residentsWithStatus.length})
              </span>
            )}
          </div>
          {datasetStateText && (
            <div className={`text-xs ${getDatasetStateColor()} ml-5`}>
              <div className="whitespace-nowrap">{datasetStateText.prefix}</div>
              <div>{datasetStateText.suffix}</div>
            </div>
          )}
        </div>
      </Button>

      <AddressOverview
        isOpen={showOverview}
        onClose={() => setShowOverview(false)}
        address={fullAddressString}
        residents={residentsWithStatus}
        canEdit={canEdit}
        onResidentUpdate={onResidentsUpdate}
        currentDatasetId={currentDatasetId}
      />
    </>
  );
}