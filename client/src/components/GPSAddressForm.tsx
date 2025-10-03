import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Loader2, Check, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GPSAddressFormProps {
  onAddressDetected?: (address: Address) => void;
  onAddressSearch?: (customers: any[]) => void;
}

export interface Address {
  street: string;
  number: string;
  city: string;
  postal: string;
  country: string;
}

export default function GPSAddressForm({ onAddressDetected, onAddressSearch }: GPSAddressFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [detected, setDetected] = useState(false);
  const [address, setAddress] = useState<Address>({
    street: '',
    number: '',
    city: '',
    postal: '',
    country: ''
  });

  const detectLocation = async () => {
    setLoading(true);
    setDetected(false);
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const response = await fetch('/api/geocode', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            });

            if (!response.ok) {
              throw new Error('Geocoding failed');
            }

            const addressData = await response.json();
            
            // Check if the address is in Germany
            if (addressData.country && addressData.country.toLowerCase() !== 'deutschland' && addressData.country.toLowerCase() !== 'germany') {
              toast({
                variant: 'destructive',
                title: t('gps.error'),
                description: t('gps.germanyOnly'),
              });
              setLoading(false);
              return;
            }
            
            setAddress(addressData);
            setDetected(true);
            onAddressDetected?.(addressData);
          } catch (error) {
            console.error('Geocoding error:', error);
            toast({
              variant: 'destructive',
              title: t('gps.error'),
              description: 'Unable to detect address from location',
            });
          } finally {
            setLoading(false);
          }
        },
        (error) => {
          setLoading(false);
          console.error('Geolocation error:', error);
          toast({
            variant: 'destructive',
            title: t('gps.error'),
            description: 'Location permission denied',
          });
        }
      );
    } else {
      setLoading(false);
      toast({
        variant: 'destructive',
        title: t('gps.error'),
        description: 'Geolocation not supported',
      });
    }
  };

  const searchAddress = async () => {
    setSearching(true);
    
    try {
      // Only send non-empty address fields
      const searchParams: Partial<Address> = {};
      if (address.street.trim()) searchParams.street = address.street;
      if (address.number.trim()) searchParams.number = address.number;
      if (address.postal.trim()) searchParams.postal = address.postal;
      if (address.city.trim()) searchParams.city = address.city;
      if (address.country.trim()) searchParams.country = address.country;
      
      const response = await fetch('/api/search-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchParams),
      });

      if (!response.ok) {
        throw new Error('Address search failed');
      }

      const customers = await response.json();
      
      if (customers.length === 0) {
        toast({
          title: t('address.searchSuccess'),
          description: t('results.empty'),
        });
      } else {
        toast({
          title: t('address.searchSuccess'),
          description: `${customers.length} ${t('address.searchSuccessDesc')}`,
        });
      }
      
      onAddressSearch?.(customers);
    } catch (error) {
      console.error('Address search error:', error);
      toast({
        variant: 'destructive',
        title: t('address.searchError'),
        description: 'Unable to search address',
      });
    } finally {
      setSearching(false);
    }
  };

  const hasAddressData = address.postal || address.street;

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
            />
          </div>
        </div>
        
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
            disabled={searching}
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
