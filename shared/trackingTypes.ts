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
}

export interface DeviceStatus {
  batteryLevel?: number;
  isCharging?: boolean;
  connectionType?: string; // 'wifi', '4g', '5g', 'ethernet', 'offline'
  effectiveType?: string; // 'slow-2g', '2g', '3g', '4g'
  screenOrientation?: string;
  memoryUsage?: number;
  timestamp: number;
}

export interface TrackingData {
  userId: string;
  username: string;
  timestamp: number;
  gps?: GPSCoordinates;
  session?: Partial<SessionData>;
  device?: DeviceStatus;
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
  statusChanges: Map<string, number>; // key: status, value: count
  uniquePhotos?: number; // Deduplicated OCR photo count (optional for backward compatibility)
  
  // Device Status
  avgBatteryLevel: number;
  lowBatteryEvents: number; // below 20%
  offlineEvents: number;
  
  // KPIs
  scansPerHour: number;
  avgTimePerAddress: number; // milliseconds
  conversionRate: number; // percentage
  activityScore: number; // calculated
  
  // Raw logs for PDF generation
  rawLogs: TrackingData[];
}

// PDF Report Data
export interface UserReport {
  userId: string;
  username: string;
  date: string;
  activityScore: number;
  
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
      activityScore: number;
      totalActions: number;
      statusChanges: Record<string, number>; // Changed from Map to Record for JSON serialization
      activeTime: number;
      distance: number;
      uniquePhotos: number; // Deduplizierte OCR-Anfragen
    };
  }[];
}

// Historical Dashboard Data Request
export interface HistoricalDataRequest {
  date: string; // YYYY-MM-DD
  userId?: string; // optional, for single user
}
