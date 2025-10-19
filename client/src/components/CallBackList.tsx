import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, MapPin, Clock, ArrowLeftToLine, CalendarIcon, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useFilteredToast } from "@/hooks/use-filtered-toast";
import { useCallBackSession } from "@/contexts/CallBackSessionContext";
import { useUIPreferences } from "@/contexts/UIPreferencesContext";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface CallBackItem {
  datasetId: string;
  address: string;
  notReachedCount: number;
  interestLaterCount: number;
  createdAt: Date;
}

type CallBackPeriod = "today" | "yesterday" | "custom";

interface CallBackListProps {
  onLoadDataset?: (datasetId: string) => Promise<void>;
}

export function CallBackList({ onLoadDataset }: CallBackListProps) {
  const [period, setPeriod] = useState<CallBackPeriod | null>(null);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [sortDescending, setSortDescending] = useState(true); // true = neueste oben, false = älteste oben
  const [, setLocation] = useLocation();
  const { toast } = useFilteredToast();
  const [loading, setLoading] = useState(false);
  const { startCallBackSession } = useCallBackSession();
  const { setCallBackMode, setShowSystemMessages } = useUIPreferences();

  const { data: callBacks, isLoading } = useQuery<CallBackItem[]>({
    queryKey: ['/api/callbacks', period, customDate?.toISOString()],
    enabled: period !== null,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache data
    queryFn: async () => {
      if (!period) return [];
      
      // For custom date, format as YYYY-MM-DD
      let endpoint = `/api/callbacks/${period}`;
      if (period === 'custom' && customDate) {
        const dateStr = format(customDate, 'yyyy-MM-dd');
        endpoint = `/api/callbacks/custom/${dateStr}`;
      }
      
      const response = await fetch(endpoint, {
        credentials: 'include',
        cache: 'no-store' // Prevent browser caching
      });
      if (!response.ok) {
        throw new Error("Fehler beim Laden der Call Back Liste");
      }
      return response.json();
    }
  });

  const handleLoadCallBacks = (selectedPeriod: CallBackPeriod) => {
    setPeriod(selectedPeriod);
    if (selectedPeriod !== 'custom') {
      setCustomDate(undefined); // Clear custom date when selecting today/yesterday
    }
  };

  const handleCustomDateSelect = (date: Date | undefined) => {
    setCustomDate(date);
    if (date) {
      setPeriod('custom');
    }
  };

  const handleQuickStart = async () => {
    if (!callBacks || callBacks.length === 0) return;
    
    // Enable Call Back Mode
    setCallBackMode(true);
    
    // Disable System Messages for focused work
    setShowSystemMessages(false);
    
    // Always start with oldest dataset chronologically (earliest time)
    // Sort list chronologically ascending (oldest first) for the session
    const chronologicalList = [...callBacks].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    // Start with first item (oldest)
    const oldestDataset = chronologicalList[0];
    await handleAddressClickForQuickStart(oldestDataset.datasetId, oldestDataset.address, chronologicalList);
  };

  const handleAddressClickForQuickStart = async (datasetId: string, address: string, chronologicalList: CallBackItem[]) => {
    if (onLoadDataset && period) {
      // Start Call Back session with chronological list (oldest→newest)
      // Index 0 = oldest, so "next" goes to newer datasets
      startCallBackSession(chronologicalList, period, 0);
      
      // Load dataset in current view
      try {
        setLoading(true);
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
          category: 'success',
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
        category: 'success',
      });
    }
  };

  const handleAddressClick = async (datasetId: string, address: string, clickedIndex: number, fromCallBack: boolean = true) => {
    if (onLoadDataset && callBacks && period) {
      // FIX: UNIFIED LOGIC - Always use chronological list (oldest → newest)
      const chronologicalList = [...callBacks].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // Find the clicked dataset's index in the chronological list
      const chronologicalIndex = chronologicalList.findIndex(item => item.datasetId === datasetId);
      
      if (chronologicalIndex === -1) {
        console.error('[CallBackList] Dataset not found in chronological list');
        return;
      }
      
      // Start session with chronological list and correct index
      // Index 0 = oldest, so "Nächster" always goes to newer datasets
      startCallBackSession(chronologicalList, period, chronologicalIndex);
      
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
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={period === "custom" ? "default" : "outline"}
                  className="flex-1"
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {customDate ? format(customDate, "dd.MM.yyyy", { locale: de }) : "Datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customDate}
                  onSelect={handleCustomDateSelect}
                  initialFocus
                  locale={de}
                  disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Quick Start button - shown when date is selected and there are callbacks */}
          {period && callBacks && callBacks.length > 0 && !isLoading && (
            <Button
              onClick={handleQuickStart}
              variant="default"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
              size="lg"
            >
              <Zap className="h-5 w-5 mr-2" />
              Quick Start - Erste Adresse öffnen
            </Button>
          )}

          {/* Loading state */}
          {(isLoading || loading) && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">{isLoading ? 'Lade Call Backs...' : 'Lade Datensatz...'}</span>
            </div>
          )}

          {/* Call backs list */}
          {!isLoading && callBacks && callBacks.length > 0 && (
            <>
              {/* Sort toggle button */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {callBacks.length} Call Back{callBacks.length !== 1 ? 's' : ''}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDescending(!sortDescending)}
                  className="gap-2"
                >
                  <Clock className="h-4 w-4" />
                  {sortDescending ? "Neueste zuerst" : "Älteste zuerst"}
                </Button>
              </div>

              <div className="space-y-2">
                {/* Sort the displayed list based on toggle */}
                {[...callBacks]
                  .sort((a, b) => {
                    const timeA = new Date(a.createdAt).getTime();
                    const timeB = new Date(b.createdAt).getTime();
                    return sortDescending ? timeB - timeA : timeA - timeB;
                  })
                  .map((item, displayIndex) => {
                    // Find original index in unsorted array for session management
                    const originalIndex = callBacks.findIndex(cb => cb.datasetId === item.datasetId);
                    return (
                      <Card
                        key={item.datasetId}
                        className="cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleAddressClick(item.datasetId, item.address, originalIndex)}
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
                    );
                  })}
              </div>
            </>
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
