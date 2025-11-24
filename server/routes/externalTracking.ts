import { Router, Request, Response } from 'express';
import type { LocationData } from '../../shared/externalTrackingTypes';
import { externalTrackingService } from '../services/externalTrackingService';
import { getBerlinTimestamp } from '../utils/timezone';

const router = Router();

/**
 * POST /api/external-tracking/location
 *
 * Empfängt Location-Daten von der externen Tracking-App
 * und speichert sie in Google Sheets (ID: 1OspTbAfG6TM4SiUIHeRAF_QlODy3oHjubbiUTRGDo3Y)
 *
 * Body: LocationData (siehe shared/externalTrackingTypes.ts)
 */
router.post('/location', async (req: Request, res: Response) => {
  try {
    // Validiere Request Body
    const locationData: LocationData = req.body;

    // Validiere Pflichtfelder
    if (!locationData.timestamp || typeof locationData.timestamp !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid required field: timestamp'
      });
    }

    if (typeof locationData.latitude !== 'number' ||
        locationData.latitude < -90 ||
        locationData.latitude > 90) {
      return res.status(400).json({
        error: 'Missing or invalid required field: latitude (must be between -90 and 90)'
      });
    }

    if (typeof locationData.longitude !== 'number' ||
        locationData.longitude < -180 ||
        locationData.longitude > 180) {
      return res.status(400).json({
        error: 'Missing or invalid required field: longitude (must be between -180 and 180)'
      });
    }

    if (!locationData.userName || typeof locationData.userName !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid required field: userName'
      });
    }

    if (typeof locationData.isCharging !== 'boolean') {
      return res.status(400).json({
        error: 'Missing or invalid required field: isCharging (must be boolean)'
      });
    }

    if (typeof locationData.isConnected !== 'boolean') {
      return res.status(400).json({
        error: 'Missing or invalid required field: isConnected (must be boolean)'
      });
    }

    // Speichere die Daten in Google Sheets
    console.log(`[External Tracking] Received location data from user: ${locationData.userName}`);
    console.log(`[External Tracking] Location: ${locationData.latitude}, ${locationData.longitude}`);
    console.log(`[External Tracking] Full location data:`, JSON.stringify(locationData, null, 2));

    await externalTrackingService.saveLocationData(locationData);

    console.log(`[External Tracking] Successfully saved location data for user: ${locationData.userName}`);

    res.json({
      success: true,
      message: 'Location data saved successfully'
    });
  } catch (error) {
    console.error('[External Tracking] Error processing location data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/external-tracking/location/batch
 *
 * Empfängt einen Batch von Location-Daten
 * Body: LocationData[] oder { locations: LocationData[], ... }
 */
router.post('/location/batch', async (req: Request, res: Response) => {
  try {
    let batchData: LocationData[] = [];
    const body = req.body;

    if (Array.isArray(body)) {
      batchData = body;
    } else if (body && Array.isArray(body.locations)) {
      batchData = body.locations;
    } else {
      return res.status(400).json({
        error: 'Invalid batch format. Expected array of locations or object with locations array.'
      });
    }

    if (batchData.length === 0) {
      return res.json({ success: true, message: 'Empty batch received' });
    }

    // Validierung: Prüfe ob alle Items die notwendigen Felder haben
    const invalidItem = batchData.find(item => 
      !item.timestamp || 
      typeof item.latitude !== 'number' || 
      typeof item.longitude !== 'number' ||
      !item.userName
    );

    if (invalidItem) {
      return res.status(400).json({
        error: 'Invalid batch data. One or more items are missing required fields (timestamp, latitude, longitude, userName).'
      });
    }

    console.log(`[External Tracking] Received batch of ${batchData.length} locations`);

    await externalTrackingService.saveBatchLocationData(batchData);

    res.json({
      success: true,
      message: `Successfully processed batch of ${batchData.length} locations`
    });

  } catch (error) {
    console.error('[External Tracking] Error processing batch data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/external-tracking/status
 *
 * Status-Endpunkt zum Testen der API-Verbindung
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    res.json({
      status: 'online',
      service: 'External Tracking API',
      timestamp: getBerlinTimestamp()
    });
  } catch (error) {
    console.error('[External Tracking] Error getting status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
