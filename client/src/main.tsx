import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { pwaService } from "./services/pwa";
import { sessionStatusManager } from "./services/sessionStatusManager";

// Initialize Session Status Manager FIRST (before any API calls)
// This intercepts fetch globally to detect 401 errors
console.log('🔒 [Session] Initializing global session monitor...');
sessionStatusManager; // Force initialization

// Initialize PWA service
pwaService.preloadCriticalResources();

// Setup PWA action listener for logging
window.addEventListener('pwa-action', (event: Event) => {
  const customEvent = event as CustomEvent;
  // This can be extended to send logs to your logging service
  console.log('PWA Action logged:', customEvent.detail);
});

// Note: PWA Update Manager is initialized lazily when PWAUpdatePrompt component mounts
// This prevents double initialization and ensures proper Service Worker readiness

createRoot(document.getElementById("root")!).render(<App />);
