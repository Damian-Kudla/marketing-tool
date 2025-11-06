/**
 * Route Replay Map Component
 * 
 * Zeigt die Route eines Mitarbeiters mit Animation:
 * - Statische Anzeige aller GPS-Punkte
 * - Animierte Route-Wiedergabe (8 Stunden in 5 Sekunden)
 * - Play/Pause/Reset Controls
 * - Zeitstempel während Animation
 */

import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Play, Pause, RotateCcw, Zap, MapPin, ArrowUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source?: 'native' | 'followmee' | 'external';
}

interface RouteReplayMapProps {
  username: string;
  gpsPoints: GPSPoint[];
  photoTimestamps?: number[];
  date: string;
}

// Custom marker for animated position
const createAnimatedMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #3b82f6;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        animation: pulse 1.5s ease-in-out infinite;
      "></div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
      </style>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

// Start marker (green)
const createStartMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #22c55e;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: white;
      ">S</div>
    `,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

// End marker (red)
const createEndMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #ef4444;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: white;
      ">E</div>
    `,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

// Photo flash marker
const createPhotoFlashMarker = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        font-size: 35px;
        filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.8));
        animation: flash-pulse 1s ease-in-out;
      ">⚡</div>
      <style>
        @keyframes flash-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.2); }
        }
      </style>
    `,
    iconSize: [35, 35],
    iconAnchor: [17, 17],
  });
};

// Small clickable marker for GPS points with source-based coloring
const createGPSPointMarker = (source?: 'native' | 'followmee' | 'external') => {
  // Native: Blue (#3b82f6), FollowMee: Black (#000000), External: Red (#ef4444)
  const color = source === 'followmee' ? '#000000' : source === 'external' ? '#ef4444' : '#3b82f6';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: ${color};
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        cursor: pointer;
      "></div>
    `,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
};

// Generate Google Maps URL with proper pin marker
const getGoogleMapsUrl = (lat: number, lng: number): string => {
  // Format: https://www.google.com/maps/search/?api=1&query=lat,lng
  // This format ensures a proper pin/marker is shown at the exact coordinates
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
};

// Calculate distance between two GPS points in meters
function calculateDistance(point1: GPSPoint, point2: GPSPoint): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (point1.latitude * Math.PI) / 180;
  const φ2 = (point2.latitude * Math.PI) / 180;
  const Δφ = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const Δλ = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
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

// Calculate appropriate zoom level to fit bounds within viewport
function calculateZoomForBounds(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }, viewportWidth: number, viewportHeight: number): number {
  // Convert latitude/longitude differences to approximate meters
  const latDiff = bounds.maxLat - bounds.minLat;
  const lngDiff = bounds.maxLng - bounds.minLng;

  // Average latitude for more accurate calculation
  const avgLat = (bounds.minLat + bounds.maxLat) / 2;

  // Approximate meters per degree at this latitude
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(avgLat * Math.PI / 180);

  // Calculate dimensions in meters
  const heightMeters = latDiff * metersPerDegreeLat;
  const widthMeters = lngDiff * metersPerDegreeLng;

  // Add 20% margin on each side (40% total) to prevent edge approach
  const requiredHeightMeters = heightMeters * 1.4;
  const requiredWidthMeters = widthMeters * 1.4;

  // Calculate required meters per pixel for both dimensions
  const requiredMetersPerPixelHeight = requiredHeightMeters / viewportHeight;
  const requiredMetersPerPixelWidth = requiredWidthMeters / viewportWidth;

  // Use the larger value to ensure both dimensions fit
  const requiredMetersPerPixel = Math.max(requiredMetersPerPixelHeight, requiredMetersPerPixelWidth);

  // Calculate zoom level based on meters per pixel formula
  // Formula: metersPerPixel = 156543.03392 * cos(lat) / 2^zoom
  const zoom = Math.log2(156543.03392 * Math.cos(avgLat * Math.PI / 180) / requiredMetersPerPixel);

  // Clamp zoom between reasonable values
  return Math.max(10, Math.min(18, Math.floor(zoom)));
}

