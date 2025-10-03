import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "app.title": "Sales Acquisition Tool",
      "gps.title": "Location",
      "gps.detecting": "Detecting location...",
      "gps.detected": "Location detected",
      "gps.error": "Failed to get location",
      "gps.button": "Detect Location",
      "address.street": "Street",
      "address.number": "Number",
      "address.city": "City",
      "address.postal": "Postal Code",
      "address.country": "Country",
      "photo.title": "Nameplate Photo",
      "photo.upload": "Upload Photo",
      "photo.take": "Take Photo",
      "photo.processing": "Processing image...",
      "results.title": "Results",
      "results.names": "Extracted Names",
      "results.existing": "Existing Customer",
      "results.prospect": "Potential Prospect",
      "results.empty": "No results yet",
      "action.save": "Save",
      "action.reset": "Reset",
      "action.edit": "Edit",
    }
  },
  de: {
    translation: {
      "app.title": "Akquise-Tool",
      "gps.title": "Standort",
      "gps.detecting": "Standort wird ermittelt...",
      "gps.detected": "Standort erkannt",
      "gps.error": "Standort konnte nicht ermittelt werden",
      "gps.button": "Standort ermitteln",
      "address.street": "Straße",
      "address.number": "Nummer",
      "address.city": "Stadt",
      "address.postal": "Postleitzahl",
      "address.country": "Land",
      "photo.title": "Typenschild Foto",
      "photo.upload": "Foto hochladen",
      "photo.take": "Foto aufnehmen",
      "photo.processing": "Bild wird verarbeitet...",
      "results.title": "Ergebnisse",
      "results.names": "Extrahierte Namen",
      "results.existing": "Bestandskunde",
      "results.prospect": "Potentieller Neukunde",
      "results.empty": "Noch keine Ergebnisse",
      "action.save": "Speichern",
      "action.reset": "Zurücksetzen",
      "action.edit": "Bearbeiten",
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'de',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
