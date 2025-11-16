import fs from "fs/promises";
import path from "path";
import { format } from "date-fns";
import { googleDriveSyncService } from "./googleDriveSyncService";

const EARTH_RADIUS_METERS = 6371e3;
const MIN_GAP_METERS = 50;
const MAX_SNAP_POINTS = 100;
const INTERPOLATION_STEP_METERS = 25;

interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source?: "native" | "followmee" | "external";
}

interface SnappedPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  source?: "native" | "followmee" | "external";
  placeId?: string;
}

interface SnappedSegment {
  segmentId: string;
  startTimestamp: number;
  endTimestamp: number;
  distanceMeters: number;
  points: SnappedPoint[];
  createdAt: number;
  updatedAt: number;
}

interface CachedRoute {
  userId: string;
  date: string;
  source: "all" | "native" | "followmee" | "external";
  lastProcessedTimestamp: number;
  segments: Record<string, SnappedSegment>;
  totalApiCallsUsed: number;
  totalCostCents: number;
  createdAt: number;
  updatedAt: number;
}

interface MonthlyCache {
  month: string;
  routes: CachedRoute[];
}

interface GapSegment {
  segmentId: string;
  start: GPSPoint;
  end: GPSPoint;
  distanceMeters: number;
}

interface ExternalGapSegment {
  start?: GPSPoint;
  end?: GPSPoint;
}

class GoogleRoadsService {
  private apiKey: string;
  private cacheDir: string;
  private currentCache: MonthlyCache | null = null;
  private cacheModified = false;

  private readonly COST_PER_REQUEST = 0.5; // 0.5 ct per segment snap

