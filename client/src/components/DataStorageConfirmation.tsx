import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Address } from '@/components/GPSAddressForm';

interface DataStorageConfirmationProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  address: Address;
}

export function DataStorageConfirmation({
  isOpen,
  onConfirm,
  onCancel,
  address,
}: DataStorageConfirmationProps) {
  const { t } = useTranslation();

  const displayAddress = `${address.street} ${address.number}, ${address.postal} ${address.city || ''}`.trim();

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('dataStorage.confirmation.title', 'Neue Daten speichern?')}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <div>
              {t('dataStorage.confirmation.message', 
                'Möchten Sie neue Daten für diese Adresse speichern?'
              )}
            </div>
            <div className="font-medium text-foreground bg-muted p-2 rounded">
              {displayAddress}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t('action.no', 'Nein')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('action.yes', 'Ja')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}