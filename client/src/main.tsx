import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { pwaService } from "./services/pwa";

// Initialize PWA service
pwaService.preloadCriticalResources();

// Setup PWA action listener for logging
window.addEventListener('pwa-action', (event: Event) => {
  const customEvent = event as CustomEvent;
  // This can be extended to send logs to your logging service
  console.log('PWA Action logged:', customEvent.detail);
});

createRoot(document.getElementById("root")!).render(<App />);
