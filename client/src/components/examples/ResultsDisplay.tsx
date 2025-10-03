import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import ResultsDisplay from '../ResultsDisplay';

export default function ResultsDisplayExample() {
  const mockResults = [
    { name: 'Max Müller', isExisting: true },
    { name: 'Anna Schmidt', isExisting: false },
    { name: 'Thomas Weber', isExisting: true },
  ];

  return (
    <I18nextProvider i18n={i18n}>
      <ResultsDisplay results={mockResults} />
    </I18nextProvider>
  );
}