  constructor() {
    this.apiKey = process.env.GOOGLE_GEOCODING_API_KEY || "";
    this.cacheDir = path.join(process.cwd(), "data", "snapped-routes-cache");

    if (!this.apiKey) {
      console.warn("[GoogleRoadsService] Warning: GOOGLE_GEOCODING_API_KEY not set");
    }
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const currentMonth = format(new Date(), "yyyy-MM");
      await this.loadMonthCache(currentMonth);
      console.log(`[GoogleRoadsService] Initialized with cache for ${currentMonth}`);
    } catch (error) {
      console.error("[GoogleRoadsService] Error during initialization:", error);
    }
  }

  private async loadMonthCache(month: string): Promise<void> {
    const cacheFile = path.join(this.cacheDir, `${month}.json`);

    try {
      const data = await fs.readFile(cacheFile, "utf-8");
      this.currentCache = JSON.parse(data);
      console.log(
        `[GoogleRoadsService] Loaded cache for ${month} with ${
          this.currentCache?.routes.length || 0
        } routes`
      );
    } catch (error: any) {
      if (error.code === "ENOENT") {
        if (googleDriveSyncService.isReady()) {
          try {
            const remoteContent = await googleDriveSyncService.loadCacheFromDrive(`${month}.json`);
            if (remoteContent) {
              this.currentCache = JSON.parse(remoteContent);
              console.log(`[GoogleRoadsService] Downloaded cache for ${month} from Drive`);
              return;
            }
          } catch (driveError) {
            console.warn("[GoogleRoadsService] Could not load cache from Drive:", driveError);
          }
        }

        this.currentCache = { month, routes: [] };
        console.log(`[GoogleRoadsService] Created new cache for ${month}`);
      } else {
        console.error("[GoogleRoadsService] Error loading cache:", error);
        this.currentCache = { month, routes: [] };
      }
    }
  }

  async saveCache(): Promise<void> {
    if (!this.currentCache || !this.cacheModified) {
      return;
    }

    const cacheFile = path.join(this.cacheDir, `${this.currentCache.month}.json`);

    try {
      await fs.writeFile(cacheFile, JSON.stringify(this.currentCache, null, 2), "utf-8");
      this.cacheModified = false;
      console.log(`[GoogleRoadsService] Saved cache for ${this.currentCache.month}`);

      if (googleDriveSyncService.isReady()) {
        try {
          await googleDriveSyncService.syncFileNow(`${this.currentCache.month}.json`);
        } catch (driveError) {
          console.warn("[GoogleRoadsService] Could not sync cache file to Drive:", driveError);
        }
      }
    } catch (error) {
      console.error("[GoogleRoadsService] Error saving cache:", error);
    }
  }

  private findCachedRoute(userId: string, date: string, source: string): CachedRoute | null {
    if (!this.currentCache) return null;
    return this.currentCache.routes.find(
      (route) => route.userId === userId && route.date === date && route.source === source
    ) || null;
  }

  private getOrCreateRoute(
    userId: string,
    date: string,
    source: "all" | "native" | "followmee" | "external"
  ): CachedRoute {
    if (!this.currentCache) {
      const month = format(new Date(date), "yyyy-MM");
      this.currentCache = { month, routes: [] };
    }

    let route = this.findCachedRoute(userId, date, source);
    if (!route) {
      route = {
        userId,
        date,
        source,
        lastProcessedTimestamp: 0,
        segments: {},
        totalApiCallsUsed: 0,
        totalCostCents: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.currentCache.routes.push(route);
    }

    return route;
  }

  private calculateDistance(a: GPSPoint, b: GPSPoint): number {
    const lat1 = (a.latitude * Math.PI) / 180;
    const lat2 = (b.latitude * Math.PI) / 180;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;

    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);

    const aa =
      sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return EARTH_RADIUS_METERS * c;
  }

  private computeGapSegments(points: GPSPoint[]): GapSegment[] {
    const segments: GapSegment[] = [];

    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1];
      const end = points[i];
      const distance = this.calculateDistance(start, end);

      if (distance >= MIN_GAP_METERS) {
        segments.push({
          segmentId: this.buildSegmentId(start, end),
          start,
          end,
          distanceMeters: distance,
        });
      }
    }

    return segments;
  }
  private buildInterpolatedSegmentPoints(start: GPSPoint, end: GPSPoint): GPSPoint[] {
    const distance = this.calculateDistance(start, end);
    if (!Number.isFinite(distance) || distance === 0) {
      return [start, end];
    }

    // For Google Roads API, we want to keep it simple: just start and end points
    // The API will interpolate for us when interpolate=true is set
    // Too many interpolated points can cause 404 errors
    return [start, end];
  }

  private normalizeOverrideSegments(segments?: ExternalGapSegment[]): GapSegment[] {
    if (!segments || segments.length === 0) {
      return [];
    }

    const normalized: GapSegment[] = [];
    for (const segment of segments) {
      if (!segment?.start || !segment?.end) {
        continue;
      }

      if (
        typeof segment.start.latitude !== "number" ||
        typeof segment.start.longitude !== "number" ||
        typeof segment.start.timestamp !== "number" ||
        typeof segment.end.latitude !== "number" ||
        typeof segment.end.longitude !== "number" ||
        typeof segment.end.timestamp !== "number"
      ) {
        continue;
      }

      const distanceMeters = this.calculateDistance(segment.start, segment.end);
      if (!Number.isFinite(distanceMeters) || distanceMeters < MIN_GAP_METERS) {
        continue;
      }

      normalized.push({
        segmentId: this.buildSegmentId(segment.start, segment.end),
        start: segment.start,
        end: segment.end,
        distanceMeters,
      });
    }

    return normalized.sort((a, b) => a.start.timestamp - b.start.timestamp);
  }

  private buildSegmentId(start: GPSPoint, end: GPSPoint): string {
    return `${start.timestamp}-${end.timestamp}`;
  }

  async snapToRoads(
    userId: string,
    date: string,
    points: GPSPoint[],
    source: "all" | "native" | "followmee" | "external" = "all",
    overrideSegments?: ExternalGapSegment[]
  ) {
    const manualSegments = this.normalizeOverrideSegments(overrideSegments);

    const sourcePoints =
      points.length > 0
        ? points
        : manualSegments.flatMap((segment) => [segment.start, segment.end]);

    if (sourcePoints.length < 2 && manualSegments.length === 0) {
      return {
        snappedSegments: [],
        segmentCount: 0,
        apiCallsUsed: 0,
        costCents: 0,
        fromCache: true,
        cacheHitRatio: 1,
        totalSegments: 0,
        cachedSegments: 0,
      };
    }

    const sortedPoints = [...sourcePoints].sort((a, b) => a.timestamp - b.timestamp);
    const segmentsToProcess =
      manualSegments.length > 0 ? manualSegments : this.computeGapSegments(sortedPoints);

    if (segmentsToProcess.length === 0) {
      return {
        snappedSegments: [],
        segmentCount: 0,
        apiCallsUsed: 0,
        costCents: 0,
        fromCache: true,
        cacheHitRatio: 1,
        totalSegments: 0,
        cachedSegments: 0,
      };
    }

    const route = this.getOrCreateRoute(userId, date, source);
    const snappedSegments: SnappedSegment[] = [];
    let apiCallsUsed = 0;
    let cachedSegments = 0;

    // Separate cached and uncached segments
    const uncachedSegments: GapSegment[] = [];
    for (const segment of segmentsToProcess) {
      const cached = route.segments[segment.segmentId];
      if (cached) {
        snappedSegments.push(cached);
        cachedSegments++;
      } else {
        uncachedSegments.push(segment);
      }
    }

    // If we have uncached segments, batch them into API calls (100 points max per call)
    if (uncachedSegments.length > 0) {
      try {
        // Build array with ALL gap endpoints: A, B, D, E, etc.
        const allGapPoints: GPSPoint[] = [];
        const segmentPointMapping: Array<{ segment: GapSegment; startIdx: number; endIdx: number }> = [];

        for (const segment of uncachedSegments) {
          const startIdx = allGapPoints.length;
          allGapPoints.push(segment.start);
          allGapPoints.push(segment.end);
          const endIdx = allGapPoints.length - 1;
          segmentPointMapping.push({ segment, startIdx, endIdx });
        }

        // Google Roads API accepts max 100 points per call
        // Split into batches if needed
        const batches: GPSPoint[][] = [];
        const batchSize = 100;
        for (let i = 0; i < allGapPoints.length; i += batchSize) {
          batches.push(allGapPoints.slice(i, i + batchSize));
        }

        console.log(
          `[GoogleRoadsService] Processing ${allGapPoints.length} points (${uncachedSegments.length} segments) in ${batches.length} API call(s)`
        );

        // Make API calls for each batch
        const allSnappedPoints: SnappedPoint[] = [];
        for (const batch of batches) {
          const batchSnapped = await this.callGoogleRoadsAPI(batch);
          allSnappedPoints.push(...batchSnapped);
        }

        apiCallsUsed = batches.length;

        // Now split the snapped points back into segments
        for (const mapping of segmentPointMapping) {
          // Extract snapped points for this segment (between startIdx and endIdx)
          const segmentSnappedPoints = allSnappedPoints.filter(
            (sp) =>
              sp.timestamp >= mapping.segment.start.timestamp &&
              sp.timestamp <= mapping.segment.end.timestamp
          );

          // If we didn't get any snapped points for this segment, use originals
          const finalPoints =
            segmentSnappedPoints.length > 0
              ? segmentSnappedPoints
              : [
                  {
                    latitude: mapping.segment.start.latitude,
                    longitude: mapping.segment.start.longitude,
                    timestamp: mapping.segment.start.timestamp,
                    source: mapping.segment.start.source,
                  },
                  {
                    latitude: mapping.segment.end.latitude,
                    longitude: mapping.segment.end.longitude,
                    timestamp: mapping.segment.end.timestamp,
                    source: mapping.segment.end.source,
                  },
                ];

          const entry: SnappedSegment = {
            segmentId: mapping.segment.segmentId,
            startTimestamp: mapping.segment.start.timestamp,
            endTimestamp: mapping.segment.end.timestamp,
            distanceMeters: mapping.segment.distanceMeters,
            points: finalPoints,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          route.segments[mapping.segment.segmentId] = entry;
          snappedSegments.push(entry);
        }
      } catch (error) {
        console.error("[GoogleRoadsService] Error snapping segments:", error);
        // Fallback: create segments with straight lines
        for (const segment of uncachedSegments) {
          snappedSegments.push({
            segmentId: segment.segmentId,
            startTimestamp: segment.start.timestamp,
            endTimestamp: segment.end.timestamp,
            distanceMeters: segment.distanceMeters,
            points: [
              {
                latitude: segment.start.latitude,
                longitude: segment.start.longitude,
                timestamp: segment.start.timestamp,
                source: segment.start.source,
              },
              {
                latitude: segment.end.latitude,
                longitude: segment.end.longitude,
                timestamp: segment.end.timestamp,
                source: segment.end.source,
              },
            ],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    }

    const costCents = apiCallsUsed * this.COST_PER_REQUEST;

    route.totalApiCallsUsed += apiCallsUsed;
    route.totalCostCents += costCents;
    route.lastProcessedTimestamp = sortedPoints[sortedPoints.length - 1].timestamp;
    route.updatedAt = Date.now();
    this.cacheModified = true;

    console.log(
      `[GoogleRoadsService] Snapped ${segmentsToProcess.length} segments (${cachedSegments} cached, ${
        segmentsToProcess.length - cachedSegments
      } new) – Cost: ${costCents.toFixed(2)} ct`
    );

    return {
      snappedSegments: snappedSegments.sort((a, b) => a.startTimestamp - b.startTimestamp),
      segmentCount: snappedSegments.length,
      apiCallsUsed,
      costCents,
      fromCache: apiCallsUsed === 0,
      cacheHitRatio:
        segmentsToProcess.length === 0 ? 1 : cachedSegments / segmentsToProcess.length,
      totalSegments: segmentsToProcess.length,
      cachedSegments,
    };
  }

  private async callGoogleRoadsAPI(points: GPSPoint[]): Promise<SnappedPoint[]> {
    if (!this.apiKey) {
      throw new Error("GOOGLE_GEOCODING_API_KEY not configured");
    }

    if (points.length === 0) {
      return [];
    }

    // Validate points before sending
    const validPoints = points.filter(p =>
      typeof p.latitude === 'number' &&
      typeof p.longitude === 'number' &&
      !isNaN(p.latitude) &&
      !isNaN(p.longitude) &&
      p.latitude >= -90 && p.latitude <= 90 &&
      p.longitude >= -180 && p.longitude <= 180
    );

    if (validPoints.length < 2) {
      console.warn("[GoogleRoadsService] Not enough valid points for API call");
      return points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
        source: point.source,
      }));
    }

    // Google Roads API expects coordinates without URL encoding for the pipe separator
    const pathParam = validPoints.map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`).join("|");
    const url = `https://roads.googleapis.com/v1/snapToRoads?path=${pathParam}&interpolate=true&key=${this.apiKey}`;

    console.log(`[GoogleRoadsService] Calling API with ${validPoints.length} points`);

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      console.error(`[GoogleRoadsService] API error response: ${text}`);
      throw new Error(`Google Roads API error: ${response.status} – ${text}`);
    }

    const data = await response.json();
    if (!data.snappedPoints || data.snappedPoints.length === 0) {
      console.warn("[GoogleRoadsService] No snapped points returned, using original points");
      return validPoints.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
        source: point.source,
      }));
    }

    return data.snappedPoints.map((snapped: any) => {
      const originalIndex = snapped.originalIndex ?? 0;
      const originalPoint = validPoints[originalIndex] || validPoints[0];
      return {
        latitude: snapped.location.latitude,
        longitude: snapped.location.longitude,
        timestamp: originalPoint.timestamp,
        source: originalPoint.source,
        placeId: snapped.placeId,
      };
    });
  }

  calculateCost(segmentCount: number): { requests: number; costCents: number } {
    const requests = Math.max(0, Math.ceil(segmentCount));
    const costCents = requests * this.COST_PER_REQUEST;
    return { requests, costCents };
  }

  getCacheInfo(
    userId: string,
    date: string,
    source: string
  ): {
    cached: boolean;
    cachedPointCount: number;
    cachedSegmentCount: number;
    lastProcessedTimestamp: number | null;
    apiCallsUsed: number;
    costCents: number;
    segmentKeys: string[];
  } {
    const route = this.findCachedRoute(userId, date, source) || null;

    if (!route) {
      return {
        cached: false,
        cachedPointCount: 0,
        cachedSegmentCount: 0,
        lastProcessedTimestamp: null,
        apiCallsUsed: 0,
        costCents: 0,
        segmentKeys: [],
      };
    }

    const keys = Object.keys(route.segments);
    return {
      cached: keys.length > 0,
      cachedPointCount: keys.length * 2,
      cachedSegmentCount: keys.length,
      lastProcessedTimestamp: route.lastProcessedTimestamp || null,
      apiCallsUsed: route.totalApiCallsUsed,
      costCents: route.totalCostCents,
      segmentKeys: keys,
    };
  }
}

export const googleRoadsService = new GoogleRoadsService();
