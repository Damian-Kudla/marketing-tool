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

import { useState, useEffect } from 'react';
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
import { Download, RefreshCw, Users, Activity, MapPin, Calendar, Route } from 'lucide-react';
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
    breaks?: Array<{
      start: number;
      end: number;
      duration: number;
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
  const { isAdmin } = useAuth();
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
  const [sortBy, setSortBy] = useState<'actions' | 'distance' | 'written'>('actions');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Expanded rows state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Route Replay state
  const [showRouteReplay, setShowRouteReplay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

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
      console.error('Error downloading report:', err);
    }
  };

  // Fetch route data for selected user
  const fetchRouteData = async (userId: string, date: string) => {
    setLoadingRoute(true);
    try {
      const response = await fetch(
        `/api/admin/dashboard/route?userId=${userId}&date=${date}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch route data');
      }

      const result = await response.json();
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
    fetchRouteData(userId, mode === 'live' ? format(new Date(), 'yyyy-MM-dd') : selectedDate);
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
      case 'distance':
        aValue = a.todayStats.distance;
        bValue = b.todayStats.distance;
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
  const chartData = sortedUsers.map(user => {
    const statusChanges = user.todayStats.statusChanges || {};
    
    return {
      name: user.username,
      interessiert: (statusChanges['interessiert'] || 0) + (statusChanges['interest_later'] || 0),
      nicht_interessiert: (statusChanges['nicht_interessiert'] || 0) + (statusChanges['no_interest'] || 0),
      nicht_angetroffen: (statusChanges['nicht_angetroffen'] || 0) + (statusChanges['not_reached'] || 0),
      termin_vereinbart: (statusChanges['termin_vereinbart'] || 0) + (statusChanges['appointment'] || 0),
      geschrieben: statusChanges['written'] || 0,
    };
  });

  // Prepare chart data for final statuses (status assignments that remain at end of day)
  const finalStatusChartData = sortedUsers.map(user => {
    const finalStatuses = user.todayStats.finalStatuses || {};
    
    return {
      name: user.username,
      interessiert: (finalStatuses['interessiert'] || 0) + (finalStatuses['interest_later'] || 0),
      nicht_interessiert: (finalStatuses['nicht_interessiert'] || 0) + (finalStatuses['no_interest'] || 0),
      nicht_angetroffen: (finalStatuses['nicht_angetroffen'] || 0) + (finalStatuses['not_reached'] || 0),
      termin_vereinbart: (finalStatuses['termin_vereinbart'] || 0) + (finalStatuses['appointment'] || 0),
      geschrieben: finalStatuses['written'] || 0,
    };
  });

  // Format duration
  const formatDuration = (ms: number): string => {
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
        <Button
          variant="outline"
          size="icon"
          onClick={() => mode === 'live' ? fetchLiveData() : fetchHistoricalData(selectedDate)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
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
                  Keine GPS-Daten verfügbar
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
                variant={sortBy === 'distance' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (sortBy === 'distance') {
                    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                  } else {
                    setSortBy('distance');
                    setSortOrder('desc');
                  }
                }}
              >
                Distanz {sortBy === 'distance' && (sortOrder === 'desc' ? '↓' : '↑')}
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
                      <>
                        <tr key={user.userId} className="border-b hover:bg-muted/50">
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
                          <td className="p-2 text-right">{user.todayStats.uniquePhotos || 0}</td>
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
                                    {statusChanges['written'] && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Geschrieben:</span>
                                        <span className="font-medium text-green-600">{statusChanges['written']}</span>
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
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">✏️ Namen korrigiert:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.ocrCorrections}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.datasetCreates > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">📝 Datensätze erstellt:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.datasetCreates}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.statusChanges > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">🔄 Status geändert:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.statusChanges}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.geocodes > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">📍 GPS-Abfragen:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.geocodes}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.edits > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">✏️ Bearbeitungen:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.edits}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.saves > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">💾 Speicherungen:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.saves}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.deletes > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">🗑️ Löschungen:</span>
                                            <span className="font-medium">{user.todayStats.actionDetails.deletes}</span>
                                          </div>
                                        )}
                                        {user.todayStats.actionDetails.navigations > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">🧭 Navigationen:</span>
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
                                        {user.todayStats.breaks.map((breakItem, idx) => (
                                          <div key={idx} className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">
                                              {format(breakItem.start, 'HH:mm', { locale: de })} - {format(breakItem.end, 'HH:mm', { locale: de })}
                                            </span>
                                            <span className="font-medium">{formatDuration(breakItem.duration)}</span>
                                          </div>
                                        ))}
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
                      </>
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

      {/* Route Replay Modal/Overlay */}
      {showRouteReplay && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-6xl my-8 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
              <div>
                <h2 className="text-xl font-bold">Route Wiedergabe</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedUsername} - {mode === 'live' ? format(new Date(), 'dd.MM.yyyy') : format(new Date(selectedDate), 'dd.MM.yyyy')}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowRouteReplay(false);
                  setRouteData(null);
                  setSelectedUserId(null);
                  setSelectedUsername(null);
                }}
                className="p-2 hover:bg-muted rounded-md transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
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

            {/* Content */}
            <div className="flex-1 p-4">
              {loadingRoute ? (
                <div className="flex items-center justify-center h-full min-h-[400px]">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Route wird geladen...</p>
                  </div>
                </div>
              ) : routeData && routeData.gpsPoints && routeData.gpsPoints.length > 0 ? (
                <RouteReplayMap
                  username={selectedUsername || 'Unbekannt'}
                  gpsPoints={routeData.gpsPoints}
                  photoTimestamps={routeData.photoTimestamps || []}
                  date={mode === 'live' ? new Date().toISOString().split('T')[0] : selectedDate}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Route className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-lg font-medium mb-2">Keine GPS-Daten verfügbar</p>
                    <p className="text-sm text-muted-foreground">
                      Für diesen Benutzer wurden an diesem Tag keine GPS-Punkte aufgezeichnet.
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
