import { Router } from 'express';
import { z } from 'zod';
import { addressDatasetService, normalizeAddress } from '../services/googleSheets';
import { logUserActivityWithRetry } from '../services/enhancedLogging';
import { storage } from '../storage';
import { dailyDataStore } from '../services/dailyDataStore';
import { getBerlinTimestamp } from '../utils/timezone';

// ==================== LOCK MECHANISM FOR RACE CONDITION PREVENTION ====================
// In-memory lock map to prevent concurrent dataset creation for the same address
// Key format: "normalizedAddress:username"
// Value: Promise of ongoing creation + timestamp
interface CreationLock {
  promise: Promise<any>;
  timestamp: number;
}

const creationLocks = new Map<string, CreationLock>();
const LOCK_TIMEOUT_MS = 30000; // 30 seconds (increased from 10s to handle slow Google Sheets API calls)

// Cleanup expired locks (ran periodically)
setInterval(() => {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  creationLocks.forEach((lock, key) => {
    if (now - lock.timestamp > LOCK_TIMEOUT_MS) {
      expiredKeys.push(key);
    }
  });
  
  expiredKeys.forEach(key => {
    console.warn(`[Lock Cleanup] Removing expired lock for: ${key}`);
    creationLocks.delete(key);
  });
}, 5000); // Check every 5 seconds

// ==================== END LOCK MECHANISM ====================

// Helper function to get current time (always use UTC internally)
function getBerlinTime(): Date {
  // IMPORTANT: Always use UTC Date objects for consistent calculations
  // This prevents timezone-related bugs when comparing dates
  return new Date();
}

// Helper function to check if a date is within 30 days from now
function isWithin30Days(date: Date): boolean {
  const now = new Date(); // Current UTC time
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysInFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  // BACKWARDS COMPATIBILITY: Accept dates within 30 days in PAST or FUTURE
  // This handles datasets created with the old buggy getBerlinTime() function
  // which created timestamps ~2 hours in the future (MESZ timezone bug)
  // After 30 days, even those buggy timestamps will expire naturally
  return date >= thirtyDaysAgo && date <= thirtyDaysInFuture;
}
import { 
  addressDatasetRequestSchema, 
  updateResidentRequestSchema,
  bulkUpdateResidentsRequestSchema,
  addressSchema 
} from '../../shared/schema';
import type { 
  AddressDataset, 
  AddressDatasetRequest, 
  UpdateResidentRequest,
  BulkUpdateResidentsRequest,
  Address 
} from '../../shared/schema';

const router = Router();

// Get street name suggestions based on partial input
router.get('/streets/suggestions', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.json({ streets: [] });
    }

    const searchTerm = query.trim().toLowerCase();
    
    // Get all datasets from cache
    const allDatasets = await addressDatasetService.getAllDatasets();
    
    // Extract unique streets that match the search term
    const matchingStreets = new Set<string>();
    
    for (const dataset of allDatasets) {
      const street = dataset.street?.toLowerCase();
      if (street && street.includes(searchTerm)) {
        matchingStreets.add(dataset.street); // Use original casing
      }
    }

    // Convert to array and sort
    const streets = Array.from(matchingStreets).sort();
    
    res.json({ streets: streets.slice(0, 10) }); // Limit to 10 suggestions
  } catch (error) {
    console.error('Error fetching street suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch street suggestions' });
  }
});

