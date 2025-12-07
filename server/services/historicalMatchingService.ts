/**
 * Historical Matching Service
 *
 * Erweitert den OCR-Abgleich mit historischen Datensätzen (AddressDatasets).
 *
 * Funktionen:
 * 1. Abrufen des jüngsten Datensatzes für eine Adresse
 * 2. Duplikat-Bereinigung in Bestands- und Neukundenlisten aus Datensätzen
 * 3. Erweiterte Kategorisierung basierend auf Bestandskundenliste + historischen Daten
 * 4. Vormieter-Erkennung (wenn genau eine Person ausgetauscht wurde)
 * 5. Erweiterung der Bestandskundenliste für "Adresse durchsuchen"
 */

import { addressDatasetService } from './googleSheets';
import { LOG_CONFIG } from '../config/logConfig';
import type {
  AddressDataset,
  EditableResident,
  ResidentCategory,
  ResidentStatus,
  Address,
  Customer,
  HistoricalMatchType,
  HistoricalInfo,
  EnhancedOCRResult,
  EnhancedExistingCustomer,
  HistoricalProspect
} from '../../shared/schema';

// ==================== HELPER FUNCTIONS ====================

/**
 * Normalisiert einen Namen für den Vergleich
 * - Lowercase
 * - Umlaute ersetzen (ä→ae, ö→oe, ü→ue, ß→ss)
 * - Mehrfache Leerzeichen normalisieren
 * - Trimmen
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrahiert den Nachnamen aus einem Namen
 * Nimmt das letzte Wort (bei "Max Müller" → "mueller")
 */
function extractLastName(name: string): string {
  const normalized = normalizeName(name);
  const parts = normalized.split(' ').filter(p => p.length >= 2);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

/**
 * Prüft ob zwei Namen übereinstimmen (wortbasiert)
 * Mindestens ein Wort muss übereinstimmen
 */
function namesMatch(name1: string, name2: string): boolean {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  // Exakte Übereinstimmung
  if (norm1 === norm2) return true;

  // Wortbasierter Vergleich
  const words1 = norm1.split(' ').filter(w => w.length >= 2);
  const words2 = norm2.split(' ').filter(w => w.length >= 2);

  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1 === w2) return true;
    }
  }

  return false;
}

// ==================== TYPES ====================

interface CleanedHistoricalData {
  existingCustomers: string[];  // Bereinigte Liste der Bestandskunden aus Datensatz
  newCustomers: string[];       // Bereinigte Liste der Neukunden aus Datensatz
  allNames: string[];           // Alle Namen (für Vormieter-Vergleich)
  removedDueToDuplicates: string[]; // Namen die wegen Duplikaten entfernt wurden
  dataset: AddressDataset;      // Der verwendete Datensatz
}

interface PreviousTenantInfo {
  newName: string;              // Der neue Name auf dem Klingelschild
  previousTenant: string;       // Der vermutliche Vormieter
  movedInAfter: Date;           // Datum des letzten Datensatzes
}

// ==================== CORE FUNCTIONS ====================

/**
 * Erstellt einen normalisierten Adress-String für den Cache-Lookup
 * (Einfache synchrone Version ohne Geocoding)
 *
 * WICHTIG: Das Format muss mit googleSheets.ts übereinstimmen!
 * Format: "street postal city" (OHNE Hausnummer!)
 * Die Hausnummer wird separat als Parameter an getAddressDatasets übergeben.
 */
function createNormalizedAddress(street: string, postal: string, city?: string): string {
  // Format muss mit googleSheets.normalizeAddress übereinstimmen: "street postal city"
  const normalizedStreet = street.toLowerCase().trim();
  const normalizedPostal = postal.trim();
  const normalizedCity = city ? city.toLowerCase().trim() : '';

  // Wenn city vorhanden, Format: "street postal city"
  // Sonst: "street postal" (für field-based matching in getByAddress)
  if (normalizedCity) {
    return `${normalizedStreet} ${normalizedPostal} ${normalizedCity}`;
  }
  return `${normalizedStreet} ${normalizedPostal}`;
}