// Determine optimal zoom level based on upcoming points in next 3 seconds of animation
function calculateOptimalZoom(currentTimestamp: number, allPoints: GPSPoint[], secondsPerHour: number, viewportWidth: number = 800, viewportHeight: number = 600): number {
  if (allPoints.length < 2) return 18;

  // Calculate how much GPS time corresponds to 3 seconds of animation time
  // secondsPerHour = real seconds to display 1 hour (3600000 ms) of GPS data
  const msPerRealSecond = 3600000 / secondsPerHour; // GPS milliseconds per real second
  const threeSecondsGPSTime = msPerRealSecond * 3; // GPS time covered in next 3 real seconds

  // Find all points within the next 3 seconds of GPS time
  const futureTimestamp = currentTimestamp + threeSecondsGPSTime;
  const upcomingPoints = allPoints.filter(p => p.timestamp >= currentTimestamp && p.timestamp <= futureTimestamp);

  // If we don't have enough points, look at a minimum window
  if (upcomingPoints.length < 2) {
    // Look ahead at least 10 points or until end
    const currentIndex = allPoints.findIndex(p => p.timestamp >= currentTimestamp);
    if (currentIndex >= 0) {
      const endIndex = Math.min(currentIndex + 10, allPoints.length);
      upcomingPoints.push(...allPoints.slice(currentIndex, endIndex));
    }
  }

  if (upcomingPoints.length < 2) return 18;

  // Calculate bounds for upcoming points
  const bounds = calculateBounds(upcomingPoints);
  if (!bounds) return 18;

  // If bounds are too small (stationary), use a reasonable default zoom
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  if (latRange < 0.0001 && lngRange < 0.0001) {
    return 17; // Zoomed in for stationary periods
  }

  // Calculate optimal zoom to fit all upcoming points
  return calculateZoomForBounds(bounds, viewportWidth, viewportHeight);
}

// Component to capture map instance
function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);

  return null;
}

