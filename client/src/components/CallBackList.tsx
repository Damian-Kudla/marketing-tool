import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Clock, ArrowLeftToLine } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useFilteredToast } from "@/hooks/use-filtered-toast";
import { useCallBackSession } from "@/contexts/CallBackSessionContext";

interface CallBackItem {
  datasetId: string;
  address: string;
  notReachedCount: number;
  interestLaterCount: number;
  createdAt: Date;
}

type CallBackPeriod = "today" | "yesterday";

interface CallBackListProps {
  onLoadDataset?: (datasetId: string) => Promise<void>;
}

export function CallBackList({ onLoadDataset }: CallBackListProps) {
  const [period, setPeriod] = useState<CallBackPeriod | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useFilteredToast();
  const [loading, setLoading] = useState(false);
  const { startCallBackSession } = useCallBackSession();

  const { data: callBacks, isLoading } = useQuery<CallBackItem[]>({
    queryKey: ['/api/callbacks', period],
    enabled: period !== null,
    queryFn: async () => {
      if (!period) return [];
      const response = await fetch(`/api/callbacks/${period}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error("Fehler beim Laden der Call Back Liste");
      }
      return response.json();
    }
  });

  const handleLoadCallBacks = (selectedPeriod: CallBackPeriod) => {
    setPeriod(selectedPeriod);
  };

  const handleAddressClick = async (datasetId: string, address: string, clickedIndex: number, fromCallBack: boolean = true) => {
    if (onLoadDataset && callBacks && period) {
      // Start Call Back session with full list and set current index
      startCallBackSession(callBacks, period, clickedIndex);
      
      // Load dataset in current view - mark as loaded from CallBack
      try {
        setLoading(true);
        // Verify dataset exists before loading
        const response = await fetch(`/api/address-datasets/${datasetId}`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch dataset: ${response.status}`);
        }
        
        const dataset = await response.json();
        
        await onLoadDataset(datasetId);
        
        toast({
          title: "Adresse geladen",
          description: `${address} wurde geöffnet`,
        });
      } catch (error) {
        console.error('Error loading dataset:', error);
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Datensatz konnte nicht geladen werden",
        });
      } finally {
        setLoading(false);
      }
    } else {
      // Fallback: Navigate to scanner page with the dataset ID
      setLocation(`/scanner?datasetId=${datasetId}`);
      toast({
        title: "Adresse geladen",
        description: `${address} wurde geöffnet`,
      });
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftToLine className="h-6 w-6" />
            Call Back Liste
          </CardTitle>
          <CardDescription>
            Adressen mit "Nicht erreicht" oder "Interesse später"
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Period selection buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => handleLoadCallBacks("today")}
              variant={period === "today" ? "default" : "outline"}
              className="flex-1"
            >
              <Clock className="h-4 w-4 mr-2" />
              Heute
            </Button>
            <Button
              onClick={() => handleLoadCallBacks("yesterday")}
              variant={period === "yesterday" ? "default" : "outline"}
              className="flex-1"
            >
              <Clock className="h-4 w-4 mr-2" />
              Gestern
            </Button>
          </div>

          {/* Loading state */}
          {(isLoading || loading) && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">{isLoading ? 'Lade Call Backs...' : 'Lade Datensatz...'}</span>
            </div>
          )}

          {/* Call backs list */}
          {!isLoading && callBacks && callBacks.length > 0 && (
            <div className="space-y-2">
              {callBacks.map((item, index) => (
                <Card
                  key={item.datasetId}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => handleAddressClick(item.datasetId, item.address, index)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{item.address}</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {item.notReachedCount > 0 && (
                            <Badge variant="secondary">
                              {item.notReachedCount}× Nicht erreicht
                            </Badge>
                          )}
                          {item.interestLaterCount > 0 && (
                            <Badge variant="secondary">
                              {item.interestLaterCount}× Interesse später
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right ml-4">
                        {formatDate(item.createdAt)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && callBacks && callBacks.length === 0 && period && (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowLeftToLine className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>
                Keine Call Backs für {period === "today" ? "heute" : "gestern"}
              </p>
            </div>
          )}

          {/* Initial state */}
          {!period && !isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              <p>Wähle einen Zeitraum aus, um Call Backs anzuzeigen</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