/**
 * Holt den jüngsten Datensatz für eine Adresse
 * Berücksichtigt Hausnummern-Bereiche (z.B. Suche "1" findet auch "1-5")
 */
export async function getMostRecentDataset(
  address: Address
): Promise<AddressDataset | null> {
  // Normalisierte Adresse OHNE Hausnummer (Format: "street postal city")
  const normalizedAddr = createNormalizedAddress(address.street, address.postal, address.city);

  // getAddressDatasets gibt bereits nach createdAt sortiert zurück (neueste zuerst)
  // Hausnummer wird separat für flexibles Matching übergeben
  const datasets = await addressDatasetService.getAddressDatasets(
    normalizedAddr,
    1, // Nur den neuesten
    address.number
  );

  return datasets.length > 0 ? datasets[0] : null;
}

/**
 * Holt alle relevanten Datensätze für eine Adresse (bei überlappenden Hausnummern)
 */
export async function getAllRelevantDatasets(
  address: Address
): Promise<AddressDataset[]> {
  // Normalisierte Adresse OHNE Hausnummer (Format: "street postal city")
  const normalizedAddr = createNormalizedAddress(address.street, address.postal, address.city);

  return await addressDatasetService.getAddressDatasets(
    normalizedAddr,
    10, // Mehr Datensätze für umfassenden Abgleich
    address.number
  );
}

/**
 * Bereinigt die Bestands- und Neukundenlisten aus einem Datensatz
 *
 * Logik:
 * 1. Wenn ein Nachname mehrfach in Bestandskunden vorkommt → nur Nachname verwenden
 * 2. Wenn ein Nachname in Bestandskunden UND Neukunden vorkommt → alle mit diesem Nachnamen entfernen
 */
export function cleanHistoricalData(dataset: AddressDataset): CleanedHistoricalData {
  const existingCustomers: string[] = [];
  const newCustomers: string[] = [];
  const removedDueToDuplicates: string[] = [];

  // Extrahiere Bestandskunden und Neukunden aus editableResidents
  const rawExisting: string[] = [];
  const rawNew: string[] = [];

  for (const resident of dataset.editableResidents) {
    if (resident.category === 'existing_customer') {
      rawExisting.push(resident.name);
    } else if (resident.category === 'potential_new_customer') {
      rawNew.push(resident.name);
    }
    // Duplikate werden ignoriert (wie im ursprünglichen Code)
  }

  // fixedCustomers sind immer Bestandskunden
  for (const fixed of dataset.fixedCustomers) {
    rawExisting.push(fixed.name);
  }

  // Zähle Nachnamen in beiden Listen
  const lastNameCountExisting = new Map<string, string[]>(); // lastName -> [fullNames]
  const lastNameCountNew = new Map<string, string[]>();

  for (const name of rawExisting) {
    const lastName = extractLastName(name);
    if (!lastNameCountExisting.has(lastName)) {
      lastNameCountExisting.set(lastName, []);
    }
    lastNameCountExisting.get(lastName)!.push(name);
  }

  for (const name of rawNew) {
    const lastName = extractLastName(name);
    if (!lastNameCountNew.has(lastName)) {
      lastNameCountNew.set(lastName, []);
    }
    lastNameCountNew.get(lastName)!.push(name);
  }

  // Finde Nachnamen die in BEIDEN Listen vorkommen → komplett entfernen
  const conflictingLastNames = new Set<string>();
  const existingLastNames = Array.from(lastNameCountExisting.keys());
  for (const lastName of existingLastNames) {
    if (lastNameCountNew.has(lastName)) {
      conflictingLastNames.add(lastName);
    }
  }

  // Verarbeite Bestandskunden
  const existingEntries = Array.from(lastNameCountExisting.entries());
  for (const [lastName, names] of existingEntries) {
    if (conflictingLastNames.has(lastName)) {
      // Konflikt: Nachname in beiden Listen → alle entfernen
      removedDueToDuplicates.push(...names);
    } else if (names.length > 1) {
      // Mehrere mit gleichem Nachnamen in Bestandskunden → nur Nachname verwenden
      // Kapitalisiere ersten Buchstaben für bessere Anzeige
      const capitalizedLastName = lastName.charAt(0).toUpperCase() + lastName.slice(1);
      existingCustomers.push(capitalizedLastName);
    } else {
      // Einziger mit diesem Nachnamen → vollständiger Name
      existingCustomers.push(names[0]);
    }
  }

  // Verarbeite Neukunden
  const newEntries = Array.from(lastNameCountNew.entries());
  for (const [lastName, names] of newEntries) {
    if (conflictingLastNames.has(lastName)) {
      // Konflikt: Nachname in beiden Listen → alle entfernen
      removedDueToDuplicates.push(...names);
    } else if (names.length > 1) {
      // Mehrere mit gleichem Nachnamen in Neukunden → nur Nachname verwenden
      const capitalizedLastName = lastName.charAt(0).toUpperCase() + lastName.slice(1);
      newCustomers.push(capitalizedLastName);
    } else {
      // Einziger mit diesem Nachnamen → vollständiger Name
      newCustomers.push(names[0]);
    }
  }

  // Alle Namen für Vormieter-Vergleich (ohne Bereinigung)
  const allNames = [...rawExisting, ...rawNew];

  return {
    existingCustomers,
    newCustomers,
    allNames,
    removedDueToDuplicates,
    dataset
  };
}

