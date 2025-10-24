import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, MapPin, Users, Loader2, ArrowLeftToLine, Clock } from 'lucide-react';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import { datasetAPI } from '@/services/api';

interface HistoryItem {
  id: string;
  address: string;
  city?: string;
  postalCode: string;
  createdAt: string;
  residentCount: number;
  notReachedCount?: number;
  interestLaterCount?: number;
}

interface UserHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  onLoadDataset?: (datasetId: string) => void;
}

export function UserHistory({ isOpen, onClose, username, onLoadDataset }: UserHistoryProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Load history when date changes or dialog opens
  useEffect(() => {
    if (isOpen && selectedDate) {
      loadHistory();
    }
  }, [isOpen, selectedDate]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await datasetAPI.getUserHistory(username, selectedDate);
      setHistoryItems(data);
    } catch (error) {
      console.error('Error loading history:', error);
      toast({
        variant: 'destructive',
        title: t('history.loadError', 'Fehler beim Laden'),
        description: t('history.loadErrorDesc', 'Verlauf konnte nicht geladen werden'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDataset = async (datasetId: string) => {
    try {
      setLoading(true);
      
      if (onLoadDataset) {
        await onLoadDataset(datasetId);
        onClose();
        toast({
          title: t('history.datasetLoaded', 'Datensatz geladen'),
          description: t('history.datasetLoadedDesc', 'Der Datensatz wurde erfolgreich geladen'),
        });
      }
    } catch (error) {
      console.error('Error loading dataset:', error);
      toast({
        variant: 'destructive',
        title: t('history.loadDatasetError', 'Fehler beim Laden'),
        description: t('history.loadDatasetErrorDesc', 'Datensatz konnte nicht geladen werden'),
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t('history.title', 'Benutzer-Verlauf')}: {username}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date selector */}
          <div className="space-y-2">
            <Label htmlFor="date">{t('history.selectDate', 'Datum auswählen')}</Label>
            <Input
              id="date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]} // Don't allow future dates
            />
          </div>

          {/* History results */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {t('history.resultsFor', 'Ergebnisse für')} {new Date(selectedDate).toLocaleDateString('de-DE')}
              </h3>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>

            <ScrollArea className="h-64">
              {historyItems.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {loading 
                    ? t('history.loading', 'Laden...')
                    : t('history.noData', 'Keine Daten für diesen Tag gefunden')
                  }
                </div>
              ) : (
                <div className="space-y-2 pr-4">
                  {historyItems.map((item) => (
                    <Card key={item.id} className="cursor-pointer hover:bg-gray-50 transition-colors">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-sm">{item.address}</span>
                            </div>
                            {item.city && (
                              <div className="text-xs text-muted-foreground ml-6">
                                {item.postalCode} {item.city}
                              </div>
                            )}
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {t('history.residentCount', '{{count}} Bewohner', { count: item.residentCount })}
                              </div>
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(item.createdAt)}
                              </div>
                            </div>
                            {/* Call Back badges */}
                            {((item.notReachedCount ?? 0) > 0 || (item.interestLaterCount ?? 0) > 0) && (
                              <div className="flex items-center gap-2 mt-2">
                                <ArrowLeftToLine className="h-3 w-3 text-orange-600" />
                                {(item.notReachedCount ?? 0) > 0 && (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                    {item.notReachedCount}× Nicht erreicht
                                  </Badge>
                                )}
                                {(item.interestLaterCount ?? 0) > 0 && (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                    {item.interestLaterCount}× Interesse später
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLoadDataset(item.id)}
                            disabled={loading}
                          >
                            {t('history.load', 'Laden')}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}