// Get datasets by street (with optional house number filter)
router.get('/streets/:streetName', async (req, res) => {
  try {
    const { streetName } = req.params;
    const username = (req as any).username;
    
    if (!streetName) {
      return res.status(400).json({ error: 'Street name is required' });
    }

    // Get all datasets from cache
    const allDatasets = await addressDatasetService.getAllDatasets();
    
    // Filter datasets by street name (case-insensitive)
    const streetDatasets = allDatasets.filter(dataset => 
      dataset.street?.toLowerCase() === decodeURIComponent(streetName).toLowerCase()
    );

    // Group by house number and keep only the most recent dataset per house number
    const houseNumberMap = new Map<string, AddressDataset>();
    
    for (const dataset of streetDatasets) {
      const existingDataset = houseNumberMap.get(dataset.houseNumber);
      if (!existingDataset || new Date(dataset.createdAt) > new Date(existingDataset.createdAt)) {
        houseNumberMap.set(dataset.houseNumber, dataset);
      }
    }

    // Convert to array and add canEdit flag
    const datasets = Array.from(houseNumberMap.values()).map(dataset => {
      const creationDate = new Date(dataset.createdAt);
      const isEditable = isWithin30Days(creationDate);
      const isCreator = dataset.createdBy === username;
      
      return {
        ...dataset,
        canEdit: isCreator && isEditable,
      };
    });

    // Sort by house number (numeric sort)
    datasets.sort((a, b) => {
      const numA = parseInt(a.houseNumber.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.houseNumber.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    res.json({ datasets });
  } catch (error) {
    console.error('Error fetching datasets by street:', error);
    res.status(500).json({ error: 'Failed to fetch datasets by street' });
  }
});

// Create new address dataset
router.post('/', async (req, res) => {
  try {
    const data = addressDatasetRequestSchema.parse(req.body);
    const username = (req as any).username; // Changed from req.user?.username to req.username
    
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validate address completeness: street, number, and postal are REQUIRED
    const missingFields: string[] = [];
    if (!data.address.street?.trim()) missingFields.push('Straße');
    if (!data.address.number?.trim()) missingFields.push('Hausnummer');
    if (!data.address.postal?.trim()) missingFields.push('Postleitzahl');

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Incomplete address', 
        message: `Folgende Pflichtfelder fehlen: ${missingFields.join(', ')}`,
        missingFields: missingFields,
      });
    }

    // Validate house number format
    try {
      storage.validateHouseNumber(data.address.number);
    } catch (error: any) {
      console.error('[POST /address-datasets] Invalid house number format:', data.address.number, error.message);
      return res.status(400).json({ 
        error: 'Invalid house number format',
        message: error.message || 'Ungültige Hausnummer',
      });
    }

    // Normalize and validate the address using Geocoding API
    let normalized;
    try {
      normalized = await normalizeAddress(
        data.address.street,
        data.address.number,
        data.address.city,
        data.address.postal,
        username // Pass username for rate limiting
      );
    } catch (error: any) {
      // Handle validation errors from normalizeAddress
      return res.status(400).json({ 
        error: 'Address validation failed', 
        message: error.message || 'Adressvalidierung fehlgeschlagen',
      });
    }

    // Verify that normalization produced a valid result
    if (!normalized) {
      console.warn('[POST /] Address normalization failed:', {
        street: data.address.street,
        number: data.address.number,
        postal: data.address.postal,
        city: data.address.city
      });
      
      return res.status(400).json({ 
        error: 'Address validation failed', 
        message: `Die Adresse "${data.address.street} ${data.address.number}, ${data.address.postal}" konnte nicht gefunden werden.

Mögliche Gründe:
• Die Straße existiert nicht in dieser Postleitzahl
• Es handelt sich um einen Gebäude- oder Haltestellennamen (z.B. "Neusser Weyhe" = Haltestelle)
• Die Adresse ist zu ungenau oder unvollständig
• Tippfehler im Straßennamen oder der Postleitzahl

Bitte überprüfe die Eingabe oder verwende eine andere Schreibweise.`,
        details: {
          street: data.address.street,
          number: data.address.number,
          postal: data.address.postal,
          city: data.address.city
        }
      });
    }

    // Check if an editable dataset exists within the last 30 days (with flexible house number matching)
    // This ensures we can't create a new dataset while an existing one is still editable
    const existingDataset = await addressDatasetService.getRecentDatasetByAddress(normalized.formattedAddress, normalized.number, 30);
    if (existingDataset) {
      // Check if the dataset is still editable (within 30 days)
      const creationDate = new Date(existingDataset.createdAt);
      const isEditable = isWithin30Days(creationDate);
      
      if (!isEditable) {
        // Dataset exists but is older than 30 days - allow creation of new dataset
        console.log('[POST /] Existing dataset found but older than 30 days, allowing new dataset creation');
      } else {
        // Dataset is still editable - prevent creation
        const isNonExactMatch = existingDataset.houseNumber !== data.address.number;
        const existingAddress = isNonExactMatch 
          ? `${existingDataset.street} ${existingDataset.houseNumber}` 
          : 'hier';
        
        // Calculate days since creation (ensure non-negative)
        const timeDiff = Date.now() - creationDate.getTime();
        const daysSince = Math.max(0, Math.floor(timeDiff / (1000 * 60 * 60 * 24)));
        const daysRemaining = Math.max(1, 30 - daysSince); // Minimum 1 day remaining
        
        if (existingDataset.createdBy !== username) {
          return res.status(409).json({ 
            error: 'A dataset for this address already exists within 30 days',
            message: `${existingDataset.createdBy} hat vor ${daysSince} Tag${daysSince !== 1 ? 'en' : ''} einen Datensatz ${existingAddress} angelegt. Du kannst seinen Datensatz ansehen aber nicht bearbeiten. In ${daysRemaining} Tag${daysRemaining !== 1 ? 'en' : ''} kannst du einen neuen Datensatz anlegen.`,
            existingCreator: existingDataset.createdBy,
            isOwnDataset: false,
            daysSinceCreation: daysSince,
            daysUntilNewAllowed: daysRemaining,
            existingDataset: isNonExactMatch ? {
              street: existingDataset.street,
              houseNumber: existingDataset.houseNumber
            } : undefined
          });
        } else {
          return res.status(409).json({ 
            error: 'A dataset for this address already exists within 30 days',
            message: `Du hast vor ${daysSince} Tag${daysSince !== 1 ? 'en' : ''} einen Datensatz ${existingAddress} angelegt. Bitte gehe auf Verlauf und bearbeite den angelegten Datensatz. In ${daysRemaining} Tag${daysRemaining !== 1 ? 'en' : ''} kannst du einen neuen Datensatz anlegen.`,
            existingCreator: existingDataset.createdBy,
            isOwnDataset: true,
            daysSinceCreation: daysSince,
            daysUntilNewAllowed: daysRemaining,
            existingDataset: isNonExactMatch ? {
              street: existingDataset.street,
              houseNumber: existingDataset.houseNumber
            } : undefined
          });
        }
      }
    }

    // ==================== LOCK CHECK: Prevent race conditions ====================
    // Create unique lock key for this address + user combination
    const lockKey = `${normalized.formattedAddress}:${username}`;
    
    // Check if creation is already in progress for this address
    if (creationLocks.has(lockKey)) {
      const existingLock = creationLocks.get(lockKey)!;
      const lockAge = Date.now() - existingLock.timestamp;
      
      // If lock is fresh (< 10s), reject with 409
      if (lockAge < LOCK_TIMEOUT_MS) {
        console.warn(`[POST /] 🔒 Dataset creation already in progress for ${lockKey} (${lockAge}ms ago)`);
        return res.status(409).json({
          error: 'Dataset creation already in progress',
          message: 'Datensatz wird bereits erstellt. Bitte warte einen Moment.',
        });
      } else {
        // Lock is expired, remove it and continue
        console.warn(`[POST /] 🔓 Removing expired lock for ${lockKey}`);
        creationLocks.delete(lockKey);
      }
    }
    // ==================== END LOCK CHECK ====================

    // Create the dataset using NORMALIZED address components
    // This ensures all datasets use Google's standardized address format
    
    // ==================== OPTIMIZED: Fast dataset creation without blocking ====================
    // Set lock to prevent race conditions
    const lockPromise = Promise.resolve(); // Dummy promise for lock mechanism
    creationLocks.set(lockKey, {
      promise: lockPromise,
      timestamp: Date.now()
    });
    console.log(`[POST /] 🔒 Set lock for ${lockKey}`);
    
    try {
      // Create dataset synchronously in cache (FAST - no Google Sheets write yet)
      const dataset = await addressDatasetService.createAddressDataset({
        normalizedAddress: normalized.formattedAddress,
        street: normalized.street,      // Use normalized street (e.g., "Schnellweider Straße")
        houseNumber: normalized.number, // Use normalized house number
        city: normalized.city,          // Use normalized city
        postalCode: normalized.postal,  // Use normalized postal code
        createdBy: username,
        rawResidentData: data.rawResidentData,
        editableResidents: data.editableResidents,
        fixedCustomers: [], // Will be populated from customer database
      });

      // Release lock IMMEDIATELY after cache write (before logging!)
      creationLocks.delete(lockKey);
      console.log(`[POST /] 🔓 Released lock for ${lockKey} (dataset in cache)`);

      // Log activity to Google Sheets ASYNCHRONOUSLY (don't wait for it)
      logUserActivityWithRetry(
        req,
        normalized.formattedAddress,
        undefined, // No prospects at creation
        undefined, // No existing customers at creation
        { // Data field
          action: 'dataset_create',
          datasetId: dataset.id,
          street: normalized.street,
          houseNumber: normalized.number,
          city: normalized.city,
          postalCode: normalized.postal,
          residentsCount: dataset.editableResidents.length
        }
      ).catch(logError => {
        console.error('[POST /api/address-datasets] Failed to log activity:', logError);
      });

      // Track action in daily data store for live dashboard
      const userId = (req as any).userId;
      if (userId && username) {
        dailyDataStore.addAction(userId, username, 'dataset_create');
      }

      // Return dataset immediately (Google Sheets write happens in background)
      res.json({
        ...dataset,
        canEdit: true,
        // Return normalized address so frontend can update its state
        // Keep original house number from user input (may contain ranges like "1-3" or "1,2,3")
        normalizedAddress: {
          street: normalized.street,
          number: data.address.number, // Use original user input, not normalized single number
          city: normalized.city,
          postal: normalized.postal,
        }
      });
    } catch (error) {
      // Release lock on error
      creationLocks.delete(lockKey);
      console.log(`[POST /] 🔓 Released lock for ${lockKey} (error)`);
      throw error;
    }
  } catch (error) {
    console.error('Error creating address dataset:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create address dataset' });
  }
});

