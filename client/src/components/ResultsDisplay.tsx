import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, AlertCircle } from 'lucide-react';

export interface CustomerResult {
  name: string;
  isExisting: boolean;
}

interface ResultsDisplayProps {
  results?: CustomerResult[];
}

export default function ResultsDisplay({ results = [] }: ResultsDisplayProps) {
  const { t } = useTranslation();

  return (
    <Card data-testid="card-results">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('results.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="text-empty">
              {t('results.empty')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground mb-3">
              {t('results.names')}
            </p>
            {results.map((result, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`row-result-${index}`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="font-medium" data-testid={`text-name-${index}`}>
                    {result.name}
                  </span>
                </div>
                <Badge
                  variant={result.isExisting ? "default" : "secondary"}
                  className={result.isExisting ? "bg-success text-white" : "bg-warning text-foreground"}
                  data-testid={`badge-status-${index}`}
                >
                  {result.isExisting ? t('results.existing') : t('results.prospect')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
