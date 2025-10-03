import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import GPSAddressForm from '../GPSAddressForm';

export default function GPSAddressFormExample() {
  return (
    <I18nextProvider i18n={i18n}>
      <GPSAddressForm onAddressDetected={(address) => console.log('Address detected:', address)} />
    </I18nextProvider>
  );
}