// Search for existing datasets WITHOUT normalization (for +/- button navigation)
router.get('/search-local', async (req, res) => {
  try {
    // IMPORTANT: Only execute search if we have a 5-digit postal code
    // This prevents unnecessary API calls while user is still typing
    const postal = req.query.postal as string;
    
    // Check if postal code is exactly 5 digits
    if (!postal || !/^\d{5}$/.test(postal)) {
      // Return empty result if postal code is not valid yet
      return res.json({
        datasets: [],
        recentDatasetExists: false,
      });
    }
    
    // Check if house number is provided (required for local search)
    const number = req.query.number as string;
    if (!number || !number.trim()) {
      // Return empty result if house number is not provided yet
      // This is expected when user is still typing the address
      return res.json({
        datasets: [],
        recentDatasetExists: false,
      });
    }
    
    // Now validate the full address (both postal and number are guaranteed to be valid)
    const address = addressSchema.parse(req.query);
    const username = (req as any).username;
    
    // Build search string WITHOUT calling normalizeAddress (no API calls!)
    const searchAddress = `${address.street || ''} ${address.postal || ''} ${address.city || ''}`.trim().toLowerCase();
    
    // Search directly in database without normalization
    const datasets = await addressDatasetService.getAddressDatasets(searchAddress, 5, address.number);
    
    // Add canEdit property and non-exact match flag
    const datasetsWithEditFlag = datasets.map(dataset => {
      const creationDate = new Date(dataset.createdAt);
      const isEditable = isWithin30Days(creationDate);
      const isCreator = dataset.createdBy === username;
      const isNonExactMatch = dataset.houseNumber !== address.number;
      
      return {
        ...dataset,
        canEdit: isCreator && isEditable,
        isNonExactMatch,
      };
    });

    res.json({
      datasets: datasetsWithEditFlag,
      recentDatasetExists: datasetsWithEditFlag.length > 0,
    });
  } catch (error) {
    console.error('Error searching local datasets:', error);
    res.status(500).json({ error: 'Failed to search local datasets' });
  }
});

