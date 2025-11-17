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

interface RouteReplayMapProps {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps?: number[];
  date: string;
  userId?: string;
  source?: 'all' | 'native' | 'followmee' | 'external' | 'external_app';
}

const MORNING_CUTOFF_HOUR = 6;
const GAP_DISTANCE_THRESHOLD_METERS = 50;
const SNAP_SEGMENT_COST_CENT_PER_CALL = 0.5;

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
  photoMarker: google.maps.Marker | null;
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
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
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

export default function RouteReplayMap({ username, gpsPoints, photoTimestamps = [], date, userId, source = 'all' }: RouteReplayMapProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTimestamp, setCurrentTimestamp] = useState(0); // Current GPS timestamp for smooth interpolation
  const [showFullRoute, setShowFullRoute] = useState(true);
  const [activePhotoFlash, setActivePhotoFlash] = useState<number | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [snapToRoadsEnabled, setSnapToRoadsEnabled] = useState(false); // Snap-to-roads toggle
  const [secondsPerHour, setSecondsPerHour] = useState(5); // Animation speed: 5 real seconds per GPS hour
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true); // Auto-Zoom toggle
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
    photoMarker: null,
    gpsMarkers: [],
  });
  const zoomListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const lastViewportChange = useRef(0); // Für 3-Sekunden-Regel
  const currentTimestampRef = useRef(0); // Aktueller Timestamp für Auto-Zoom
  const lastBoundsRef = useRef<{ latRange: number; lngRange: number } | null>(null); // Letzte Bounds für Vergleich
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

  // Detect stationary periods (20+ min in 20m radius) - based on basePoints
  const stationaryPeriods = useMemo(() => detectStationaryPeriods(basePoints), [basePoints]);

  // Display points: In pause mode, filter to only show external GPS data within pause period
  const displayPoints = useMemo(() => {
    if (!pauseMode.active || pauseMode.periodIndex === null) {
      return basePoints;
    }

    const period = stationaryPeriods[pauseMode.periodIndex];
    if (!period) {
      return basePoints;
    }

    // Filter to only external GPS points within the pause period
    return basePoints.filter(
      p => p.timestamp >= period.startTime &&
           p.timestamp <= period.endTime &&
           (p.source === 'followmee' || p.source === 'external' || p.source === 'external_app')
    );
  }, [basePoints, pauseMode, stationaryPeriods]);

  const baseRouteSignature = useMemo(() => buildRouteSignature(basePoints), [basePoints]);

  useEffect(() => {
    basePointsRef.current = basePoints;
  }, [basePoints]);

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
  const interpolatePosition = (timestamp: number): GPSPoint | null => {
    if (displayPoints.length === 0) return null;

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

    for (let i = 0; i < displayPoints.length; i++) {
      if (displayPoints[i].timestamp <= clampedTime) {
        beforeIdx = i;
      } else {
        afterIdx = i;
        break;
      }
    }

    // If we're at or after the last point
    if (afterIdx === 0 || afterIdx === beforeIdx) {
      return displayPoints[beforeIdx];
    }

    const beforePoint = displayPoints[beforeIdx];
    const afterPoint = displayPoints[afterIdx];

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

  // Get current interpolated position
  const currentPosition = useMemo(() => {
    return interpolatePosition(currentTimestamp);
  }, [currentTimestamp, snapToRoadsEnabled, snapSegments, displayPoints]);

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
  const createRouteSegments = (points: GPSPoint[], gapIds?: Set<string>) => {
    const segments: { points: [number, number][]; source: 'native' | 'followmee' | 'external' | 'external_app' }[] = [];

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

  const fullRouteSegments = createRouteSegments(displayPoints, snapToRoadsEnabled ? gapSegmentIdSet : undefined);
  const animatedRouteSegments = createRouteSegments(animatedRouteWithInterpolation, snapToRoadsEnabled ? gapSegmentIdSet : undefined);

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.fullRoutes);

    if (!showFullRoute) return;

    overlays.fullRoutes = fullRouteSegments.map(segment => {
      const sourceColor = SOURCE_COLORS[segment.source || 'native'];

      console.log('[RouteReplay] Full Route Segment:', {
        source: segment.source,
        color: sourceColor,
        points: segment.points.length
      });

      return new googleMaps.Polyline({
        map,
        path: segment.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: sourceColor,
        strokeOpacity: pauseMode.active ? 0.15 : 0.5,
        strokeWeight: 2,
        zIndex: 50,
      });
    });
  }, [fullRouteSegments, showFullRoute, mapsApiLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.animatedRoutes);

    overlays.animatedRoutes = animatedRouteSegments.map(segment => {
      const sourceColor = SOURCE_COLORS[segment.source || 'native'];

      return new googleMaps.Polyline({
        map,
        path: segment.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: sourceColor,
        strokeOpacity: pauseMode.active ? 0.25 : 0.9,
        strokeWeight: 4,
        zIndex: 200,
      });
    });
  }, [animatedRouteSegments, mapsApiLoaded, pauseMode.active]);

  // Pause Mode Route: Show only external GPS points during pause period
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = window.google?.maps;
    if (!map || !googleMaps) return;

    const overlays = mapOverlaysRef.current;
    clearPolylineList(overlays.pauseRoutes);

    // Only render pause route if pause mode is active
    if (!pauseMode.active || pauseMode.periodIndex === null) return;

    const period = stationaryPeriods[pauseMode.periodIndex];
    if (!period) return;

    // Get all external GPS points during the pause period
    const pausePoints = basePoints.filter(
      p => p.timestamp >= period.startTime &&
           p.timestamp <= period.endTime &&
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
  }, [pauseMode.active, pauseMode.periodIndex, stationaryPeriods, basePoints, currentTimestamp, currentPosition, mapsApiLoaded]);

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
  const updateCameraView = useCallback((forceUpdate = false) => {
    const map = mapRef.current;
    if (!map) return;
    if (!window.google?.maps) return;

    // Im Pause-Modus verwende displayPoints (gefilterte externe GPS-Punkte)
    // Ansonsten verwende basePoints - verwende refs für aktuelle Werte
    const points = pauseModeRef.current.active ? displayPointsRef.current : basePointsRef.current;
    if (points.length === 0) return;

    // Aktuelle Position basierend auf currentTimestampRef berechnen (nicht aus Closure!)
    const currentTime = currentTimestampRef.current;
    const currentIdx = points.findIndex(p => p.timestamp >= currentTime);
    if (currentIdx === -1) return;

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

    // Pre-Check: Ist der Nutzer bereits zu nah am Rand? (Emergency Zoom)
    // Berechne erstmal grob die Lookahead-Punkte für Edge-Detection
    const msPerHour = 3600000;
    const sph = secondsPerHour;
    const animationSpeedMsPerSec = msPerHour / sph;
    const lookaheadWindowMs = animationSpeedMsPerSec * 3;

    let preliminaryLookaheadPoints = points.filter(p =>
      p.timestamp >= currentTime && p.timestamp <= currentTime + lookaheadWindowMs
    );

    if (preliminaryLookaheadPoints.length < 10) {
      const currentIndex = points.findIndex(p => p.timestamp >= currentTime);
      if (currentIndex !== -1) {
        preliminaryLookaheadPoints = points.slice(currentIndex, Math.min(currentIndex + 20, points.length));
      }
    }

    const preliminaryMaxLatDiff = preliminaryLookaheadPoints.length > 0
      ? Math.max(...preliminaryLookaheadPoints.map(p => Math.abs(p.latitude - position.latitude)), 0)
      : 0;
    const preliminaryMaxLngDiff = preliminaryLookaheadPoints.length > 0
      ? Math.max(...preliminaryLookaheadPoints.map(p => Math.abs(p.longitude - position.longitude)), 0)
      : 0;

    let isEmergencyZoom = false;
    if (lastBoundsRef.current) {
      const latEdgeRatio = preliminaryMaxLatDiff / (lastBoundsRef.current.latRange / 2);
      const lngEdgeRatio = preliminaryMaxLngDiff / (lastBoundsRef.current.lngRange / 2);
      isEmergencyZoom = latEdgeRatio > 0.7 || lngEdgeRatio > 0.7;
    }

    // 3-Sekunden-Regel: Keine Änderung öfter als alle 3 Sekunden
    // ABER: Überspringen bei forceUpdate, erstem Zoom (lastBoundsRef === null), oder Emergency
    const timeSinceLastChange = now - lastViewportChange.current;
    if (!forceUpdate && !isEmergencyZoom && lastBoundsRef.current !== null && timeSinceLastChange < 3000) {
      console.log('[RouteReplay] Camera update skipped (3s cooldown)', {
        timeSinceLastChange: (timeSinceLastChange / 1000).toFixed(1) + 's'
      });
      return;
    }

    if (isEmergencyZoom) {
      console.log('[RouteReplay] 🚨 Emergency zoom triggered - skipping cooldown');
    }

    // 1. Lookahead-Punkte verwenden (bereits berechnet für Emergency Check)
    let lookaheadPoints = preliminaryLookaheadPoints;

    if (lookaheadPoints.length === 0) return;

    // 3. Aktuelle Position muss auch berücksichtigt werden
    const allPointsToShow = [position, ...lookaheadPoints];

    const lats = allPointsToShow.map(p => p.latitude);
    const lngs = allPointsToShow.map(p => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // 4. Berechne Bounds mit aktuelle Position als Zentrum
    // Der Zoom soll so gewählt werden, dass:
    // - Die aktuelle Position im Zentrum ist
    // - Alle Lookahead-Punkte mindestens 20% vom Rand entfernt sind

    // Finde den am weitesten entfernten Punkt von der aktuellen Position
    const latDiffs = lookaheadPoints.map(p => Math.abs(p.latitude - position.latitude));
    const lngDiffs = lookaheadPoints.map(p => Math.abs(p.longitude - position.longitude));

    const maxLatDiff = Math.max(...latDiffs, 0);
    const maxLngDiff = Math.max(...lngDiffs, 0);

    // 20%-Regel: Weitester Lookahead-Punkt soll 20% vom Rand entfernt sein
    // Mathematik:
    // - Nutzer ist im Zentrum (50% der Höhe/Breite)
    // - 20% vom Rand = 80% vom unteren/rechten Rand = 30% vom Zentrum
    // - Wenn weitester Punkt X Grad entfernt ist und bei 30% vom Zentrum liegen soll:
    //   X / (visibleRange / 2) = 0.30  =>  visibleRange = X / 0.30 = X * 3.33
    // - ABER: Etwas engerer Zoom (Faktor 2.0) für bessere Sicht = ~25% vom Zentrum = ~25% vom Rand
    const ZOOM_FACTOR = 2.0;  // Weitester Punkt bei 25% vom Zentrum = 25% vom Rand
    const MIN_VISIBLE_RANGE = 0.0008; // ca. 80m - verhindert zu starkes Ranzoomen
    
    const visibleLatRange = Math.max(maxLatDiff * ZOOM_FACTOR, MIN_VISIBLE_RANGE);
    const visibleLngRange = Math.max(maxLngDiff * ZOOM_FACTOR, MIN_VISIBLE_RANGE);

    // 5. Prüfe ob sich die Bounds signifikant geändert haben (> 30% Änderung in IRGENDEINER Dimension)
    // ABER: Emergency Zoom überspringt diese Prüfung (bereits oben geprüft)
    const lastBoundsData = lastBoundsRef.current;
    if (!forceUpdate && !isEmergencyZoom && lastBoundsData) {
      const latChange = Math.abs(visibleLatRange - lastBoundsData.latRange) / lastBoundsData.latRange;
      const lngChange = Math.abs(visibleLngRange - lastBoundsData.lngRange) / lastBoundsData.lngRange;

      // Zoom nur wenn BEIDE Dimensionen sich weniger als 30% ändern
      // Wenn eine sich > 30% ändert, zoomen wir
      const maxChange = Math.max(latChange, lngChange);

      if (maxChange < 0.3) {
        console.log('[RouteReplay] Camera update skipped (bounds change < 30%)', {
          latChange: (latChange * 100).toFixed(1) + '%',
          lngChange: (lngChange * 100).toFixed(1) + '%',
          maxChange: (maxChange * 100).toFixed(1) + '%'
        });
        return;
      }
    }

    // 6. Bounds setzen
    const bounds = new window.google.maps.LatLngBounds(
      { lat: position.latitude - visibleLatRange / 2, lng: position.longitude - visibleLngRange / 2 },
      { lat: position.latitude + visibleLatRange / 2, lng: position.longitude + visibleLngRange / 2 }
    );

    // 7. Zoom und Zentrum setzen
    // Die Karte ist bereits unter der Timeline positioniert (top: timelineHeight),
    // daher brauchen wir kein extra Top-Padding mehr
    map.fitBounds(bounds, {
      top: 20,
      bottom: 50,
      left: 50,
      right: 50
    });

    // 8. Bounds speichern und Timestamp aktualisieren
    lastBoundsRef.current = { latRange: visibleLatRange, lngRange: visibleLngRange };
    lastViewportChange.current = now;

    console.log('[RouteReplay] Camera updated:', {
      currentPos: { lat: position.latitude.toFixed(5), lng: position.longitude.toFixed(5) },
      lookaheadPoints: lookaheadPoints.length,
      windowMs: lookaheadWindowMs,
      maxLatDiff: maxLatDiff.toFixed(5),
      maxLngDiff: maxLngDiff.toFixed(5),
      visibleLatRange: visibleLatRange.toFixed(5),
      visibleLngRange: visibleLngRange.toFixed(5)
    });
  }, []); // Keine Dependencies - verwendet nur refs für aktuelle Werte

  // Periodische Kamera-Updates alle 3 Sekunden während Animation
  useEffect(() => {
    if (!isPlaying || !mapRef.current || !autoZoomEnabled) return;

    // Sofort beim Start ausführen (erzwungen, ignoriert 3s-Regel)
    console.log('[RouteReplay] Animation started - forcing initial camera update');
    updateCameraView(true);

    // Dann alle 3 Sekunden wiederholen
    const interval = setInterval(() => updateCameraView(false), 3000);
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
    if (!currentPosition || currentIndex <= 0 || currentIndex >= displayPoints.length - 1) {
      overlays.currentMarker = removeMarker(overlays.currentMarker);
      return;
    }

    if (!overlays.currentMarker) {
      overlays.currentMarker = new googleMaps.Marker({
        map,
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          fillColor: '#000000', // Schwarz für bessere Sichtbarkeit
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
          scale: 12, // Größerer Marker
        },
        zIndex: 450,
      });
    }

    overlays.currentMarker.setPosition({ lat: currentPosition.latitude, lng: currentPosition.longitude });
  }, [currentPosition, currentIndex, displayPoints.length, mapsApiLoaded]);

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
            fillOpacity: pauseMode.active ? 0.15 : 0.9, // Stark ausgegraut im Pause-Modus
            strokeColor: '#ffffff',
            strokeWeight: 1,
            scale: 4,
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
      duration: endTime - startTime
    });

    // Center on current position if auto-zoom is enabled
    if (autoZoomEnabled && currentPosition && mapRef.current) {
      mapRef.current.panTo({
        lat: currentPosition.latitude,
        lng: currentPosition.longitude
      });
      console.log('[RouteReplay] Centered on current position', {
        lat: currentPosition.latitude,
        lng: currentPosition.longitude
      });
    }

    setIsPlaying(true);
    startTimeRef.current = Date.now();

    // Current GPS timestamp (where we're resuming from)
    const startGPSTimestamp = currentTimestamp;

    const animate = () => {
      if (!startTimeRef.current) {
        console.log('[RouteReplay] animate() aborted: no startTimeRef');
        return;
      }

      // Elapsed real time since animation started
      const elapsedRealTime = Date.now() - startTimeRef.current;

      // Calculate how much GPS time has passed based on animation speed
      const realTimePerGPSHour = secondsPerHour * 1000; // milliseconds
      const gpsTimePerRealTime = (60 * 60 * 1000) / realTimePerGPSHour; // GPS ms per real ms
      const elapsedGPSTime = elapsedRealTime * gpsTimePerRealTime;

      // Current GPS timestamp in the animation
      const targetGPSTimestamp = startGPSTimestamp + elapsedGPSTime;

      if (elapsedRealTime % 1000 < 16) { // Log ungefähr jede Sekunde
        console.log('[RouteReplay] animate()', {
          elapsedRealTime,
          elapsedGPSTime,
          targetGPSTimestamp,
          startGPSTimestamp,
          endTime,
          progress: ((targetGPSTimestamp - startGPSTimestamp) / (endTime - startGPSTimestamp) * 100).toFixed(1) + '%'
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

  // Keyboard navigation: Arrow Left/Right for previous/next GPS point
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousPoint();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextPoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentIndex, displayPoints]);

  // Center map on current position
  const centerOnCurrentPosition = () => {
    if (mapRef.current && currentPosition) {
      mapRef.current.panTo({
        lat: currentPosition.latitude,
        lng: currentPosition.longitude
      });
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

              {/* Stationary period backgrounds */}
              <div className="absolute w-full h-3 pointer-events-none">
                {displayPoints.length > 0 && stationaryPeriods.map((period, idx) => {
                  const totalDuration = endTime - startTime;
                  if (totalDuration <= 0) return null;
                  const startPos = ((period.startTime - startTime) / totalDuration) * 100;
                  const endPos = ((period.endTime - startTime) / totalDuration) * 100;
                  const width = endPos - startPos;
                  return (
                    <div
                      key={`break-${idx}`}
                      className="absolute h-full bg-orange-400 opacity-40 rounded"
                      style={{ left: `${startPos}%`, width: `${width}%` }}
                      title={`Pause: ${Math.round(period.durationMs / (60000))} Min`}
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
            {currentPosition && (
              <span className="hidden sm:inline text-sm font-bold whitespace-nowrap font-mono tabular-nums">
                {format(new Date(currentPosition.timestamp), 'HH:mm:ss', { locale: de })}
              </span>
            )}
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
            {stationaryPeriods.length > 0 && (
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


