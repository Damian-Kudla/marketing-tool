import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import ResultsDisplay from '../ResultsDisplay';

export default function ResultsDisplayExample() {
  const mockResult = {
    residentNames: ['Max Müller', 'Anna Schmidt', 'Thomas Weber'],
    existingCustomers: [],
    newProspects: ['Max Müller', 'Anna Schmidt', 'Thomas Weber']
  };

  return (
    <I18nextProvider i18n={i18n}>
      <ResultsDisplay result={mockResult} />
    </I18nextProvider>
  );
}