// Get address datasets for a specific address (WITH normalization - only for "Adresse durchsuchen" button)
router.get('/', async (req, res) => {
  try {
    const address = addressSchema.parse(req.query);
    const username = (req as any).username; // Get username for rate limiting
    
    const normalized = await normalizeAddress(
      address.street,
      address.number,
      address.city,
      address.postal,
      username // Pass username for rate limiting
    );

    // If address validation failed, return error
    if (!normalized) {
      return res.status(400).json({ 
        error: 'Address validation failed', 
        message: `Die Adresse "${address.street} ${address.number}, ${address.postal}" konnte nicht gefunden werden.`,
      });
    }

    // Pass house number for flexible matching (e.g., "30" should match "30,31,32,33")
    const datasets = await addressDatasetService.getAddressDatasets(normalized.formattedAddress, 5, address.number);
    
    // Check if recent dataset exists (within 30 days) and who created it
    const recentDataset = await addressDatasetService.getRecentDatasetByAddress(normalized.formattedAddress, address.number, 30);
    
    // Add canEdit property and non-exact match flag to each dataset
    const datasetsWithEditFlag = datasets.map(dataset => {
      const creationDate = new Date(dataset.createdAt);
      const isEditable = isWithin30Days(creationDate);
      const isCreator = dataset.createdBy === username;
      const isNonExactMatch = dataset.houseNumber !== address.number;
      
      return {
        ...dataset,
        canEdit: isCreator && isEditable,
        isNonExactMatch,
      };
    });
    
    const response = {
      datasets: datasetsWithEditFlag,
      canCreateNew: !recentDataset || recentDataset.createdBy === username,
      existingTodayBy: recentDataset?.createdBy !== username ? recentDataset?.createdBy : undefined,
      normalizedAddress: normalized.formattedAddress,
      // Return corrected address components for frontend update
      correctedAddress: {
        street: normalized.street,
        number: normalized.number,
        city: normalized.city,
        postal: normalized.postal,
      }
    };

    // Log dataset retrieval activity
    try {
      await logUserActivityWithRetry(
        req,
        normalized.formattedAddress,
        undefined,
        undefined
      );
    } catch (logError) {
      console.error('[GET /api/address-datasets] Failed to log activity:', logError);
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching address datasets:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid address data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to fetch address datasets' });
  }
});

// Update resident in dataset
router.put('/residents', async (req, res) => {
  try {
    const data = updateResidentRequestSchema.parse(req.body);
    const username = (req as any).username;
    
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get the dataset to check permissions
    const dataset = await addressDatasetService.getDatasetById(data.datasetId);
    
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // Check if user can edit this dataset (only creator can edit, and only within 30 days)
    const creationDate = new Date(dataset.createdAt);
    const isEditable = isWithin30Days(creationDate);
    const usernameMatches = dataset.createdBy === username;
    const canEdit = usernameMatches && isEditable;
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Cannot edit this dataset. Editing is only allowed within 30 days of creation by the creator.' });
    }

    // Sanitize: Auto-clear status if category is not potential_new_customer
    let sanitizedResidentData = data.residentData;
    if (sanitizedResidentData && sanitizedResidentData.status && sanitizedResidentData.category !== 'potential_new_customer') {
      console.warn(`[Update Resident] Auto-clearing status for ${sanitizedResidentData.name} (category: ${sanitizedResidentData.category})`);
      sanitizedResidentData = {
        ...sanitizedResidentData,
        status: undefined
      };
    }

    await addressDatasetService.updateResidentInDataset(
      data.datasetId,
      data.residentIndex,
      sanitizedResidentData
    );

    // Log resident update activity
    try {
      const action = data.residentData === null ? 'resident_delete' : 'resident_update';
      await logUserActivityWithRetry(
        req,
        dataset.normalizedAddress,
        undefined,
        undefined,
        { // Data field
          action,
          datasetId: data.datasetId,
          residentIndex: data.residentIndex,
          residentName: data.residentData?.name,
          residentStatus: data.residentData?.status
        }
      );
    } catch (logError) {
      console.error('[PUT /api/address-datasets/residents] Failed to log activity:', logError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating resident:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to update resident' });
  }
});

// Bulk update all residents in dataset
router.put('/bulk-residents', async (req, res) => {
  try {
    const data = bulkUpdateResidentsRequestSchema.parse(req.body);
    const username = (req as any).username;
    
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // FIX: Auto-clear status if category is not potential_new_customer
    // This handles the case where a resident is changed from potential_new_customer → existing_customer
    const sanitizedResidents = data.editableResidents.map(resident => {
      if (resident.status && resident.category !== 'potential_new_customer') {
        console.warn(`[Bulk Update] Auto-clearing status for ${resident.name} (category: ${resident.category})`);
        return {
          ...resident,
          status: undefined
        };
      }
      return resident;
    });
    
    // Use sanitized residents for the update
    data.editableResidents = sanitizedResidents;

    // Get the dataset to check permissions
    const dataset = await addressDatasetService.getDatasetById(data.datasetId);
    
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // Check if user can edit this dataset (only creator can edit, and only within 30 days)
    const creationDate = new Date(dataset.createdAt);
    const isEditable = isWithin30Days(creationDate);
    const usernameMatches = dataset.createdBy === username;
    const canEdit = usernameMatches && isEditable;
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Cannot edit this dataset. Editing is only allowed within 30 days of creation by the creator.' });
    }

    await addressDatasetService.bulkUpdateResidentsInDataset(
      data.datasetId,
      data.editableResidents
    );

    console.log(`[Bulk Update] Successfully updated ${data.editableResidents.length} residents in dataset ${data.datasetId}`);

    // Log bulk resident update activity
    try {
      await logUserActivityWithRetry(
        req,
        dataset.normalizedAddress,
        undefined,
        undefined,
        { // Data field
          action: 'bulk_residents_update',
          datasetId: data.datasetId,
          residentsCount: data.editableResidents.length,
          residents: data.editableResidents.map(r => ({
            name: r.name,
            status: r.status
          }))
        }
      );
    } catch (logError) {
      console.error('[PUT /api/address-datasets/bulk-residents] Failed to log activity:', logError);
    }

    // Track action in daily data store for live dashboard
    const userId = (req as any).userId;
    if (userId && username) {
      dailyDataStore.addAction(userId, username, 'bulk_residents_update');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error bulk updating residents:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to bulk update residents' });
  }
});

// Get user history for a specific date
router.get('/history/:username/:date', async (req, res) => {
  try {
    const { username, date } = req.params;
    const requestingUser = (req as any).username;
    
    if (!requestingUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Users can only see their own history
    if (username !== requestingUser) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const datasets = await addressDatasetService.getUserDatasetsByDate(username, targetDate);
    
    // Return simplified data for history view with call back counts
    const historyItems = datasets.map(dataset => {
      const notReachedCount = dataset.editableResidents.filter(r => r.status === 'not_reached').length;
      const interestLaterCount = dataset.editableResidents.filter(r => r.status === 'interest_later').length;
      
      return {
        id: dataset.id,
        address: `${dataset.street} ${dataset.houseNumber}`,
        city: dataset.city,
        postalCode: dataset.postalCode,
        createdAt: dataset.createdAt,
        residentCount: dataset.editableResidents.length + dataset.fixedCustomers.length,
        notReachedCount,
        interestLaterCount,
      };
    });

    // Log history retrieval activity
    try {
      await logUserActivityWithRetry(
        req,
        undefined, // No specific address for history view
        undefined,
        undefined
      );
    } catch (logError) {
      console.error('[GET /api/address-datasets/history] Failed to log activity:', logError);
    }

    res.json(historyItems);
  } catch (error) {
    console.error('Error fetching user history:', error);
    res.status(500).json({ error: 'Failed to fetch user history' });
  }
});

// Load specific dataset by ID  
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const username = (req as any).username;
    
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get dataset by ID
    const dataset = await addressDatasetService.getDatasetById(id);
    
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // Check if dataset is editable (only creator within 30 days)
    const creationDate = dataset.createdAt instanceof Date ? dataset.createdAt : new Date(dataset.createdAt);
    const now = new Date();
    const isEditable = isWithin30Days(creationDate);
    const usernameMatches = dataset.createdBy === username;
    const canEdit = usernameMatches && isEditable;
    
    // Debug: Log edit check details (only if canEdit is false for debugging)
    if (!canEdit) {
      console.log('[GET /:id] ❌ Edit NOT allowed:', {
        datasetId: id,
        createdAt: getBerlinTimestamp(creationDate),
        createdBy: dataset.createdBy,
        requestingUser: username,
        now: getBerlinTimestamp(now),
        timeDiff: now.getTime() - creationDate.getTime(),
        daysSince: Math.floor((now.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24)),
        isEditable,
        usernameMatches,
        reason: !usernameMatches ? 'Not creator' : !isEditable ? 'Outside 30-day window' : 'Unknown',
      });
    }

    // Log dataset retrieval activity
    try {
      await logUserActivityWithRetry(
        req,
        dataset.normalizedAddress,
        undefined,
        undefined
      );
    } catch (logError) {
      console.error('[GET /api/address-datasets/:id] Failed to log activity:', logError);
    }

    res.json({
      ...dataset,
      canEdit,
    });
  } catch (error) {
    console.error('Error fetching dataset:', error);
    res.status(500).json({ error: 'Failed to fetch dataset' });
  }
});

export default router;
