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
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Play, Pause, RotateCcw, Zap } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source?: 'native' | 'followmee';
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
const createGPSPointMarker = (source?: 'native' | 'followmee') => {
  // Native: Blue (#3b82f6), FollowMee: Black (#000000)
  const color = source === 'followmee' ? '#000000' : '#3b82f6';

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

// Detect stationary periods (20+ minutes within 20m radius)
function detectStationaryPeriods(points: GPSPoint[]): StationaryPeriod[] {
  const RADIUS_METERS = 20;
  const MIN_DURATION_MS = 20 * 60 * 1000; // 20 minutes
  const stationaryPeriods: StationaryPeriod[] = [];

  if (points.length < 2) return stationaryPeriods;

  let segmentStart = 0;

  for (let i = 1; i < points.length; i++) {
    const startPoint = points[segmentStart];
    const currentPoint = points[i];
    const distance = calculateDistance(startPoint, currentPoint);

    // If we've moved more than RADIUS_METERS, check if previous segment was stationary
    if (distance > RADIUS_METERS) {
      const duration = points[i - 1].timestamp - startPoint.timestamp;

      if (duration >= MIN_DURATION_MS) {
        // Calculate center point (average of all points in segment)
        let sumLat = 0;
        let sumLng = 0;
        const segmentPoints = points.slice(segmentStart, i);

        segmentPoints.forEach(p => {
          sumLat += p.latitude;
          sumLng += p.longitude;
        });

        stationaryPeriods.push({
          startIndex: segmentStart,
          endIndex: i - 1,
          startTime: startPoint.timestamp,
          endTime: points[i - 1].timestamp,
          durationMs: duration,
          centerLat: sumLat / segmentPoints.length,
          centerLng: sumLng / segmentPoints.length,
        });
      }

      segmentStart = i;
    }
  }

  // Check last segment
  const lastSegmentDuration = points[points.length - 1].timestamp - points[segmentStart].timestamp;
  if (lastSegmentDuration >= MIN_DURATION_MS) {
    let sumLat = 0;
    let sumLng = 0;
    const segmentPoints = points.slice(segmentStart);

    segmentPoints.forEach(p => {
      sumLat += p.latitude;
      sumLng += p.longitude;
    });

    stationaryPeriods.push({
      startIndex: segmentStart,
      endIndex: points.length - 1,
      startTime: points[segmentStart].timestamp,
      endTime: points[points.length - 1].timestamp,
      durationMs: lastSegmentDuration,
      centerLat: sumLat / segmentPoints.length,
      centerLng: sumLng / segmentPoints.length,
    });
  }

  return stationaryPeriods;
}

// Determine optimal zoom level based on upcoming movement
function calculateOptimalZoom(upcomingPoints: GPSPoint[]): number {
  if (upcomingPoints.length < 2) return 18;

  // Calculate total distance in upcoming segment
  let totalDistance = 0;
  for (let i = 0; i < upcomingPoints.length - 1; i++) {
    totalDistance += calculateDistance(upcomingPoints[i], upcomingPoints[i + 1]);
  }

  const avgDistance = totalDistance / (upcomingPoints.length - 1);

  // Zoom levels based on average distance between points
  // High zoom for walking/stationary (< 50m between points)
  if (avgDistance < 50) return 18;
  // Medium-high zoom for slow movement (50-150m)
  if (avgDistance < 150) return 17;
  // Medium zoom for moderate speed (150-300m)
  if (avgDistance < 300) return 16;
  // Lower zoom for fast movement (300-600m)
  if (avgDistance < 600) return 15;
  // Very low zoom for very fast movement (> 600m)
  return 14;
}

// Component to follow current position with intelligent panning and zoom
function CameraFollow({ currentPosition, currentIndex, allPoints, manualZoom, isPlaying, intelligentZoomEnabled }: {
  currentPosition: GPSPoint | null;
  currentIndex: number;
  allPoints: GPSPoint[];
  manualZoom: number;
  isPlaying: boolean;
  intelligentZoomEnabled: boolean;
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
    if (!lastPositionRef.current || !isPlaying) {
      const initialZoom = intelligentZoomEnabled ? 18 : manualZoom;
      map.setView([targetLat, targetLng], initialZoom, { animate: true, duration: 0.5 });
      lastPositionRef.current = currentPosition;
      currentZoomRef.current = initialZoom;
      lastZoomChangeRef.current = now;
      return;
    }

    if (!isPlaying) {
      lastPositionRef.current = currentPosition;
      return;
    }

    // Intelligent zoom calculation (only when enabled and playing)
    if (intelligentZoomEnabled) {
      // Check if 3 seconds have passed since last zoom change
      const timeSinceLastZoomChange = now - lastZoomChangeRef.current;

      if (timeSinceLastZoomChange >= 3000) {
        // Look ahead at upcoming points (next 10 points or until end)
        const lookaheadCount = 10;
        const upcomingPoints = allPoints.slice(currentIndex, Math.min(currentIndex + lookaheadCount, allPoints.length));

        if (upcomingPoints.length >= 2) {
          const optimalZoom = calculateOptimalZoom(upcomingPoints);

          // Only change zoom if significantly different (at least 1 level)
          if (Math.abs(currentZoomRef.current - optimalZoom) >= 1) {
            map.setZoom(optimalZoom, { animate: true });
            currentZoomRef.current = optimalZoom;
            lastZoomChangeRef.current = now;
            console.log(`[IntelligentZoom] Changed zoom to ${optimalZoom} at index ${currentIndex}`);
          }
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
  const [showFullRoute, setShowFullRoute] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(18);
  const [secondsPerHour, setSecondsPerHour] = useState(5); // Seconds to display one hour of data
  const [intelligentZoomEnabled, setIntelligentZoomEnabled] = useState(true); // Auto-zoom based on speed
  const [activePhotoFlash, setActivePhotoFlash] = useState<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedIndexRef = useRef<number>(0);

  // Sort GPS points by timestamp
  const sortedPoints = [...gpsPoints].sort((a, b) => a.timestamp - b.timestamp);

  // Detect stationary periods (20+ min in 20m radius)
  const stationaryPeriods = detectStationaryPeriods(sortedPoints);

  // Calculate animation duration based on time span of data
  const timeSpanMs = sortedPoints.length > 0
    ? sortedPoints[sortedPoints.length - 1].timestamp - sortedPoints[0].timestamp
    : 0;
  const timeSpanHours = timeSpanMs / (1000 * 60 * 60); // Convert to hours
  const ANIMATION_DURATION = timeSpanHours * secondsPerHour * 1000; // Total duration in ms

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

  // Current position for animation
  const currentPosition = sortedPoints[currentIndex];

  // Route up to current position
  const animatedRoute = sortedPoints.slice(0, currentIndex + 1);

  // Create polyline segments grouped by source for multi-colored route
  const createRouteSegments = (points: GPSPoint[]) => {
    const segments: { points: [number, number][]; source: 'native' | 'followmee' | 'unknown' }[] = [];

    if (points.length < 2) return segments;

    let currentSegment: [number, number][] = [[points[0].latitude, points[0].longitude]];
    let currentSource = points[0].source || 'native';

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const pointSource = point.source || 'native';

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
  const animatedRouteSegments = createRouteSegments(animatedRoute);

  // Manual scrubbing: Update position based on slider
  const handleScrub = (index: number) => {
    if (isPlaying) {
      pauseAnimation();
    }
    setCurrentIndex(index);
    pausedIndexRef.current = index;
  };

  // Start animation
  const startAnimation = () => {
    if (sortedPoints.length === 0) return;

    setIsPlaying(true);
    // Start from current position (useful for resume after scrub)
    const startIndex = currentIndex;
    const remainingPoints = sortedPoints.length - 1 - startIndex;
    const remainingProgress = remainingPoints / (sortedPoints.length - 1);
    
    startTimeRef.current = Date.now();

    const animate = () => {
      if (!startTimeRef.current) return;

      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(elapsed / (ANIMATION_DURATION * remainingProgress), 1);
      const newIndex = startIndex + Math.floor(progress * remainingPoints);

      setCurrentIndex(newIndex);
      pausedIndexRef.current = newIndex;

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIsPlaying(false);
        startTimeRef.current = null;
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
    setCurrentIndex(0);
    pausedIndexRef.current = 0;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

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
    <div className="h-full flex flex-col">
      {/* Compact Controls */}
      <div className="shrink-0 px-4 py-2 border-b bg-background">
        <CardContent className="p-0">
          <div className="flex items-center gap-4 flex-wrap mb-4">
            {/* Animation Controls */}
            <div className="flex gap-2">
              {!isPlaying ? (
                <Button onClick={startAnimation} size="sm">
                  <Play className="h-4 w-4 mr-2" />
                  Abspielen
                </Button>
              ) : (
                <Button onClick={pauseAnimation} size="sm" variant="secondary">
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
              <Button onClick={resetAnimation} size="sm" variant="outline">
                <RotateCcw className="h-4 w-4 mr-2" />
                Zurücksetzen
              </Button>
            </div>

            {/* Animation Speed Control */}
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground whitespace-nowrap">Geschwindigkeit:</span>
              <input
                type="range"
                min="1"
                max="30"
                value={secondsPerHour}
                onChange={(e) => setSecondsPerHour(Number(e.target.value))}
                className="w-24"
                title="Sekunden pro Stunde"
              />
              <span className="text-sm font-medium w-20">{secondsPerHour}s/h</span>
            </div>

            {/* Zoom Control (nur wenn intelligenter Zoom deaktiviert) */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Zoom:</span>
              <input
                type="range"
                min="10"
                max="18"
                value={zoomLevel}
                onChange={(e) => setZoomLevel(Number(e.target.value))}
                className="w-24"
                disabled={isPlaying || intelligentZoomEnabled}
                title={intelligentZoomEnabled ? "Zoom ist bei aktiviertem Auto-Zoom gesperrt" : isPlaying ? "Zoom ist während Wiedergabe gesperrt" : "Zoom-Stufe anpassen"}
              />
              <span className="text-sm font-medium w-8">{zoomLevel}</span>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-4 ml-auto">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={intelligentZoomEnabled}
                  onChange={(e) => setIntelligentZoomEnabled(e.target.checked)}
                  className="rounded"
                />
                Auto-Zoom
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showFullRoute}
                  onChange={(e) => setShowFullRoute(e.target.checked)}
                  className="rounded"
                />
                Gesamte Route
              </label>
            </div>
          </div>

          {/* Timeline Scrubber */}
          <div className="mb-4 space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Punkt {currentIndex + 1} von {sortedPoints.length}
              </span>
              {currentPosition && (
                <span>
                  {format(new Date(currentPosition.timestamp), 'HH:mm:ss', { locale: de })}
                </span>
              )}
            </div>

            {/* Interactive Timeline Slider with Hour Markers and Stationary Periods */}
            <div className="relative">
              {/* Stationary period backgrounds */}
              <div className="absolute w-full h-3 pointer-events-none">
                {sortedPoints.length > 0 && stationaryPeriods.map((period, idx) => {
                  const startTime = sortedPoints[0].timestamp;
                  const endTime = sortedPoints[sortedPoints.length - 1].timestamp;
                  const totalDuration = endTime - startTime;

                  const startPos = ((period.startTime - startTime) / totalDuration) * 100;
                  const endPos = ((period.endTime - startTime) / totalDuration) * 100;
                  const width = endPos - startPos;

                  const durationMinutes = Math.round(period.durationMs / (1000 * 60));

                  return (
                    <div
                      key={`stationary-${idx}`}
                      className="absolute h-full bg-orange-300 opacity-50"
                      style={{ left: `${startPos}%`, width: `${width}%` }}
                      title={`Pause: ${durationMinutes} Min`}
                    />
                  );
                })}
              </div>

              {/* Hour marker ticks */}
              <div className="absolute w-full h-3 pointer-events-none">
                {(() => {
                  const startTime = sortedPoints[0].timestamp;
                  const endTime = sortedPoints[sortedPoints.length - 1].timestamp;
                  const totalDuration = endTime - startTime;

                  // Generate hour markers
                  const hourMarkers: { position: number; time: Date }[] = [];
                  const startHour = new Date(startTime);
                  startHour.setMinutes(0, 0, 0); // Round down to hour

                  let currentHour = new Date(startHour);
                  currentHour.setHours(currentHour.getHours() + 1); // Start from next hour

                  while (currentHour.getTime() <= endTime) {
                    const position = ((currentHour.getTime() - startTime) / totalDuration) * 100;
                    hourMarkers.push({ position, time: new Date(currentHour) });
                    currentHour.setHours(currentHour.getHours() + 1);
                  }

                  return hourMarkers.map((marker, idx) => (
                    <div
                      key={idx}
                      className="absolute h-full border-l-2 border-gray-400"
                      style={{ left: `${marker.position}%` }}
                      title={format(marker.time, 'HH:mm', { locale: de })}
                    />
                  ));
                })()}
              </div>

              <input
                type="range"
                min="0"
                max={sortedPoints.length - 1}
                value={currentIndex}
                onChange={(e) => handleScrub(Number(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer relative z-10"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentIndex / (sortedPoints.length - 1)) * 100}%, #e5e7eb ${(currentIndex / (sortedPoints.length - 1)) * 100}%, #e5e7eb 100%)`
                }}
              />
            </div>

            {/* Hour labels below timeline */}
            <div className="relative h-4">
              {(() => {
                const startTime = sortedPoints[0].timestamp;
                const endTime = sortedPoints[sortedPoints.length - 1].timestamp;
                const totalDuration = endTime - startTime;

                // Generate hour markers
                const hourMarkers: { position: number; time: Date }[] = [];

                // Add start marker
                hourMarkers.push({ position: 0, time: new Date(startTime) });

                const startHour = new Date(startTime);
                startHour.setMinutes(0, 0, 0); // Round down to hour

                let currentHour = new Date(startHour);
                currentHour.setHours(currentHour.getHours() + 1); // Start from next hour

                while (currentHour.getTime() <= endTime) {
                  const position = ((currentHour.getTime() - startTime) / totalDuration) * 100;
                  hourMarkers.push({ position, time: new Date(currentHour) });
                  currentHour.setHours(currentHour.getHours() + 1);
                }

                // Add end marker
                hourMarkers.push({ position: 100, time: new Date(endTime) });

                return hourMarkers.map((marker, idx) => (
                  <span
                    key={idx}
                    className="absolute text-xs text-muted-foreground transform -translate-x-1/2"
                    style={{ left: `${marker.position}%` }}
                  >
                    {format(marker.time, 'HH:mm', { locale: de })}
                  </span>
                ));
              })()}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Start</p>
              <p className="font-medium">
                {format(new Date(sortedPoints[0].timestamp), 'HH:mm', { locale: de })}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Aktuell</p>
              <p className="font-medium">
                {currentPosition ? format(new Date(currentPosition.timestamp), 'HH:mm', { locale: de }) : '-'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Ende</p>
              <p className="font-medium">
                {format(new Date(sortedPoints[sortedPoints.length - 1].timestamp), 'HH:mm', { locale: de })}
              </p>
            </div>
          </div>

          {/* Breaks / Stationary Periods */}
          {stationaryPeriods.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Pausen (≥20 Min): {stationaryPeriods.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {stationaryPeriods.map((period, idx) => {
                  const durationMinutes = Math.round(period.durationMs / (1000 * 60));
                  const startTime = format(new Date(period.startTime), 'HH:mm', { locale: de });
                  const endTime = format(new Date(period.endTime), 'HH:mm', { locale: de });

                  return (
                    <button
                      key={`break-${idx}`}
                      onClick={() => {
                        handleScrub(period.startIndex);
                      }}
                      className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 rounded border border-orange-300 transition-colors"
                      title={`Zu Pause springen: ${startTime} - ${endTime}`}
                    >
                      {startTime} ({durationMinutes} Min)
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* GPS Source Legend */}
          <div className="mt-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">GPS-Quellen:</p>
            <div className="flex gap-3 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-[#3b82f6] border border-white shadow-sm"></div>
                <span>Native App</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-[#000000] border border-white shadow-sm"></div>
                <span>FollowMee</span>
              </div>
            </div>
          </div>
        </CardContent>
      </div>

      {/* Map - Full Height */}
      <div className="flex-1 overflow-hidden relative">
            <MapContainer
              center={[sortedPoints[0].latitude, sortedPoints[0].longitude]}
              zoom={zoomLevel}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
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
                const color = segment.source === 'followmee' ? '#000000' : '#3b82f6'; // Black for FollowMee, Blue for Native
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
                            Quelle: {point.source === 'followmee' ? 'FollowMee' : 'Native App'}
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
