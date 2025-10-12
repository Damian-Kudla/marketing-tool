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
}

interface AddressDatasetsProps {
  address: Address;
  onLoadDataset: (datasetId: string) => void;
}

export function AddressDatasets({ address, onLoadDataset }: AddressDatasetsProps) {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<AddressDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    loadDatasets();
  }, [address]);

  const loadDatasets = async () => {
    setLoading(true);
    try {
      const response = await datasetAPI.getDatasets(address);
      
      // Transform datasets to AddressDataset format
      const addressDatasets = response.datasets.map((ds: any) => ({
        id: ds.id,
        createdBy: ds.createdBy,
        createdAt: ds.createdAt,
        residentCount: (ds.editableResidents?.length || 0) + (ds.fixedCustomers?.length || 0),
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
          {datasets.map((dataset) => (
            <div
              key={dataset.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => onLoadDataset(dataset.id)}
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">{dataset.createdBy}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(dataset.createdAt)} • {dataset.residentCount} {t('datasets.residents', 'Bewohner')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onLoadDataset(dataset.id);
                }}
              >
                {t('datasets.load', 'Laden')}
              </Button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
