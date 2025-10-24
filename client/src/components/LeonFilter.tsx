import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Calendar, User } from 'lucide-react';
import { datasetAPI } from '@/services/api';
import type { ResidentStatus, EditableResident, AddressDataset } from '@shared/schema';
import { RESIDENT_STATUSES as ALL_STATUSES, STATUS_LABELS } from '@/constants/statuses';
import { useAuth } from '@/contexts/AuthContext';

interface LeonFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadDataset: (datasetId: string) => void;
}

interface FilteredResident {
  name: string;
  status: ResidentStatus;
  notes?: string;
}

interface DatasetWithResidents extends AddressDataset {
  filteredResidents: FilteredResident[];
}

export function LeonFilter({ isOpen, onClose, onLoadDataset }: LeonFilterProps) {
  const { username: currentUsername } = useAuth();
  const [streetInput, setStreetInput] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [streetSuggestions, setStreetSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null);
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<ResidentStatus>>(new Set(ALL_STATUSES));
  const [datasets, setDatasets] = useState<DatasetWithResidents[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightsEnabled, setHighlightsEnabled] = useState(true);

  // Fetch street suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (streetInput.length < 2) {
        setStreetSuggestions([]);
        return;
      }

      setLoadingSuggestions(true);
      try {
        const response = await fetch(`/api/address-datasets/streets/suggestions?query=${encodeURIComponent(streetInput)}`);
        const data = await response.json();
        setStreetSuggestions(data.streets || []);
      } catch (error) {
        console.error('Error fetching street suggestions:', error);
        setStreetSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    };

    const debounceTimeout = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(debounceTimeout);
  }, [streetInput]);

  // Load datasets when street is selected
  useEffect(() => {
    const loadDatasets = async () => {
      if (!selectedStreet) {
        setDatasets([]);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(`/api/address-datasets/streets/${encodeURIComponent(selectedStreet)}`);
        const data = await response.json();
        
        // Filter and transform datasets
        const filtered = (data.datasets || [])
          .map((dataset: AddressDataset) => {
            // Filter by house number if provided
            if (houseNumber && dataset.houseNumber !== houseNumber) {
              return null;
            }

            // Filter residents by status
            const filteredResidents = (dataset.editableResidents || [])
              .filter((resident: EditableResident) => 
                resident.status && selectedStatuses.has(resident.status)
              )
              .map((resident: EditableResident) => ({
                name: resident.name,
                status: resident.status!,
                notes: resident.notes
              }));

            // Only include dataset if it has residents after filtering
            if (filteredResidents.length === 0) {
              return null;
            }

            return {
              ...dataset,
              filteredResidents
            };
          })
          .filter((dataset: DatasetWithResidents | null): dataset is DatasetWithResidents => dataset !== null);

        setDatasets(filtered);
      } catch (error) {
        console.error('Error loading datasets:', error);
        setDatasets([]);
      } finally {
        setLoading(false);
      }
    };

    loadDatasets();
  }, [selectedStreet, houseNumber, selectedStatuses]);

  // Calculate most common creation date and current username
  const getMostCommonDate = (datasets: DatasetWithResidents[]): string | null => {
    if (datasets.length === 0) return null;
    
    const dateCounts = new Map<string, number>();
    datasets.forEach(dataset => {
      const dateOnly = new Date(dataset.createdAt).toDateString();
      dateCounts.set(dateOnly, (dateCounts.get(dateOnly) || 0) + 1);
    });

    let maxCount = 0;
    let mostCommonDate: string | null = null;
    dateCounts.forEach((count, date) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommonDate = date;
      }
    });

    return mostCommonDate;
  };

  const mostCommonCreationDate = getMostCommonDate(datasets);

  const handleSelectStreet = (street: string) => {
    setSelectedStreet(street);
    setStreetInput(street);
    setStreetSuggestions([]);
  };

  const toggleStatus = (status: ResidentStatus) => {
    const newStatuses = new Set(selectedStatuses);
    if (newStatuses.has(status)) {
      newStatuses.delete(status);
    } else {
      newStatuses.add(status);
    }
    setSelectedStatuses(newStatuses);
  };

  const handleReset = () => {
    setStreetInput('');
    setHouseNumber('');
    setSelectedStreet(null);
    setStreetSuggestions([]);
    setDatasets([]);
    setSelectedStatuses(new Set(ALL_STATUSES));
    setShowStatusFilter(false);
  };

  const handleLoadDataset = (datasetId: string) => {
    onLoadDataset(datasetId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Filter wie in Leon</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Street Selection */}
          <div className="space-y-2">
            <Label htmlFor="street">Straße *</Label>
            <div className="relative">
              <Input
                id="street"
                value={streetInput}
                onChange={(e) => {
                  setStreetInput(e.target.value);
                  setSelectedStreet(null);
                }}
                placeholder="Straßenname eingeben..."
                className="pr-10"
              />
              {loadingSuggestions && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            
            {/* Street Suggestions */}
            {streetSuggestions.length > 0 && (
              <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                {streetSuggestions.map((street, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectStreet(street)}
                    className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-sm"
                  >
                    {street}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* House Number (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="houseNumber">Hausnummer (optional)</Label>
            <Input
              id="houseNumber"
              value={houseNumber}
              onChange={(e) => setHouseNumber(e.target.value)}
              placeholder="z.B. 5 oder 5,6,7"
            />
          </div>

          {/* Status Filter */}
          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={() => setShowStatusFilter(!showStatusFilter)}
              className="w-full"
            >
              Statusfilter ({selectedStatuses.size}/{ALL_STATUSES.length})
            </Button>
            
            {showStatusFilter && (
              <div className="border rounded-md p-4 space-y-2">
                {ALL_STATUSES.map((status) => (
                  <div key={status} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status}`}
                      checked={selectedStatuses.has(status)}
                      onCheckedChange={() => toggleStatus(status)}
                    />
                    <Label htmlFor={`status-${status}`} className="cursor-pointer">
                      {STATUS_LABELS[status]}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Results */}
          {selectedStreet && (
            <div className="border-t pt-4">
              <h3 className="font-semibold mb-3">
                Ergebnisse für {selectedStreet}
                {houseNumber && ` Nr. ${houseNumber}`}
              </h3>
              
              {/* Legend */}
              {datasets.length > 0 && (mostCommonCreationDate || currentUsername) && (
                <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md border-2 border-amber-300 dark:border-amber-800 text-xs space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-amber-900 dark:text-amber-100">Hervorhebungen:</p>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="highlights-toggle"
                        checked={highlightsEnabled}
                        onCheckedChange={(checked) => setHighlightsEnabled(checked as boolean)}
                      />
                      <Label 
                        htmlFor="highlights-toggle" 
                        className="text-xs cursor-pointer text-amber-900 dark:text-amber-100 font-medium"
                      >
                        Aktiviert
                      </Label>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {mostCommonCreationDate && (
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className="text-[10px] px-1.5 py-0 h-5 bg-amber-200 dark:bg-amber-900 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100"
                        >
                          <Calendar className="h-2.5 w-2.5 mr-1" />
                          Anderer Tag
                        </Badge>
                        <span className="text-muted-foreground">= Erstellt an einem anderen Tag als die Mehrheit</span>
                      </div>
                    )}
                    {currentUsername && (
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className="text-[10px] px-1.5 py-0 h-5 bg-blue-200 dark:bg-blue-900 border-blue-400 dark:border-blue-700 text-blue-900 dark:text-blue-100"
                        >
                          <User className="h-2.5 w-2.5 mr-1" />
                          Von [Nutzer]
                        </Badge>
                        <span className="text-muted-foreground">= Erstellt von einem anderen Nutzer</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : datasets.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Keine Datensätze gefunden
                </p>
              ) : (
                <div className="space-y-3">
                  {datasets.map((dataset) => {
                    const datasetDate = new Date(dataset.createdAt).toDateString();
                    const isDifferentDate = highlightsEnabled && mostCommonCreationDate && datasetDate !== mostCommonCreationDate;
                    const isDifferentCreator = highlightsEnabled && currentUsername && dataset.createdBy !== currentUsername;
                    
                    return (
                      <button
                        key={dataset.id}
                        onClick={() => handleLoadDataset(dataset.id)}
                        className={`w-full text-left border-2 rounded-lg p-4 hover:bg-muted transition-colors ${
                          isDifferentDate || isDifferentCreator 
                            ? 'bg-amber-100 dark:bg-amber-950/40 border-amber-400 dark:border-amber-600 shadow-sm' 
                            : 'border-border'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold">
                                {dataset.street} {dataset.houseNumber}
                              </p>
                              {/* Tags for highlights */}
                              {isDifferentDate && (
                                <Badge 
                                  variant="outline" 
                                  className="text-[10px] px-1.5 py-0 h-5 bg-amber-200 dark:bg-amber-900 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100 font-medium"
                                >
                                  <Calendar className="h-2.5 w-2.5 mr-1" />
                                  Anderer Tag
                                </Badge>
                              )}
                              {isDifferentCreator && (
                                <Badge 
                                  variant="outline" 
                                  className="text-[10px] px-1.5 py-0 h-5 bg-blue-200 dark:bg-blue-900 border-blue-400 dark:border-blue-700 text-blue-900 dark:text-blue-100 font-medium"
                                >
                                  <User className="h-2.5 w-2.5 mr-1" />
                                  Von {dataset.createdBy}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                {new Date(dataset.createdAt).toLocaleDateString('de-DE')}
                              </p>
                              <span className="text-xs text-muted-foreground">•</span>
                              <p className="text-xs text-muted-foreground">
                                Erstellt von {dataset.createdBy}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {dataset.filteredResidents.length} Anwohner
                          </Badge>
                        </div>
                        
                        <div className="space-y-1.5">
                          {dataset.filteredResidents.map((resident, idx) => (
                            <div key={idx} className="text-sm bg-background border rounded p-2">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{resident.name}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {STATUS_LABELS[resident.status]}
                                </Badge>
                              </div>
                              {resident.notes && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {resident.notes}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleReset} className="flex-1">
              Zurücksetzen
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Schließen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
