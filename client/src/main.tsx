import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { pwaService } from "./services/pwa";
import { pwaUpdateManager } from "./services/pwaUpdateManager";

// Initialize PWA service
pwaService.preloadCriticalResources();

// Setup PWA action listener for logging
window.addEventListener('pwa-action', (event: Event) => {
  const customEvent = event as CustomEvent;
  // This can be extended to send logs to your logging service
  console.log('PWA Action logged:', customEvent.detail);
});

// Initialize PWA Update Manager AFTER Service Worker is ready
// This ensures SW is registered before we start checking for updates
console.log('🚀 [PWA Main] Starting PWA Update Manager initialization...');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => {
    console.log('✅ [PWA Main] Service Worker ready, triggering update check');
    pwaUpdateManager.checkForUpdates();
  }).catch((error) => {
    console.error('❌ [PWA Main] Service Worker ready failed:', error);
  });
} else {
  console.warn('⚠️ [PWA Main] Service Worker not supported');
}

createRoot(document.getElementById("root")!).render(<App />);
