import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import PhotoCapture from '../PhotoCapture';

export default function PhotoCaptureExample() {
  return (
    <I18nextProvider i18n={i18n}>
      <PhotoCapture onPhotoProcessed={(result) => console.log('Photo processed:', result)} />
    </I18nextProvider>
  );
}
