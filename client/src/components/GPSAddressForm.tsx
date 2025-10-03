import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Loader2, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GPSAddressFormProps {
  onAddressDetected?: (address: Address) => void;
}

export interface Address {
  street: string;
  number: string;
  city: string;
  postal: string;
  country: string;
}

export default function GPSAddressForm({ onAddressDetected }: GPSAddressFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
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
        
        <div className="grid grid-cols-2 gap-4">
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
          <div>
            <Label htmlFor="city" className="text-sm font-medium">{t('address.city')}</Label>
            <Input
              id="city"
              value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })}
              data-testid="input-city"
              className="mt-1.5 min-h-11"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="country" className="text-sm font-medium">{t('address.country')}</Label>
          <Input
            id="country"
            value={address.country}
            onChange={(e) => setAddress({ ...address, country: e.target.value })}
            data-testid="input-country"
            className="mt-1.5 min-h-11"
          />
        </div>
      </CardContent>
    </Card>
  );
}
