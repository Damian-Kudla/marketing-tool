import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, AlertCircle, UserCheck, UserPlus } from 'lucide-react';

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
}

interface ResultsDisplayProps {
  result?: OCRResult | null;
}

export default function ResultsDisplay({ result }: ResultsDisplayProps) {
  const { t } = useTranslation();

  if (!result || (result.existingCustomers.length === 0 && result.newProspects.length === 0)) {
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

  return (
    <Card data-testid="card-results">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {result.existingCustomers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-success" />
              <p className="text-sm font-medium">
                {t('results.existingCustomers')} ({result.existingCustomers.length})
              </p>
            </div>
            {result.existingCustomers.map((customer, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`row-existing-${index}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-success" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" data-testid={`text-customer-name-${index}`}>
                      {customer.name}
                    </p>
                    {(customer.street || customer.houseNumber || customer.postalCode) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[customer.street, customer.houseNumber, customer.postalCode]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  className="bg-success text-success-foreground flex-shrink-0"
                  data-testid={`badge-existing-${index}`}
                >
                  {t('results.existing')}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {result.newProspects.length > 0 && (
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
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`row-prospect-${index}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-warning" />
                  </div>
                  <span className="font-medium truncate" data-testid={`text-prospect-name-${index}`}>
                    {prospect}
                  </span>
                </div>
                <Badge
                  className="bg-warning text-warning-foreground flex-shrink-0"
                  data-testid={`badge-prospect-${index}`}
                >
                  {t('results.prospect')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