/**
 * Findet einen Namen in der bereinigten historischen Liste
 */
function findInHistoricalList(
  name: string,
  historicalList: string[]
): string | null {
  for (const historicalName of historicalList) {
    if (namesMatch(name, historicalName)) {
      return historicalName;
    }
  }
  return null;
}

/**
 * Findet Resident-Details aus dem Datensatz
 */
function findResidentInDataset(
  name: string,
  dataset: AddressDataset
): EditableResident | null {
  // Suche in editableResidents
  for (const resident of dataset.editableResidents) {
    if (namesMatch(name, resident.name)) {
      return resident;
    }
  }
  // Suche in fixedCustomers
  for (const fixed of dataset.fixedCustomers) {
    if (namesMatch(name, fixed.name)) {
      return fixed;
    }
  }
  return null;
}

/**
 * Hauptfunktion: Kategorisiert einen Namen basierend auf Bestandskundenliste + historischen Daten
 *
 * Kategorisierung:
 * 1. In Bestandskundenliste + im Datensatz als Bestandskunde → confirmed_existing (Bestandskunde)
 * 2. In Bestandskundenliste + im Datensatz als Neukunde → list_vs_dataset_conflict (Klärungsbedarf)
 * 3. Nicht in Bestandskundenliste + im Datensatz als Bestandskunde → dataset_only_existing (Klärungsbedarf)
 * 4. Nicht in Bestandskundenliste + im Datensatz als Neukunde → historical_prospect (Neukunde mit Status)
 * 5. Kein historischer Datensatz → no_historical_data
 */
