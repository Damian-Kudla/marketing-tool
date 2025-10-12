import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, X, Smartphone, Apple, Chrome } from 'lucide-react';
import { pwaService } from '@/services/pwa';
import { pwaLogger } from '@/services/pwaLogger';

interface PWAInstallPromptProps {
  onClose?: () => void;
  showCompact?: boolean;
}

export default function PWAInstallPrompt({ onClose, showCompact = false }: PWAInstallPromptProps) {
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [userAgent, setUserAgent] = useState('');

  useEffect(() => {
    // Check PWA status
    const status = pwaService.getStatus();
    setCanInstall(status.canInstall);
    setIsInstalled(status.isInstalled);
    setUserAgent(navigator.userAgent);

    // Listen for PWA events
    const handleBeforeInstallPrompt = () => {
      setCanInstall(true);
      pwaLogger.log('INSTALL_PROMPT_SHOWN', { trigger: 'automatic' });
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
      pwaLogger.logInstallation('prompt');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    pwaLogger.log('INSTALL_BUTTON_CLICKED', { userAgent });

    try {
      const installed = await pwaService.showInstallPrompt();
      if (installed) {
        setIsInstalled(true);
        setCanInstall(false);
        onClose?.();
      }
    } catch (error) {
      pwaLogger.logError(error as Error, 'PWA_INSTALL_FAILED');
    } finally {
      setInstalling(false);
    }
  };

  const isIOS = /iPad|iPhone|iPod/.test(userAgent);
  const isAndroid = /Android/.test(userAgent);
  const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  const isChrome = /Chrome/.test(userAgent);

  // Don't show if already installed
  if (isInstalled) {
    return null;
  }

  // Compact version for in-app prompts
  if (showCompact) {
    return (
      <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-sm">
        <Smartphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span className="text-blue-700 dark:text-blue-300 flex-1">
          Install app for offline access
        </span>
        {canInstall ? (
          <Button
            size="sm"
            onClick={handleInstall}
            disabled={installing}
            className="h-7 px-2 text-xs"
          >
            {installing ? 'Installing...' : 'Install'}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-7 w-7 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  // Full install prompt card
  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            {isIOS && <Apple className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
            {isAndroid && <Chrome className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
            {!isIOS && !isAndroid && <Download className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
          </div>
          
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100">
              Install Energy Scan Capture
            </h3>
            
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Get faster access, offline functionality, and a native app experience.
            </p>
            
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Offline support
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Faster loading
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Native feel
              </div>
            </div>

            {/* Platform-specific instructions */}
            {isIOS && isSafari && !canInstall && (
              <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 p-2 rounded">
                <strong>iOS Safari:</strong> Tap the share button <span className="inline-block mx-1">⬆️</span> and select "Add to Home Screen"
              </div>
            )}
            
            {isAndroid && !canInstall && (
              <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 p-2 rounded">
                <strong>Android:</strong> Use Chrome browser and tap the menu (⋮) to find "Install app" or "Add to Home screen"
              </div>
            )}
          </div>
          
          <div className="flex flex-col gap-2">
            {canInstall && (
              <Button
                onClick={handleInstall}
                disabled={installing}
                size="sm"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {installing ? 'Installing...' : 'Install'}
              </Button>
            )}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="w-8 h-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}