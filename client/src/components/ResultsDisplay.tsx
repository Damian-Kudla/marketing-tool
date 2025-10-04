import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, AlertCircle, UserCheck, UserPlus } from 'lucide-react';
import ImageWithOverlays from './ImageWithOverlays';
import type { Address } from '@/components/GPSAddressForm';

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
}

export default function ResultsDisplay({ result, photoImageSrc, address, onNamesUpdated }: ResultsDisplayProps) {
  const { t } = useTranslation();

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

  // Helper to determine what to display in the Bestandskunden section
  // If we have residentNames (photo uploaded), show the photo names that matched
  // If no residentNames (address-only search), show the customer names from database
  const getMatchedNames = (): Array<{name: string, isPhotoName: boolean}> => {
    if (result.residentNames.length > 0) {
      // Photo was uploaded - show photo names that matched
      const photoMatchedNames = result.residentNames.filter(name => !result.newProspects.includes(name));
      return photoMatchedNames.map(name => ({name, isPhotoName: true}));
    } else if (result.existingCustomers.length > 0) {
      // Address-only search - show customer names from database
      return result.existingCustomers.map(customer => ({name: customer.name, isPhotoName: false}));
    }
    return [];
  };

  const matchedNames = getMatchedNames();

  return (
    <>
      {showImageOverlays && (
        <div className="mb-4">
          <ImageWithOverlays
            imageSrc={photoImageSrc!}
            fullVisionResponse={result.fullVisionResponse}
            residentNames={result.residentNames}
            existingCustomers={result.existingCustomers}
            newProspects={result.newProspects}
            allCustomersAtAddress={result.allCustomersAtAddress}
            address={address}
            onNamesUpdated={onNamesUpdated}
          />
        </div>
      )}
      
      <Card data-testid="card-results">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
        {matchedNames.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-success" />
              <p className="text-sm font-medium">
                {t('results.existingCustomers')} ({matchedNames.length})
              </p>
            </div>
            {matchedNames.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`row-existing-${index}`}
              >
                <div className="h-9 w-9 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium overflow-x-auto whitespace-nowrap" data-testid={`text-customer-name-${index}`}>
                    {item.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Only show prospects list if no image overlays (address-only search) */}
        {!showImageOverlays && result.newProspects.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-warning" />
              <p className="text-sm font-medium">
                {t('results.newProspects')} ({result.newProspects.length})
              </p>
            </div>
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
        )}

        {result.allCustomersAtAddress && result.allCustomersAtAddress.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">
                {t('results.allCustomersAtAddress')} ({result.allCustomersAtAddress.length})
              </p>
            </div>
            {result.allCustomersAtAddress.map((customer, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`row-address-customer-${index}`}
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}
