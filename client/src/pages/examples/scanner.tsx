import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import ScannerPage from '../scanner';

export default function ScannerPageExample() {
  return (
    <I18nextProvider i18n={i18n}>
      <ScannerPage />
    </I18nextProvider>
  );
}
