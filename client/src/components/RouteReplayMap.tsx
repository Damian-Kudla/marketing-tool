/**
 * Route Replay Map Component
 *
 * Zeigt die Route eines Mitarbeiters mit Animation:
 * - Statische Anzeige aller GPS-Punkte
 * - Animierte Route-Wiedergabe (8 Stunden in 5 Sekunden)
 * - Play/Pause/Reset Controls
 * - Zeitstempel während Animation
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Play, Pause, RotateCcw, Zap, MapPin, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source?: 'native' | 'followmee' | 'external' | 'external_app';
  userAgent?: string; // User-Agent string from device
}

interface SnapPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  source?: 'native' | 'followmee' | 'external' | 'external_app';
  placeId?: string;
}

interface SnapSegment {
  segmentId: string;
  startTimestamp: number;
  endTimestamp: number;
  distanceMeters: number;
  points: SnapPoint[];
}

interface GapSegment {
  id: string;
  start: GPSPoint;
  end: GPSPoint;
  distanceMeters: number;
}

interface RouteSegment {
  points: [number, number][];
  source: 'native' | 'followmee' | 'external' | 'external_app';
  userAgent?: string;
}

interface RouteReplayMapProps {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps?: number[];
  contracts?: number[]; // EGON contract timestamps (Unix ms)
  date: string;
  userId?: string;
  source?: 'all' | 'native' | 'followmee' | 'external' | 'external_app';
  breaks?: Array<{
    start: number;
    end: number;
    duration: number;
    location?: { lat: number; lng: number };
    locations?: Array<{
      poi_name: string;
      poi_type: string;
      address: string;
      place_id: string;
      durationAtLocation?: number;
    }>;
    isCustomerConversation?: boolean; // True if contract was written during this break
    contractsInBreak?: number[]; // Contract timestamps that fall within this break
  }>;
}

const MORNING_CUTOFF_HOUR = 6;
const GAP_DISTANCE_THRESHOLD_METERS = 50;
const SNAP_SEGMENT_COST_CENT_PER_CALL = 0.5;

/**
 * Remove Device-ID from User-Agent string for comparison
 * Example: "Mozilla/5.0... [Device:ce41e359ad0ed0b1]" → "Mozilla/5.0..."
 */
function cleanUserAgent(userAgent?: string): string {
  if (!userAgent) return 'Unknown';
  // Don't remove Device-ID anymore to allow distinguishing specific devices
  // return userAgent.replace(/\s*\[Device:[^\]]+\]\s*/g, '').trim();
  return userAgent.trim();
}

/**
 * Extract unique User-Agents from GPS points (cleaned, without Device-ID)
 */
function extractUniqueUserAgents(gpsPoints: GPSPoint[]): string[] {
  const userAgentSet = new Set<string>();
  
  gpsPoints.forEach(point => {
    if (point.userAgent) {
      userAgentSet.add(cleanUserAgent(point.userAgent));
    }
  });
  
  return Array.from(userAgentSet).sort();
}

/**
 * Generate a color for a User-Agent based on hash
 */
function getUserAgentColor(userAgent: string, index: number): string {
  const colors = [
    '#3b82f6', // Blue
    '#10b981', // Green
    '#f59e0b', // Orange
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#84cc16', // Lime
  ];
  return colors[index % colors.length];
}

function buildRouteSignature(points: GPSPoint[]): string {
  if (!points || points.length === 0) return 'empty';
  const first = points[0];
  const last = points[points.length - 1];
  return `${first.timestamp}-${last.timestamp}-${points.length}`;
}

const SOURCE_COLORS: Record<'native' | 'followmee' | 'external' | 'external_app', string> = {
  native: '#3b82f6',      // Blau für native GPS
  followmee: '#000000',   // Schwarz für FollowMee
  external: '#ef4444',    // Rot für externe Quellen
  external_app: '#ef4444', // Alias für externe Quellen (same as external)
};

const SNAP_SEGMENT_COLOR = '#10b981';

let googleMapsLoaderPromise: Promise<void> | null = null;

async function loadGoogleMapsApi(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.google?.maps) return;

  if (!googleMapsLoaderPromise) {
    googleMapsLoaderPromise = (async () => {
      const response = await fetch('/api/admin/google-maps-config', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error('Failed to load Google Maps config');
      }

      const { apiKey } = await response.json();
      if (!apiKey) {
        throw new Error('Google Maps API key missing');
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Google Maps script failed to load'));
        document.head.appendChild(script);
      });
    })();
  }

  await googleMapsLoaderPromise;
}

interface MapOverlays {
  fullRoutes: google.maps.Polyline[];
  animatedRoutes: google.maps.Polyline[];
  snapRoutes: google.maps.Polyline[];
  pauseRoutes: google.maps.Polyline[];
  startMarker: google.maps.Marker | null;
  endMarker: google.maps.Marker | null;
  currentMarker: google.maps.Marker | null;
  userMarkers: Map<string, google.maps.Marker>; // Markers for each active User-Agent
  photoMarker: google.maps.Marker | null;
  contractMarker: google.maps.Marker | null; // EGON contract marker
  poiMarker: any | null; // Custom HTML overlay marker for POI
  gpsMarkers: google.maps.Marker[];
}

const DEFAULT_MAP_CENTER = { lat: 51.1657, lng: 10.4515 };

const clearPolylineList = (polylines: google.maps.Polyline[]) => {
  polylines.forEach(polyline => polyline.setMap(null));
  polylines.length = 0;
};

const removeMarker = (marker: google.maps.Marker | null) => {
  if (marker) {
    marker.setMap(null);
  }
  return null;
};

// Generate Google Maps URL with proper pin marker
const getGoogleMapsUrl = (lat: number, lng: number): string => {
  // Format: https://www.google.com/maps/search/?api=1&query=lat,lng
  // This format ensures a proper pin/marker is shown at the exact coordinates
  // Use toFixed(6) to prevent scientific notation (e.g., 1.7123445e-7) and limit precision
  // 6 decimal places = ~10cm accuracy, more than sufficient for GPS
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
};

// Calculate distance between two GPS points in meters
function calculateDistance(point1: GPSPoint, point2: GPSPoint): number {
  const earthRadiusMeters = 6371e3;
  const lat1 = (point1.latitude * Math.PI) / 180;
  const lat2 = (point2.latitude * Math.PI) / 180;
  const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const deltaLng = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);

  const a =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

// Calculate speed between two GPS points (km/h)
function calculateSpeed(point1: GPSPoint, point2: GPSPoint): number {
  const timeDiffHours = (point2.timestamp - point1.timestamp) / (1000 * 60 * 60);
  if (timeDiffHours === 0) return 0;
  
  const distance = calculateDistance(point1, point2); // meters
  const speedKmh = (distance / 1000) / timeDiffHours;
  return speedKmh;
}

// Interface for stationary period
interface StationaryPeriod {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  centerLat: number;
  centerLng: number;
}

// Detect inactivity breaks (20+ minutes gaps between tracking points)
// This matches the break calculation in the admin dashboard
function detectStationaryPeriods(points: GPSPoint[]): StationaryPeriod[] {
  const MIN_BREAK_MS = 20 * 60 * 1000; // 20 minutes
  const breaks: StationaryPeriod[] = [];

  if (points.length < 2) return breaks;

  // Filter to only native app points for break detection
  const nativePoints = points.filter(p => p.source === 'native' || !p.source);

  if (nativePoints.length < 2) return breaks;

  // Find gaps between consecutive native app points
  for (let i = 1; i < nativePoints.length; i++) {
    const prevPoint = nativePoints[i - 1];
    const currentPoint = nativePoints[i];
    const gap = currentPoint.timestamp - prevPoint.timestamp;

    if (gap >= MIN_BREAK_MS) {
      // Find indices in original sorted array
      const startIndex = points.indexOf(prevPoint);
      const endIndex = points.indexOf(currentPoint);

      breaks.push({
        startIndex: startIndex,
        endIndex: endIndex,
        startTime: prevPoint.timestamp,
        endTime: currentPoint.timestamp,
        durationMs: gap,
        centerLat: (prevPoint.latitude + currentPoint.latitude) / 2,
        centerLng: (prevPoint.longitude + currentPoint.longitude) / 2,
      });
    }
  }

  return breaks;
}

// Calculate bounds for a set of GPS points
function calculateBounds(points: GPSPoint[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (points.length === 0) return null;

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;

  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }

  return { minLat, maxLat, minLng, maxLng };
}

// Calculate appropriate zoom level to fit bounds within viewport (Google Maps optimized)
function calculateZoomForBounds(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }, viewportWidth: number, viewportHeight: number): number {
  const latDiff = bounds.maxLat - bounds.minLat;
  const lngDiff = bounds.maxLng - bounds.minLng;
  const avgLat = (bounds.minLat + bounds.maxLat) / 2;

  // Approximate meters per degree at this latitude
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(avgLat * Math.PI / 180);

  // Calculate dimensions in meters
  const heightMeters = latDiff * metersPerDegreeLat;
  const widthMeters = lngDiff * metersPerDegreeLng;

  // Add 60% buffer around the bounds (40% margin on each side)
  // This ensures points stay well within the viewport
  const requiredHeightMeters = heightMeters * 2.4;
  const requiredWidthMeters = widthMeters * 2.4;

  // Calculate required meters per pixel
  const requiredMetersPerPixelHeight = requiredHeightMeters / viewportHeight;
  const requiredMetersPerPixelWidth = requiredWidthMeters / viewportWidth;
  const requiredMetersPerPixel = Math.max(requiredMetersPerPixelHeight, requiredMetersPerPixelWidth);

  // Google Maps zoom formula: metersPerPixel = 156543.03392 * cos(lat) / 2^zoom
  const zoom = Math.log2(156543.03392 * Math.cos(avgLat * Math.PI / 180) / requiredMetersPerPixel);

  // Clamp between min 12 (overview) and max 20 (very close)
  // Don't round - let Google Maps handle sub-zoom levels
  const clampedZoom = Math.max(12, Math.min(20, zoom));

  console.log('[RouteReplay] Zoom calculation - heightMeters:', heightMeters.toFixed(2),
    'widthMeters:', widthMeters.toFixed(2),
    'rawZoom:', zoom.toFixed(2),
    'clampedZoom:', clampedZoom.toFixed(2));

  return clampedZoom;
}

// calculateOptimalZoom function removed - auto-zoom disabled to prevent rendering conflicts

