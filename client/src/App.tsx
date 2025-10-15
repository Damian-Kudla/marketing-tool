import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
import { AuthProvider } from '@/contexts/AuthContext';
import { ViewModeProvider } from '@/contexts/ViewModeContext';
import { UIPreferencesProvider } from '@/contexts/UIPreferencesContext';
import { CallBackSessionProvider } from '@/contexts/CallBackSessionContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PWAUpdatePrompt } from '@/components/PWAUpdatePrompt';
import ScannerPage from "@/pages/scanner";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ScannerPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