export function categorizeWithHistoricalData(
  name: string,
  isInCustomerList: boolean,
  customer: Customer | null,
  cleanedData: CleanedHistoricalData | null
): EnhancedOCRResult {
  const result: EnhancedOCRResult = {
    name,
    category: isInCustomerList ? 'existing_customer' : 'potential_new_customer',
    isExistingCustomer: isInCustomerList,
  };

  // Kundendaten hinzufügen wenn vorhanden
  if (customer) {
    result.customerId = customer.id;
    result.customerStreet = customer.street;
    result.customerHouseNumber = customer.houseNumber;
    result.customerPostalCode = customer.postalCode;
    result.contractType = customer.contractType;
  }

  // Wenn keine historischen Daten vorhanden
  if (!cleanedData) {
    result.historicalInfo = {
      matchType: 'no_historical_data'
    };
    return result;
  }

  const { existingCustomers, newCustomers, dataset } = cleanedData;

  // Suche in historischen Listen
  const foundInHistoricalExisting = findInHistoricalList(name, existingCustomers);
  const foundInHistoricalNew = findInHistoricalList(name, newCustomers);

  // Finde Resident-Details für Status
  const residentDetails = findResidentInDataset(name, dataset);

  let matchType: HistoricalMatchType;
  let finalCategory: ResidentCategory;

  if (isInCustomerList) {
    if (foundInHistoricalExisting) {
      // Fall 1: Bestandskunde bestätigt
      matchType = 'confirmed_existing';
      finalCategory = 'existing_customer';
    } else if (foundInHistoricalNew) {
      // Fall 2: Widerspruch - in Liste als Bestandskunde, im Datensatz als Neukunde
      matchType = 'list_vs_dataset_conflict';
      finalCategory = 'clarification_needed';
    } else {
      // In Bestandskundenliste, aber nicht im historischen Datensatz gefunden
      matchType = 'no_historical_data';
      finalCategory = 'existing_customer';
    }
  } else {
    if (foundInHistoricalExisting) {
      // Fall 3: Nicht in Liste, aber im Datensatz als Bestandskunde
      matchType = 'dataset_only_existing';
      finalCategory = 'clarification_needed';
    } else if (foundInHistoricalNew) {
      // Fall 4: Neukunde mit historischem Status
      matchType = 'historical_prospect';
      finalCategory = 'potential_new_customer';
    } else {
      // Weder in Liste noch in historischen Daten
      matchType = 'no_historical_data';
      finalCategory = 'potential_new_customer';
    }
  }

  result.category = finalCategory;
  result.historicalInfo = {
    matchType,
    datasetId: dataset.id,
    datasetDate: dataset.createdAt,
    datasetHouseNumber: dataset.houseNumber,
    historicalStatus: residentDetails?.status,
    historicalCategory: residentDetails?.category,
  };

  return result;
}

/**
 * Erkennt Vormieter wenn genau ein Name ausgetauscht wurde
 *
 * Vergleicht alle Namen aus dem neuen Scan mit allen Namen aus dem alten Datensatz.
 * Wenn genau ein Name hinzugekommen und einer weggefallen ist, wird der Vormieter erkannt.
 */
export function detectPreviousTenant(
  newNames: string[],
  cleanedData: CleanedHistoricalData
): PreviousTenantInfo | null {
  const oldNames = cleanedData.allNames;

  // Normalisiere alle Namen für Vergleich
  const normalizedNewSet = new Set(newNames.map(n => normalizeName(n)));
  const normalizedOldSet = new Set(oldNames.map(n => normalizeName(n)));

  // Finde Namen die nur in der neuen Liste sind
  const onlyInNew: string[] = [];
  for (const name of newNames) {
    const normalized = normalizeName(name);
    if (!normalizedOldSet.has(normalized)) {
      onlyInNew.push(name);
    }
  }

  // Finde Namen die nur in der alten Liste sind
  const onlyInOld: string[] = [];
  for (const name of oldNames) {
    const normalized = normalizeName(name);
    if (!normalizedNewSet.has(normalized)) {
      onlyInOld.push(name);
    }
  }

  // Vormieter-Erkennung: Genau ein Unterschied in beide Richtungen
  if (onlyInNew.length === 1 && onlyInOld.length === 1) {
    return {
      newName: onlyInNew[0],
      previousTenant: onlyInOld[0],
      movedInAfter: cleanedData.dataset.createdAt
    };
  }

  return null;
}

/**
 * Fügt Vormieter-Info zu den Enhanced Results hinzu
 */
export function addPreviousTenantInfo(
  results: EnhancedOCRResult[],
  previousTenantInfo: PreviousTenantInfo | null
): EnhancedOCRResult[] {
  if (!previousTenantInfo) return results;

  return results.map(result => {
    if (namesMatch(result.name, previousTenantInfo.newName)) {
      return {
        ...result,
        historicalInfo: {
          ...result.historicalInfo!,
          previousTenant: previousTenantInfo.previousTenant,
          movedInAfter: previousTenantInfo.movedInAfter
        }
      };
    }
    return result;
  });
}

