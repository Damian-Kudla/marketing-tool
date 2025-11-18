// Tracking Data Types

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  source?: 'native' | 'followmee'; // GPS data source
}

export interface SessionData {
  userId: string;
  username: string;
  startTime: number;
  lastActivity: number;
  isActive: boolean;
  idleTime: number; // milliseconds
  sessionDuration: number; // milliseconds
  pageViews: number;
  actions: ActionLog[];
}

export interface ActionLog {
  timestamp: number;
  action: 'scan' | 'edit' | 'save' | 'delete' | 'status_change' | 'navigate';
  details?: string;
  residentStatus?: 'interessiert' | 'nicht_interessiert' | 'nicht_angetroffen' | 'termin_vereinbart';
  previousStatus?: 'interessiert' | 'nicht_interessiert' | 'nicht_angetroffen' | 'termin_vereinbart'; // For tracking actual status changes
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  userAgent: string;
  screenResolution: string;
}

export interface DeviceStatus {
  batteryLevel?: number;
  isCharging?: boolean;
  connectionType?: string; // 'wifi', '4g', '5g', 'ethernet', 'offline'
  effectiveType?: string; // 'slow-2g', '2g', '3g', '4g'
  screenOrientation?: string;
  memoryUsage?: number;
  timestamp: number;
  deviceId?: string; // Device fingerprint ID
}

export interface TrackingData {
  userId: string;
  username: string;
  timestamp: number;
  gps?: GPSCoordinates;
  session?: Partial<SessionData>;
  device?: DeviceStatus;
  deviceInfo?: DeviceInfo; // Device fingerprint information
}

// Daily Aggregated Data (stored in RAM)
export interface DailyUserData {
  userId: string;
  username: string;
  date: string; // YYYY-MM-DD
  
  // GPS Data
  gpsPoints: GPSCoordinates[];
  totalDistance: number; // meters
  uniqueAddresses: Set<string>;
  
  // Session Data
  totalSessionTime: number; // milliseconds
  totalIdleTime: number; // milliseconds
  activeTime: number; // milliseconds
  sessionCount: number;
  
  // Actions
  totalActions: number;
  actionsByType: Map<string, number>;
  statusChanges: Map<string, number>; // key: status, value: count (all changes made)
  finalStatuses?: Map<string, number>; // key: status, value: count (final status per resident)
  conversionRates?: { // Conversion rates from 'interest_later' to other statuses
    interest_later_to_written?: number;
    interest_later_to_no_interest?: number;
    interest_later_to_appointment?: number;
    interest_later_to_not_reached?: number;
    interest_later_total?: number;
  };
  uniquePhotos?: number; // Deduplicated OCR photo count (optional for backward compatibility)
  photoTimestamps?: number[]; // Timestamps when photos were taken (for route replay)
  
  // Device Status
  avgBatteryLevel: number;
  lowBatteryEvents: number; // below 20%
  offlineEvents: number;
  
  // KPIs
  scansPerHour: number;
  avgTimePerAddress: number; // milliseconds
  conversionRate: number; // percentage
  activityScore?: number;
  
  // Raw logs for PDF generation
  rawLogs: TrackingData[];
}

// PDF Report Data
export interface UserReport {
  userId: string;
  username: string;
  date: string;
  activityScore?: number;
  
  summary: {
    totalDistance: number;
    uniqueAddresses: number;
    totalSessionTime: number;
    activeTime: number;
    idleTime: number;
    totalActions: number;
    statusChanges: Map<string, number>;
    scansPerHour: number;
    conversionRate: number;
  };
  
  timeline: {
    firstActivity: number;
    lastActivity: number;
    peakHours: string[]; // e.g., ["09:00-10:00", "14:00-15:00"]
  };
  
  device: {
    avgBatteryLevel: number;
    lowBatteryEvents: number;
    offlineEvents: number;
  };
}

export interface DailyReport {
  date: string;
  generatedAt: number;
  totalUsers: number;
  userReports: UserReport[];
}

// Admin Dashboard Live Data
export interface DashboardLiveData {
  timestamp: number;
  users: {
    userId: string;
    username: string;
    currentLocation?: GPSCoordinates;
    isActive: boolean;
    lastSeen: number;
    todayStats: {
      totalActions: number;
      actionDetails?: { // Breakdown of actions by type
        scans?: number;
        ocrCorrections?: number;
        datasetCreates?: number;
        geocodes?: number;
        edits?: number;
        saves?: number;
        deletes?: number;
        statusChanges?: number;
        navigations?: number;
        other?: number;
      };
      statusChanges: Record<string, number>; // All status changes made during the day
      finalStatuses: Record<string, number>; // Final status assignments that remain at end of day
      conversionRates: { // Conversion rates from 'interest_later' to other statuses
        interest_later_to_written?: number;
        interest_later_to_no_interest?: number;
        interest_later_to_appointment?: number;
        interest_later_to_not_reached?: number;
        interest_later_total?: number; // Total 'interest_later' changes
      };
      activeTime: number;
      distance: number;
      uniquePhotos: number; // Deduplizierte OCR-Anfragen
      peakTime?: string; // e.g., "13:00-15:00" - most active time period
      breaks?: Array<{ // Top 3 breaks (largest time gaps)
        start: number; // timestamp
        end: number; // timestamp
        duration: number; // milliseconds
        locations?: Array<{ // POI information for the pause location
          poi_name: string;
          poi_type: string;
          address: string;
          place_id: string;
        }>;
      }>;
    };
  }[];
}

// Historical Dashboard Data Request
export interface HistoricalDataRequest {
  date: string; // YYYY-MM-DD
  userId?: string; // optional, for single user
}
