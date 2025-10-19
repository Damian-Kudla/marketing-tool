import React, { lazy, Suspense, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
import { AuthProvider } from '@/contexts/AuthContext';
import { ViewModeProvider } from '@/contexts/ViewModeContext';
import { UIPreferencesProvider } from '@/contexts/UIPreferencesContext';
import { CallBackSessionProvider } from '@/contexts/CallBackSessionContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProtectedAdminRoute } from '@/components/ProtectedAdminRoute';
import { PWAUpdatePrompt } from '@/components/PWAUpdatePrompt';
import { SessionExpiredBanner } from '@/components/SessionExpiredBanner';
import ScannerPage from "@/pages/scanner";
import NotFound from "@/pages/not-found";

// Lazy load admin dashboard for better performance
const AdminDashboard = lazy(() => import("@/pages/admin-dashboard"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={ScannerPage} />
      <Route path="/admin/dashboard">
        <ProtectedAdminRoute>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          }>
            <AdminDashboard />
          </Suspense>
        </ProtectedAdminRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { toast } = useToast();
  
  // ✅ IMPROVED: Global error handler for SESSION_EXPIRED and 401 errors
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      const errorMessage = error?.message || String(error);
      
      // Check for SESSION_EXPIRED or auth-related errors
      const isSessionExpired = errorMessage === 'SESSION_EXPIRED';
      const isAuthError = errorMessage.includes('Authentication required') || 
                          errorMessage.includes('authentication failed') ||
                          errorMessage.includes('Unauthorized');
      
      // If it's an auth error AND user has cookies, it's a stale session
      if ((isSessionExpired || isAuthError) && document.cookie.length > 0) {
        // Prevent default error handling
        event.preventDefault();
        
        // Show user-friendly message
        toast({
          variant: 'destructive',
          title: '🔄 Server wurde aktualisiert',
          description: 'Bitte logge dich kurz aus und wieder ein, dann sollte alles wie gewohnt weiter funktionieren.',
          duration: 8000,
        });
      }
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [toast]);
  
  // Debug version indicator
  console.log('🔄 App loaded - Version: 2025-10-10-v2.0-with-new-features');
  
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <ViewModeProvider>
            <UIPreferencesProvider>
              <CallBackSessionProvider>
                <TooltipProvider>
                  <SessionExpiredBanner />
                  <Toaster />
                  <PWAUpdatePrompt />
                  <ProtectedRoute>
                    <Router />
                  </ProtectedRoute>
                </TooltipProvider>
              </CallBackSessionProvider>
            </UIPreferencesProvider>
          </ViewModeProvider>
        </AuthProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

export default App;
