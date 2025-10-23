import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, User, ChevronDown, ChevronUp } from 'lucide-react';
import { datasetAPI } from '@/services/api';
import type { Address } from '@/components/GPSAddressForm';

interface AddressDataset {
  id: string;
  createdBy: string;
  createdAt: string;
  residentCount: number;
  street?: string;
  houseNumber?: string;
  isNonExactMatch?: boolean;
}

interface AddressDatasetsProps {
  address: Address;
  onLoadDataset: (datasetId: string) => void;
  shouldLoad?: boolean; // Signal to load datasets
  useNormalization?: boolean; // If true, uses normalized search (for "Adresse durchsuchen" button)
  onAddressCorrected?: (correctedAddress: Address) => void; // Callback when backend returns corrected address
}

export function AddressDatasets({ address, onLoadDataset, shouldLoad, useNormalization = false, onAddressCorrected }: AddressDatasetsProps) {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<AddressDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Create normalized address string for comparison
  const normalizedAddress = address 
    ? `${address.street || ''} ${address.number || ''} ${address.postal || ''} ${address.city || ''}`.toLowerCase().trim()
    : null;

  // Load datasets when address changes (automatically on every address change)
  useEffect(() => {
    if (shouldLoad && normalizedAddress) {
      console.log(`[AddressDatasets] Address changed, loading datasets (${useNormalization ? 'normalized' : 'local'} search) for:`, normalizedAddress);
      loadDatasets();
    }
  }, [shouldLoad, normalizedAddress, useNormalization]);

  // Clear datasets when address is cleared
  useEffect(() => {
    if (!normalizedAddress) {
      console.log('[AddressDatasets] Address cleared, resetting datasets');
      setDatasets([]);
      setIsExpanded(false);
    }
  }, [normalizedAddress]);

  const loadDatasets = async () => {
    setLoading(true);
    try {
      // Choose endpoint based on useNormalization prop
      const response = useNormalization
        ? await datasetAPI.getDatasets(address)        // WITH normalization (for "Adresse durchsuchen")
        : await datasetAPI.searchDatasetsLocal(address); // WITHOUT normalization (for +/- buttons)
      
      console.log(`[AddressDatasets] Loaded datasets using ${useNormalization ? 'normalized' : 'local'} search:`, response.datasets.length);
      
      // If backend returned corrected address, notify parent
      if (useNormalization && response.correctedAddress && onAddressCorrected) {
        const { street, number, city, postal } = response.correctedAddress;
        console.log('[AddressDatasets] Backend returned corrected address:', response.correctedAddress);
        onAddressCorrected({
          street,
          number,
          city,
          postal,
          onlyEven: address?.onlyEven,
          onlyOdd: address?.onlyOdd
        });
      }
      
      // Transform datasets to AddressDataset format
      const addressDatasets = response.datasets.map((ds: any) => ({
        id: ds.id,
        createdBy: ds.createdBy,
        createdAt: ds.createdAt,
        residentCount: (ds.editableResidents?.length || 0) + (ds.fixedCustomers?.length || 0),
        street: ds.street,
        houseNumber: ds.houseNumber,
        isNonExactMatch: ds.isNonExactMatch,
      }));
      
      setDatasets(addressDatasets);
    } catch (error) {
      console.error('Error loading datasets:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          {t('datasets.loading', 'Lade Datensätze...')}
        </CardContent>
      </Card>
    );
  }

  if (datasets.length === 0) {
    return null; // Don't show anything if no datasets
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t('datasets.oldDatasetsAvailable', 'Alte Datensätze verfügbar')} ({datasets.length})
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 space-y-2">
          {datasets.map((dataset) => {
            // Check if query has multiple house numbers (comma, slash, or hyphen)
            const queryHasMultipleNumbers = address.number && (
              address.number.includes(',') || 
              address.number.includes('/') ||
              address.number.includes('-')
            );
            
            // Check if dataset has multiple house numbers
            const datasetHasMultipleNumbers = dataset.houseNumber && (
              dataset.houseNumber.includes(',') || 
              dataset.houseNumber.includes('/') ||
              dataset.houseNumber.includes('-')
            );
            
            // Show address if:
            // 1. It's a non-exact match (different house number), OR
            // 2. Query has multiple numbers (e.g., "23,24"), OR
            // 3. Dataset covers multiple numbers (e.g., "23/24")
            const shouldShowAddress = 
              dataset.isNonExactMatch || 
              queryHasMultipleNumbers || 
              datasetHasMultipleNumbers;
            
            return (
              <div
                key={dataset.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => onLoadDataset(dataset.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{dataset.createdBy}</p>
                    {shouldShowAddress && dataset.street && dataset.houseNumber && (
                      <p className="text-xs font-medium text-blue-600 truncate">
                        {dataset.street} {dataset.houseNumber}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {formatDate(dataset.createdAt)} • {dataset.residentCount} {t('datasets.residents', 'Bewohner')}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0 ml-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadDataset(dataset.id);
                  }}
                >
                  {t('datasets.load', 'Laden')}
                </Button>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