// Component to follow current position with intelligent panning and zoom
function CameraFollow({ currentPosition, currentIndex, allPoints, manualZoom, isPlaying, intelligentZoomEnabled, secondsPerHour }: {
  currentPosition: GPSPoint | null;
  currentIndex: number;
  allPoints: GPSPoint[];
  manualZoom: number;
  isPlaying: boolean;
  intelligentZoomEnabled: boolean;
  secondsPerHour: number;
}) {
  const map = useMap();
  const lastPositionRef = useRef<GPSPoint | null>(null);
  const lastZoomChangeRef = useRef<number>(0);
  const currentZoomRef = useRef<number>(manualZoom);

  useEffect(() => {
    if (!intelligentZoomEnabled) {
      // Use manual zoom
      if (map.getZoom() !== manualZoom) {
        map.setZoom(manualZoom, { animate: false });
        currentZoomRef.current = manualZoom;
      }
    }
  }, [manualZoom, map, intelligentZoomEnabled]);

  useEffect(() => {
    if (!currentPosition) return;

    const targetLat = currentPosition.latitude;
    const targetLng = currentPosition.longitude;
    const now = Date.now();

    // Initial centering (first position or when starting playback)
    if (!lastPositionRef.current) {
      const initialZoom = intelligentZoomEnabled && isPlaying ? 18 : manualZoom;
      map.setView([targetLat, targetLng], initialZoom, { animate: true, duration: 0.5 });
      lastPositionRef.current = currentPosition;
      currentZoomRef.current = initialZoom;
      lastZoomChangeRef.current = now;
      return;
    }

    // Don't control camera when paused - allow free user control
    if (!isPlaying) {
      lastPositionRef.current = currentPosition;
      return;
    }

    // Re-center and lock camera when starting to play
    map.setView([targetLat, targetLng], currentZoomRef.current, { animate: true, duration: 0.5 });

    // Intelligent zoom calculation (only when enabled and playing)
    if (intelligentZoomEnabled) {
      // Check if 3 seconds have passed since last zoom change
      const timeSinceLastZoomChange = now - lastZoomChangeRef.current;

      if (timeSinceLastZoomChange >= 3000) {
        // Get map size for accurate zoom calculation
        const mapSize = map.getSize();
        const viewportWidth = mapSize.x;
        const viewportHeight = mapSize.y;

        // Calculate optimal zoom based on next 3 seconds of GPS data
        const optimalZoom = calculateOptimalZoom(
          currentPosition.timestamp,
          allPoints,
          secondsPerHour,
          viewportWidth,
          viewportHeight
        );

        // Only change zoom if significantly different (at least 1 level)
        if (Math.abs(currentZoomRef.current - optimalZoom) >= 1) {
          map.setZoom(optimalZoom, { animate: true });
          currentZoomRef.current = optimalZoom;
          lastZoomChangeRef.current = now;
          console.log(`[IntelligentZoom] Changed zoom to ${optimalZoom} at timestamp ${currentPosition.timestamp} (speed: ${secondsPerHour}s/h)`);
        }
      }
    }

    // Get current map bounds and size
    const bounds = map.getBounds();
    const mapSize = map.getSize();

    // Calculate 30% threshold from edges (in pixels)
    const threshold = 0.3;
    const thresholdX = mapSize.x * threshold;
    const thresholdY = mapSize.y * threshold;

    // Convert target position to pixel coordinates
    const targetPoint = map.latLngToContainerPoint([targetLat, targetLng]);

    // Check if point is getting too close to any edge (within 30%)
    const tooCloseLeft = targetPoint.x < thresholdX;
    const tooCloseRight = targetPoint.x > (mapSize.x - thresholdX);
    const tooCloseTop = targetPoint.y < thresholdY;
    const tooCloseBottom = targetPoint.y > (mapSize.y - thresholdY);

    if (tooCloseLeft || tooCloseRight || tooCloseTop || tooCloseBottom) {
      // Pan smoothly to re-center the point
      map.panTo([targetLat, targetLng], {
        animate: true,
        duration: 0.25,
        easeLinearity: 0.25,
        noMoveStart: true
      });
    }

    lastPositionRef.current = currentPosition;
  }, [currentPosition, currentIndex, allPoints, map, isPlaying, manualZoom, intelligentZoomEnabled]);

  return null;
}

// Initial bounds setup (only on mount)
function InitialBounds({ points }: { points: GPSPoint[] }) {
  const map = useMap();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (points.length === 0 || initialized) return;

    const bounds = L.latLngBounds(
      points.map(p => [p.latitude, p.longitude])
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
      setInitialized(true);
    }
  }, [points, map, initialized]);

  return null;
}

