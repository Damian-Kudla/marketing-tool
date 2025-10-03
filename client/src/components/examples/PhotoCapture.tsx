import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import PhotoCapture from '../PhotoCapture';

export default function PhotoCaptureExample() {
  return (
    <I18nextProvider i18n={i18n}>
      <PhotoCapture onPhotoCapture={(file) => console.log('Photo captured:', file.name)} />
    </I18nextProvider>
  );
}
