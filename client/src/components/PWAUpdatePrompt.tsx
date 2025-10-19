/**
 * PWA Update Prompt Component
 * 
 * Zeigt eine benutzerfreundliche Benachrichtigung wenn ein Update verfügbar ist.
 * Bietet Optionen zum sofortigen Update oder späteren Update.
 */

import { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Download, X, RefreshCw } from 'lucide-react';
import { pwaUpdateManager, UpdateStatus } from '@/services/pwaUpdateManager';

export function PWAUpdatePrompt() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    updateAvailable: false,
    currentVersion: '',
    newVersion: '',
    isUpdating: false
  });
  const [isVisible, setIsVisible] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    console.log('🎯 [PWA Update Prompt] Initializing update monitoring...');
    
    // Register for update notifications
    pwaUpdateManager.onUpdate((status) => {
      console.log('📣 [PWA Update Prompt] Update notification received:', status);
      setUpdateStatus(status);
      setIsVisible(true);
    });

    // Initialize and check for updates on mount
    // The manager will only initialize once due to singleton pattern
    const initializeUpdates = async () => {
      console.log('🔄 [PWA Update Prompt] Starting update manager initialization...');
      await pwaUpdateManager.ensureInitialized();
      console.log('✅ [PWA Update Prompt] Update manager initialized');
    };

    initializeUpdates().catch(error => {
      console.error('❌ [PWA Update Prompt] Initialization failed:', error);
    });

    return () => {
      console.log('🧹 [PWA Update Prompt] Cleaning up...');
      // Cleanup if needed
    };
  }, []);

  const handleUpdateNow = async () => {
    setIsApplying(true);
    
    try {
      // Apply the update
      await pwaUpdateManager.applyUpdate();
      
      // Update will trigger reload automatically
      // Show brief loading state
      setUpdateStatus(prev => ({ ...prev, isUpdating: true }));
    } catch (error) {
      console.error('Failed to apply update:', error);
      setIsApplying(false);
    }
  };

  const handleUpdateLater = () => {
    setIsVisible(false);
    // User will get prompted again on next check (30 seconds)
  };

  const handleForceClear = async () => {
    if (confirm('Dies löscht alle gecachten Daten und lädt die App neu. Fortfahren?')) {
      await pwaUpdateManager.forceClearAndReload();
    }
  };

  if (!isVisible || !updateStatus.updateAvailable) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-96 z-50 animate-in slide-in-from-bottom-5">
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <AlertTitle className="text-blue-900 dark:text-blue-100 flex items-center justify-between">
          <span>Neue Version verfügbar!</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleUpdateLater}
            disabled={isApplying}
          >
            <X className="h-4 w-4" />
          </Button>
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-blue-800 dark:text-blue-200">
            Eine neue Version der App ist verfügbar. 
            {updateStatus.currentVersion && (
              <span className="block text-sm mt-1">
                Version: {updateStatus.currentVersion} → {updateStatus.newVersion}
              </span>
            )}
          </p>
          
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleUpdateNow}
              disabled={isApplying}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isApplying ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Update wird angewendet...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Jetzt aktualisieren
                </>
              )}
            </Button>
            
            <Button
              onClick={handleUpdateLater}
              variant="outline"
              disabled={isApplying}
              className="w-full"
            >
              Später
            </Button>

            {/* Debug option - only show in development or if updates fail */}
            {import.meta.env.DEV && (
              <Button
                onClick={handleForceClear}
                variant="outline"
                size="sm"
                className="w-full text-xs"
                disabled={isApplying}
              >
                Cache löschen & neu laden (Debug)
              </Button>
            )}
          </div>
          
          {updateStatus.isUpdating && (
            <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
              App wird aktualisiert und neu geladen...
            </p>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