export default function RouteReplayMap({ username, gpsPoints, photoTimestamps = [], date }: RouteReplayMapProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTimestamp, setCurrentTimestamp] = useState(0); // Current GPS timestamp for smooth interpolation
  const [showFullRoute, setShowFullRoute] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(18);
  const [secondsPerHour, setSecondsPerHour] = useState(5); // Seconds to display one hour of data
  const [intelligentZoomEnabled, setIntelligentZoomEnabled] = useState(true); // Auto-zoom based on speed
  const [activePhotoFlash, setActivePhotoFlash] = useState<number | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  
  // Draggable panel positions
  const [leftPanelPos, setLeftPanelPos] = useState({ x: 16, y: 96 }); // left-4 top-24 (16px, 96px)
  const [rightPanelPos, setRightPanelPos] = useState({ x: -16, y: 96 }); // right-4 top-24 (negative for right positioning)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedIndexRef = useRef<number>(0);
  const pausedTimestampRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

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

  // Sort GPS points by timestamp
  const sortedPoints = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);

  // Initialize current timestamp
  useEffect(() => {
    if (sortedPoints.length > 0 && currentTimestamp === 0) {
      setCurrentTimestamp(sortedPoints[0].timestamp);
      pausedTimestampRef.current = sortedPoints[0].timestamp;
    }
  }, [sortedPoints, currentTimestamp]);

  // Detect stationary periods (20+ min in 20m radius)
  const stationaryPeriods = detectStationaryPeriods(sortedPoints);

  // Get time range for timeline
  const startTime = sortedPoints.length > 0 ? sortedPoints[0].timestamp : 0;
  const endTime = sortedPoints.length > 0 ? sortedPoints[sortedPoints.length - 1].timestamp : 0;

  // Interpolate position between two GPS points based on timestamp
  const interpolatePosition = (timestamp: number): GPSPoint | null => {
    if (sortedPoints.length === 0) return null;

    // Clamp timestamp to valid range
    const clampedTime = Math.max(startTime, Math.min(endTime, timestamp));

    // Find the two points surrounding this timestamp
    let beforeIdx = 0;
    let afterIdx = 0;

    for (let i = 0; i < sortedPoints.length; i++) {
      if (sortedPoints[i].timestamp <= clampedTime) {
        beforeIdx = i;
      } else {
        afterIdx = i;
        break;
      }
    }

    // If we're at or after the last point
    if (afterIdx === 0 || afterIdx === beforeIdx) {
      return sortedPoints[beforeIdx];
    }

    const beforePoint = sortedPoints[beforeIdx];
    const afterPoint = sortedPoints[afterIdx];

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
  const currentPosition = interpolatePosition(currentTimestamp);

  // Note: Animation is now time-based, not duration-based
  // The animation speed is controlled by secondsPerHour in real-time

  // Calculate photo positions between GPS points
  const calculatePhotoPosition = (photoTimestamp: number): [number, number] | null => {
    if (sortedPoints.length < 2) return null;

    // Find the two GPS points surrounding the photo timestamp
    let beforePoint: GPSPoint | null = null;
    let afterPoint: GPSPoint | null = null;

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      if (sortedPoints[i].timestamp <= photoTimestamp && sortedPoints[i + 1].timestamp >= photoTimestamp) {
        beforePoint = sortedPoints[i];
        afterPoint = sortedPoints[i + 1];
        break;
      }
    }

    // If photo is before first GPS or after last GPS, use closest point
    if (!beforePoint && !afterPoint) {
      if (photoTimestamp < sortedPoints[0].timestamp) {
        return [sortedPoints[0].latitude, sortedPoints[0].longitude];
      } else {
        const last = sortedPoints[sortedPoints.length - 1];
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

  // Check if current animation time should trigger a photo flash
  useEffect(() => {
    if (!isPlaying || sortedPoints.length === 0) return;

    const currentPoint = sortedPoints[currentIndex];
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
  }, [currentIndex, isPlaying, photoTimestamps, sortedPoints, activePhotoFlash]);

  // Calculate time span
  const timeSpan = sortedPoints.length > 0
    ? sortedPoints[sortedPoints.length - 1].timestamp - sortedPoints[0].timestamp
    : 0;

  // Route up to current timestamp (all points before or at current time)
  const animatedRoute = sortedPoints.filter(p => p.timestamp <= currentTimestamp);

  // Add interpolated current position to animated route for smooth drawing
  const animatedRouteWithInterpolation = currentPosition && currentPosition.timestamp > (animatedRoute[animatedRoute.length - 1]?.timestamp || 0)
    ? [...animatedRoute, currentPosition]
    : animatedRoute;

  // Create polyline segments grouped by source for multi-colored route
  const createRouteSegments = (points: GPSPoint[]) => {
    const segments: { points: [number, number][]; source: 'native' | 'followmee' | 'external' }[] = [];

    if (points.length < 2) return segments;

    let currentSegment: [number, number][] = [[points[0].latitude, points[0].longitude]];
    let currentSource: 'native' | 'followmee' | 'external' = points[0].source || 'native';

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const pointSource: 'native' | 'followmee' | 'external' = point.source || 'native';

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

  const fullRouteSegments = createRouteSegments(sortedPoints);
  const animatedRouteSegments = createRouteSegments(animatedRouteWithInterpolation);

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

  // Find GPS point index by timestamp
  const findIndexByTimestamp = (targetTimestamp: number): number => {
    // Find the first GPS point that is at or after the target timestamp
    for (let i = 0; i < sortedPoints.length; i++) {
      if (sortedPoints[i].timestamp >= targetTimestamp) {
        return i;
      }
    }
    // If no point found, return last index
    return sortedPoints.length - 1;
  };

  // Start animation - Time-based with smooth interpolation
  const startAnimation = () => {
    if (sortedPoints.length === 0) return;

    setIsPlaying(true);
    startTimeRef.current = Date.now();

    // Current GPS timestamp (where we're resuming from)
    const startGPSTimestamp = currentTimestamp;

    const animate = () => {
      if (!startTimeRef.current) return;

      // Elapsed real time since animation started
      const elapsedRealTime = Date.now() - startTimeRef.current;

      // Calculate how much GPS time has passed based on animation speed
      // secondsPerHour defines how many real seconds = 1 GPS hour
      const realTimePerGPSHour = secondsPerHour * 1000; // milliseconds
      const gpsTimePerRealTime = (60 * 60 * 1000) / realTimePerGPSHour; // GPS ms per real ms
      const elapsedGPSTime = elapsedRealTime * gpsTimePerRealTime;

      // Current GPS timestamp in the animation
      const targetGPSTimestamp = startGPSTimestamp + elapsedGPSTime;

      // Update timestamp for smooth interpolation
      setCurrentTimestamp(targetGPSTimestamp);
      pausedTimestampRef.current = targetGPSTimestamp;

      // Update index for compatibility
      const newIndex = findIndexByTimestamp(targetGPSTimestamp);
      setCurrentIndex(newIndex);
      pausedIndexRef.current = newIndex;

      // Check if we've reached the end
      if (targetGPSTimestamp >= endTime) {
        setIsPlaying(false);
        startTimeRef.current = null;
        setCurrentTimestamp(endTime);
      } else {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

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
    if (sortedPoints.length > 0) {
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

  // Center map on current position
  const centerOnCurrentPosition = () => {
    if (mapRef.current && currentPosition) {
      mapRef.current.setView(
        [currentPosition.latitude, currentPosition.longitude],
        mapRef.current.getZoom(),
        { animate: true, duration: 0.5 }
      );
    }
  };

  // Format time span
  const formatTimeSpan = (ms: number): string => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (sortedPoints.length === 0) {
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
      {/* Timeline Bar - Always at top, floating over map */}
      <div className="absolute top-0 left-0 right-0 z-[1000] px-4 py-3 bg-background/95 backdrop-blur-sm shadow-lg border-b">
        <div className="flex items-center gap-3">
          {/* Play/Pause/Reset Controls */}
          <div className="flex gap-2">
            {!isPlaying ? (
              <Button onClick={startAnimation} size="sm" className="h-9">
                <Play className="h-4 w-4 mr-1" />
                Abspielen
              </Button>
            ) : (
              <Button onClick={pauseAnimation} size="sm" variant="secondary" className="h-9">
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </Button>
            )}
            <Button onClick={resetAnimation} size="sm" variant="outline" className="h-9">
              <RotateCcw className="h-4 w-4 mr-1" />
              Zurück
            </Button>
            <Button onClick={centerOnCurrentPosition} size="sm" variant="outline" className="h-9" title="Zur aktuellen Position zentrieren">
              <MapPin className="h-4 w-4" />
            </Button>
          </div>

          {/* Timeline Slider with Time Labels */}
          <div className="flex-1 min-w-0">
            <div className="relative pb-4">
              {/* Stationary period backgrounds */}
              <div className="absolute w-full h-3 pointer-events-none">
                {sortedPoints.length > 0 && stationaryPeriods.map((period, idx) => {
                  const totalDuration = endTime - startTime;
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
                {(() => {
                  const hourMarkers: { position: number; time: Date }[] = [];
                  const startHour = new Date(startTime);
                  startHour.setMinutes(0, 0, 0);
                  let currentHour = new Date(startHour);
                  currentHour.setHours(currentHour.getHours() + 1);

                  while (currentHour.getTime() <= endTime) {
                    const position = ((currentHour.getTime() - startTime) / (endTime - startTime)) * 100;
                    hourMarkers.push({ position, time: new Date(currentHour) });
                    currentHour.setHours(currentHour.getHours() + 1);
                  }

                  return hourMarkers.map((marker, idx) => (
                    <div
                      key={idx}
                      className="absolute h-full border-l border-gray-400"
                      style={{ left: `${marker.position}%` }}
                      title={format(marker.time, 'HH:mm', { locale: de })}
                    />
                  ));
                })()}
              </div>

              <input
                type="range"
                min={startTime}
                max={endTime}
                value={currentTimestamp}
                onChange={(e) => handleScrub(Number(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer relative z-10"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((currentTimestamp - startTime) / (endTime - startTime)) * 100}%, #e5e7eb ${((currentTimestamp - startTime) / (endTime - startTime)) * 100}%, #e5e7eb 100%)`
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
          <div className="flex items-center gap-3">
            {currentPosition && (
              <span className="text-sm font-bold whitespace-nowrap font-mono tabular-nums">
                {format(new Date(currentPosition.timestamp), 'HH:mm:ss', { locale: de })}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <input
                type="range"
                min="1"
                max="30"
                value={secondsPerHour}
                onChange={(e) => setSecondsPerHour(Number(e.target.value))}
                className="w-20"
                title="Geschwindigkeit"
              />
              <span className="text-xs font-medium w-12 font-mono tabular-nums">{secondsPerHour}s/h</span>
            </div>
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
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={intelligentZoomEnabled}
                  onChange={(e) => setIntelligentZoomEnabled(e.target.checked)}
                  className="rounded"
                />
                <span>Auto-Zoom</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showFullRoute}
                  onChange={(e) => setShowFullRoute(e.target.checked)}
                  className="rounded"
                />
                <span>Gesamte Route</span>
              </label>
            </div>

            {/* Manual Zoom (when auto-zoom disabled) */}
            {!intelligentZoomEnabled && !isPlaying && (
              <div className="pt-2 border-t space-y-1">
                <label className="text-xs text-muted-foreground">Zoom-Stufe</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="10"
                    max="18"
                    value={zoomLevel}
                    onChange={(e) => setZoomLevel(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-8 font-mono tabular-nums">{zoomLevel}</span>
                </div>
              </div>
            )}
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
                  {format(new Date(sortedPoints[0].timestamp), 'HH:mm', { locale: de })}
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
                  {format(new Date(sortedPoints[sortedPoints.length - 1].timestamp), 'HH:mm', { locale: de })}
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

                    return (
                      <button
                        key={`break-${idx}`}
                        onClick={() => handleScrub(period.startTime)}
                        className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 rounded border border-orange-300 transition-colors font-mono tabular-nums"
                        title={`Zu Pause springen: ${startTimeStr} - ${endTimeStr}`}
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
        </div>
      </div>

      {/* Map Container - Full screen */}
      <div className="w-full h-full">
            <MapContainer
              center={[sortedPoints[0].latitude, sortedPoints[0].longitude]}
              zoom={zoomLevel}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Zoom Control - Bottom Left */}
              <ZoomControl position="bottomleft" />

              {/* Capture map reference */}
              <MapRefCapture mapRef={mapRef} />

              {/* Initial bounds setup (only on first load) */}
              <InitialBounds points={sortedPoints} />
              
              {/* Camera follows current position with intelligent panning */}
              <CameraFollow
                currentPosition={currentPosition}
                currentIndex={currentIndex}
                allPoints={sortedPoints}
                manualZoom={zoomLevel}
                isPlaying={isPlaying}
                intelligentZoomEnabled={intelligentZoomEnabled}
                secondsPerHour={secondsPerHour}
              />

              {/* Full Route (grayed out) - Multi-colored by source */}
              {showFullRoute && fullRouteSegments.map((segment, idx) => {
                const color = segment.source === 'followmee' ? '#9ca3af' : '#9ca3af'; // All gray for full route
                return (
                  <Polyline
                    key={`full-segment-${idx}`}
                    positions={segment.points}
                    color={color}
                    weight={3}
                    opacity={0.5}
                    dashArray="5, 5"
                  />
                );
              })}

              {/* Animated Route (colored by source) */}
              {animatedRouteSegments.map((segment, idx) => {
                // Black for FollowMee, Red for External, Blue for Native
                const color = segment.source === 'followmee' ? '#000000' : segment.source === 'external' ? '#ef4444' : '#3b82f6';
                return (
                  <Polyline
                    key={`animated-segment-${idx}`}
                    positions={segment.points}
                    color={color}
                    weight={4}
                    opacity={0.8}
                  />
                );
              })}

              {/* Start Marker */}
              {sortedPoints.length > 0 && (
                <Marker
                  position={[sortedPoints[0].latitude, sortedPoints[0].longitude]}
                  icon={createStartMarker()}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-bold">Start</p>
                      <p>{format(new Date(sortedPoints[0].timestamp), 'HH:mm:ss', { locale: de })}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* End Marker */}
              {sortedPoints.length > 1 && (
                <Marker
                  position={[
                    sortedPoints[sortedPoints.length - 1].latitude,
                    sortedPoints[sortedPoints.length - 1].longitude
                  ]}
                  icon={createEndMarker()}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-bold">Ende</p>
                      <p>{format(new Date(sortedPoints[sortedPoints.length - 1].timestamp), 'HH:mm:ss', { locale: de })}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Current Position Marker (animated) */}
              {currentPosition && currentIndex > 0 && currentIndex < sortedPoints.length - 1 && (
                <Marker
                  position={[currentPosition.latitude, currentPosition.longitude]}
                  icon={createAnimatedMarker()}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-bold">Aktuelle Position</p>
                      <p>{format(new Date(currentPosition.timestamp), 'HH:mm:ss', { locale: de })}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Genauigkeit: ±{Math.round(currentPosition.accuracy)}m
                      </p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Photo Flash Markers */}
              {activePhotoFlash !== null && photoPositions.map(photo => {
                if (photo.timestamp !== activePhotoFlash) return null;
                
                return (
                  <Marker
                    key={`photo-flash-${photo.timestamp}`}
                    position={photo.position}
                    icon={createPhotoFlashMarker()}
                    zIndexOffset={2000}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-bold">📸 Foto aufgenommen</p>
                        <p>{format(new Date(photo.timestamp), 'HH:mm:ss', { locale: de })}</p>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Clickable GPS Point Markers (only show every 5th point to avoid clutter) */}
              {sortedPoints
                .filter((_, index) => index % 5 === 0)
                .map((point, index) => (
                  <Marker
                    key={`gps-point-${index}`}
                    position={[point.latitude, point.longitude]}
                    icon={createGPSPointMarker(point.source)}
                    eventHandlers={{
                      click: () => {
                        window.open(getGoogleMapsUrl(point.latitude, point.longitude), '_blank');
                      }
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-bold">GPS-Punkt</p>
                        <p className="text-xs">{format(new Date(point.timestamp), 'HH:mm:ss', { locale: de })}</p>
                        <p className="text-xs mt-1">
                          {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
                        </p>
                        {point.source && (
                          <p className="text-xs mt-1 text-muted-foreground">
                            Quelle: {point.source === 'followmee' ? 'FollowMee' : point.source === 'external' ? 'Damians Tracking App' : 'Native App'}
                          </p>
                        )}
                        <button
                          onClick={() => window.open(getGoogleMapsUrl(point.latitude, point.longitude), '_blank')}
                          className="mt-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 w-full"
                        >
                          In Google Maps öffnen
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
            </MapContainer>
      </div>
    </div>
  );
}
