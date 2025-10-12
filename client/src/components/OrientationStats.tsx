import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Download, Trash2 } from 'lucide-react';
import OrientationLoggingService from '@/services/orientationLogging';

interface OrientationStatsProps {
  className?: string;
}

export default function OrientationStats({ className }: OrientationStatsProps) {
  const [stats, setStats] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  const refreshStats = () => {
    const currentStats = OrientationLoggingService.getOrientationStats();
    setStats(currentStats);
  };

  useEffect(() => {
    refreshStats();
    
    // Refresh stats every 5 seconds when visible
    const interval = isVisible ? setInterval(refreshStats, 5000) : null;
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isVisible]);

  const exportLogs = () => {
    const logs = OrientationLoggingService.exportLogs();
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orientation-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    OrientationLoggingService.clearLogs();
    refreshStats();
  };

  if (!isVisible) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsVisible(true)}
        className={`fixed bottom-4 right-4 z-50 ${className || ''}`}
      >
        <Eye className="h-4 w-4 mr-2" />
        Orientation Stats
      </Button>
    );
  }

  return (
    <Card className={`fixed bottom-4 right-4 z-50 w-80 max-h-96 overflow-y-auto ${className || ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Orientation Correction Stats</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsVisible(false)}
          >
            ×
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {stats && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-semibold">{stats.totalCorrections}</div>
                <div className="text-muted-foreground">Total</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-semibold">{(stats.successRate * 100).toFixed(1)}%</div>
                <div className="text-muted-foreground">Success</div>
              </div>
            </div>

            {/* Correction Types */}
            <div>
              <h4 className="font-semibold mb-1">Correction Types</h4>
              <div className="flex gap-1">
                <Badge variant="secondary">
                  Frontend: {stats.frontendCorrections}
                </Badge>
                <Badge variant="outline">
                  Backend: {stats.backendCorrections}
                </Badge>
              </div>
            </div>

            {/* Device Types */}
            {Object.keys(stats.deviceTypes).length > 0 && (
              <div>
                <h4 className="font-semibold mb-1">Device Types</h4>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.deviceTypes).map(([device, count]) => (
                    <Badge key={device} variant="outline" className="text-xs">
                      {device}: {String(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Detection Methods */}
            {Object.keys(stats.detectionMethods).length > 0 && (
              <div>
                <h4 className="font-semibold mb-1">Detection Methods</h4>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.detectionMethods).map(([method, count]) => (
                    <Badge key={method} variant="outline" className="text-xs">
                      {method}: {String(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Rotation Distribution */}
            {Object.keys(stats.orientationDistribution).length > 0 && (
              <div>
                <h4 className="font-semibold mb-1">Rotations Applied</h4>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.orientationDistribution).map(([rotation, count]) => (
                    <Badge key={rotation} variant="outline" className="text-xs">
                      {rotation}°: {String(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Performance */}
            <div>
              <h4 className="font-semibold mb-1">Performance</h4>
              <div className="text-muted-foreground space-y-1">
                <div>Avg Processing: {stats.avgProcessingTime.toFixed(0)}ms</div>
                <div>Avg Text Blocks: {stats.avgTextBlocks.toFixed(1)}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={refreshStats}
                className="flex-1"
              >
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportLogs}
                className="flex-1"
              >
                <Download className="h-3 w-3 mr-1" />
                Export
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearLogs}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}