export default function RouteReplayMap({ username, gpsPoints: rawGpsPoints, photoTimestamps = [], contracts = [], date, userId, source = 'all', breaks = [] }: RouteReplayMapProps) {
  // CRITICAL: Filter out corrupted GPS coordinates BEFORE any processing
  // This is a safety net in case backend filter didn't catch them
  const gpsPoints = rawGpsPoints.filter(p => {
    const lat = p.latitude;
    const lng = p.longitude;
    const isValidLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90 && Math.abs(lat) > 0.001;
    const isValidLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180 && Math.abs(lng) > 0.001;
    return isValidLat && isValidLng;
  });
  
  const filteredCount = rawGpsPoints.length - gpsPoints.length;
  if (filteredCount > 0) {
    console.warn(`[RouteReplay] ⚠️ Filtered ${filteredCount} corrupted GPS points (lat≈0 or lng≈0)`);
  }

  // DEBUG: Only log initialization details when DEBUG_ROUTE_REPLAY is enabled
  if (import.meta.env.VITE_DEBUG_ROUTE_REPLAY === 'true') {
    console.log(`[RouteReplay] Initialized for ${username}:`, { gpsPoints: gpsPoints.length, breaks: breaks.length, contracts: contracts.length, source });

    if (breaks.length > 0) {
      console.log('[RouteReplay] Breaks data:', breaks);
    }
    if (contracts.length > 0) {
      console.log('[RouteReplay] Contracts:', contracts.map(ts => `${ts} (${new Date(ts).toLocaleTimeString()})`));
    }
    // Also log first and last GPS point timestamps for comparison
    if (gpsPoints.length > 0) {
      const sorted = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);
      console.log(`[RouteReplay] GPS time range: ${new Date(sorted[0].timestamp).toLocaleTimeString()} - ${new Date(sorted[sorted.length - 1].timestamp).toLocaleTimeString()}`);
      console.log(`[RouteReplay] GPS timestamp range: ${sorted[0].timestamp} - ${sorted[sorted.length - 1].timestamp}`);
    }
  }
  
  // ALWAYS log contracts for debugging (temporary)
  console.log(`[RouteReplay] 📝 Contracts received: ${contracts.length}`, contracts.length > 0 ? contracts.map(ts => new Date(ts).toLocaleTimeString('de-DE')) : 'none');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTimestamp, setCurrentTimestamp] = useState(0); // Current GPS timestamp for smooth interpolation
  const [activePhotoFlash, setActivePhotoFlash] = useState<number | null>(null);
  const [activeContractFlash, setActiveContractFlash] = useState<number | null>(null); // EGON contract flash
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [snapToRoadsEnabled, setSnapToRoadsEnabled] = useState(false); // Snap-to-roads toggle
  const [secondsPerHour, setSecondsPerHour] = useState(5); // Animation speed: 5 real seconds per GPS hour
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true); // Auto-Zoom toggle
  const [showRouteLines, setShowRouteLines] = useState(true); // Toggle für Linien-Anzeige
  const [showMovementMode, setShowMovementMode] = useState(true); // Toggle für Fußgänger/Auto-Emoji
  const [snapSegments, setSnapSegments] = useState<SnapSegment[] | null>(null);
  const [snapStats, setSnapStats] = useState<{ apiCallsUsed: number; costCents: number; segmentCount: number } | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [isSnapping, setIsSnapping] = useState(false); // Loading state for snapping
  const [mapsApiLoaded, setMapsApiLoaded] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  // Pause Mode State
  const [pauseMode, setPauseMode] = useState<{
    active: boolean;
    periodIndex: number | null;
  }>({ active: false, periodIndex: null });

  // User-Agent Filter State
  const [availableUserAgents, setAvailableUserAgents] = useState<string[]>([]);
  const [activeUserAgents, setActiveUserAgents] = useState<Set<string>>(new Set());
  
  // Adjust speed when entering/exiting pause mode
  useEffect(() => {
    if (pauseMode.active) {
      setSecondsPerHour(10); // Slower speed in pause mode
    } else {
      setSecondsPerHour(5); // Normal speed
    }
  }, [pauseMode.active]);
  
  // Draggable panel positions
  const [leftPanelPos, setLeftPanelPos] = useState({ x: 16, y: 96 }); // left-4 top-24 (16px, 96px)
  const [rightPanelPos, setRightPanelPos] = useState({ x: -16, y: 96 }); // right-4 top-24 (negative for right positioning)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Timeline bar height for dynamic map padding
  const [timelineHeight, setTimelineHeight] = useState(0);
  const timelineBarRef = useRef<HTMLDivElement | null>(null);
  
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedIndexRef = useRef<number>(0);
  const pausedTimestampRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapOverlaysRef = useRef<MapOverlays>({
    fullRoutes: [],
    animatedRoutes: [],
    snapRoutes: [],
    pauseRoutes: [],
    startMarker: null,
    endMarker: null,
    currentMarker: null,
    userMarkers: new Map(),
    photoMarker: null,
    contractMarker: null,
    poiMarker: null,
    gpsMarkers: [],
  });
  const zoomListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const lastViewportChange = useRef(0); // Für 3-Sekunden-Regel
  const currentTimestampRef = useRef(0); // Aktueller Timestamp für Auto-Zoom
  const contractPauseRef = useRef<{ paused: boolean; resumeAt: number | null }>({ paused: false, resumeAt: null }); // Contract pause state
  const animationGPSStartRef = useRef(0); // GPS timestamp when animation segment started
  const lastBoundsRef = useRef<{ latRange: number; lngRange: number } | null>(null); // Letzte Bounds für Vergleich
  const cameraAdjustingRef = useRef(false); // Animation wartet auf Kamera-Anpassung
  const cameraReadyCallbackRef = useRef<(() => void) | null>(null); // Callback wenn Kamera bereit ist
  const cameraStateRef = useRef<{
    datasetSignature: string;
    lastPosition: GPSPoint | null;
    lastZoomChange: number;
    currentZoom: number;
  }>({
    datasetSignature: '',
    lastPosition: null,
    lastZoomChange: 0,
    currentZoom: 16,
  });
  const basePointsRef = useRef<GPSPoint[]>([]);
  const displayPointsRef = useRef<GPSPoint[]>([]);
  const pauseModeRef = useRef<{ active: boolean; periodIndex: number | null }>({ active: false, periodIndex: null });
  const snapRequestIdRef = useRef(0);
  const prevUserAgentsRef = useRef<string[]>([]);

  // Memoize available User-Agents to prevent re-computation on every render
  const availableUserAgentsMemo = useMemo(() => {
    // Only extract User-Agents from native GPS points
    const nativePoints = gpsPoints.filter(p => p.source === 'native' || !p.source);
    return extractUniqueUserAgents(nativePoints);
  }, [gpsPoints]);

  // Update availableUserAgents state only when the array content actually changes
  useEffect(() => {
    const hasChanged =
      availableUserAgentsMemo.length !== prevUserAgentsRef.current.length ||
      availableUserAgentsMemo.some((ua, i) => ua !== prevUserAgentsRef.current[i]);

    if (hasChanged) {
      prevUserAgentsRef.current = availableUserAgentsMemo;
      setAvailableUserAgents(availableUserAgentsMemo);

      // Initialize active User-Agents when they change
      if (availableUserAgentsMemo.length > 0) {
        if (source === 'all') {
          // For 'all': Only activate first User-Agent
          setActiveUserAgents(new Set([availableUserAgentsMemo[0]]));
        } else {
          // For 'native': Activate all User-Agents
          setActiveUserAgents(new Set(availableUserAgentsMemo));
        }
      }
    }
  }, [availableUserAgentsMemo, source]);

  // Auto-disable Auto-Zoom when multiple User-Agents are active
  useEffect(() => {
    if (activeUserAgents.size > 1 && autoZoomEnabled) {
      setAutoZoomEnabled(false);
      if (import.meta.env.VITE_DEBUG_ROUTE_REPLAY === 'true') {
        console.log('[RouteReplay] Auto-Zoom disabled: multiple User-Agents active');
      }
    }
  }, [activeUserAgents.size, autoZoomEnabled]);

  // Drag handlers for movable panels
  const handleMouseDown = (e: React.MouseEvent, panel: 'left' | 'right') => {
    e.preventDefault();
    setDragging(panel);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragging) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    if (dragging === 'left') {
      setLeftPanelPos(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
    } else if (dragging === 'right') {
      setRightPanelPos(prev => ({
        x: prev.x - deltaX, // Subtract for right-positioned elements
        y: prev.y + deltaY
      }));
    }

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  // Add/remove mouse event listeners for dragging
  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, dragStart]);

  // Measure timeline bar height dynamically
  useEffect(() => {
    const updateTimelineHeight = () => {
      if (timelineBarRef.current) {
        const newHeight = timelineBarRef.current.offsetHeight;
        setTimelineHeight(newHeight);
        
        // Trigger Google Maps resize after container size changes
        if (mapRef.current && window.google?.maps) {
          setTimeout(() => {
            if (mapRef.current) {
              window.google.maps.event.trigger(mapRef.current, 'resize');
            }
          }, 100);
        }
      }
    };

    // Initial measurement
    updateTimelineHeight();

    // Update on window resize
    window.addEventListener('resize', updateTimelineHeight);
    
    // Use ResizeObserver for more accurate updates when content changes
    const resizeObserver = new ResizeObserver(updateTimelineHeight);
    if (timelineBarRef.current) {
      resizeObserver.observe(timelineBarRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateTimelineHeight);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsApi()
      .then(() => {
        if (!cancelled) {
          setMapsApiLoaded(true);
          setMapLoadError(null);
        }
      })
      .catch((error: Error) => {
        console.error('[RouteReplayMap] Failed to load Google Maps API:', error);
        if (!cancelled) {
          setMapLoadError(error.message || 'Google Maps konnte nicht geladen werden.');
          toast({
            title: 'Google Maps Fehler',
            description: error.message || 'Die Karte konnte nicht geladen werden.',
            variant: 'destructive'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Sort GPS points by timestamp
  const sortedPoints = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);
  const originalRouteSignature = useMemo(() => buildRouteSignature(sortedPoints), [sortedPoints]);

  // Filter out early-morning points (before 06:00 local time)
  const pointsAfterSix = sortedPoints.filter(point => {
    const hour = new Date(point.timestamp).getHours();
    return hour >= MORNING_CUTOFF_HOUR;
  });

  const basePoints = pointsAfterSix;

  // Debug: Log source breakdown of GPS points
  useEffect(() => {
    const sourceBreakdown = basePoints.reduce((acc, p) => {
      const src = p.source || 'native';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`[RouteReplay] 📊 GPS source breakdown:`, sourceBreakdown);
    console.log(`[RouteReplay] 📊 Total points: ${basePoints.length}, activeUserAgents: ${activeUserAgents.size}`);
  }, [basePoints, activeUserAgents]);

  // Filter basePoints by active User-Agents first
  const uaFilteredPoints = useMemo(() => {
    const result = basePoints.filter(p => {
      // If it's a native point, check if its User-Agent is active
      if (p.source === 'native' || !p.source) {
        // If we have active agents selected, only show those
        if (activeUserAgents.size > 0) {
          if (!p.userAgent) return false; // Skip native points without UA
          return activeUserAgents.has(cleanUserAgent(p.userAgent));
        }
      }
      // Always include external data (assumed to belong to the session/user context)
      return true;
    });
    console.log(`[RouteReplay] 📊 uaFilteredPoints: ${result.length} (from ${basePoints.length})`);
    return result;
  }, [basePoints, activeUserAgents]);

  // Detect stationary periods based on filtered points
  // This ensures pauses are calculated separately for the selected user(s)
  const stationaryPeriods = useMemo(() => detectStationaryPeriods(uaFilteredPoints), [uaFilteredPoints]);

  // Calculate driving segments for timeline visualization
  // Merge segments that are less than 10 minutes apart (traffic lights, short stops)
  // Only count as driving if user moved at least 50m from start point during the segment
  const drivingSegments = useMemo(() => {
    const rawSegments: { start: number; end: number; startPointIndex: number }[] = [];
    if (uaFilteredPoints.length < 2) return [];

    let currentSegment: { start: number; end: number; startPointIndex: number } | null = null;

    for (let i = 0; i < uaFilteredPoints.length - 1; i++) {
      const p1 = uaFilteredPoints[i];
      const p2 = uaFilteredPoints[i+1];
      const speed = calculateSpeed(p1, p2);

      // Threshold 8 km/h for driving
      if (speed >= 8) {
        if (currentSegment) {
          currentSegment.end = p2.timestamp;
        } else {
          currentSegment = { start: p1.timestamp, end: p2.timestamp, startPointIndex: i };
        }
      } else {
        if (currentSegment) {
          rawSegments.push(currentSegment);
          currentSegment = null;
        }
      }
    }
    if (currentSegment) {
      rawSegments.push(currentSegment);
    }

    // Debug: Log raw segments before merge
    if (rawSegments.length > 0) {
      console.log(`[DrivingSegments] Raw segments before merge: ${rawSegments.length}`);
      rawSegments.forEach((seg, idx) => {
        const duration = (seg.end - seg.start) / 60000;
        console.log(`  [${idx}] ${new Date(seg.start).toLocaleTimeString()} - ${new Date(seg.end).toLocaleTimeString()} (${duration.toFixed(1)} min)`);
      });
    }

    // Merge segments that are less than 10 minutes apart
    // This handles traffic lights, short stops, etc.
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const mergedSegments: { start: number; end: number; startPointIndex: number }[] = [];
    
    for (const segment of rawSegments) {
      if (mergedSegments.length === 0) {
        mergedSegments.push({ ...segment });
      } else {
        const lastSegment = mergedSegments[mergedSegments.length - 1];
        const gapBetween = segment.start - lastSegment.end;
        
        if (gapBetween < TEN_MINUTES_MS) {
          // Merge: extend the last segment to include this one (keep original startPointIndex)
          console.log(`[DrivingSegments] 🔗 Merging segments: gap=${(gapBetween/60000).toFixed(1)}min < 10min`);
          lastSegment.end = segment.end;
        } else {
          // Gap is too large, start a new segment
          console.log(`[DrivingSegments] ❌ Not merging: gap=${(gapBetween/60000).toFixed(1)}min >= 10min`);
          mergedSegments.push({ ...segment });
        }
      }
    }
    
    // Debug: Log merged segments
    if (mergedSegments.length > 0) {
      console.log(`[DrivingSegments] After merge: ${mergedSegments.length} segments (was ${rawSegments.length})`);
      mergedSegments.forEach((seg, idx) => {
        const duration = (seg.end - seg.start) / 60000;
        console.log(`  [${idx}] ${new Date(seg.start).toLocaleTimeString()} - ${new Date(seg.end).toLocaleTimeString()} (${duration.toFixed(1)} min)`);
      });
    }
    
    // Filter out segments where user never moved 50m from start point
    // This eliminates GPS jitter being detected as driving
    const MIN_DISTANCE_M = 50;
    const validSegments: { start: number; end: number }[] = [];
    
    for (const segment of mergedSegments) {
      const startPoint = uaFilteredPoints[segment.startPointIndex];
      if (!startPoint) continue;
      
      // Check all points during this segment to see if any is 50m+ from start
      let movedFarEnough = false;
      for (let i = segment.startPointIndex; i < uaFilteredPoints.length; i++) {
        const point = uaFilteredPoints[i];
        if (point.timestamp > segment.end) break;
        
        const distance = calculateDistance(startPoint, point);
        if (distance >= MIN_DISTANCE_M) {
          movedFarEnough = true;
          break;
        }
      }
      
      if (movedFarEnough) {
        validSegments.push({ start: segment.start, end: segment.end });
      }
    }
    
    return validSegments;
  }, [uaFilteredPoints]);

  // Display points: Filter by Pause Mode
  const displayPoints = useMemo(() => {
    if (!pauseMode.active || pauseMode.periodIndex === null) {
      return uaFilteredPoints;
    }

    // Use backend breaks if available, otherwise fall back to stationaryPeriods
    let period: { startTime: number; endTime: number } | undefined;
    
    if (breaks && breaks.length > 0 && pauseMode.periodIndex < breaks.length) {
      // Use backend breaks - they have 'start' and 'end' properties
      const breakItem = breaks[pauseMode.periodIndex];
      period = { startTime: breakItem.start, endTime: breakItem.end };
    } else if (stationaryPeriods[pauseMode.periodIndex]) {
      // Fallback to local stationaryPeriods
      period = stationaryPeriods[pauseMode.periodIndex];
    }
    
    if (!period) {
      return uaFilteredPoints;
    }

    // Filter to only external GPS points within the pause period
    return uaFilteredPoints.filter(
      p => p.timestamp >= period!.startTime &&
           p.timestamp <= period!.endTime &&
           (p.source === 'followmee' || p.source === 'external' || p.source === 'external_app')
    );
  }, [uaFilteredPoints, pauseMode, stationaryPeriods, breaks]);

  // Group display points by User-Agent for independent interpolation
  const pointsByUser = useMemo(() => {
    const grouped: Record<string, GPSPoint[]> = {};
    
    if (source === 'all') {
      // For 'all' source, combine all points into a single track
      // This ensures we have one continuous line and one marker
      grouped['combined'] = displayPoints;
      console.log(`[RouteReplay] 📊 pointsByUser (source=all): combined=${displayPoints.length} points`);
      return grouped;
    }

    displayPoints.forEach(point => {
      // Determine key: User-Agent for native, 'external' for others
      let key = 'external';
      if (point.source === 'native' || !point.source) {
        key = point.userAgent ? cleanUserAgent(point.userAgent) : 'unknown';
      }
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(point);
    });
    
    console.log(`[RouteReplay] 📊 pointsByUser:`, Object.entries(grouped).map(([k, v]) => `${k}=${v.length}`).join(', '));
    return grouped;
  }, [displayPoints, source]);

  // Check if there are any external GPS points in the dataset
  const hasExternalGPS = useMemo(() => {
    return basePoints.some(p => p.source === 'followmee' || p.source === 'external' || p.source === 'external_app');
  }, [basePoints]);

  // Determine movement mode based on driving segments (uses merged segments for consistency)
  // This ensures that short stops (traffic lights, etc.) don't switch to walking mode
  const getMovementMode = (currentIndex: number): 'walking' | 'driving' => {
    if (displayPoints.length === 0) return 'walking';
    
    const currentPoint = displayPoints[Math.min(currentIndex, displayPoints.length - 1)];
    if (!currentPoint) return 'walking';
    
    const currentTime = currentPoint.timestamp;
    
    // Check if current time falls within any merged driving segment
    for (const segment of drivingSegments) {
      if (currentTime >= segment.start && currentTime <= segment.end) {
        return 'driving';
      }
    }
    
    return 'walking';
  };

  const baseRouteSignature = useMemo(() => buildRouteSignature(basePoints), [basePoints]);

  useEffect(() => {
    basePointsRef.current = uaFilteredPoints;
  }, [uaFilteredPoints]);

  useEffect(() => {
    displayPointsRef.current = displayPoints;
  }, [displayPoints]);

  useEffect(() => {
    pauseModeRef.current = pauseMode;
  }, [pauseMode]);

  // Trigger map resize when timeline height changes
  useEffect(() => {
    if (mapRef.current && window.google?.maps && timelineHeight > 0) {
      
      // Give the DOM time to update before triggering resize
      const timer = setTimeout(() => {
        if (mapRef.current) {
          window.google.maps.event.trigger(mapRef.current, 'resize');
        }
        
        // Force camera update if animation is playing
        if (isPlaying && autoZoomEnabled) {
          updateCameraView(true);
        }
      }, 150);
      
      return () => clearTimeout(timer);
    }
  }, [timelineHeight]);

  useEffect(() => {
    if (!mapsApiLoaded) return;
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;
    if (!window.google?.maps) return;

    const initialCenter = basePoints.length > 0
      ? { lat: basePoints[0].latitude, lng: basePoints[0].longitude }
      : DEFAULT_MAP_CENTER;

    mapRef.current = new window.google.maps.Map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 15, // Fixed default zoom
      disableDefaultUI: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      backgroundColor: '#0f172a',
      gestureHandling: 'greedy', // Scroll-Zoom ohne Strg
    });
  }, [mapsApiLoaded, basePoints]);

  // Initialer Zoom beim Laden: Zeigt alle GPS-Punkte mit 10% Puffer
  // NUR EINMAL beim ersten Laden ausführen
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!window.google?.maps) return;
    if (basePoints.length === 0) return;

    // Prüfen ob dieser Dataset bereits initialisiert wurde
    if (cameraStateRef.current.datasetSignature === baseRouteSignature) {
      return; // Bereits initialisiert, nicht erneut zoomen
    }

    const bounds = new window.google.maps.LatLngBounds();
    basePoints.forEach(point => bounds.extend({ lat: point.latitude, lng: point.longitude }));

    if (!bounds.isEmpty()) {
      // 10% Puffer + Timeline-Höhe berücksichtigen
      map.fitBounds(bounds, { 
        top: 50, 
        right: 50, 
        bottom: 50, 
        left: 50 
      });

      // Initialen Kamera-Status setzen
      cameraStateRef.current = {
        datasetSignature: baseRouteSignature,
        lastPosition: null,
        lastZoomChange: 0,
        currentZoom: map.getZoom() || 15,
      };

      console.log('[RouteReplay] Initial zoom set for dataset:', {
        pointsCount: basePoints.length,
        zoom: map.getZoom()
      });
    }
  }, [baseRouteSignature, basePoints, mapsApiLoaded]);

  // Manual zoom control removed - user controls zoom via map controls
  // Zoom listener removed - no longer needed

  useEffect(() => {
    return () => {
      const overlays = mapOverlaysRef.current;
      clearPolylineList(overlays.fullRoutes);
      clearPolylineList(overlays.animatedRoutes);
      clearPolylineList(overlays.snapRoutes);
      clearPolylineList(overlays.pauseRoutes);
      overlays.startMarker = removeMarker(overlays.startMarker);
      overlays.endMarker = removeMarker(overlays.endMarker);
      overlays.currentMarker = removeMarker(overlays.currentMarker);
      overlays.userMarkers.forEach(marker => marker.setMap(null));
      overlays.userMarkers.clear();
      overlays.photoMarker = removeMarker(overlays.photoMarker);
      overlays.gpsMarkers.forEach(marker => marker.setMap(null));
      overlays.gpsMarkers = [];
      zoomListenerRef.current?.remove();
      zoomListenerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sortedPoints.length > 0 && basePoints.length === 0) {
      toast({
        title: 'Keine GPS-Daten nach 06:00 Uhr',
        description: 'Alle Punkte liegen zwischen 00:00 und 06:00 Uhr und werden ausgeblendet.'
      });
    }
  }, [originalRouteSignature, basePoints.length, sortedPoints.length]);

  const gapSegments = useMemo(() => {
    if (basePoints.length < 2) return [];
    const segments: GapSegment[] = [];
    for (let i = 1; i < basePoints.length; i++) {
      const prev = basePoints[i - 1];
      const curr = basePoints[i];
      const distanceMeters = calculateDistance(prev, curr);
      if (distanceMeters >= GAP_DISTANCE_THRESHOLD_METERS) {
        segments.push({
          id: `${prev.timestamp}-${curr.timestamp}`,
          start: prev,
          end: curr,
          distanceMeters
        });
      }
    }
    return segments;
  }, [basePoints]);

  const estimatedSnapPointCount = gapSegments.length * 2;
  // Google Roads API accepts up to 100 points per call, each segment = 2 points
  // So we can process up to 50 segments per API call
  const estimatedSnapApiCalls = gapSegments.length > 0 ? Math.ceil(gapSegments.length / 50) : 0;
  const estimatedSnapCostCents = estimatedSnapApiCalls * SNAP_SEGMENT_COST_CENT_PER_CALL;
  const appliedSnapSegmentCount = snapStats?.segmentCount ?? snapSegments?.length ?? 0;
  const appliedSnapApiCalls = snapStats?.apiCallsUsed ?? appliedSnapSegmentCount;
  const gapSegmentIdSet = useMemo(() => new Set(gapSegments.map(segment => segment.id)), [gapSegments]);


  // Effect to snap points when toggle is enabled
  useEffect(() => {
    if (!snapToRoadsEnabled) {
      setSnapSegments(null);
      setSnapStats(null);
      setSnapError(null);
      setIsSnapping(false);
      return;
    }

    if (!userId) {
      setSnapError('Kein Benutzer ausgewaehlt.');
      setSnapSegments(null);
      setSnapStats(null);
      return;
    }

    const currentBasePoints = basePointsRef.current;
    if (currentBasePoints.length < 2) {
      setSnapError('Nicht genug GPS-Daten fuer Snap-to-Roads.');
      setSnapSegments(null);
      setSnapStats(null);
      return;
    }

    // Calculate gap segments here to avoid dependency issues
    const currentGapSegments: GapSegment[] = [];
    for (let i = 1; i < currentBasePoints.length; i++) {
      const prev = currentBasePoints[i - 1];
      const curr = currentBasePoints[i];
      const distanceMeters = calculateDistance(prev, curr);
      if (distanceMeters >= GAP_DISTANCE_THRESHOLD_METERS) {
        currentGapSegments.push({
          id: `${prev.timestamp}-${curr.timestamp}`,
          start: prev,
          end: curr,
          distanceMeters
        });
      }
    }

    if (currentGapSegments.length === 0) {
      setSnapError('Keine Luecken ueber 50 m vorhanden.');
      setSnapSegments(null);
      setSnapStats(null);
      setIsSnapping(false);
      return;
    }

    setSnapSegments(null);
    setSnapStats(null);

    const controller = new AbortController();
    const requestId = ++snapRequestIdRef.current;
    setIsSnapping(true);
    setSnapError(null);
    const payloadSegments = currentGapSegments.map(segment => ({
      start: segment.start,
      end: segment.end
    }));

    (async () => {
      try {
        // Optimierung: Sende nur Segmente statt alle GPS-Punkte (reduziert Body-Größe erheblich)
        const response = await fetch('/api/admin/dashboard/snap-to-roads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId,
            date,
            source,
            points: [], // Backend extrahiert Punkte aus Segmenten
            segments: payloadSegments
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Snap-to-Roads fehlgeschlagen.');
        }

        const result = await response.json();
        if (controller.signal.aborted || snapRequestIdRef.current !== requestId) {
          return;
        }

        setSnapSegments(result.segments || []);
        setSnapStats({
          apiCallsUsed: result.apiCallsUsed || 0,
          costCents: Number(result.costCents || 0),
          segmentCount: result.segmentCount || (result.segments?.length ?? 0)
        });
        setSnapError(null);
      } catch (error: any) {
        if (controller.signal.aborted || snapRequestIdRef.current !== requestId) {
          return;
        }
        setSnapError(error?.message || 'Snap-to-Roads fehlgeschlagen.');
        setSnapSegments(null);
        setSnapStats(null);
      } finally {
        if (snapRequestIdRef.current === requestId) {
          setIsSnapping(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [snapToRoadsEnabled, baseRouteSignature, userId, date, source]);

  // Initialize current timestamp to first GPS point
  useEffect(() => {
    if (displayPoints.length === 0) return;

    // Stop any running animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    // Reset animation state
    startTimeRef.current = null;
    pausedIndexRef.current = 0;
    pausedTimestampRef.current = displayPoints[0].timestamp;
    currentTimestampRef.current = displayPoints[0].timestamp;
    lastBoundsRef.current = null; // Reset bounds tracking
    setCurrentIndex(0);
    setCurrentTimestamp(displayPoints[0].timestamp);
    setIsPlaying(false);
  }, [baseRouteSignature]); // Only reset when route signature changes, not on every displayPoints change

  // Ensure currentTimestamp is within valid range when displayPoints changes (e.g. filtering or pause mode)
  useEffect(() => {
    if (displayPoints.length === 0) return;

    const start = displayPoints[0].timestamp;
    const end = displayPoints[displayPoints.length - 1].timestamp;

    // If currentTimestamp is significantly out of bounds (e.g. > 1 sec), clamp it
    // This handles cases where filtering changes the time range (e.g. switching users or entering pause mode)
    // Also fixes the issue where timer starts at 06:00 even if points start at 11:00
    if (currentTimestamp < start - 1000 || currentTimestamp > end + 1000) {
      console.log('[RouteReplay] Clamping timestamp to new range:', {
        current: currentTimestamp,
        newStart: start,
        newEnd: end
      });
      
      // If we are before start, jump to start
      if (currentTimestamp < start) {
        setCurrentTimestamp(start);
        pausedTimestampRef.current = start;
        // Find new index
        const newIndex = 0;
        setCurrentIndex(newIndex);
        pausedIndexRef.current = newIndex;
      } 
      // If we are after end, jump to end
      else {
        setCurrentTimestamp(end);
        pausedTimestampRef.current = end;
        // Find new index
        const newIndex = displayPoints.length - 1;
        setCurrentIndex(newIndex);
        pausedIndexRef.current = newIndex;
      }
    }
  }, [displayPoints, currentTimestamp]);

  // Get time range for timeline
  const startTime = displayPoints.length > 0 ? displayPoints[0].timestamp : 0;
  const endTime = displayPoints.length > 0 ? displayPoints[displayPoints.length - 1].timestamp : 0;

  // Track container width for adaptive hour markers
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const hourMarkers = useMemo(() => {
    if (displayPoints.length === 0) return [];
    const duration = endTime - startTime;
    if (duration <= 0) return [];

    // Calculate adaptive interval based on container width
    // Each hour marker needs ~60px minimum to avoid overlap
    const minSpacingPx = 60;
    const availableWidth = Math.max(400, containerWidth - 600); // Subtract space for buttons
    const maxMarkers = Math.floor(availableWidth / minSpacingPx);
    const durationHours = duration / (1000 * 60 * 60);

    // Calculate hour interval: 1, 2, 3, 4, 6, 8, 12, or 24 hours
    let hourInterval = 1;
    const possibleIntervals = [1, 2, 3, 4, 6, 8, 12, 24];
    for (const interval of possibleIntervals) {
      if (durationHours / interval <= maxMarkers) {
        hourInterval = interval;
        break;
      }
    }

    const markers: { position: number; time: Date }[] = [];
    const startHour = new Date(startTime);
    startHour.setMinutes(0, 0, 0);
    if (startHour.getTime() <= startTime) {
      startHour.setHours(startHour.getHours() + hourInterval);
    } else {
      // Align to interval (e.g., if interval is 2, round to even hours)
      const currentHourValue = startHour.getHours();
      const alignedHour = Math.ceil(currentHourValue / hourInterval) * hourInterval;
      startHour.setHours(alignedHour);
    }

    const currentHour = new Date(startHour);
    while (currentHour.getTime() < endTime) {
      const position = ((currentHour.getTime() - startTime) / duration) * 100;
      if (position > 0 && position < 100) {
        markers.push({ position, time: new Date(currentHour) });
      }
      currentHour.setHours(currentHour.getHours() + hourInterval);
    }

    return markers;
  }, [startTime, endTime, displayPoints.length, containerWidth]);

  const timelineProgress = endTime > startTime
    ? (currentTimestamp - startTime) / (endTime - startTime)
    : 0;
  const clampedTimelineProgress = Math.max(0, Math.min(1, timelineProgress));

  // Interpolate position between two GPS points based on timestamp
  // If snap-to-roads is enabled, interpolate along snap segments
  const interpolatePosition = (timestamp: number, points: GPSPoint[] = displayPoints): GPSPoint | null => {
    if (points.length === 0) return null;

    // Clamp timestamp to valid range
    const clampedTime = Math.max(startTime, Math.min(endTime, timestamp));

    // If snap-to-roads enabled, check if we're in a snap segment
    if (snapToRoadsEnabled && snapSegments && snapSegments.length > 0) {
      for (const segment of snapSegments) {
        if (clampedTime >= segment.startTimestamp && clampedTime <= segment.endTimestamp) {
          // We're in this snap segment - interpolate along snap points
          const segmentDuration = segment.endTimestamp - segment.startTimestamp;
          const elapsed = clampedTime - segment.startTimestamp;
          const progress = segmentDuration > 0 ? elapsed / segmentDuration : 0;

          const totalPoints = segment.points.length;
          const exactPosition = progress * (totalPoints - 1);
          const beforeIdx = Math.floor(exactPosition);
          const afterIdx = Math.min(beforeIdx + 1, totalPoints - 1);

          if (beforeIdx === afterIdx) {
            // At the end of segment
            const point = segment.points[beforeIdx];
            return {
              latitude: point.latitude,
              longitude: point.longitude,
              accuracy: 10,
              timestamp: clampedTime,
              source: point.source
            };
          }

          const beforePoint = segment.points[beforeIdx];
          const afterPoint = segment.points[afterIdx];
          const localProgress = exactPosition - beforeIdx;

          return {
            latitude: beforePoint.latitude + (afterPoint.latitude - beforePoint.latitude) * localProgress,
            longitude: beforePoint.longitude + (afterPoint.longitude - beforePoint.longitude) * localProgress,
            accuracy: 10,
            timestamp: clampedTime,
            source: beforePoint.source
          };
        }
      }
    }

    // Not in a snap segment, or snap-to-roads disabled - use regular GPS interpolation
    // Find the two points surrounding this timestamp
    let beforeIdx = 0;
    let afterIdx = 0;

    for (let i = 0; i < points.length; i++) {
      if (points[i].timestamp <= clampedTime) {
        beforeIdx = i;
      } else {
        afterIdx = i;
        break;
      }
    }

    // If we're at or after the last point
    if (afterIdx === 0 || afterIdx === beforeIdx) {
      return points[beforeIdx];
    }

    const beforePoint = points[beforeIdx];
    const afterPoint = points[afterIdx];

    // Calculate interpolation ratio
    const timeDiff = afterPoint.timestamp - beforePoint.timestamp;
    const ratio = timeDiff > 0 ? (clampedTime - beforePoint.timestamp) / timeDiff : 0;

    // Interpolate position
    return {
      latitude: beforePoint.latitude + (afterPoint.latitude - beforePoint.latitude) * ratio,
      longitude: beforePoint.longitude + (afterPoint.longitude - beforePoint.longitude) * ratio,
      accuracy: beforePoint.accuracy + (afterPoint.accuracy - beforePoint.accuracy) * ratio,
      timestamp: clampedTime,
      source: beforePoint.source
    };
  };

  // Get current interpolated positions for all active agents
  const currentPositions = useMemo(() => {
    const positions: Record<string, GPSPoint> = {};
    
    if (source === 'all') {
      if (pointsByUser['combined']) {
        const pos = interpolatePosition(currentTimestamp, pointsByUser['combined']);
        if (pos) {
          positions['combined'] = pos;
        }
      }
      return positions;
    }
    
    // Calculate for each active User-Agent
    activeUserAgents.forEach(ua => {
      const userPoints = pointsByUser[ua];
      if (userPoints && userPoints.length > 0) {
        const pos = interpolatePosition(currentTimestamp, userPoints);
        if (pos) {
          positions[ua] = pos;
        }
      }
    });
    
    // Also calculate for external data if present
    if (pointsByUser['external']) {
      const pos = interpolatePosition(currentTimestamp, pointsByUser['external']);
      if (pos) {
        positions['external'] = pos;
      }
    }
    
    // Debug: Log positions
    const posKeys = Object.keys(positions);
    if (posKeys.length === 0) {
      console.log(`[RouteReplay] ⚠️ currentPositions is EMPTY! source=${source}, pointsByUser keys:`, Object.keys(pointsByUser));
    }
    
    return positions;
  }, [currentTimestamp, pointsByUser, activeUserAgents, snapToRoadsEnabled, snapSegments, source]);

  // Backward compatibility: Primary current position (for camera following etc.)
  const currentPosition = useMemo(() => {
    // If source is 'all', use combined position
    if (source === 'all' && currentPositions['combined']) {
      return currentPositions['combined'];
    }
    // Return the first available position from active user agents
    const uas = Array.from(activeUserAgents);
    if (uas.length > 0 && currentPositions[uas[0]]) {
      return currentPositions[uas[0]];
    }
    return currentPositions['external'] || currentPositions['combined'] || null;
  }, [currentPositions, activeUserAgents, source]);

  // Note: Animation is now time-based, not duration-based
  // The animation speed is controlled by secondsPerHour in real-time

  // Calculate photo positions between GPS points
  const calculatePhotoPosition = (photoTimestamp: number): [number, number] | null => {
    if (displayPoints.length < 2) return null;

    // Find the two GPS points surrounding the photo timestamp
    let beforePoint: GPSPoint | null = null;
    let afterPoint: GPSPoint | null = null;

    for (let i = 0; i < displayPoints.length - 1; i++) {
      if (displayPoints[i].timestamp <= photoTimestamp && displayPoints[i + 1].timestamp >= photoTimestamp) {
        beforePoint = displayPoints[i];
        afterPoint = displayPoints[i + 1];
        break;
      }
    }

    // If photo is before first GPS or after last GPS, use closest point
    if (!beforePoint && !afterPoint) {
      if (photoTimestamp < displayPoints[0].timestamp) {
        return [displayPoints[0].latitude, displayPoints[0].longitude];
      } else {
        const last = displayPoints[displayPoints.length - 1];
        return [last.latitude, last.longitude];
      }
    }

    if (!beforePoint || !afterPoint) return null;

    // Calculate interpolation ratio
    const totalTimeDiff = afterPoint.timestamp - beforePoint.timestamp;
    const photoTimeDiff = photoTimestamp - beforePoint.timestamp;
    const ratio = totalTimeDiff > 0 ? photoTimeDiff / totalTimeDiff : 0;

    // Interpolate latitude and longitude
    const lat = beforePoint.latitude + (afterPoint.latitude - beforePoint.latitude) * ratio;
    const lng = beforePoint.longitude + (afterPoint.longitude - beforePoint.longitude) * ratio;

    return [lat, lng];
  };

  // Photo markers with calculated positions
  const photoPositions = photoTimestamps
    .map(timestamp => ({
      timestamp,
      position: calculatePhotoPosition(timestamp)
    }))
    .filter(p => p.position !== null) as Array<{ timestamp: number; position: [number, number] }>;

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    overlays.photoMarker = removeMarker(overlays.photoMarker);

    if (activePhotoFlash === null) return;

    const flash = photoPositions.find(photo => photo.timestamp === activePhotoFlash);
    if (!flash) return;

    overlays.photoMarker = new googleMaps.Marker({
      map,
      position: { lat: flash.position[0], lng: flash.position[1] },
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        fillColor: '#fbbf24',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 8,
      },
      label: {
        text: '⚡',
        fontSize: '20px',
      },
      zIndex: 600,
    });
  }, [activePhotoFlash, photoPositions, mapsApiLoaded]);

  // Check if current animation time should trigger a photo flash
  useEffect(() => {
    if (!isPlaying || displayPoints.length === 0) return;

    const currentPoint = displayPoints[currentIndex];
    if (!currentPoint) return;

    // Check if any photo timestamp is close to current position (within 5 seconds)
    const activePhoto = photoTimestamps.find(timestamp => {
      const diff = Math.abs(timestamp - currentPoint.timestamp);
      return diff < 5000; // 5 seconds tolerance
    });

    if (activePhoto && activePhotoFlash !== activePhoto) {
      setActivePhotoFlash(activePhoto);
      // Remove flash after 1 second
      setTimeout(() => {
        setActivePhotoFlash(null);
      }, 1000);
    }
  }, [currentIndex, isPlaying, photoTimestamps, displayPoints, activePhotoFlash]);

  // Contract markers with calculated positions (same logic as photos)
  const contractPositions = contracts
    .map(timestamp => ({
      timestamp,
      position: calculatePhotoPosition(timestamp) // Reuse same interpolation logic
    }))
    .filter(p => p.position !== null) as Array<{ timestamp: number; position: [number, number] }>;

  // Contract marker effect (green marker with 📝 emoji)
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    overlays.contractMarker = removeMarker(overlays.contractMarker);

    if (activeContractFlash === null) return;

    const flash = contractPositions.find(contract => contract.timestamp === activeContractFlash);
    if (!flash) return;

    overlays.contractMarker = new googleMaps.Marker({
      map,
      position: { lat: flash.position[0], lng: flash.position[1] },
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        fillColor: '#22c55e', // Green for contracts
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 10,
      },
      label: {
        text: '📝',
        fontSize: '22px',
      },
      zIndex: 650, // Above photo markers
    });
  }, [activeContractFlash, contractPositions, mapsApiLoaded]);

  // Track which contracts have already been triggered (to avoid re-triggering)
  const triggeredContractsRef = useRef<Set<number>>(new Set());
  
  // Reset triggered contracts when contracts change or animation restarts
  useEffect(() => {
    triggeredContractsRef.current.clear();
  }, [contracts, date]);

  // Check if current animation time should trigger a contract flash (with 1 sec pause)
  // This effect sets the contractPauseRef which the animation loop checks
  useEffect(() => {
    if (!isPlaying || displayPoints.length === 0 || currentTimestamp === 0) return;
    // Don't trigger new contracts while already paused for a contract
    if (contractPauseRef.current.paused) return;

    // Check if any contract timestamp has been passed but not yet triggered
    const activeContract = contracts.find(contractTs => {
      // Contract must be before or at current animation time
      if (contractTs > currentTimestamp) return false;
      // Contract must not have been triggered already
      if (triggeredContractsRef.current.has(contractTs)) return false;
      // Contract must be within reasonable range (not too far in the past)
      const timeSinceContract = currentTimestamp - contractTs;
      return timeSinceContract < 30000; // Within 30 seconds after contract time
    });

    if (activeContract) {
      console.log(`[Contract Check] 🎯 CONTRACT TRIGGERED! Animation time: ${new Date(currentTimestamp).toLocaleTimeString()}, Contract: ${new Date(activeContract).toLocaleTimeString()}`);
      triggeredContractsRef.current.add(activeContract);
      setActiveContractFlash(activeContract);
      
      // Set contract pause - animation loop will check this and stop (1 second pause)
      contractPauseRef.current = { paused: true, resumeAt: Date.now() + 1000 };
    }
  }, [currentTimestamp, isPlaying, contracts, displayPoints]);

  // Calculate time span
  const timeSpan = displayPoints.length > 0
    ? displayPoints[displayPoints.length - 1].timestamp - displayPoints[0].timestamp
    : 0;

  // Route up to current timestamp (all points before or at current time)
  const animatedRoute = displayPoints.filter(p => p.timestamp <= currentTimestamp);

  // Add interpolated current position to animated route for smooth drawing
  const animatedRouteWithInterpolation = currentPosition && currentPosition.timestamp > (animatedRoute[animatedRoute.length - 1]?.timestamp || 0)
    ? [...animatedRoute, currentPosition]
    : animatedRoute;

  // Create polyline segments grouped by source for multi-colored route
  const createRouteSegments = (points: GPSPoint[], gapIds?: Set<string>): RouteSegment[] => {
    const segments: RouteSegment[] = [];

    if (points.length < 2) return segments;

    let currentSegment: [number, number][] = [[points[0].latitude, points[0].longitude]];
    let currentSource: 'native' | 'followmee' | 'external' | 'external_app' = points[0].source || 'native';

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const pointSource: 'native' | 'followmee' | 'external' | 'external_app' = point.source || 'native';
      const pairId = `${points[i - 1].timestamp}-${point.timestamp}`;
      const isGap = gapIds?.has(pairId);

      if (isGap) {
        if (currentSegment.length > 1) {
          segments.push({ points: currentSegment, source: currentSource });
        }
        currentSegment = [[point.latitude, point.longitude]];
        currentSource = pointSource;
        continue;
      }

      if (pointSource === currentSource) {
        // Continue current segment
        currentSegment.push([point.latitude, point.longitude]);
      } else {
        // Source changed, save current segment and start new one
        if (currentSegment.length > 1) {
          segments.push({ points: currentSegment, source: currentSource });
        }
        currentSegment = [[points[i-1].latitude, points[i-1].longitude], [point.latitude, point.longitude]];
        currentSource = pointSource;
      }
    }

    // Add final segment
    if (currentSegment.length > 1) {
      segments.push({ points: currentSegment, source: currentSource });
    }

    return segments;
  };

  // Generate segments for ALL active users
  const fullRouteSegments = useMemo(() => {
    let allSegments: RouteSegment[] = [];
    
    // Process each user's points
    Object.entries(pointsByUser).forEach(([key, points]) => {
      const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
      const segments = createRouteSegments(sorted, snapToRoadsEnabled ? gapSegmentIdSet : undefined);
      
      // Add user info to segments
      segments.forEach(seg => {
        seg.userAgent = key;
      });
      
      allSegments = [...allSegments, ...segments];
    });
    
    return allSegments;
  }, [pointsByUser, snapToRoadsEnabled, gapSegmentIdSet]);

  // Generate animated segments for ALL active users
  const animatedRouteSegments = useMemo(() => {
    let allSegments: RouteSegment[] = [];
    
    Object.entries(pointsByUser).forEach(([key, points]) => {
      // Filter points up to current timestamp
      const animatedPoints = points.filter(p => p.timestamp <= currentTimestamp);
      
      // Add interpolated current position for this user
      const currentPos = currentPositions[key];
      
      let pointsToDraw = animatedPoints;
      if (currentPos && currentPos.timestamp > (animatedPoints[animatedPoints.length - 1]?.timestamp || 0)) {
        pointsToDraw = [...animatedPoints, currentPos];
      }
      
      const segments = createRouteSegments(pointsToDraw, snapToRoadsEnabled ? gapSegmentIdSet : undefined);
      
      segments.forEach(seg => {
        seg.userAgent = key;
      });
      
      allSegments = [...allSegments, ...segments];
    });
    
    return allSegments;
  }, [pointsByUser, currentTimestamp, currentPositions, snapToRoadsEnabled, gapSegmentIdSet]);

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.fullRoutes);

    if (!showRouteLines) return;

    overlays.fullRoutes = fullRouteSegments.map(segment => {
      // Use User-Agent color for native segments, source color for others
      let color = SOURCE_COLORS[segment.source || 'native'];
      if (segment.source === 'native' && segment.userAgent) {
        const ua = segment.userAgent;
        const index = availableUserAgents.indexOf(ua);
        color = getUserAgentColor(ua, index >= 0 ? index : 0);
      }

      return new googleMaps.Polyline({
        map,
        path: segment.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: color,
        strokeOpacity: pauseMode.active ? 0.1 : 0.3,
        strokeWeight: 2,
        zIndex: 50,
      });
    });
  }, [fullRouteSegments, showRouteLines, mapsApiLoaded, pauseMode.active, availableUserAgents]);

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.animatedRoutes);

    overlays.animatedRoutes = animatedRouteSegments.map(segment => {
      // Use User-Agent color for native segments, source color for others
      let color = SOURCE_COLORS[segment.source || 'native'];
      if (segment.source === 'native' && segment.userAgent) {
        const ua = segment.userAgent;
        const index = availableUserAgents.indexOf(ua);
        color = getUserAgentColor(ua, index >= 0 ? index : 0);
      }

      return new googleMaps.Polyline({
        map,
        path: segment.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: color,
        strokeOpacity: pauseMode.active ? 0.25 : 0.9,
        strokeWeight: 4,
        zIndex: 200,
      });
    });
  }, [animatedRouteSegments, mapsApiLoaded, pauseMode.active, availableUserAgents]);

  // Pause Mode Route: Show only external GPS points during pause period
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.pauseRoutes);

    // Only render pause route if pause mode is active
    if (!pauseMode.active || pauseMode.periodIndex === null) return;

    // Use backend breaks if available, otherwise fall back to stationaryPeriods
    let period: { startTime: number; endTime: number } | undefined;
    
    if (breaks && breaks.length > 0 && pauseMode.periodIndex < breaks.length) {
      const breakItem = breaks[pauseMode.periodIndex];
      period = { startTime: breakItem.start, endTime: breakItem.end };
    } else if (stationaryPeriods[pauseMode.periodIndex]) {
      period = stationaryPeriods[pauseMode.periodIndex];
    }
    
    if (!period) return;

    // Get all external GPS points during the pause period
    const pausePoints = basePoints.filter(
      p => p.timestamp >= period!.startTime &&
           p.timestamp <= period!.endTime &&
           (p.source === 'followmee' || p.source === 'external' || p.source === 'external_app')
    );

    if (pausePoints.length < 2) return;

    // Filter to animated route (up to current timestamp)
    const animatedPausePoints = pausePoints.filter(p => p.timestamp <= currentTimestamp);
    
    if (animatedPausePoints.length < 2) return;

    // Add interpolated current position for smooth drawing
    const pauseRouteWithInterpolation = currentPosition && 
                                        currentPosition.timestamp > (animatedPausePoints[animatedPausePoints.length - 1]?.timestamp || 0) &&
                                        currentPosition.timestamp <= period.endTime
      ? [...animatedPausePoints, currentPosition]
      : animatedPausePoints;

    // Create segments grouped by source
    const pauseSegments = createRouteSegments(pauseRouteWithInterpolation);

    overlays.pauseRoutes = pauseSegments.map(segment => {
      return new googleMaps.Polyline({
        map,
        path: segment.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: '#000000', // Schwarz für Pause-Route
        strokeOpacity: 1,
        strokeWeight: 6,
        zIndex: 300, // Higher than normal routes
      });
    });
  }, [pauseMode.active, pauseMode.periodIndex, stationaryPeriods, breaks, basePoints, currentTimestamp, currentPosition, mapsApiLoaded]);

  // POI Marker (Gartenschild) in Pause Mode
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    
    // Clear existing POI marker
    if (overlays.poiMarker) {
      overlays.poiMarker.setMap(null);
      overlays.poiMarker = null;
    }

    // Only show POI marker in pause mode with location data
    if (!pauseMode.active || pauseMode.periodIndex === null) {
      console.log('[RouteReplay POI] Pause mode not active or no period selected');
      return;
    }
    
    const breakData = breaks[pauseMode.periodIndex];
    console.log('[RouteReplay POI] Break data:', breakData);
    
    if (!breakData || !breakData.location || !breakData.locations || breakData.locations.length === 0) {
      console.log('[RouteReplay POI] Missing data:', { 
        hasBreak: !!breakData, 
        hasLocation: !!breakData?.location,
        locationsCount: breakData?.locations?.length || 0
      });
      return;
    }

    const poi = breakData.locations[0]; // Use first POI
    const { lat, lng } = breakData.location;
    
    console.log(`[RouteReplay POI] ✅ Creating marker for ${poi.poi_name} at [${lat}, ${lng}]`);

    // Create custom HTML marker (Gartenschild style)
    const markerDiv = document.createElement('div');
    markerDiv.innerHTML = `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
        <!-- Gartensteck-Schild -->
        <div style="
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 8px 12px;
          border-radius: 8px 8px 2px 2px;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
          font-weight: 600;
          font-size: 13px;
          text-align: center;
          min-width: 120px;
          max-width: 200px;
          border: 2px solid #047857;
          animation: slideDown 0.5s ease-out, pulse 2s ease-in-out infinite;
          transform-origin: bottom center;
        ">
          📍 ${poi.poi_name}
          ${poi.durationAtLocation ? `<div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">${poi.durationAtLocation} min</div>` : ''}
        </div>
        <!-- Stange (Pfahl) -->
        <div style="
          width: 4px;
          height: 30px;
          background: linear-gradient(180deg, #047857 0%, #065f46 100%);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        "></div>
      </div>
      <style>
        @keyframes slideDown {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }
      </style>
    `;

    // Use OverlayView for custom HTML marker
    class HTMLMarker extends googleMaps.OverlayView {
      private position: google.maps.LatLng;
      private div: HTMLElement | null = null;

      constructor(position: google.maps.LatLng, content: HTMLElement) {
        super();
        this.position = position;
        this.div = content;
      }

      onAdd() {
        const panes = this.getPanes();
        if (panes && this.div) {
          panes.floatPane.appendChild(this.div);
        }
      }

      draw() {
        const projection = this.getProjection();
        if (!projection || !this.div) return;

        const pos = projection.fromLatLngToDivPixel(this.position);
        if (pos) {
          this.div.style.position = 'absolute';
          this.div.style.left = pos.x - 60 + 'px'; // Center horizontally
          this.div.style.top = pos.y - 70 + 'px'; // Position above the point
          this.div.style.zIndex = '1000';
        }
      }

      onRemove() {
        if (this.div && this.div.parentNode) {
          this.div.parentNode.removeChild(this.div);
        }
      }
    }

    const marker = new HTMLMarker(new googleMaps.LatLng(lat, lng), markerDiv);
    marker.setMap(map);
    overlays.poiMarker = marker as any;

    return () => {
      if (overlays.poiMarker) {
        overlays.poiMarker.setMap(null);
        overlays.poiMarker = null;
      }
    };
  }, [pauseMode.active, pauseMode.periodIndex, breaks, mapsApiLoaded]);

  // Calculate animated snap segments up to current timestamp
  const animatedSnapSegments = useMemo(() => {
    if (!snapToRoadsEnabled || !snapSegments || snapSegments.length === 0) return [];

    const result: Array<{ points: Array<{ lat: number; lng: number }> }> = [];

    for (const segment of snapSegments) {
      if (!segment.points || segment.points.length < 2) continue;

      // Check if animation has reached this segment
      if (currentTimestamp < segment.startTimestamp) {
        // Haven't reached this segment yet - don't draw it
        continue;
      } else if (currentTimestamp >= segment.endTimestamp) {
        // Fully past this segment - draw entire segment
        result.push({
          points: segment.points.map(p => ({ lat: p.latitude, lng: p.longitude }))
        });
      } else {
        // Currently animating through this segment - interpolate progressively
        const segmentDuration = segment.endTimestamp - segment.startTimestamp;
        const elapsed = currentTimestamp - segment.startTimestamp;

        // Ensure progress is between 0 and 1
        let progress = segmentDuration > 0 ? elapsed / segmentDuration : 0;
        progress = Math.max(0, Math.min(1, progress));

        // Calculate exact position along the snap points
        const totalPoints = segment.points.length;

        if (totalPoints === 0) continue;
        if (totalPoints === 1) {
          // Single point - can't draw a line
          continue;
        }

        // Calculate which point we're at (0 to totalPoints-1)
        const exactPosition = progress * (totalPoints - 1);
        const beforeIdx = Math.floor(exactPosition);
        const afterIdx = Math.min(beforeIdx + 1, totalPoints - 1);

        // Take all points up to beforeIdx
        const fullPoints = segment.points.slice(0, beforeIdx + 1);

        // If we're between two points, interpolate
        if (beforeIdx < afterIdx && progress < 1) {
          const beforePoint = segment.points[beforeIdx];
          const afterPoint = segment.points[afterIdx];
          const localProgress = exactPosition - beforeIdx;

          const interpolatedLat = beforePoint.latitude + (afterPoint.latitude - beforePoint.latitude) * localProgress;
          const interpolatedLng = beforePoint.longitude + (afterPoint.longitude - beforePoint.longitude) * localProgress;

          fullPoints.push({
            latitude: interpolatedLat,
            longitude: interpolatedLng,
            timestamp: currentTimestamp,
            source: beforePoint.source
          });
        }

        if (fullPoints.length >= 2) {
          result.push({
            points: fullPoints.map(p => ({ lat: p.latitude, lng: p.longitude }))
          });
        }
      }
    }

    return result;
  }, [snapSegments, snapToRoadsEnabled, currentTimestamp]);

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.snapRoutes);

    if (!snapToRoadsEnabled || animatedSnapSegments.length === 0) return;

    overlays.snapRoutes = animatedSnapSegments.map(segment => new googleMaps.Polyline({
      map,
      path: segment.points,
      strokeColor: SNAP_SEGMENT_COLOR,
      strokeOpacity: 0.9,
      strokeWeight: 3, // Dünner: 3 statt 5
      zIndex: 300,
    }));
  }, [animatedSnapSegments, snapToRoadsEnabled, mapsApiLoaded]);

  // Intelligente Kamera-Steuerung mit prädiktivem Auto-Zoom
  // WICHTIG: Keine Dependencies außer Refs, um Endlosschleife zu vermeiden
  // 
  // Algorithmus:
  // 1. Berechne aktuelle Position des Users
  // 2. Berechne Lookahead-Punkte (nächste 3 Anzeige-Sekunden)
  // 3. Zoom so setzen, dass User nie näher als 20% an den Rand kommt
  // 4. Zentrum auf aktueller User-Position halten
  // 5. Kamera-Updates nur alle 3 Sekunden, es sei denn Emergency (User am Rand)
  const updateCameraView = useCallback((forceUpdate = false, onComplete?: () => void) => {
    const map = mapRef.current;
    if (!map) {
      onComplete?.();
      return;
    }
    if (!window.google?.maps) {
      onComplete?.();
      return;
    }

    // Im Pause-Modus verwende displayPoints (gefilterte externe GPS-Punkte)
    // Ansonsten verwende basePoints - verwende refs für aktuelle Werte
    const points = pauseModeRef.current.active ? displayPointsRef.current : basePointsRef.current;
    if (points.length === 0) {
      onComplete?.();
      return;
    }

    // Aktuelle Position basierend auf currentTimestampRef berechnen (nicht aus Closure!)
    const currentTime = currentTimestampRef.current;
    const currentIdx = points.findIndex(p => p.timestamp >= currentTime);
    if (currentIdx === -1) {
      onComplete?.();
      return;
    }

    // Interpoliere Position für genauen Timestamp
    let position: GPSPoint;
    if (currentIdx === 0) {
      position = points[0];
    } else {
      const before = points[currentIdx - 1];
      const after = points[currentIdx];
      const timeDiff = after.timestamp - before.timestamp;
      const ratio = timeDiff > 0 ? (currentTime - before.timestamp) / timeDiff : 0;
      position = {
        latitude: before.latitude + (after.latitude - before.latitude) * ratio,
        longitude: before.longitude + (after.longitude - before.longitude) * ratio,
        accuracy: before.accuracy,
        timestamp: currentTime,
        source: before.source
      };
    }

    const now = Date.now();

    // Berechne Lookahead-Punkte für die nächsten 3 Anzeige-Sekunden
    const msPerHour = 3600000;
    const sph = secondsPerHour;
    const animationSpeedMsPerSec = msPerHour / sph; // GPS-ms pro Anzeige-Sekunde
    const lookaheadWindowMs = animationSpeedMsPerSec * 3; // 3 Anzeige-Sekunden vorausschauen

    let lookaheadPoints = points.filter(p =>
      p.timestamp >= currentTime && p.timestamp <= currentTime + lookaheadWindowMs
    );

    // Fallback: Mindestens 15 Punkte verwenden wenn zu wenige im Zeitfenster
    if (lookaheadPoints.length < 15) {
      const currentIndex = points.findIndex(p => p.timestamp >= currentTime);
      if (currentIndex !== -1) {
        lookaheadPoints = points.slice(currentIndex, Math.min(currentIndex + 25, points.length));
      }
    }

    if (lookaheadPoints.length === 0) {
      onComplete?.();
      return;
    }

    // Berechne maximale Distanz aller Lookahead-Punkte von aktueller Position
    const maxLatDiff = Math.max(...lookaheadPoints.map(p => Math.abs(p.latitude - position.latitude)), 0);
    const maxLngDiff = Math.max(...lookaheadPoints.map(p => Math.abs(p.longitude - position.longitude)), 0);

    // Emergency-Check: User näher als 20% am Rand?
    // Bei 20% Randabstand bedeutet das: maxDiff / (range/2) > 0.6 (da 50% - 20% = 30% vom Zentrum)
    let isEmergencyZoom = false;
    if (lastBoundsRef.current) {
      const latEdgeRatio = maxLatDiff / (lastBoundsRef.current.latRange / 2);
      const lngEdgeRatio = maxLngDiff / (lastBoundsRef.current.lngRange / 2);
      // Emergency wenn User in der "Gefahrenzone" (näher als 20% am Rand = mehr als 60% vom Zentrum)
      isEmergencyZoom = latEdgeRatio > 0.6 || lngEdgeRatio > 0.6;
    }

    // 3-Sekunden-Regel: Keine Änderung öfter als alle 3 Sekunden
    // ABER: Überspringen bei forceUpdate, erstem Zoom (lastBoundsRef === null), oder Emergency
    const timeSinceLastChange = now - lastViewportChange.current;
    if (!forceUpdate && !isEmergencyZoom && lastBoundsRef.current !== null && timeSinceLastChange < 3000) {
      onComplete?.();
      return;
    }

    if (isEmergencyZoom) {
      console.log('[RouteReplay] 🚨 Emergency zoom triggered - User near edge');
    }

    // 20%-Regel: Alle Punkte sollen mindestens 20% vom Rand entfernt sein
    // Mathematik:
    // - User ist im Zentrum (50% der Höhe/Breite)
    // - 20% vom Rand = 80% von links/unten = 30% vom Zentrum Richtung Rand
    // - Wenn weitester Punkt X Grad entfernt ist und bei max 30% vom Zentrum liegen soll:
    //   X / (visibleRange / 2) = 0.30  =>  visibleRange = X * 2 / 0.30 = X * 6.67
    // - Faktor 3.33 (für einen etwas engeren Zoom und etwas Spielraum)
    const EDGE_BUFFER = 0.30; // 30% vom Zentrum = 20% vom Rand
    const ZOOM_FACTOR = 1 / EDGE_BUFFER; // ~3.33
    const MIN_VISIBLE_RANGE = 0.001; // ca. 100m - verhindert zu starkes Ranzoomen
    
    const visibleLatRange = Math.max(maxLatDiff * ZOOM_FACTOR * 2, MIN_VISIBLE_RANGE);
    const visibleLngRange = Math.max(maxLngDiff * ZOOM_FACTOR * 2, MIN_VISIBLE_RANGE);

    // Prüfe ob sich die Bounds signifikant geändert haben (> 25% Änderung)
    const lastBoundsData = lastBoundsRef.current;
    if (!forceUpdate && !isEmergencyZoom && lastBoundsData) {
      const latChange = Math.abs(visibleLatRange - lastBoundsData.latRange) / lastBoundsData.latRange;
      const lngChange = Math.abs(visibleLngRange - lastBoundsData.lngRange) / lastBoundsData.lngRange;
      const maxChange = Math.max(latChange, lngChange);

      // Nur zoomen wenn Änderung > 25%
      if (maxChange < 0.25) {
        onComplete?.();
        return;
      }
    }

    // Markiere dass Kamera angepasst wird
    cameraAdjustingRef.current = true;

    // Bounds setzen - zentriert auf aktuelle Position
    const bounds = new window.google.maps.LatLngBounds(
      { lat: position.latitude - visibleLatRange / 2, lng: position.longitude - visibleLngRange / 2 },
      { lat: position.latitude + visibleLatRange / 2, lng: position.longitude + visibleLngRange / 2 }
    );

    // fitBounds mit Padding für UI-Elemente (Einstellungen und Info-Panels links/rechts)
    map.fitBounds(bounds, {
      top: 30,
      bottom: 60,
      left: 80,  // Mehr Platz links für Einstellungen-Panel
      right: 80  // Mehr Platz rechts für Info-Panel
    });

    // Bounds und Timestamp speichern
    lastBoundsRef.current = { latRange: visibleLatRange, lngRange: visibleLngRange };
    lastViewportChange.current = now;

    console.log('[RouteReplay] Camera updated:', {
      forceUpdate,
      isEmergencyZoom,
      currentPos: { lat: position.latitude.toFixed(5), lng: position.longitude.toFixed(5) },
      lookaheadPoints: lookaheadPoints.length,
      maxLatDiff: maxLatDiff.toFixed(6),
      maxLngDiff: maxLngDiff.toFixed(6),
      visibleLatRange: visibleLatRange.toFixed(6),
      visibleLngRange: visibleLngRange.toFixed(6)
    });

    // Warte auf idle-Event der Karte bevor Animation fortgesetzt wird
    // (Karte hat fertig gerendert und Tiles geladen)
    const idleListener = map.addListener('idle', () => {
      idleListener.remove();
      cameraAdjustingRef.current = false;
      console.log('[RouteReplay] Camera idle - ready to continue');
      onComplete?.();
    });

    // Fallback-Timeout falls idle nicht feuert (z.B. bei schnellen Änderungen)
    setTimeout(() => {
      if (cameraAdjustingRef.current) {
        idleListener.remove();
        cameraAdjustingRef.current = false;
        console.log('[RouteReplay] Camera timeout - forcing continue');
        onComplete?.();
      }
    }, 800); // Max 800ms warten
  }, []); // Keine Dependencies - verwendet nur refs für aktuelle Werte

  // Periodische Kamera-Updates alle 3 Sekunden während Animation
  // Die Animation wird während Kamera-Anpassungen automatisch pausiert (via cameraAdjustingRef)
  useEffect(() => {
    if (!isPlaying || !mapRef.current || !autoZoomEnabled) return;

    // Periodische Updates alle 3 Sekunden
    const interval = setInterval(() => {
      // Kein Update wenn gerade angepasst wird
      if (!cameraAdjustingRef.current) {
        updateCameraView(false);
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isPlaying, autoZoomEnabled]); // isPlaying und autoZoomEnabled als Dependencies

  // Force camera update when entering/exiting pause mode
  useEffect(() => {
    if (autoZoomEnabled && mapRef.current) {
      // Small delay to ensure displayPointsRef is updated
      const timer = setTimeout(() => {
        updateCameraView(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pauseMode.active]); // Trigger when pause mode changes

  // Start/End Marker: Nur bei Route-Wechsel neu erstellen, nicht während Animation
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    overlays.startMarker = removeMarker(overlays.startMarker);
    overlays.endMarker = removeMarker(overlays.endMarker);

    if (basePoints.length === 0) return;

    const startPoint = basePoints[0];
    overlays.startMarker = new googleMaps.Marker({
      map,
      position: { lat: startPoint.latitude, lng: startPoint.longitude },
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        fillColor: '#22c55e',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 10,
      },
      label: {
        text: 'S',
        color: '#ffffff',
        fontWeight: 'bold',
      },
      zIndex: 400,
    });

    if (basePoints.length > 1) {
      const endPoint = basePoints[basePoints.length - 1];
      overlays.endMarker = new googleMaps.Marker({
        map,
        position: { lat: endPoint.latitude, lng: endPoint.longitude },
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 10,
        },
        label: {
          text: 'E',
          color: '#ffffff',
          fontWeight: 'bold',
        },
        zIndex: 400,
      });
    }
  }, [baseRouteSignature, mapsApiLoaded]); // baseRouteSignature statt displayPoints!

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    
    // Clear legacy marker
    overlays.currentMarker = removeMarker(overlays.currentMarker);

    // If no positions, clear all markers
    if (Object.keys(currentPositions).length === 0) {
      overlays.userMarkers.forEach(marker => marker.setMap(null));
      overlays.userMarkers.clear();
      return;
    }

    // Clear markers for inactive users
    const activeKeys = new Set(Object.keys(currentPositions));
    Array.from(overlays.userMarkers.entries()).forEach(([key, marker]) => {
      if (!activeKeys.has(key)) {
        marker.setMap(null);
        overlays.userMarkers.delete(key);
      }
    });

    // Update or create markers for active users
    Object.entries(currentPositions).forEach(([key, position]) => {
      let marker = overlays.userMarkers.get(key);
      
      // Determine color
      let color = '#000000';
      if (key === 'combined') {
         // Use color of the current position's source
         color = SOURCE_COLORS[position.source || 'native'];
      } else if (key === 'external') {
        color = '#ef4444'; // Red for external
      } else {
        const index = availableUserAgents.indexOf(key);
        color = getUserAgentColor(key, index >= 0 ? index : 0);
      }

      // Determine if we should show emoji
      // Native: Only if single user is active (to avoid clutter)
      // External: Always (as it's grouped into a single track)
      // Combined: Always (it's the single track for 'all')
      const isExternal = key === 'external';
      const isCombined = key === 'combined';
      const isTargetForEmoji = isExternal || isCombined || (activeUserAgents.size === 1);
      
      const shouldShowEmoji = isTargetForEmoji && showMovementMode;
      
      const markerOptions: google.maps.MarkerOptions = {
        position: { lat: position.latitude, lng: position.longitude },
        zIndex: 450,
        title: key === 'external' ? 'External App' : (key === 'combined' ? 'Combined Track' : key)
      };

      if (shouldShowEmoji) {
        const movementMode = getMovementMode(currentIndex);
        const emoji = movementMode === 'walking' ? '🚶' : '🚗';
        
        markerOptions.label = {
          text: emoji,
          fontSize: '48px',
          className: 'emoji-marker-label',
        };
        markerOptions.icon = {
          path: googleMaps.SymbolPath.CIRCLE,
          fillColor: '#FFFFFF',
          fillOpacity: 0.9,
          strokeColor: '#000000',
          strokeWeight: 3,
          scale: 20,
        };
      } else {
        markerOptions.label = null; // Clear label if switching from emoji
        markerOptions.icon = {
          path: googleMaps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 10, // Slightly smaller than single mode
        };
      }

      if (!marker) {
        marker = new googleMaps.Marker({
          map,
          ...markerOptions
        });
        overlays.userMarkers.set(key, marker);
      } else {
        marker.setOptions(markerOptions);
      }
    });
  }, [currentPositions, currentIndex, availableUserAgents, activeUserAgents, hasExternalGPS, showMovementMode, mapsApiLoaded]);

  // GPS-Marker: Nur basierend auf baseRouteSignature (ändert sich nur bei Route-Wechsel)
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    overlays.gpsMarkers.forEach(marker => marker.setMap(null));
    overlays.gpsMarkers = [];

    if (basePoints.length === 0) return;

    overlays.gpsMarkers = basePoints
      .filter((_, index) => index % 5 === 0)
      .map(point => {
        const marker = new googleMaps.Marker({
          map,
          position: { lat: point.latitude, lng: point.longitude },
          icon: {
            path: googleMaps.SymbolPath.CIRCLE,
            fillColor: SOURCE_COLORS[point.source || 'native'],
            fillOpacity: pauseMode.active ? 0.1 : 0.5,
            strokeColor: '#ffffff',
            strokeWeight: 1,
            scale: 3.5,
          },
          title: format(new Date(point.timestamp), 'HH:mm:ss', { locale: de }),
        });
        marker.addListener('click', () => window.open(getGoogleMapsUrl(point.latitude, point.longitude), '_blank'));
        return marker;
      });
  }, [baseRouteSignature, mapsApiLoaded, pauseMode.active]); // pauseMode als Dependency

  // Check if a stationary period has external GPS data
  const hasExternalGPSInPeriod = useCallback((period: StationaryPeriod): boolean => {
    const periodPoints = basePoints.filter(
      p => p.timestamp >= period.startTime && p.timestamp <= period.endTime
    );
    return periodPoints.some(p => p.source === 'followmee' || p.source === 'external' || p.source === 'external_app');
  }, [basePoints]);

  // Handle pause button click
  const handlePauseClick = (period: StationaryPeriod, periodIndex: number) => {
    // Check if period has external GPS data
    if (!hasExternalGPSInPeriod(period)) {
      // No external GPS data - just scrub to the position
      handleScrub(period.startTime);
      return;
    }

    // Toggle pause mode
    if (pauseMode.active && pauseMode.periodIndex === periodIndex) {
      // Deactivate pause mode
      setPauseMode({ active: false, periodIndex: null });
    } else {
      // Activate pause mode
      setPauseMode({ active: true, periodIndex });

      // Stop animation if playing
      if (isPlaying) {
        pauseAnimation();
      }

      // Scrub to pause start
      setCurrentTimestamp(period.startTime);
      pausedTimestampRef.current = period.startTime;
      const idx = findIndexByTimestamp(period.startTime);
      setCurrentIndex(idx);
      pausedIndexRef.current = idx;

      // Get external GPS points during pause period for initial bounds
      const pausePoints = basePoints.filter(
        p => p.timestamp >= period.startTime &&
             p.timestamp <= period.endTime &&
             (p.source === 'followmee' || p.source === 'external' || p.source === 'external_app')
      );

      // Fit bounds to show all pause points if auto-zoom is enabled
      if (autoZoomEnabled && mapRef.current && window.google?.maps && pausePoints.length > 0) {
        const bounds = new window.google.maps.LatLngBounds();
        pausePoints.forEach(point => bounds.extend({ lat: point.latitude, lng: point.longitude }));
        
        if (!bounds.isEmpty()) {
          mapRef.current.fitBounds(bounds, { 
            top: 50, 
            right: 50, 
            bottom: 50, 
            left: 50 
          });
          
          // Reset camera state to prevent jumping back to initial position
          // This ensures the camera stays in the pause area when animation starts
          const firstPausePoint = pausePoints[0];
          cameraStateRef.current = {
            datasetSignature: baseRouteSignature,
            lastPosition: firstPausePoint,
            lastZoomChange: Date.now(),
            currentZoom: mapRef.current.getZoom() || 15,
          };
          lastBoundsRef.current = null; // Reset bounds to allow camera updates
        }
      } else if (mapRef.current) {
        // Fallback: center on pause location if no auto-zoom
        mapRef.current.panTo({
          lat: period.centerLat,
          lng: period.centerLng
        });
        
        // Also reset camera state in fallback case
        const firstPausePoint = pausePoints[0];
        if (firstPausePoint) {
          cameraStateRef.current = {
            datasetSignature: baseRouteSignature,
            lastPosition: firstPausePoint,
            lastZoomChange: Date.now(),
            currentZoom: mapRef.current.getZoom() || 15,
          };
          lastBoundsRef.current = null;
        }
      }
    }
  };

  // Handle manual time input
  const handleTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeStr = e.target.value; // "HH:mm" or "HH:mm:ss"
    if (!timeStr) return;

    try {
      const [hours, minutes, seconds] = timeStr.split(':').map(Number);
      const newDate = new Date(currentTimestamp || startTime);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);
      if (seconds !== undefined) newDate.setSeconds(seconds);
      
      // Clamp to range
      const newTimestamp = Math.max(startTime, Math.min(endTime, newDate.getTime()));
      handleScrub(newTimestamp);
    } catch (error) {
      console.error('Invalid time input:', error);
    }
  };

  // Manual scrubbing: Update position based on timestamp slider
  const handleScrub = (timestamp: number) => {
    if (isPlaying) {
      pauseAnimation();
    }
    setCurrentTimestamp(timestamp);
    pausedTimestampRef.current = timestamp;

    // Update currentIndex for compatibility
    const idx = findIndexByTimestamp(timestamp);
    setCurrentIndex(idx);
    pausedIndexRef.current = idx;
  };

  // Navigate to next GPS point
  const handleNextPoint = () => {
    if (currentIndex < displayPoints.length - 1) {
      const nextIndex = currentIndex + 1;
      const nextPoint = displayPoints[nextIndex];
      setCurrentTimestamp(nextPoint.timestamp);
      pausedTimestampRef.current = nextPoint.timestamp;
      setCurrentIndex(nextIndex);
      pausedIndexRef.current = nextIndex;
    }
  };

  // Navigate to previous GPS point
  const handlePreviousPoint = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      const prevPoint = displayPoints[prevIndex];
      setCurrentTimestamp(prevPoint.timestamp);
      pausedTimestampRef.current = prevPoint.timestamp;
      setCurrentIndex(prevIndex);
      pausedIndexRef.current = prevIndex;
    }
  };

  // Find GPS point index by timestamp
  const findIndexByTimestamp = (targetTimestamp: number): number => {
    // Find the first GPS point that is at or after the target timestamp
    for (let i = 0; i < displayPoints.length; i++) {
      if (displayPoints[i].timestamp >= targetTimestamp) {
        return i;
      }
    }
    // If no point found, return last index
    return displayPoints.length - 1;
  };

  // Start animation - Time-based with smooth interpolation
  const startAnimation = () => {
    if (displayPoints.length === 0) {
      console.log('[RouteReplay] Cannot start animation: no display points');
      return;
    }

    console.log('[RouteReplay] Starting animation', {
      displayPointsCount: displayPoints.length,
      currentTimestamp,
      startTime,
      endTime,
      duration: endTime - startTime,
      autoZoomEnabled
    });

    // Funktion die die eigentliche Animation startet
    const beginAnimationLoop = () => {
      setIsPlaying(true);
      startTimeRef.current = Date.now();

      // Current GPS timestamp (where we're resuming from)
      // Store GPS start timestamp in ref so it can be updated after contract pause
      animationGPSStartRef.current = currentTimestamp;

      // Ref um zu tracken wann Kamera-Pause begann
      let cameraPauseStart: number | null = null;

      const animate = () => {
        if (!startTimeRef.current) {
          console.log('[RouteReplay] animate() aborted: no startTimeRef');
          return;
        }

        // Pausiere Animation wenn Kamera gerade angepasst wird (bei Auto-Zoom)
        if (cameraAdjustingRef.current) {
          // Merke Start der Kamera-Pause
          if (cameraPauseStart === null) {
            cameraPauseStart = Date.now();
          }
          // Weiter warten, aber Animation nicht fortsetzen
          animationRef.current = requestAnimationFrame(animate);
          return;
        } else if (cameraPauseStart !== null) {
          // Kamera-Anpassung beendet - Zeit kompensieren
          const pauseDuration = Date.now() - cameraPauseStart;
          startTimeRef.current += pauseDuration; // Startzeit nach hinten verschieben
          cameraPauseStart = null;
          console.log('[RouteReplay] Camera adjustment done - compensated', pauseDuration, 'ms');
        }

        // Check if we're paused for a contract
        if (contractPauseRef.current.paused) {
          const now = Date.now();
          if (contractPauseRef.current.resumeAt && now >= contractPauseRef.current.resumeAt) {
            // Resume animation after contract pause
            console.log('[RouteReplay] 📝 Contract pause ended, resuming from GPS time:', new Date(currentTimestampRef.current).toLocaleTimeString());
            contractPauseRef.current = { paused: false, resumeAt: null };
            setActiveContractFlash(null);
            // CRITICAL: Update GPS start to current position, reset real time start
            animationGPSStartRef.current = currentTimestampRef.current;
            startTimeRef.current = Date.now();
          } else {
            // Still paused, continue waiting
            animationRef.current = requestAnimationFrame(animate);
            return;
          }
        }

        // Elapsed real time since animation started
        const elapsedRealTime = Date.now() - startTimeRef.current;

        // Calculate how much GPS time has passed based on animation speed
        const realTimePerGPSHour = secondsPerHour * 1000; // milliseconds
        const gpsTimePerRealTime = (60 * 60 * 1000) / realTimePerGPSHour; // GPS ms per real ms
        const elapsedGPSTime = elapsedRealTime * gpsTimePerRealTime;

        // Current GPS timestamp in the animation (use ref instead of closure variable)
        const targetGPSTimestamp = animationGPSStartRef.current + elapsedGPSTime;

        if (import.meta.env.VITE_DEBUG_ROUTE_REPLAY === 'true' && elapsedRealTime % 1000 < 16) { // Log ungefähr jede Sekunde
          console.log('[RouteReplay] animate()', {
            elapsedRealTime,
            elapsedGPSTime,
            targetGPSTimestamp,
            startGPSTimestamp: animationGPSStartRef.current,
            endTime,
            progress: ((targetGPSTimestamp - animationGPSStartRef.current) / (endTime - animationGPSStartRef.current) * 100).toFixed(1) + '%'
          });
        }

        // Update timestamp for smooth interpolation
        setCurrentTimestamp(targetGPSTimestamp);
        pausedTimestampRef.current = targetGPSTimestamp;
        currentTimestampRef.current = targetGPSTimestamp; // Für Auto-Zoom

        // Update index for compatibility
        const newIndex = findIndexByTimestamp(targetGPSTimestamp);
        setCurrentIndex(newIndex);
        pausedIndexRef.current = newIndex;

        // Kamera-Steuerung erfolgt über updateCameraView (alle 3 Sekunden)
        // Keine redundante Pan-Logik hier im Animationsloop

        // Check if we've reached the END of pause in pause mode (not the start)
        if (pauseMode.active && pauseMode.periodIndex !== null && breaks.length > pauseMode.periodIndex) {
          const breakData = breaks[pauseMode.periodIndex];
          console.log('[RouteReplay] 🔍 Pause mode check:', { 
            targetGPSTimestamp, 
            breakEnd: breakData?.end,
            shouldStop: breakData && targetGPSTimestamp >= breakData.end 
          });
          
          if (breakData && targetGPSTimestamp >= breakData.end) {
            console.log('[RouteReplay] 🛑 Reached end of pause, stopping animation');
            setIsPlaying(false);
            startTimeRef.current = null;
            setCurrentTimestamp(breakData.end);
            return;
          }
        }

        // Check if we've reached the end
        if (targetGPSTimestamp >= endTime) {
          console.log('[RouteReplay] Animation reached end', { targetGPSTimestamp, endTime });
          setIsPlaying(false);
          startTimeRef.current = null;
          setCurrentTimestamp(endTime);
        } else {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      console.log('[RouteReplay] Starting animation frame');
      animationRef.current = requestAnimationFrame(animate);
    };

    // Wenn Auto-Zoom aktiviert ist: Erst Kamera zentrieren, dann Animation starten
    if (autoZoomEnabled && mapRef.current) {
      console.log('[RouteReplay] Auto-Zoom enabled - centering camera before animation');
      
      // Erzwinge sofortige Kamera-Zentrierung, warte auf Fertigstellung
      updateCameraView(true, () => {
        console.log('[RouteReplay] Camera ready - starting animation');
        beginAnimationLoop();
      });
    } else {
      // Ohne Auto-Zoom sofort starten
      beginAnimationLoop();
    }
  };

  // Pause animation
  const pauseAnimation = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setIsPlaying(false);
    startTimeRef.current = null;
    pausedIndexRef.current = currentIndex;
  };

  // Reset animation
  const resetAnimation = () => {
    pauseAnimation();
    if (displayPoints.length > 0) {
      setCurrentTimestamp(startTime);
      pausedTimestampRef.current = startTime;
      setCurrentIndex(0);
      pausedIndexRef.current = 0;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Keyboard navigation: Arrow Left/Right for previous/next GPS point, Space for Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousPoint();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextPoint();
      } else if (e.code === 'Space') {
        // Prevent if typing in input
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        
        e.preventDefault();
        if (isPlaying) {
          pauseAnimation();
        } else {
          startAnimation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentIndex, displayPoints, isPlaying]); // Added isPlaying dependency

  // Center map on current position
  const centerOnCurrentPosition = () => {
    const map = mapRef.current;
    if (!map) return;
    
    // Try multiple sources for current position
    let targetPos: { lat: number; lng: number } | null = null;
    
    // 1. Use currentPosition if available
    if (currentPosition) {
      targetPos = { lat: currentPosition.latitude, lng: currentPosition.longitude };
    }
    // 2. Fallback: Use 'combined' position (for source='all')
    else if (currentPositions['combined']) {
      targetPos = { lat: currentPositions['combined'].latitude, lng: currentPositions['combined'].longitude };
    }
    // 3. Fallback: Use current index point
    else if (displayPoints[currentIndex]) {
      targetPos = { lat: displayPoints[currentIndex].latitude, lng: displayPoints[currentIndex].longitude };
    }
    // 4. Last fallback: Center on all points
    else if (displayPoints.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      displayPoints.forEach(p => bounds.extend({ lat: p.latitude, lng: p.longitude }));
      map.fitBounds(bounds);
      return;
    }
    
    if (targetPos) {
      map.panTo(targetPos);
      map.setZoom(17); // Zoom in when centering
      console.log('[RouteReplay] Centered on position:', targetPos);
    }
  };

  // Format time span
  const formatTimeSpan = (ms: number): string => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (displayPoints.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            Keine GPS-Daten für {username} am {format(new Date(date), 'dd.MM.yyyy', { locale: de })}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Timeline Bar - Always at top */}
      <div ref={timelineBarRef} className="absolute left-0 right-0 z-[1000] px-2 sm:px-4 bg-background/95 backdrop-blur-sm shadow-lg border-b top-0 pt-6 pb-3">
        <div className="flex items-center gap-1 sm:gap-2 lg:gap-3">
          {/* Play/Pause/Reset Controls */}
          <div className="flex gap-2">
            {!isPlaying ? (
              <Button onClick={startAnimation} size="sm" className="h-9">
                <Play className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline">Abspielen</span>
              </Button>
            ) : (
              <Button onClick={pauseAnimation} size="sm" variant="secondary" className="h-9">
                <Pause className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline">Pause</span>
              </Button>
            )}
            <Button onClick={resetAnimation} size="sm" variant="outline" className="h-9">
              <RotateCcw className="h-4 w-4 md:mr-1" />
              <span className="hidden md:inline">Zurück</span>
            </Button>
            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                onClick={handlePreviousPoint}
                size="sm"
                variant="outline"
                className="h-9 px-2"
                title="Vorheriger GPS-Punkt (Pfeil Links)"
                disabled={currentIndex <= 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleNextPoint}
                size="sm"
                variant="outline"
                className="h-9 px-2"
                title="Nächster GPS-Punkt (Pfeil Rechts)"
                disabled={currentIndex >= displayPoints.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={centerOnCurrentPosition} size="sm" variant="outline" className="h-9 px-2" title="Zur aktuellen Position zentrieren">
              <MapPin className="h-4 w-4" />
            </Button>
          </div>

          {/* Timeline Slider with Time Labels */}
          <div className="flex-1 min-w-0">
            <div className="relative pb-4 pt-5">
              {/* Hour labels above slider */}
              {hourMarkers.length > 0 && (
                <div className="absolute left-0 right-0 top-0 h-5 pointer-events-none">
                  {hourMarkers.map((marker, idx) => (
                    <div
                      key={`hour-label-${idx}`}
                      className="absolute flex flex-col items-center text-[10px] text-muted-foreground font-mono"
                      style={{ left: `${marker.position}%`, transform: 'translateX(-50%)' }}
                    >
                      <span className="px-1 rounded bg-background/80 shadow-sm">
                        {format(marker.time, 'HH:mm', { locale: de })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Stationary period backgrounds - use backend breaks if available, otherwise local calculation */}
              <div className="absolute w-full h-3 pointer-events-none overflow-hidden">
                {displayPoints.length > 0 && breaks && breaks.length > 0 ? (
                  // Use backend breaks (with customer conversation info)
                  // Filter to only show breaks that overlap with current timeline range
                  breaks
                    .filter(breakItem => breakItem.end >= startTime && breakItem.start <= endTime)
                    .map((breakItem, idx) => {
                      const totalDuration = endTime - startTime;
                      if (totalDuration <= 0) return null;
                      // Clamp break times to visible timeline range
                      const clampedStart = Math.max(breakItem.start, startTime);
                      const clampedEnd = Math.min(breakItem.end, endTime);
                      const startPos = ((clampedStart - startTime) / totalDuration) * 100;
                      const endPos = ((clampedEnd - startTime) / totalDuration) * 100;
                      const width = endPos - startPos;
                      if (width <= 0) return null;
                      const isCustomerConversation = breakItem.isCustomerConversation === true;
                      
                      return (
                        <div
                          key={`break-${idx}`}
                          className={`absolute h-full opacity-50 rounded ${
                            isCustomerConversation ? 'bg-green-500' : 'bg-orange-400'
                          }`}
                          style={{ left: `${startPos}%`, width: `${width}%` }}
                          title={isCustomerConversation 
                            ? `Kundengespräch: ${Math.round(breakItem.duration / 60000)} Min`
                            : `Pause: ${Math.round(breakItem.duration / 60000)} Min`
                          }
                        />
                      );
                    })
                ) : (
                  // Fallback to local stationaryPeriods
                  // Filter to only show periods that overlap with current timeline range
                  stationaryPeriods
                    .filter(period => period.endTime >= startTime && period.startTime <= endTime)
                    .map((period, idx) => {
                      const totalDuration = endTime - startTime;
                      if (totalDuration <= 0) return null;
                      // Clamp period times to visible timeline range
                      const clampedStart = Math.max(period.startTime, startTime);
                      const clampedEnd = Math.min(period.endTime, endTime);
                      const startPos = ((clampedStart - startTime) / totalDuration) * 100;
                      const endPos = ((clampedEnd - startTime) / totalDuration) * 100;
                      const width = endPos - startPos;
                      if (width <= 0) return null;
                      return (
                        <div
                          key={`break-${idx}`}
                          className="absolute h-full bg-orange-400 opacity-40 rounded"
                          style={{ left: `${startPos}%`, width: `${width}%` }}
                          title={`Pause: ${Math.round(period.durationMs / (60000))} Min`}
                        />
                      );
                    })
                )}
                {/* Driving segments - filter to only show segments that overlap with current timeline range */}
                {displayPoints.length > 0 && drivingSegments
                  .filter(segment => segment.end >= startTime && segment.start <= endTime)
                  .map((segment, idx) => {
                    const totalDuration = endTime - startTime;
                    if (totalDuration <= 0) return null;
                    // Clamp segment times to visible timeline range
                    const clampedStart = Math.max(segment.start, startTime);
                    const clampedEnd = Math.min(segment.end, endTime);
                    const startPos = ((clampedStart - startTime) / totalDuration) * 100;
                    const endPos = ((clampedEnd - startTime) / totalDuration) * 100;
                    const width = endPos - startPos;
                    if (width <= 0) return null;
                    return (
                      <div
                        key={`drive-${idx}`}
                        className="absolute h-full bg-blue-500 opacity-40 rounded"
                        style={{ left: `${startPos}%`, width: `${width}%` }}
                        title="Fahrt (Auto)"
                      />
                    );
                  })}
              </div>

              {/* Hour marker ticks */}
              <div className="absolute w-full h-3 pointer-events-none">
                {hourMarkers.map((marker, idx) => (
                  <div
                    key={`hour-tick-${idx}`}
                    className="absolute h-full border-l border-gray-400"
                    style={{ left: `${marker.position}%` }}
                    title={format(marker.time, 'HH:mm', { locale: de })}
                  />
                ))}
              </div>

              {/* Contract markers (📝) on timeline */}
              {contracts.length > 0 && displayPoints.length > 0 && (
                <div className="absolute w-full h-5 -top-1 pointer-events-none z-20">
                  {contracts.map((contractTs, idx) => {
                    const totalDuration = endTime - startTime;
                    if (totalDuration <= 0) return null;
                    // Only show if contract is within timeline range
                    if (contractTs < startTime || contractTs > endTime) return null;
                    const position = ((contractTs - startTime) / totalDuration) * 100;
                    return (
                      <div
                        key={`contract-${idx}`}
                        className="absolute flex items-center justify-center"
                        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
                        title={`Vertrag: ${format(new Date(contractTs), 'HH:mm:ss', { locale: de })}`}
                      >
                        <span className="text-sm drop-shadow-md">📝</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <input
                type="range"
                min={startTime}
                max={endTime}
                value={currentTimestamp}
                onChange={(e) => handleScrub(Number(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer relative z-10"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${clampedTimelineProgress * 100}%, #e5e7eb ${clampedTimelineProgress * 100}%, #e5e7eb 100%)`
                }}
              />

              {/* Time labels below slider */}
              <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>{format(new Date(startTime), 'HH:mm', { locale: de })}</span>
                <span>{format(new Date(endTime), 'HH:mm', { locale: de })}</span>
              </div>
            </div>
          </div>

          {/* Current time + Speed */}
          <div className="flex items-center gap-2 lg:gap-3">
            <Input
              type="time"
              step="1"
              value={format(new Date(currentTimestamp || startTime), 'HH:mm:ss', { locale: de })}
              onChange={handleTimeInputChange}
              className="w-28 h-8 text-sm font-mono tabular-nums bg-background/50"
            />
            {/* Speed control removed - fixed at 5s/hour */}
          </div>
        </div>
      </div>

      {/* Left Control Panel - Settings & Toggles */}
      <div 
        className="absolute z-[1000] bg-background/95 backdrop-blur-sm rounded-lg shadow-xl border select-none"
        style={{ 
          left: `${leftPanelPos.x}px`, 
          top: `${leftPanelPos.y}px`,
          cursor: dragging === 'left' ? 'grabbing' : 'default'
        }}
      >
        {/* Header with collapse button */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => handleMouseDown(e, 'left')}
        >
          <span className="text-xs font-semibold text-muted-foreground">EINSTELLUNGEN</span>
          <button
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="hover:bg-accent rounded p-1"
            title={leftPanelCollapsed ? "Ausklappen" : "Einklappen"}
          >
            {leftPanelCollapsed ? (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>

        {/* Content */}
        {!leftPanelCollapsed && (
          <div className="p-4 space-y-3">
            {/* Auto-Zoom Toggle */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoZoomEnabled}
                  onChange={(e) => setAutoZoomEnabled(e.target.checked)}
                  className="rounded"
                />
                <span>Auto-Zoom</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                {autoZoomEnabled
                  ? 'Kamera folgt automatisch der Route'
                  : 'Manuelle Kamerasteuerung aktiv'}
              </p>
            </div>

            {/* Route Lines Toggle */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRouteLines}
                  onChange={(e) => setShowRouteLines(e.target.checked)}
                  className="rounded"
                />
                <span>Routen-Linien</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                {showRouteLines
                  ? 'Linien werden angezeigt'
                  : 'Linien ausgeblendet'}
              </p>
            </div>

            {/* Movement Mode Emoji Toggle */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMovementMode}
                  onChange={(e) => setShowMovementMode(e.target.checked)}
                  className="rounded"
                />
                <span>Bewegungsmodus 🚶🚗</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                {showMovementMode
                  ? 'Zeigt Fußgänger/Auto-Icon basierend auf Geschwindigkeit'
                  : 'Bewegungsmodus ausgeblendet'}
              </p>
            </div>

            {/* User-Agent Filter (only for native GPS) */}
            {(source === 'native' || source === 'all') && availableUserAgents.length > 1 && (
              <div className="pt-3 border-t space-y-2">
                <label className="text-sm font-medium">
                  Geräte ({availableUserAgents.length})
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {availableUserAgents.map((userAgent, index) => {
                    const isActive = activeUserAgents.has(userAgent);
                    const color = getUserAgentColor(userAgent, index);
                    
                    // Extract device info from User-Agent (e.g., "iPhone; CPU iPhone OS 18_6_2")
                    const deviceMatch = userAgent.match(/\((.*?)\)/);
                    let deviceInfo = deviceMatch ? deviceMatch[1].split(';')[0].trim() : `Gerät ${index + 1}`;
                    
                    // Extract Device ID if present to distinguish devices
                    const deviceIdMatch = userAgent.match(/\[Device:([^\]]+)\]/);
                    if (deviceIdMatch) {
                      deviceInfo += ` (${deviceIdMatch[1].substring(0, 6)}...)`;
                    }
                    
                    return (
                      <button
                        key={userAgent}
                        onClick={() => {
                          const newActive = new Set(activeUserAgents);
                          
                          if (source === 'all') {
                            // For 'all': Only one User-Agent can be active
                            newActive.clear();
                            newActive.add(userAgent);
                          } else {
                            // For 'native': Toggle
                            if (isActive) {
                              newActive.delete(userAgent);
                            } else {
                              newActive.add(userAgent);
                            }
                          }
                          
                          setActiveUserAgents(newActive);
                        }}
                        className={`w-full px-2 py-1.5 text-xs rounded border transition-colors text-left ${
                          isActive
                            ? 'bg-primary/10 border-primary font-medium'
                            : 'bg-muted/50 border-border hover:bg-muted'
                        }`}
                        title={userAgent}
                      >
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate">{deviceInfo}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {source === 'all'
                    ? `${activeUserAgents.size} Gerät aktiv (nur ein Gerät für GPS + External)`
                    : `${activeUserAgents.size} von ${availableUserAgents.length} Geräten aktiv`}
                </p>
                {activeUserAgents.size > 1 && (
                  <p className="text-[10px] text-orange-600 font-medium">
                    ⚠️ Auto-Zoom bei mehreren Geräten deaktiviert
                  </p>
                )}
              </div>
            )}

            {/* Geschwindigkeitsregler */}
            <div className="pt-3 border-t space-y-2">
              <label className="text-sm font-medium">Geschwindigkeit</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={secondsPerHour}
                  onChange={(e) => setSecondsPerHour(Number(e.target.value))}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-xs font-mono w-12 text-right">{secondsPerHour}s/h</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {secondsPerHour} Sekunden = 1 Stunde GPS-Daten
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right Info Panel - Stats & Breaks */}
      <div 
        className="absolute z-[1000] bg-background/95 backdrop-blur-sm rounded-lg shadow-xl border max-w-sm select-none"
        style={{ 
          right: `${Math.abs(rightPanelPos.x)}px`, 
          top: `${rightPanelPos.y}px`,
          cursor: dragging === 'right' ? 'grabbing' : 'default'
        }}
      >
        {/* Header with collapse button */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => handleMouseDown(e, 'right')}
        >
          <span className="text-xs font-semibold text-muted-foreground">INFO & PAUSEN</span>
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="hover:bg-accent rounded p-1"
            title={rightPanelCollapsed ? "Ausklappen" : "Einklappen"}
          >
            {rightPanelCollapsed ? (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>

        {/* Content */}
        {!rightPanelCollapsed && (
          <div className="p-4 space-y-3">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Start</p>
                <p className="font-medium font-mono tabular-nums">
                  {format(new Date(displayPoints[0].timestamp), 'HH:mm', { locale: de })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Aktuell</p>
                <p className="font-medium font-mono tabular-nums">
                  {currentPosition ? format(new Date(currentPosition.timestamp), 'HH:mm', { locale: de }) : '-'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Ende</p>
                <p className="font-medium font-mono tabular-nums">
                  {format(new Date(displayPoints[displayPoints.length - 1].timestamp), 'HH:mm', { locale: de })}
                </p>
              </div>
            </div>

            {/* Breaks */}
            {breaks && breaks.length > 0 ? (
              // Show breaks from backend (with POI data)
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Pausen (≥20 Min): {breaks.length}
                  {breaks.some(b => b.isCustomerConversation) && (
                    <span className="ml-2 text-green-600">
                      ({breaks.filter(b => b.isCustomerConversation).length} Kundengespräch{breaks.filter(b => b.isCustomerConversation).length !== 1 ? 'e' : ''})
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {breaks.map((breakItem, idx) => {
                    const durationMinutes = Math.round(breakItem.duration / (1000 * 60));
                    const startTimeStr = format(new Date(breakItem.start), 'HH:mm', { locale: de });
                    const endTimeStr = format(new Date(breakItem.end), 'HH:mm', { locale: de });
                    const hasPOIData = breakItem.locations && breakItem.locations.length > 0;
                    const isActive = pauseMode.active && pauseMode.periodIndex === idx;
                    const isCustomerConversation = breakItem.isCustomerConversation === true;

                    // Convert break to StationaryPeriod format for handlePauseClick
                    // Find indices in displayPoints array for this break
                    const startIdx = displayPoints.findIndex(p => p.timestamp >= breakItem.start);
                    const endIdx = displayPoints.findIndex(p => p.timestamp >= breakItem.end);
                    
                    const period: StationaryPeriod = {
                      startIndex: startIdx !== -1 ? startIdx : 0,
                      endIndex: endIdx !== -1 ? endIdx : displayPoints.length - 1,
                      startTime: breakItem.start,
                      endTime: breakItem.end,
                      durationMs: breakItem.duration,
                      centerLat: breakItem.location?.lat || 0,
                      centerLng: breakItem.location?.lng || 0
                    };

                    // Color coding: green for customer conversation, orange for POI, gray for regular pause
                    const buttonClass = isActive 
                      ? 'bg-red-500 text-white border-red-600 shadow-lg ring-2 ring-red-400' 
                      : isCustomerConversation
                        ? 'bg-green-100 hover:bg-green-200 border-green-400 text-green-800'
                        : hasPOIData
                          ? 'bg-orange-100 hover:bg-orange-200 border-orange-300'
                          : 'bg-gray-100 hover:bg-gray-200 border-gray-300';

                    const titleText = isCustomerConversation
                      ? `Kundengespräch (Vertrag geschrieben) ${startTimeStr} - ${endTimeStr}${isActive ? ' (aktiv)' : ''}`
                      : hasPOIData 
                        ? `Pause mit POI: ${breakItem.locations![0].poi_name} (${startTimeStr} - ${endTimeStr})${isActive ? ' (aktiv - klicken zum Deaktivieren)' : ''}` 
                        : `Zu Pause springen: ${startTimeStr} - ${endTimeStr}`;

                    return (
                      <button
                        key={`break-${idx}`}
                        onClick={() => handlePauseClick(period, idx)}
                        className={`px-2 py-1 text-xs rounded border transition-colors font-mono tabular-nums ${buttonClass}`}
                        title={titleText}
                      >
                        {isCustomerConversation && '📝 '}
                        {startTimeStr} ({durationMinutes} Min)
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : stationaryPeriods.length > 0 && (
              // Fallback: Show detected periods (no POI data)
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Pausen (≥20 Min): {stationaryPeriods.length}
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {stationaryPeriods.map((period, idx) => {
                    const durationMinutes = Math.round(period.durationMs / (1000 * 60));
                    const startTimeStr = format(new Date(period.startTime), 'HH:mm', { locale: de });
                    const endTimeStr = format(new Date(period.endTime), 'HH:mm', { locale: de });
                    const hasExternalData = hasExternalGPSInPeriod(period);
                    const isActive = pauseMode.active && pauseMode.periodIndex === idx;

                    return (
                      <button
                        key={`break-${idx}`}
                        onClick={() => handlePauseClick(period, idx)}
                        className={`px-2 py-1 text-xs rounded border transition-colors font-mono tabular-nums ${
                          isActive 
                            ? 'bg-red-500 text-white border-red-600 shadow-lg ring-2 ring-red-400' 
                            : hasExternalData
                              ? 'bg-orange-100 hover:bg-orange-200 border-orange-300'
                              : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
                        }`}
                        title={
                          hasExternalData 
                            ? `Pause mit externen GPS-Daten: ${startTimeStr} - ${endTimeStr}${isActive ? ' (aktiv - klicken zum Deaktivieren)' : ''}` 
                            : `Zu Pause springen: ${startTimeStr} - ${endTimeStr} (keine externen GPS-Daten)`
                        }
                      >
                        {startTimeStr} ({durationMinutes} Min)
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Legend */}
      <div className="absolute bottom-4 right-4 z-[1000] bg-background/95 backdrop-blur-sm rounded-lg shadow-xl border px-3 py-2">
        <p className="text-xs text-muted-foreground mb-1">GPS-Quellen:</p>
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#3b82f6] border border-white shadow-sm"></div>
            <span>Native App</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#000000] border border-white shadow-sm"></div>
            <span>FollowMee</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ef4444] border border-white shadow-sm"></div>
            <span>Damians Tracking App</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#10b981] border border-white shadow-sm"></div>
            <span>Snap-to-Roads</span>
          </div>
        </div>
      </div>

      {/* Map Container - Full screen with dynamic top position to avoid timeline overlap */}
      <div 
        className="absolute left-0 right-0 bottom-0 rounded-xl overflow-hidden border border-border bg-muted"
        style={{ top: `${timelineHeight}px` }}
      >
        {/* Pause Mode Frost Vignette - only over map area */}
        {pauseMode.active && (
          <div 
            className="absolute inset-0 z-[999] pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 80px 20px rgba(220, 38, 38, 0.4)',
              background: 'radial-gradient(ellipse at center, transparent 30%, rgba(220, 38, 38, 0.15) 100%)',
              backdropFilter: 'brightness(0.85) saturate(0.7)'
            }}
          >
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600/90 text-white px-4 py-2 rounded-lg shadow-lg font-semibold text-sm">
              Pause-Modus aktiv
            </div>
          </div>
        )}
        
        <div ref={mapContainerRef} className="w-full h-full" />
        {!mapsApiLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/75 backdrop-blur-sm z-[600]">
            <div className="text-sm text-muted-foreground">Google Maps wird geladen...</div>
          </div>
        )}
        {mapLoadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 backdrop-blur-sm z-[700]">
            <div className="text-sm text-red-500 font-medium text-center px-4">{mapLoadError}</div>
          </div>
        )}
      </div>
    </div>
  );
}