// ==================== ADDRESS SEARCH ENHANCEMENT ====================

/**
 * Erweitert die Bestandskundenliste mit historischen Bestandskunden
 * für die "Adresse durchsuchen" Funktion
 *
 * Gibt zurück: Erweiterte Liste mit Rückgewinnungs-Hinweisen für ehemalige Bestandskunden
 */
export async function enhanceCustomerListWithHistoricalData(
  currentCustomers: Customer[],
  address: Address
): Promise<EnhancedExistingCustomer[]> {
  const result: EnhancedExistingCustomer[] = [];

  // Zuerst aktuelle Kunden hinzufügen
  for (const customer of currentCustomers) {
    result.push({
      id: customer.id,
      name: customer.name,
      street: customer.street,
      houseNumber: customer.houseNumber,
      postalCode: customer.postalCode,
      isExisting: customer.isExisting,
      contractType: customer.contractType,
      isFromHistoricalDataset: false,
      notInCurrentList: false
    });
  }

  // Historischen Datensatz abrufen
  const dataset = await getMostRecentDataset(address);
  if (!dataset) {
    if (LOG_CONFIG.HISTORICAL_MATCHING.logDatasetLookup) {
      console.log('[HistoricalMatching] Kein Datensatz für:', `${address.street} ${address.number}`);
    }
    return result;
  }

  if (LOG_CONFIG.HISTORICAL_MATCHING.logDatasetLookup) {
    console.log('[HistoricalMatching] Datensatz gefunden:', dataset.id);
  }

  const cleanedData = cleanHistoricalData(dataset);
  const currentCustomerNames = new Set(
    currentCustomers.map(c => normalizeName(c.name))
  );

  // Füge historische Bestandskunden hinzu, die nicht in der aktuellen Liste sind
  for (const historicalName of cleanedData.existingCustomers) {
    const normalizedHistorical = normalizeName(historicalName);

    // Prüfe ob dieser Name schon in der aktuellen Liste ist
    let foundInCurrent = false;
    for (const currentName of Array.from(currentCustomerNames)) {
      if (namesMatch(historicalName, currentName) || normalizedHistorical === currentName) {
        foundInCurrent = true;
        break;
      }
    }

    if (!foundInCurrent) {
      // Dieser historische Bestandskunde ist nicht mehr in der aktuellen Liste
      if (LOG_CONFIG.HISTORICAL_MATCHING.logDetailedResults) {
        console.log('[HistoricalMatching] Rückgewinnungs-Kandidat:', historicalName);
      }

      result.push({
        id: undefined,
        name: historicalName,
        street: address.street,
        houseNumber: dataset.houseNumber,
        postalCode: address.postal,
        isExisting: true, // War mal Bestandskunde
        contractType: null,
        isFromHistoricalDataset: true,
        historicalDatasetDate: dataset.createdAt,
        notInCurrentList: true // Für "Reiner war am [Datum] Bestandskunde..." Hinweis
      });
    }
  }

  return result;
}

/**
 * Hauptfunktion für den erweiterten OCR-Abgleich
 * Wird aus der OCR-Route aufgerufen
 */
