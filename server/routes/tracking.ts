import { Router, Request, Response } from 'express';
import { dailyDataStore } from '../services/dailyDataStore';
import { logUserActivityWithRetry } from '../services/enhancedLogging';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { GPSCoordinates, SessionData, DeviceStatus } from '../../shared/trackingTypes';

const router = Router();

/**
 * POST /api/tracking/gps
 * Receive GPS coordinates from client
 */
router.post('/gps', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId || !req.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { gps, timestamp } = req.body as { gps: GPSCoordinates; timestamp: number };

    if (!gps || !gps.latitude || !gps.longitude) {
      return res.status(400).json({ error: 'Invalid GPS data' });
    }

    // Store in RAM
    dailyDataStore.addGPS(req.userId, req.username, gps);

    // Log to Google Sheets with GPS data
    await logUserActivityWithRetry(
      req,
      `GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`, // address field
      undefined,
      undefined,
      { // data field
        action: 'gps_update',
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        timestamp
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Tracking API] Error processing GPS:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/tracking/session
 * Receive session data from client
 */
router.post('/session', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId || !req.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { session, timestamp } = req.body as { session: Partial<SessionData>; timestamp: number };

    if (!session) {
      return res.status(400).json({ error: 'Invalid session data' });
    }

    // Store in RAM
    dailyDataStore.updateSession(req.userId, req.username, session);

    // Recalculate KPIs
    dailyDataStore.calculateKPIs(req.userId);

    // Determine action type from session data
    let actionType = 'session_update';
    if (session.actions && session.actions.length > 0) {
      const lastAction = session.actions[session.actions.length - 1];
      actionType = lastAction.action || 'session_update';
    }

    // Log to Google Sheets with session data
    await logUserActivityWithRetry(
      req,
      undefined,
      undefined,
      undefined,
      { // data field
        action: actionType,
        isActive: session.isActive,
        idleTime: session.idleTime,
        sessionDuration: session.sessionDuration,
        actionsCount: session.actions?.length || 0,
        timestamp
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Tracking API] Error processing session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/tracking/device
 * Receive device status from client
 */
router.post('/device', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId || !req.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { device, timestamp } = req.body as { device: DeviceStatus; timestamp: number };

    if (!device) {
      return res.status(400).json({ error: 'Invalid device data' });
    }

    // Store in RAM
    dailyDataStore.updateDevice(req.userId, req.username, device);

    // Recalculate KPIs
    dailyDataStore.calculateKPIs(req.userId);

    // Log to Google Sheets with device data
    await logUserActivityWithRetry(
      req,
      undefined,
      undefined,
      undefined,
      { // data field
        action: 'device_update',
        batteryLevel: device.batteryLevel,
        isCharging: device.isCharging,
        connectionType: device.connectionType,
        effectiveType: device.effectiveType,
        screenOrientation: device.screenOrientation,
        memoryUsage: device.memoryUsage,
        timestamp
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Tracking API] Error processing device status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/tracking/status
 * Get tracking status (for debugging)
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const storeSize = dailyDataStore.getSize();
    const userData = dailyDataStore.getUserDailyData(req.userId);

    res.json({
      store: storeSize,
      user: userData ? {
        totalActions: userData.totalActions,
        totalDistance: Math.round(userData.totalDistance),
        activityScore: userData.activityScore,
        statusChanges: Object.fromEntries(userData.statusChanges)
      } : null
    });
  } catch (error) {
    console.error('[Tracking API] Error getting status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
