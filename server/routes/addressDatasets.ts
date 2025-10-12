import { Router } from 'express';
import { z } from 'zod';
import { addressDatasetService, normalizeAddress } from '../services/googleSheets';

// Helper function to get current time in Berlin timezone (MEZ/MESZ)
function getBerlinTime(): Date {
  const berlinTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  return berlinTime;
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

// Create new address dataset
router.post('/', async (req, res) => {
  try {
    const data = addressDatasetRequestSchema.parse(req.body);
    const username = (req as any).username; // Changed from req.user?.username to req.username
    
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Normalize the address
    const normalizedAddress = await normalizeAddress(
      data.address.street,
      data.address.number,
      data.address.city,
      data.address.postal
    );

    // Check if dataset already exists for today
    const existingDataset = await addressDatasetService.getTodaysDatasetByAddress(normalizedAddress);
    if (existingDataset) {
      if (existingDataset.createdBy !== username) {
        return res.status(409).json({ 
          error: 'A dataset for this address already exists today',
          message: `${existingDataset.createdBy} war heute schon hier. Du kannst seinen Datensatz ansehen aber nicht bearbeiten.`,
          existingCreator: existingDataset.createdBy,
          isOwnDataset: false
        });
      } else {
        return res.status(409).json({ 
          error: 'A dataset for this address already exists today',
          message: 'Du hast heute schon einen Datensatz hier angelegt. Bitte gehe auf Verlauf und bearbeite den angelegten Datensatz.',
          existingCreator: existingDataset.createdBy,
          isOwnDataset: true
        });
      }
    }

    // Create the dataset
    const dataset = await addressDatasetService.createAddressDataset({
      normalizedAddress,
      street: data.address.street,
      houseNumber: data.address.number,
      city: data.address.city,
      postalCode: data.address.postal,
      createdBy: username,
      rawResidentData: data.rawResidentData,
      editableResidents: data.editableResidents,
      fixedCustomers: [], // Will be populated from customer database
    });

    // New datasets are always editable by the creator
    res.json({
      ...dataset,
      canEdit: true,
    });
  } catch (error) {
    console.error('Error creating address dataset:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create address dataset' });
  }
});

// Get address datasets for a specific address
router.get('/', async (req, res) => {
  try {
    const address = addressSchema.parse(req.query);
    
    const normalizedAddress = await normalizeAddress(
      address.street,
      address.number,
      address.city,
      address.postal
    );

    const datasets = await addressDatasetService.getAddressDatasets(normalizedAddress, 5);
    
    // Check if today's dataset exists and who created it
    const todaysDataset = await addressDatasetService.getTodaysDatasetByAddress(normalizedAddress);
    const username = (req as any).username;
    
    // Add canEdit property to each dataset
    const now = getBerlinTime();
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const datasetsWithEditFlag = datasets.map(dataset => {
      const creationDate = new Date(dataset.createdAt);
      const creationDateOnly = new Date(creationDate.getFullYear(), creationDate.getMonth(), creationDate.getDate());
      const isToday = nowDateOnly.getTime() === creationDateOnly.getTime();
      const isCreator = dataset.createdBy === username;
      
      return {
        ...dataset,
        canEdit: isCreator && isToday,
      };
    });
    
    const response = {
      datasets: datasetsWithEditFlag,
      canCreateNew: !todaysDataset || todaysDataset.createdBy === username,
      existingTodayBy: todaysDataset?.createdBy !== username ? todaysDataset?.createdBy : undefined,
      normalizedAddress,
    };

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

    // Check if user can edit this dataset (only creator can edit, and only on creation day)
    const now = getBerlinTime(); // Use Berlin timezone
    const creationDate = new Date(dataset.createdAt);
    
    // Compare dates in local timezone (ignore time, only compare year/month/day)
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const creationDateOnly = new Date(creationDate.getFullYear(), creationDate.getMonth(), creationDate.getDate());
    const isToday = nowDateOnly.getTime() === creationDateOnly.getTime();
    
    if (dataset.createdBy !== username || !isToday) {
      return res.status(403).json({ error: 'Cannot edit this dataset' });
    }

    await addressDatasetService.updateResidentInDataset(
      data.datasetId,
      data.residentIndex,
      data.residentData
    );

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

    // Get the dataset to check permissions
    const dataset = await addressDatasetService.getDatasetById(data.datasetId);
    
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    // Check if user can edit this dataset (only creator can edit, and only on creation day)
    const now = getBerlinTime(); // Use Berlin timezone
    const creationDate = new Date(dataset.createdAt);
    
    // Compare dates in local timezone (ignore time, only compare year/month/day)
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const creationDateOnly = new Date(creationDate.getFullYear(), creationDate.getMonth(), creationDate.getDate());
    const isToday = nowDateOnly.getTime() === creationDateOnly.getTime();
    
    const usernameMatches = dataset.createdBy === username;
    const canEdit = usernameMatches && isToday;
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Cannot edit this dataset' });
    }

    await addressDatasetService.bulkUpdateResidentsInDataset(
      data.datasetId,
      data.editableResidents
    );

    console.log(`[Bulk Update] Successfully updated ${data.editableResidents.length} residents in dataset ${data.datasetId}`);

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
    
    // Return simplified data for history view
    const historyItems = datasets.map(dataset => ({
      id: dataset.id,
      address: `${dataset.street} ${dataset.houseNumber}`,
      city: dataset.city,
      postalCode: dataset.postalCode,
      createdAt: dataset.createdAt,
      residentCount: dataset.editableResidents.length + dataset.fixedCustomers.length,
    }));

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

    // Check if dataset is editable (only creator on creation day)
    const now = getBerlinTime(); // Use Berlin timezone
    const creationDate = new Date(dataset.createdAt);
    
    // Compare dates in local timezone (ignore time, only compare year/month/day)
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const creationDateOnly = new Date(creationDate.getFullYear(), creationDate.getMonth(), creationDate.getDate());
    const isToday = nowDateOnly.getTime() === creationDateOnly.getTime();
    
    const usernameMatches = dataset.createdBy === username;
    const canEdit = usernameMatches && isToday;

    console.log('[GET /:id] Dataset edit permissions (Berlin time):');
    console.log('  datasetId:', id);
    console.log('  createdBy:', dataset.createdBy);
    console.log('  requestingUser:', username);
    console.log('  usernameMatches:', usernameMatches);
    console.log('  createdAt:', dataset.createdAt);
    console.log('  now (Berlin):', now.toISOString());
    console.log('  nowDateOnly:', nowDateOnly.toISOString());
    console.log('  creationDateOnly:', creationDateOnly.toISOString());
    console.log('  isToday:', isToday);
    console.log('  >>> canEdit:', canEdit);

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