export async function performEnhancedOCRMatching(
  residentNames: string[],
  existingCustomers: Customer[],
  newProspects: string[],
  address: Address
): Promise<{
  enhancedResults: EnhancedOCRResult[];
  historicalDatasetUsed: { id: string; createdAt: Date; createdBy: string; houseNumber: string } | null;
  previousTenantInfo: PreviousTenantInfo | null;
}> {
  // Historischen Datensatz abrufen
  const dataset = await getMostRecentDataset(address);

  let cleanedData: CleanedHistoricalData | null = null;
  if (dataset) {
    cleanedData = cleanHistoricalData(dataset);
    if (LOG_CONFIG.HISTORICAL_MATCHING.logDatasetLookup) {
      console.log('[HistoricalMatching] Datensatz gefunden:', dataset.id);
    }
    if (LOG_CONFIG.HISTORICAL_MATCHING.logDetailedResults) {
      console.log('[HistoricalMatching] Bereinigte Bestandskunden:', cleanedData.existingCustomers);
      console.log('[HistoricalMatching] Bereinigte Neukunden:', cleanedData.newCustomers);
      console.log('[HistoricalMatching] Entfernt wegen Duplikaten:', cleanedData.removedDueToDuplicates);
    }
  } else {
    if (LOG_CONFIG.HISTORICAL_MATCHING.logDatasetLookup) {
      console.log('[HistoricalMatching] Kein Datensatz für:', `${address.street} ${address.number}`);
    }
  }

  // Erstelle Map für schnellen Zugriff auf Kundendaten
  const customerByName = new Map<string, Customer>();
  for (const customer of existingCustomers) {
    customerByName.set(normalizeName(customer.name), customer);
  }

  // Kategorisiere jeden Namen
  const enhancedResults: EnhancedOCRResult[] = [];

  for (const name of residentNames) {
    const normalizedName = normalizeName(name);
    const customer = customerByName.get(normalizedName) || null;
    const isInCustomerList = customer !== null ||
      existingCustomers.some(c => namesMatch(c.name, name));

    const result = categorizeWithHistoricalData(
      name,
      isInCustomerList,
      customer,
      cleanedData
    );

    enhancedResults.push(result);
  }

  // Vormieter-Erkennung
  let previousTenantInfo: PreviousTenantInfo | null = null;
  if (cleanedData) {
    previousTenantInfo = detectPreviousTenant(residentNames, cleanedData);
    if (previousTenantInfo && LOG_CONFIG.HISTORICAL_MATCHING.logPreviousTenant) {
      console.log('[HistoricalMatching] Vormieter erkannt:', previousTenantInfo.previousTenant, '→', previousTenantInfo.newName);
    }
  }

  // Füge Vormieter-Info hinzu
  const finalResults = addPreviousTenantInfo(enhancedResults, previousTenantInfo);

  return {
    enhancedResults: finalResults,
    historicalDatasetUsed: dataset ? {
      id: dataset.id,
      createdAt: dataset.createdAt,
      createdBy: dataset.createdBy,
      houseNumber: dataset.houseNumber
    } : null,
    previousTenantInfo
  };
}

/**
 * Holt die Neukunden aus dem letzten Datensatz für "Adresse durchsuchen"
 * und prüft, ob sie inzwischen in der Bestandskundenliste sind
 */
export async function getHistoricalProspects(
  currentCustomers: Customer[],
  address: Address
): Promise<HistoricalProspect[]> {
  const result: HistoricalProspect[] = [];

  // Historischen Datensatz abrufen
  const dataset = await getMostRecentDataset(address);
  if (!dataset) {
    return result;
  }

  // Normalisierte Namen der aktuellen Kunden für Matching
  const currentCustomerNormalized = currentCustomers.map(c => normalizeName(c.name));

  // Extrahiere alle potential_new_customer aus dem Datensatz
  for (const resident of dataset.editableResidents) {
    if (resident.category === 'potential_new_customer') {
      // Prüfe ob dieser Name jetzt in der Bestandskundenliste ist
      const normalizedName = normalizeName(resident.name);
      let maybeNowCustomer = false;

      for (const currentName of currentCustomerNormalized) {
        if (namesMatch(resident.name, currentName) || normalizedName === currentName) {
          maybeNowCustomer = true;
          break;
        }
      }

      // Auch gegen die vollständigen Kundennamen prüfen
      if (!maybeNowCustomer) {
        for (const customer of currentCustomers) {
          if (namesMatch(resident.name, customer.name)) {
            maybeNowCustomer = true;
            break;
          }
        }
      }

      result.push({
        name: resident.name,
        status: resident.status,
        notes: resident.notes,
        floor: resident.floor,
        door: resident.door,
        maybeNowCustomer,
        datasetDate: dataset.createdAt,
        datasetId: dataset.id,
      });
    }
  }

  return result;
}

// Service loaded silently
