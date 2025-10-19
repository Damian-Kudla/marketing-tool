import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { MapPin, Loader2, Check, Search, Plus, Minus } from 'lucide-react';
import { useFilteredToast } from '@/hooks/use-filtered-toast';
import { geocodeAPI, addressAPI } from '@/services/api';

interface GPSAddressFormProps {
  onAddressDetected?: (address: Address) => void;
  onAddressSearch?: (customers: any[]) => void;
  initialAddress?: Address | null;
}

export interface Address {
  street: string;
  number: string;
  city: string;
  postal: string;
}

export default function GPSAddressForm({ onAddressDetected, onAddressSearch, initialAddress }: GPSAddressFormProps) {
  const { t } = useTranslation();
  const { toast } = useFilteredToast();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [detected, setDetected] = useState(false);
  const [houseNumberError, setHouseNumberError] = useState(false);
  const [onlyEven, setOnlyEven] = useState(false);
  const [onlyOdd, setOnlyOdd] = useState(false);
  const [address, setAddress] = useState<Address>(initialAddress || {
    street: '',
    number: '',
    city: '',
    postal: ''
  });

  // Store previous initialAddress to detect changes
  const prevInitialAddressRef = useRef<Address | null | undefined>(undefined);

  // Update internal address state when initialAddress prop changes
  // Also reset to empty when initialAddress is null (Reset button clicked)
  useEffect(() => {
    // Check if initialAddress actually changed (deep comparison)
    const hasChanged = 
      prevInitialAddressRef.current === undefined || // First render
      (prevInitialAddressRef.current !== initialAddress && (
        !prevInitialAddressRef.current ||
        !initialAddress ||
        prevInitialAddressRef.current.street !== initialAddress.street ||
        prevInitialAddressRef.current.number !== initialAddress.number ||
        prevInitialAddressRef.current.postal !== initialAddress.postal ||
        prevInitialAddressRef.current.city !== initialAddress.city
      ));
    
    if (!hasChanged) {
      return; // No change, don't update
    }
    
    // Update the ref
    prevInitialAddressRef.current = initialAddress;
    
    if (initialAddress) {
      setAddress(initialAddress);
    } else if (initialAddress === null) {
      // Reset to empty state
      setAddress({
        street: '',
        number: '',
        city: '',
        postal: ''
      });
    }
  }, [initialAddress]); // Only depend on initialAddress, NOT on address!

  // Check if house number is a natural number (positive integer)
  const isNaturalNumber = (value: string): boolean => {
    const trimmed = value.trim();
    const num = parseInt(trimmed, 10);
    return /^\d+$/.test(trimmed) && num > 0 && num.toString() === trimmed;
  };

  const canShowPlusMinus = isNaturalNumber(address.number);

  const incrementHouseNumber = () => {
    if (canShowPlusMinus) {
      const current = parseInt(address.number, 10);
      setAddress({ ...address, number: (current + 1).toString() });
    }
  };

  const decrementHouseNumber = () => {
    if (canShowPlusMinus) {
      const current = parseInt(address.number, 10);
      if (current > 1) {
        setAddress({ ...address, number: (current - 1).toString() });
      }
    }
  };

  // Store previous address to detect ACTUAL changes (not just re-renders)
  const prevAddressRef = useRef<string>('');
  
  // Notify parent component whenever address changes
  // Using JSON.stringify to detect actual changes and prevent infinite loops
  useEffect(() => {
    // Only notify if address has actual values (not empty initial state)
    if (address.street || address.postal || address.number) {
      // Compare with previous address using JSON to detect real changes
      const addressStr = JSON.stringify(address);
      if (addressStr !== prevAddressRef.current) {
        prevAddressRef.current = addressStr;
        onAddressDetected?.(address);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address.street, 
    address.number, 
    address.city, 
    address.postal
    // DO NOT include onAddressDetected - causes infinite loop
  ]);

  const detectLocation = async () => {
    setLoading(true);
    setDetected(false);
    
    if ('geolocation' in navigator) {
      // Permissions-Check vorab
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'denied') {
        toast({
          variant: 'destructive',
          title: 'Keine Standortberechtigung',
          description: 'Die Standort-Berechtigung wurde verweigert. Bitte erlauben Sie den Standortzugriff in Ihren Browsereinstellungen, um diese Funktion zu nutzen.',
        });
        setLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const addressData: Partial<Address> = await geocodeAPI.reverseGeocode(
              position.coords.latitude,
              position.coords.longitude
            );

            // Setze immer alle verfügbaren Felder mit Defaults für fehlende Werte
            const completeAddress: Address = {
              street: addressData.street || '',
              number: addressData.number || '',
              postal: addressData.postal || '',
              city: addressData.city || ''
            };

            setAddress(completeAddress);
            setDetected(true);
            onAddressDetected?.(completeAddress);

            // Warnung bei unvollständiger Adresse (z. B. keine street/number, aber PLZ/city vorhanden)
            if (!completeAddress.street || !completeAddress.number) {
              toast({
                variant: 'default',
                title: 'Unvollständige Adresse',
                description: 'Straße oder Hausnummer konnte nicht genau ermittelt werden. Bitte überprüfen und ergänzen Sie die Eingabe manuell.',
              });
            }
          } catch (error: any) {
            console.error('Geocoding error:', error);

            if (error?.response?.status === 429) {
              const errorData = error.response?.data || {};
              const errorMessage = errorData.message || 'Zu viele Standortabfragen. Bitte warte eine Minute.';
              toast({
                variant: 'destructive',
                title: 'Rate Limit erreicht',
                description: errorMessage,
                duration: 10000,
              });
            } else if (error?.response?.data?.errorCode === 'POSTAL_CODE_RESTRICTED') {
              toast({
                variant: 'destructive',
                title: 'Postleitzahl nicht erlaubt',
                description: error.response.data.error,
                duration: 8000,
              });
            } else if (error?.response?.data?.error === 'No geocoding results found') {
              toast({
                variant: 'destructive',
                title: 'Keine Ergebnisse',
                description: 'Keine passende Adresse gefunden. Versuchen Sie eine andere Position oder geben Sie die Adresse manuell ein.',
              });
            } else if (error?.response?.data?.error === 'Location not in Germany') {
              toast({
                variant: 'destructive',
                title: 'Standort nicht in Deutschland',
                description: 'Dieser Service ist nur für Adressen in Deutschland verfügbar.',
              });
            } else {
              toast({
                variant: 'destructive',
                title: 'Standort-Fehler',
                description: error?.response?.data?.error || 'Die Adresse konnte nicht vom Standort erkannt werden. Bitte versuchen Sie es erneut.',
              });
            }
          } finally {
            setLoading(false);
          }
        },
        (error) => {
          setLoading(false);
          console.error('Geolocation error:', error);
          toast({
            variant: 'destructive',
            title: 'Standort-Berechtigung',
            description: 'Die Standort-Berechtigung wurde verweigert. Bitte erlauben Sie den Standortzugriff in Ihren Browsereinstellungen.',
          });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }  // Hohe Genauigkeit, 15s Timeout, frische Position
      );
    } else {
      setLoading(false);
      toast({
        variant: 'destructive',
        title: 'Standort nicht verfügbar',
        description: 'Ihr Browser unterstützt keine Standorterkennung. Bitte geben Sie die Adresse manuell ein.',
      });
    }
  };

  // Helper function to expand range notation (e.g., "1-5" -> [1,2,3,4,5])
  const expandHouseNumberRange = (rangeStr: string): string[] => {
    const parts = rangeStr.split('-').map(p => p.trim());
    
    // Must have exactly 2 parts
    if (parts.length !== 2) return [rangeStr];
    
    // Both parts must be valid integers
    const start = parseInt(parts[0]);
    const end = parseInt(parts[1]);
    
    if (isNaN(start) || isNaN(end)) return [rangeStr];
    
    // Start must be less than end
    if (start >= end) return [rangeStr];
    
    // Start must be positive
    if (start < 1) return [rangeStr];
    
    // Generate range
    const numbers: number[] = [];
    for (let i = start; i <= end; i++) {
      // Apply even/odd filters
      if (onlyEven && i % 2 !== 0) continue;
      if (onlyOdd && i % 2 === 0) continue;
      numbers.push(i);
    }
    
    return numbers.map(n => n.toString());
  };

  const searchAddress = async () => {
    // VALIDATION: Check required fields before searching
    const missingFields: string[] = [];
    if (!address.street || !address.street.trim()) {
      missingFields.push(t('address.street'));
    }
    if (!address.number || !address.number.trim()) {
      missingFields.push(t('address.number'));
    }
    if (!address.postal || !address.postal.trim()) {
      missingFields.push(t('address.postal'));
    }

    if (missingFields.length > 0) {
      toast({
        variant: 'destructive',
        title: t('address.missingFields', 'Fehlende Pflichtfelder'),
        description: t('address.missingFieldsDesc', 'Folgende Felder müssen ausgefüllt werden: {{fields}}', {
          fields: missingFields.join(', ')
        }),
      });
      return;
    }

    setSearching(true);
    
    try {
      // Expand ranges and handle multiple house numbers
      const inputNumbers = address.number
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length > 0);
      
      let allHouseNumbers: string[] = [];
      
      for (const input of inputNumbers) {
        if (input.includes('-')) {
          // Expand range
          const expanded = expandHouseNumberRange(input);
          allHouseNumbers = [...allHouseNumbers, ...expanded];
        } else {
          // Regular number
          allHouseNumbers.push(input);
        }
      }
      
      // Remove duplicates
      allHouseNumbers = Array.from(new Set(allHouseNumbers));
      
      let allCustomers: any[] = [];
      
      // Search for each house number
      for (const houseNumber of allHouseNumbers) {
        const searchParams: Partial<Address> = {};
        if (address.street?.trim()) searchParams.street = address.street;
        searchParams.number = houseNumber;
        if (address.postal?.trim()) searchParams.postal = address.postal;
        if (address.city?.trim()) searchParams.city = address.city;
        
        const customers = await addressAPI.searchAddress(searchParams);
        allCustomers = [...allCustomers, ...customers];
      }
      
      // Remove duplicates based on customer ID
      const uniqueCustomers = Array.from(
        new Map(allCustomers.map(c => [c.id || c.name, c])).values()
      );
      
      if (uniqueCustomers.length === 0) {
        toast({
          title: t('address.searchSuccess'),
          description: t('results.empty'),
          category: 'system',
        });
      } else {
        toast({
          title: t('address.searchSuccess'),
          description: `${uniqueCustomers.length} ${t('address.searchSuccessDesc')}`,
          category: 'system',
        });
      }
      
      // Set the address in parent component so it shows in header
      onAddressDetected?.(address);
      onAddressSearch?.(uniqueCustomers);
    } catch (error) {
      console.error('Address search error:', error);
      toast({
        variant: 'destructive',
        title: t('address.searchError'),
        description: 'Adresse konnte nicht gesucht werden',
      });
    } finally {
      setSearching(false);
    }
  };

  // Check if house number contains dash
  const hasDashInNumber = address.number && address.number.includes('-');
  const hasAddressData = address.postal || address.street;
  const isSearchDisabled = searching;

  // Reset even/odd filters when dash is removed
  useEffect(() => {
    if (!hasDashInNumber) {
      setOnlyEven(false);
      setOnlyOdd(false);
    }
  }, [hasDashInNumber]);

  return (
    <Card data-testid="card-gps-address">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">{t('gps.title')}</CardTitle>
        <Button
          onClick={detectLocation}
          disabled={loading}
          size="default"
          data-testid="button-detect-location"
          className="gap-2"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : detected ? (
            <Check className="h-4 w-4" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
          {loading ? t('gps.detecting') : detected ? t('gps.detected') : t('gps.button')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Label htmlFor="street" className="text-sm font-medium">{t('address.street')}</Label>
            <Input
              id="street"
              value={address.street}
              onChange={(e) => setAddress({ ...address, street: e.target.value })}
              data-testid="input-street"
              className="mt-1.5 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="number" className="text-sm font-medium">{t('address.number')}</Label>
            <Input
              id="number"
              value={address.number}
              onChange={(e) => setAddress({ ...address, number: e.target.value })}
              data-testid="input-number"
              className="mt-1.5 min-h-11"
              placeholder="z.B. 1,2,3 oder 1-5"
            />
            {/* Plus/Minus buttons directly under house number */}
            {canShowPlusMinus && (
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={decrementHouseNumber}
                  disabled={parseInt(address.number, 10) <= 1}
                  className="h-11 w-full"
                  title="Hausnummer verringern"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={incrementHouseNumber}
                  className="h-11 w-full"
                  title="Hausnummer erhöhen"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
            {hasDashInNumber && (
              <div className="mt-3 space-y-2 p-3 bg-muted rounded-md">
                <p className="text-xs text-muted-foreground mb-2">
                  Bereich wird automatisch erweitert (z.B. 1-5 → 1,2,3,4,5)
                </p>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="onlyEven"
                      checked={onlyEven}
                      onCheckedChange={(checked) => {
                        setOnlyEven(!!checked);
                        if (checked) setOnlyOdd(false); // Uncheck odd when even is checked
                      }}
                      data-testid="checkbox-even"
                    />
                    <Label htmlFor="onlyEven" className="text-sm cursor-pointer">
                      Nur gerade Nummern
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="onlyOdd"
                      checked={onlyOdd}
                      onCheckedChange={(checked) => {
                        setOnlyOdd(!!checked);
                        if (checked) setOnlyEven(false); // Uncheck even when odd is checked
                      }}
                      data-testid="checkbox-odd"
                    />
                    <Label htmlFor="onlyOdd" className="text-sm cursor-pointer">
                      Nur ungerade Nummern
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Postal code field - full width */}
        <div>
          <Label htmlFor="postal" className="text-sm font-medium">{t('address.postal')}</Label>
          <Input
            id="postal"
            value={address.postal}
            onChange={(e) => setAddress({ ...address, postal: e.target.value })}
            data-testid="input-postal"
            className="mt-1.5 min-h-11"
          />
        </div>

        {hasAddressData && (
          <Button
            onClick={searchAddress}
            disabled={isSearchDisabled}
            size="lg"
            variant="outline"
            data-testid="button-search-address"
            className="w-full min-h-12 gap-2"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {searching ? t('address.searching') : t('action.searchAddress')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}