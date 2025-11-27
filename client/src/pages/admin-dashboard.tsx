/**
 * Admin Dashboard Page
 * 
 * Live & Historical View:
 * - Leaflet Map mit User-Markern
 * - User-Vergleichstabelle (sortierbar)
 * - Status-Changes Chart
 * - Finale Status-Zuordnungen Chart
 * - Conversion Rates Anzeige
 * - PDF-Report Download
 */

import { useState, useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Download, RefreshCw, Users, Activity, MapPin, Calendar, Route, LogOut, FileText } from 'lucide-react';
import RouteReplayMap from '../components/RouteReplayMap';

// Fix Leaflet default icon issue with Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom colored marker icon (unified color)
const createColoredIcon = (color: string = '#3b82f6') => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: ${color};
        width: 25px;
        height: 25px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      "></div>
    `,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

interface DashboardUser {
  userId: string;
  username: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  };
  isActive: boolean;
  lastSeen: number;
  todayStats: {
    totalActions: number;
    actionDetails?: {
      scans: number;
      ocrCorrections: number;
      datasetCreates: number;
      geocodes: number;
      edits: number;
      saves: number;
      deletes: number;
      statusChanges: number;
      navigations: number;
      other: number;
    };
    statusChanges: Record<string, number>;
    finalStatuses: Record<string, number>; // Final status assignments for the day
    conversionRates: { // Conversion rates from 'interest_later' to other statuses
      interest_later_to_written?: number;
      interest_later_to_no_interest?: number;
      interest_later_to_appointment?: number;
      interest_later_to_not_reached?: number;
      interest_later_total?: number; // Total 'interest_later' changes
    };
    activeTime: number;
    distance: number;
    uniquePhotos: number; // Deduplicated photo count
    peakTime?: string; // e.g., "13:00-15:00"
    egonContracts?: number; // Number of contracts from EGON database
    breaks?: Array<{
      start: number;
      end: number;
      duration: number;
      locations?: Array<{
        poi_name: string;
        poi_type: string;
        address: string;
        place_id: string;
        durationAtLocation?: number;
      }>;
      isCustomerConversation?: boolean;
      contractsInBreak?: number[];
    }>;
  };
}

interface DashboardData {
  timestamp: number;
  users: DashboardUser[];
  date?: string;
  totalUsers?: number;
  activeUsers?: number;
  totalStatusChanges?: number;
  totalDistance?: number;
}

// Map component that auto-fits bounds
function MapBounds({ users }: { users: DashboardUser[] }) {
  const map = useMap();

  useEffect(() => {
    if (users.length === 0) return;

    const bounds = L.latLngBounds(
      users
        .filter(u => u.currentLocation)
        .map(u => [u.currentLocation!.latitude, u.currentLocation!.longitude])
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [users, map]);

  return null;
}

export default function AdminDashboard() {
  const { isAdmin, logout } = useAuth();
  const [mode, setMode] = useState<'live' | 'historical'>('live');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Helper: Get last weekday (skip weekends)
  const getLastWeekday = (daysBack: number = 1): string => {
    const date = new Date();
    let count = 0;
    
    while (count < daysBack) {
      date.setDate(date.getDate() - 1);
      const dayOfWeek = date.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++;
      }
    }
    
    return format(date, 'yyyy-MM-dd');
  };
  
  const [selectedDate, setSelectedDate] = useState<string>(getLastWeekday(1)); // Auto-select last weekday
  const [sortBy, setSortBy] = useState<'actions' | 'statusChanges' | 'written'>('actions');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [generatingReport, setGeneratingReport] = useState(false);
  
  // Expanded rows state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Expanded dataset updates state (nested expansion)
  const [expandedDatasetUpdates, setExpandedDatasetUpdates] = useState<Set<string>>(new Set());
  
  // Route Replay state
  const [showRouteReplay, setShowRouteReplay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [gpsSource, setGpsSource] = useState<'all' | 'native' | 'followmee' | 'external' | 'external_app'>('all');

  // Lock background scroll while the route modal is open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!showRouteReplay) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showRouteReplay]);

  // Redirect if not admin
  useEffect(() => {
    if (isAdmin === false) {
      window.location.href = '/';
    }
  }, [isAdmin]);

  // Fetch live data
  const fetchLiveData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/dashboard/live', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch live data');
      }

      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch live data');
      console.error('Error fetching live data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch historical data
  const fetchHistoricalData = async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/dashboard/historical?date=${date}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch historical data');
      }

      const result = await response.json();
      
      // DEBUG: Log Raphael's data
      const raphaelUser = result.users?.find((u: any) => u.username === 'Raphael');
      if (raphaelUser) {
        console.log(`[Frontend] 📦 Raphael data received for ${date}:`, {
          username: raphaelUser.username,
          totalActions: raphaelUser.todayStats.totalActions,
          uniquePhotos: raphaelUser.todayStats.uniquePhotos,
          statusChangesCount: Object.keys(raphaelUser.todayStats.statusChanges || {}).length
        });
        console.log(`[Frontend] 🔍 FULL todayStats for Raphael:`, raphaelUser.todayStats);
        console.log(`[Frontend] 🔍 uniquePhotos type: ${typeof raphaelUser.todayStats.uniquePhotos}, value: ${raphaelUser.todayStats.uniquePhotos}`);
      }
      
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch historical data');
      console.error('Error fetching historical data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Download PDF report
  const downloadReport = async (date: string) => {
    try {
      const response = await fetch(`/api/admin/reports/${date}/download`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Report not found for this date');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-report-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(err.message || 'Failed to download report');
    }
  };

  // Generate daily report (partial or final)
  const generateDailyReport = async () => {
    setGeneratingReport(true);
    try {
      const date = mode === 'live' ? format(new Date(), 'yyyy-MM-dd') : selectedDate;
      const isPartial = mode === 'live'; // Live = partial, Historical = final

      const response = await fetch('/api/admin/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date, isPartial }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate report');
      }

      const result = await response.json();
      alert(`✅ ${result.message}\n\nDatum: ${result.date}\nTyp: ${result.isPartial ? 'Zwischenbericht' : 'Abschlussbericht'}`);
    } catch (err: any) {
      alert(`❌ Fehler beim Erstellen des Berichts:\n${err.message}`);
      console.error('Error generating report:', err);
    } finally {
      setGeneratingReport(false);
    }
  };

  // Fetch route data for selected user
  const fetchRouteData = async (userId: string, date: string, source?: 'all' | 'native' | 'followmee' | 'external' | 'external_app') => {
    setLoadingRoute(true);
    try {
      const sourceParam = source && source !== 'all' ? `&source=${source}` : '';
      const response = await fetch(
        `/api/admin/dashboard/route?userId=${userId}&date=${date}${sourceParam}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch route data');
      }

      const result = await response.json();

      // SAFETY FILTER: Filter out points that don't match the selected date
      // This prevents old data (e.g. from FollowMee cache issues) from appearing in the route
      if (result.gpsPoints && Array.isArray(result.gpsPoints)) {
        const targetDate = date;
        const originalCount = result.gpsPoints.length;
        
        result.gpsPoints = result.gpsPoints.filter((point: any) => {
          // Use date-fns format to ensure consistent local date comparison
          const pointDate = format(new Date(point.timestamp), 'yyyy-MM-dd');
          return pointDate === targetDate;
        });

        if (result.gpsPoints.length < originalCount) {
          console.log(`[Frontend] Filtered ${originalCount - result.gpsPoints.length} points from wrong date (Target: ${targetDate})`);
        }

        // Update total points count
        if (result.totalPoints !== undefined) {
          result.totalPoints = result.gpsPoints.length;
        }
      }

      setRouteData(result);

    } catch (err: any) {
      alert(err.message || 'Failed to fetch route data');
      console.error('Error fetching route data:', err);
      setRouteData(null);
    } finally {
      setLoadingRoute(false);
    }
  };

  // Handle show route for user
  const handleShowRoute = (userId: string, username: string) => {
    setSelectedUserId(userId);
    setSelectedUsername(username);
    setShowRouteReplay(true);
    fetchRouteData(userId, mode === 'live' ? format(new Date(), 'yyyy-MM-dd') : selectedDate, gpsSource);
  };

  // Handle GPS source change
  const handleGpsSourceChange = (newSource: 'all' | 'native' | 'followmee' | 'external' | 'external_app') => {
    setGpsSource(newSource);
    // Re-fetch route data if modal is open
    if (showRouteReplay && selectedUserId) {
      fetchRouteData(selectedUserId, mode === 'live' ? format(new Date(), 'yyyy-MM-dd') : selectedDate, newSource);
    }
  };

  // Initial data fetch
  useEffect(() => {
    if (mode === 'live') {
      fetchLiveData();
      // Auto-refresh every 30 seconds
      const interval = setInterval(fetchLiveData, 30000);
      return () => clearInterval(interval);
    } else {
      fetchHistoricalData(selectedDate);
    }
  }, [mode, selectedDate]);

  // Sort users
  const sortedUsers = data?.users ? [...data.users].sort((a, b) => {
    let aValue: number, bValue: number;

    switch (sortBy) {
      case 'actions':
        aValue = a.todayStats.totalActions;
        bValue = b.todayStats.totalActions;
        break;
      case 'statusChanges':
        // Sum all status changes
        aValue = Object.values(a.todayStats.statusChanges || {}).reduce((sum: number, count) => sum + (count as number), 0);
        bValue = Object.values(b.todayStats.statusChanges || {}).reduce((sum: number, count) => sum + (count as number), 0);
        break;
      case 'written':
        aValue = a.todayStats.finalStatuses?.['written'] || 0;
        bValue = b.todayStats.finalStatuses?.['written'] || 0;
        break;
      default:
        return 0;
    }

    return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
  }) : [];

  // Prepare chart data for status changes
  // Note: 'geschrieben' comes from EGON contracts, not from status changes
  const chartData = sortedUsers.map(user => {
    const statusChanges = user.todayStats.statusChanges || {};
    
    return {
      name: user.username,
      interessiert: (statusChanges['interessiert'] || 0) + (statusChanges['interest_later'] || 0),
      nicht_interessiert: (statusChanges['nicht_interessiert'] || 0) + (statusChanges['no_interest'] || 0),
      nicht_angetroffen: (statusChanges['nicht_angetroffen'] || 0) + (statusChanges['not_reached'] || 0),
      termin_vereinbart: (statusChanges['termin_vereinbart'] || 0) + (statusChanges['appointment'] || 0),
      geschrieben: user.todayStats.egonContracts || 0, // From EGON database
    };
  });

  // Prepare chart data for final statuses (status assignments that remain at end of day)
  // Note: 'geschrieben' comes from EGON contracts, not from final statuses
  const finalStatusChartData = sortedUsers.map(user => {
    const finalStatuses = user.todayStats.finalStatuses || {};
    
    return {
      name: user.username,
      interessiert: (finalStatuses['interessiert'] || 0) + (finalStatuses['interest_later'] || 0),
      nicht_interessiert: (finalStatuses['nicht_interessiert'] || 0) + (finalStatuses['no_interest'] || 0),
      nicht_angetroffen: (finalStatuses['nicht_angetroffen'] || 0) + (finalStatuses['not_reached'] || 0),
      termin_vereinbart: (finalStatuses['termin_vereinbart'] || 0) + (finalStatuses['appointment'] || 0),
      geschrieben: user.todayStats.egonContracts || 0, // From EGON database
    };
  });

  // Format duration
  const formatDuration = (ms: number): string => {
    // -1 indicates "App not used" (no native GPS data)
    if (ms === -1) {
      return 'App nicht genutzt';
    }
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  // Format distance
  const formatDistance = (meters: number): string => {
    return `${(meters / 1000).toFixed(2)} km`;
  };

  // Toggle expanded row
  const toggleExpandRow = (userId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedRows(newExpanded);
  };

  // Toggle expanded dataset updates (nested)
  const toggleExpandDatasetUpdates = (userId: string) => {
    const newExpanded = new Set(expandedDatasetUpdates);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedDatasetUpdates(newExpanded);
  };

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return null; // Redirect will happen
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Mitarbeiter-Tracking und Aktivitätsanalyse
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => mode === 'live' ? fetchLiveData() : fetchHistoricalData(selectedDate)}
            disabled={loading}
            title="Aktualisieren"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            onClick={generateDailyReport}
            disabled={generatingReport}
            className="gap-2"
            title={mode === 'live' ? 'Zwischenbericht erstellen' : 'Abschlussbericht erstellen'}
          >
            <FileText className={`h-4 w-4 ${generatingReport ? 'animate-pulse' : ''}`} />
            Bericht erstellen
          </Button>
          <Button
            variant="outline"
            onClick={logout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>

      {/* Mode Tabs */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'live' | 'historical')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="live">Live Ansicht</TabsTrigger>
          <TabsTrigger value="historical">Historisch</TabsTrigger>
        </TabsList>

        {/* Historical Date Picker */}
        {mode === 'historical' && (
          <Card className="mt-4">
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4">
                {/* Quick Select Buttons */}
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      const lastWeekday = getLastWeekday(1);
                      setSelectedDate(lastWeekday);
                      fetchHistoricalData(lastWeekday);
                    }}
                  >
                    Letzter Wochentag
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      const secondLastWeekday = getLastWeekday(2);
                      setSelectedDate(secondLastWeekday);
                      fetchHistoricalData(secondLastWeekday);
                    }}
                  >
                    Vorletzter Wochentag
                  </Button>
                </div>
                
                {/* Date Picker and Action Buttons */}
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <Label htmlFor="date">Datum auswählen</Label>
                    <Input
                      id="date"
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      max={format(new Date(), 'yyyy-MM-dd')}
                    />
                  </div>
                  <Button onClick={() => fetchHistoricalData(selectedDate)}>
                    <Calendar className="h-4 w-4 mr-2" />
                    Laden
                  </Button>
                  <Button variant="outline" onClick={() => downloadReport(selectedDate)}>
                    <Download className="h-4 w-4 mr-2" />
                    PDF Report
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error Message */}
        {error && (
          <Card className="border-red-500 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Statistics Cards */}
        {data && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Mitarbeiter</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totalUsers || data.users.length}</div>
                <p className="text-xs text-muted-foreground">
                  {data.activeUsers || data.users.filter(u => u.isActive).length} aktiv
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Gesamt Fotos</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {data.users.reduce((sum, u) => sum + (u.todayStats.uniquePhotos || 0), 0)}
                </div>
                <p className="text-xs text-muted-foreground">Unique Fotos heute</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Status-Änderungen</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {data.totalStatusChanges || 
                    data.users.reduce((sum, u) => {
                      const statusChanges = u.todayStats.statusChanges || {};
                      const values = Object.values(statusChanges);
                      return sum + values.reduce((s, c) => s + c, 0);
                    }, 0)}
                </div>
                <p className="text-xs text-muted-foreground">Gesamt</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Distanz</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatDistance(data.totalDistance || 
                    data.users.reduce((sum, u) => sum + u.todayStats.distance, 0))}
                </div>
                <p className="text-xs text-muted-foreground">Gesamt zurückgelegt</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Map */}
        <TabsContent value="live" className="mt-4">
          {data && data.users.some(u => u.currentLocation) ? (
            <Card>
              <CardHeader>
                <CardTitle>Live Standorte</CardTitle>
                <CardDescription>
                  Aktuelle GPS-Positionen der Mitarbeiter
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ height: '500px', width: '100%' }}>
                  <MapContainer
                    center={[51.1657, 10.4515]}
                    zoom={6}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapBounds users={data.users.filter(u => u.currentLocation)} />
                    {data.users
                      .filter(u => u.currentLocation)
                      .map(user => (
                        <Marker
                          key={user.userId}
                          position={[
                            user.currentLocation!.latitude,
                            user.currentLocation!.longitude,
                          ]}
                          icon={createColoredIcon()}
                        >
                          <Popup>
                            <div className="space-y-2">
                              <h3 className="font-bold">{user.username}</h3>
                              <div className="text-sm space-y-1">
                                <p>
                                  <strong>Actions:</strong> {user.todayStats.totalActions}
                                </p>
                                <p>
                                  <strong>Fotos:</strong> {user.todayStats.uniquePhotos || 0}
                                </p>
                                <p>
                                  <strong>Distanz:</strong>{' '}
                                  {formatDistance(user.todayStats.distance)}
                                </p>
                                <p>
                                  <strong>Status:</strong>{' '}
                                  {user.isActive ? (
                                    <span className="text-green-600">Aktiv</span>
                                  ) : (
                                    <span className="text-gray-500">Inaktiv</span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Zuletzt gesehen:{' '}
                                  {format(new Date(user.lastSeen), 'HH:mm:ss', { locale: de })}
                                </p>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                  </MapContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  Keine GPS-Daten verfuegbar
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="historical" className="mt-4">
          {data && data.users.some(u => u.currentLocation) ? (
            <Card>
              <CardHeader>
                <CardTitle>Standorte vom {format(new Date(selectedDate), 'dd.MM.yyyy', { locale: de })}</CardTitle>
                <CardDescription>
                  Letzte bekannte Positionen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ height: '500px', width: '100%' }}>
                  <MapContainer
                    center={[51.1657, 10.4515]}
                    zoom={6}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapBounds users={data.users.filter(u => u.currentLocation)} />
                    {data.users
                      .filter(u => u.currentLocation)
                      .map(user => (
                        <Marker
                          key={user.userId}
                          position={[
                            user.currentLocation!.latitude,
                            user.currentLocation!.longitude,
                          ]}
                          icon={createColoredIcon()}
                        >
                          <Popup>
                            <div className="space-y-2">
                              <h3 className="font-bold">{user.username}</h3>
                              <div className="text-sm space-y-1">
                                <p>
                                  <strong>Actions:</strong> {user.todayStats.totalActions}
                                </p>
                                <p>
                                  <strong>Fotos:</strong> {user.todayStats.uniquePhotos || 0}
                                </p>
                                <p>
                                  <strong>Distanz:</strong>{' '}
                                  {formatDistance(user.todayStats.distance)}
                                </p>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                  </MapContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  Keine GPS-Daten für dieses Datum verfügbar
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* User Comparison Table */}
      {data && data.users.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mitarbeiter-Vergleich</CardTitle>
            <CardDescription>Sortierbar nach verschiedenen Metriken</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-2">
              <Button
                variant={sortBy === 'actions' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (sortBy === 'actions') {
                    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                  } else {
                    setSortBy('actions');
                    setSortOrder('desc');
                  }
                }}
              >
                Actions {sortBy === 'actions' && (sortOrder === 'desc' ? '↓' : '↑')}
              </Button>
              <Button
                variant={sortBy === 'statusChanges' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (sortBy === 'statusChanges') {
                    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                  } else {
                    setSortBy('statusChanges');
                    setSortOrder('desc');
                  }
                }}
              >
                Status-Änderungen {sortBy === 'statusChanges' && (sortOrder === 'desc' ? '↓' : '↑')}
              </Button>
              <Button
                variant={sortBy === 'written' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (sortBy === 'written') {
                    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                  } else {
                    setSortBy('written');
                    setSortOrder('desc');
                  }
                }}
              >
                Geschrieben {sortBy === 'written' && (sortOrder === 'desc' ? '↓' : '↑')}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 w-8"></th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-right p-2">Geschrieben</th>
                    <th className="text-right p-2">Actions</th>
                    <th className="text-right p-2">Fotos</th>
                    <th className="text-right p-2">Status-Änderungen</th>
                    <th className="text-right p-2">Distanz</th>
                    <th className="text-right p-2">Aktiv-Zeit</th>
                    <th className="text-center p-2">Status</th>
                    <th className="text-center p-2">Route</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map(user => {
                    const statusChanges = user.todayStats.statusChanges || {};
                    const values = Object.values(statusChanges);
                    const totalStatusChanges = values.reduce((s, c) => s + c, 0);
                    const isExpanded = expandedRows.has(user.userId);

                    return (
                      <Fragment key={user.userId}>
                        <tr className="border-b hover:bg-muted/50">
                          <td className="p-2">
                            <button
                              onClick={() => toggleExpandRow(user.userId)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Details anzeigen/verbergen"
                            >
                              {isExpanded ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </button>
                          </td>
                          <td className="p-2 font-medium">{user.username}</td>
                          <td className="p-2 text-right">
                            <span className="font-bold text-green-600">
                              {user.todayStats.finalStatuses?.['written'] || 0}
                            </span>
                          </td>
                          <td className="p-2 text-right">{user.todayStats.totalActions}</td>
                          <td className="p-2 text-right">
                            {user.todayStats.uniquePhotos || 0}
                          </td>
                          <td className="p-2 text-right">{totalStatusChanges}</td>
                          <td className="p-2 text-right">
                            {formatDistance(user.todayStats.distance)}
                          </td>
                          <td className="p-2 text-right">
                            {formatDuration(user.todayStats.activeTime)}
                          </td>
                          <td className="p-2 text-center">
                            {user.isActive ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                Aktiv
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                Inaktiv
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleShowRoute(user.userId, user.username)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                              title="Route auf Karte anzeigen"
                            >
                              <Route className="w-3 h-3" />
                              Route
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${user.userId}-details`} className="bg-muted/30">
                            <td colSpan={10} className="p-4">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                {/* Action Details - FIRST COLUMN */}
                                <div>
                                  <h4 className="font-semibold mb-2 text-primary">Action Details:</h4>
                                  <div className="space-y-1">
                                    {user.todayStats.actionDetails && (
                                      <>
                                        {user.todayStats.actionDetails.scans > 0 && (
                                          <div>
                                            <div className="flex justify-between">
                                              <span className="text-muted-foreground">📸 Fotos hochgeladen:</span>
                                              <span className="font-medium">{user.todayStats.actionDetails.scans}</span>
                                            </div>
                                            {user.todayStats.uniquePhotos > 0 && user.todayStats.uniquePhotos !== user.todayStats.actionDetails.scans && (
                                              <div className="flex justify-between text-sm ml-4">
                                                <span className="text-muted-foreground italic">└─ davon unique:</span>
                                                <span className="font-medium">{user.todayStats.uniquePhotos}</span>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.ocrCorrections > 0 && (
                                          <div>
                                            <div 
                                              className="flex justify-between items-center cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                                              onClick={() => toggleExpandDatasetUpdates(user.userId)}
                                            >
                                              <span className="text-muted-foreground flex items-center gap-1">
                                                {expandedDatasetUpdates.has(user.userId) ? (
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                  </svg>
                                                ) : (
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                  </svg>
                                                )}
                                                👤 Datensatz-Updates:
                                              </span>
                                              <span className="font-medium">{user.todayStats.actionDetails.ocrCorrections}</span>
                                            </div>
                                            {expandedDatasetUpdates.has(user.userId) && (
                                              <div className="ml-6 mt-1 space-y-1 text-sm border-l-2 border-muted pl-2">
                                                {user.todayStats.actionDetails.statusChanges > 0 && (
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">🔄 Status geändert:</span>
                                                    <span className="font-medium">{user.todayStats.actionDetails.statusChanges}</span>
                                                  </div>
                                                )}
                                                {user.todayStats.actionDetails.edits > 0 && (
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">✏️ Bearbeitet:</span>
                                                    <span className="font-medium">{user.todayStats.actionDetails.edits}</span>
                                                  </div>
                                                )}
                                                {user.todayStats.actionDetails.saves > 0 && (
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">💾 Gespeichert:</span>
                                                    <span className="font-medium">{user.todayStats.actionDetails.saves}</span>
                                                  </div>
                                                )}
                                                {user.todayStats.actionDetails.deletes > 0 && (
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">🗑️ Gelöscht:</span>
                                                    <span className="font-medium">{user.todayStats.actionDetails.deletes}</span>
                                                  </div>
                                                )}
                                                {/* Show total */}
                                                <div className="text-xs text-muted-foreground font-medium pt-1 border-t">
                                                  Gesamt: {user.todayStats.actionDetails.ocrCorrections} Updates
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.datasetCreates > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">📝 Datensätze erstellt:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.datasetCreates}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.geocodes > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">📍 GPS-Abfragen:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.geocodes}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.navigations > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">🧭 Navigiert:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.navigations}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.other > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">➕ Sonstige:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.other}</span>
                                          </div>
                                        )}
                                        {/* Show total as summary */}
                                        <div className="flex justify-between pt-1 border-t border-border">
                                          <span className="text-muted-foreground font-semibold">Gesamt:</span>
                                          <span className="font-semibold">{user.todayStats.totalActions}</span>
                                        </div>
                                      </>
                                    )}
                                    {(!user.todayStats.actionDetails || user.todayStats.totalActions === 0) && (
                                      <div className="text-muted-foreground italic">Keine Actions</div>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Status-Änderungen Details - SECOND COLUMN */}
                                <div>
                                  <h4 className="font-semibold mb-2 text-primary">Status-Änderungen Details:</h4>
                                  <div className="space-y-1">
                                    {statusChanges['interessiert'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Interessiert:</span>
                                        <span className="font-medium">{statusChanges['interessiert']}</span>
                                      </div>
                                    )}
                                    {statusChanges['interest_later'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Später Interesse:</span>
                                        <span className="font-medium">{statusChanges['interest_later']}</span>
                                      </div>
                                    )}
                                    {statusChanges['appointment'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Termin vereinbart:</span>
                                        <span className="font-medium">{statusChanges['appointment']}</span>
                                      </div>
                                    )}
                                    {statusChanges['termin_vereinbart'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Termin vereinbart (alt):</span>
                                        <span className="font-medium">{statusChanges['termin_vereinbart']}</span>
                                      </div>
                                    )}
                                    {(user.todayStats.egonContracts ?? 0) > 0 && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">📝 Geschrieben (EGON):</span>
                                        <span className="font-medium text-green-600">{user.todayStats.egonContracts}</span>
                                      </div>
                                    )}
                                    {statusChanges['nicht_interessiert'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Nicht interessiert:</span>
                                        <span className="font-medium">{statusChanges['nicht_interessiert']}</span>
                                      </div>
                                    )}
                                    {statusChanges['no_interest'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Kein Interesse:</span>
                                        <span className="font-medium">{statusChanges['no_interest']}</span>
                                      </div>
                                    )}
                                    {statusChanges['nicht_angetroffen'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Nicht angetroffen:</span>
                                        <span className="font-medium">{statusChanges['nicht_angetroffen']}</span>
                                      </div>
                                    )}
                                    {statusChanges['not_reached'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Nicht erreicht:</span>
                                        <span className="font-medium">{statusChanges['not_reached']}</span>
                                      </div>
                                    )}
                                    {totalStatusChanges === 0 && (
                                      <div className="text-muted-foreground italic">Keine Status-Änderungen</div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-semibold mb-2 text-primary">Zeitanalyse:</h4>
                                  <div className="space-y-1">
                                    {user.todayStats.peakTime && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Peak Time:</span>
                                        <span className="font-medium">{user.todayStats.peakTime}</span>
                                      </div>
                                    )}
                                    {user.todayStats.breaks && user.todayStats.breaks.length > 0 && (
                                      <div className="mt-2">
                                        <div className="text-muted-foreground font-medium mb-1">Pausen:</div>
                                        {(() => {
                                          console.log(`[Dashboard] ${user.username}: ${user.todayStats.breaks.length} breaks`, user.todayStats.breaks);
                                          return user.todayStats.breaks.map((breakItem, idx) => (
                                            <div key={idx} className="mb-2 pb-2 border-b last:border-0">
                                              <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">
                                                  {format(breakItem.start, 'HH:mm', { locale: de })} - {format(breakItem.end, 'HH:mm', { locale: de })}
                                                </span>
                                                <span className="font-medium">{formatDuration(breakItem.duration)}</span>
                                              </div>
                                              {(() => {
                                                console.log(`[Dashboard]   Break ${idx}: locations=${breakItem.locations?.length || 0}`, breakItem.locations);
                                                return null;
                                              })()}
                                              {breakItem.locations && breakItem.locations.length > 0 && (
                                              <div className="mt-1 space-y-1">
                                                {breakItem.locations.map((loc, locIdx) => (
                                                  <div key={locIdx} className="text-xs text-muted-foreground pl-2 border-l-2 border-blue-300">
                                                    <div className="flex justify-between items-start">
                                                      <div className="flex-1">
                                                        <div className="font-semibold text-blue-600">{loc.poi_name}</div>
                                                        {loc.address && <div>{loc.address}</div>}
                                                        {loc.poi_type && <div className="italic">{loc.poi_type}</div>}
                                                      </div>
                                                      {loc.durationAtLocation !== undefined && loc.durationAtLocation > 0 && (
                                                        <div className="ml-2 text-xs font-medium text-orange-600 whitespace-nowrap">
                                                          {loc.durationAtLocation} min
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ));
                                        })()}
                                      </div>
                                    )}
                                    {(!user.todayStats.peakTime && (!user.todayStats.breaks || user.todayStats.breaks.length === 0)) && (
                                      <div className="text-muted-foreground italic">Keine Zeitdaten</div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Changes Chart */}
      {data && chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Status-Änderungen pro Mitarbeiter</CardTitle>
            <CardDescription>
              Verteilung der Resident-Status (interessiert, nicht interessiert, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="interessiert" fill="#22c55e" name="Interessiert" />
                <Bar dataKey="termin_vereinbart" fill="#3b82f6" name="Termin vereinbart" />
                <Bar dataKey="geschrieben" fill="#059669" name="Geschrieben" stackId="a" />
                <Bar dataKey="nicht_angetroffen" fill="#eab308" name="Nicht angetroffen" />
                <Bar dataKey="nicht_interessiert" fill="#ef4444" name="Nicht interessiert" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Final Status Assignments Chart */}
      {data && finalStatusChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Finale Status-Zuordnungen pro Mitarbeiter</CardTitle>
            <CardDescription>
              Endgültige Status, die Anwohnern am Tag zugeordnet wurden
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={finalStatusChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="interessiert" fill="#22c55e" name="Interessiert" />
                <Bar dataKey="termin_vereinbart" fill="#3b82f6" name="Termin vereinbart" />
                <Bar dataKey="geschrieben" fill="#059669" name="Geschrieben" stackId="a" />
                <Bar dataKey="nicht_angetroffen" fill="#eab308" name="Nicht angetroffen" />
                <Bar dataKey="nicht_interessiert" fill="#ef4444" name="Nicht interessiert" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Conversion Rates from "Interesse später" */}
      {data && data.users.some(u => u.todayStats.conversionRates?.interest_later_total) && (
        <Card>
          <CardHeader>
            <CardTitle>Conversion Rates von "Interesse später"</CardTitle>
            <CardDescription>
              Prozentuale Verteilung: Wie viele "Interesse später" wurden zu welchem Status geändert
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {sortedUsers.filter(u => u.todayStats.conversionRates?.interest_later_total).map(user => {
                const rates = user.todayStats.conversionRates;
                const total = rates.interest_later_total || 0;
                
                if (total === 0) return null;

                return (
                  <div key={user.userId} className="space-y-2">
                    <h4 className="font-semibold text-lg">{user.username}</h4>
                    <div className="text-sm text-muted-foreground mb-2">
                      Gesamt "Interesse später" Änderungen: {total}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {rates.interest_later_to_written !== undefined && rates.interest_later_to_written > 0 && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                          <div className="text-xs text-green-700 font-medium mb-1">→ Geschrieben</div>
                          <div className="text-2xl font-bold text-green-600">
                            {((rates.interest_later_to_written / total) * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ({rates.interest_later_to_written} von {total})
                          </div>
                        </div>
                      )}
                      {rates.interest_later_to_appointment !== undefined && rates.interest_later_to_appointment > 0 && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                          <div className="text-xs text-blue-700 font-medium mb-1">→ Termin</div>
                          <div className="text-2xl font-bold text-blue-600">
                            {((rates.interest_later_to_appointment / total) * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ({rates.interest_later_to_appointment} von {total})
                          </div>
                        </div>
                      )}
                      {rates.interest_later_to_no_interest !== undefined && rates.interest_later_to_no_interest > 0 && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                          <div className="text-xs text-red-700 font-medium mb-1">→ Kein Interesse</div>
                          <div className="text-2xl font-bold text-red-600">
                            {((rates.interest_later_to_no_interest / total) * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ({rates.interest_later_to_no_interest} von {total})
                          </div>
                        </div>
                      )}
                      {rates.interest_later_to_not_reached !== undefined && rates.interest_later_to_not_reached > 0 && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                          <div className="text-xs text-yellow-700 font-medium mb-1">→ Nicht erreicht</div>
                          <div className="text-2xl font-bold text-yellow-600">
                            {((rates.interest_later_to_not_reached / total) * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ({rates.interest_later_to_not_reached} von {total})
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Route Replay Modal/Overlay - Fullscreen */}
      {showRouteReplay && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 z-[9999] bg-background overflow-hidden"
          style={{ margin: 0, padding: 0 }}
        >
          <div className="flex h-full w-full flex-col overflow-hidden" style={{ margin: 0, padding: 0 }}>
            {/* Compact Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0 z-[100]">
              {/* Left: Title and User Info */}
              <div className="flex items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold">Route: {selectedUsername}</h2>
                  <p className="text-xs text-muted-foreground">
                    {mode === 'live' ? format(new Date(), 'dd.MM.yyyy') : format(new Date(selectedDate), 'dd.MM.yyyy')}
                  </p>
                </div>
              </div>

              {/* Center: GPS Source Filter */}
              <div className="flex items-center gap-2">
                <Label htmlFor="gps-source" className="text-xs font-medium">GPS-Quelle:</Label>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleGpsSourceChange('all')}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      gpsSource === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    Alle
                  </button>
                  <button
                    onClick={() => handleGpsSourceChange('native')}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      gpsSource === 'native'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    Native App
                  </button>
                  <button
                    onClick={() => handleGpsSourceChange('followmee')}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      gpsSource === 'followmee'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    FollowMee
                  </button>
                  <button
                    onClick={() => handleGpsSourceChange('external')}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      gpsSource === 'external'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    Damians Tracking App
                  </button>
                </div>
                {routeData && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({routeData.totalPoints} Punkte{routeData.originalPointCount && routeData.originalPointCount > routeData.totalPoints ? ` von ${routeData.originalPointCount}` : ''})
                  </span>
                )}
              </div>

              {/* Right: Close Button */}
              <button
                onClick={() => {
                  setShowRouteReplay(false);
                  setRouteData(null);
                  setSelectedUserId(null);
                  setSelectedUsername(null);
                }}
                className="rounded-md p-2 transition-colors hover:bg-muted"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Content - Scrollable */}
            <div id="route-modal-scroll-container" className="flex-1 overflow-y-auto bg-background">
              {loadingRoute ? (
                <div className="flex min-h-full items-center justify-center py-16">
                  <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary"></div>
                    <p className="text-muted-foreground">Route wird geladen...</p>
                  </div>
                </div>
              ) : routeData && routeData.gpsPoints && routeData.gpsPoints.length > 0 ? (
                <RouteReplayMap
                  username={selectedUsername || 'Unbekannt'}
                  userId={selectedUserId || ''}
                  gpsPoints={routeData.gpsPoints}
                  photoTimestamps={routeData.photoTimestamps || []}
                  contracts={routeData.contracts || []}
                  source={routeData.source || gpsSource}
                  date={mode === 'live' ? new Date().toISOString().split('T')[0] : selectedDate}
                  breaks={routeData.breaks || []}
                />
              ) : (
                <div className="flex min-h-full items-center justify-center py-16">
                  <div className="px-4 text-center">
                    <Route className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
                    <p className="mb-2 text-lg font-medium">Keine GPS-Daten verfuegbar</p>
                    <p className="text-sm text-muted-foreground">
                      Fuer diesen Benutzer wurden an diesem Tag keine GPS-Punkte aufgezeichnet.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
