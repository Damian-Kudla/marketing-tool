// Akquise-Tool PWA Service Worker
// Optimized for performance with comprehensive caching strategies
const VERSION = '2.8.9';

const CACHE_NAME = 'akquise-tool-v2.8.9';
const STATIC_CACHE = 'static-cache-v2.8.9';
const API_CACHE = 'api-cache-v2.8.9';
const IMAGE_CACHE = 'image-cache-v2.8.9';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.svg',
  '/icons/icon-512x512.svg',
  '/icons/apple-touch-icon.svg',
  // Vite build assets will be cached dynamically when requested
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/auth',
  // NOTE: /api/ocr is EXCLUDED - OCR responses can be large with image data
  '/api/addresses',
  '/api/results'
];

// Cache size limits
const MAX_API_CACHE_SIZE = 50;
const MAX_IMAGE_CACHE_SIZE = 10; // Only for app icons (small)

// Utility function for logging PWA actions
function logPWAAction(action, details = {}) {
  console.log(`[PWA SW] ${action}:`, details);
  
  // Send to logging service if available
  if (self.registration && self.registration.active) {
    self.registration.active.postMessage({
      type: 'PWA_LOG',
      action,
      details,
      timestamp: new Date().toISOString()
    });
  }
}

// Install event - cache static assets
self.addEventListener('install', event => {
  logPWAAction('SW_INSTALL', { cacheName: CACHE_NAME });
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE).then(cache => {
        logPWAAction('CACHING_STATIC_ASSETS', { count: STATIC_ASSETS.length });
        return cache.addAll(STATIC_ASSETS);
      }),
      
      // Initialize other caches
      caches.open(API_CACHE),
      caches.open(IMAGE_CACHE)
    ]).then(() => {
      logPWAAction('SW_INSTALL_COMPLETE');
      self.skipWaiting();
    }).catch(error => {
      logPWAAction('SW_INSTALL_ERROR', { error: error.message });
    })
  );
});

// Activate event - clean up old caches and IndexedDB
self.addEventListener('activate', event => {
  logPWAAction('SW_ACTIVATE');
  
  event.waitUntil(
    Promise.all([
      // 1. Delete ALL old caches (including old versions with images)
      caches.keys().then(cacheNames => {
        const currentCaches = [STATIC_CACHE, API_CACHE, IMAGE_CACHE];
        
        const deletePromises = cacheNames
          .filter(cacheName => !currentCaches.includes(cacheName))
          .map(cacheName => {
            logPWAAction('DELETING_OLD_CACHE', { cacheName });
            return caches.delete(cacheName);
          });
        
        return Promise.all(deletePromises);
      }),
      
      // 2. Clear IndexedDB (old OCR images stored as Base64)
      clearIndexedDB(),
      
      // 3. Clear old localStorage items
      clearOldLocalStorage()
      
    ]).then(() => {
      logPWAAction('SW_ACTIVATE_COMPLETE');
      return self.clients.claim();
    }).catch(error => {
      logPWAAction('SW_ACTIVATE_ERROR', { error: error.message });
    })
  );
});

// Clear IndexedDB to remove old OCR images
async function clearIndexedDB() {
  try {
    // Delete the entire EnergyScanner database (contains Base64 images)
    const deleteRequest = indexedDB.deleteDatabase('EnergyScanner');
    
    return new Promise((resolve) => {
      deleteRequest.onsuccess = () => {
        logPWAAction('INDEXEDDB_CLEARED', { database: 'EnergyScanner' });
        resolve();
      };
      
      deleteRequest.onerror = () => {
        logPWAAction('INDEXEDDB_CLEAR_ERROR', { error: deleteRequest.error });
        resolve(); // Continue even if clear fails
      };
      
      deleteRequest.onblocked = () => {
        logPWAAction('INDEXEDDB_CLEAR_BLOCKED');
        resolve(); // Continue even if blocked
      };
    });
  } catch (error) {
    logPWAAction('INDEXEDDB_CLEAR_EXCEPTION', { error: error.message });
  }
}

// Clear old localStorage items
function clearOldLocalStorage() {
  try {
    // These items are only needed during runtime, not stored long-term
    const itemsToRemove = ['pwa-logs', 'pwa-metrics'];
    
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'CLEAR_LOCAL_STORAGE',
          items: itemsToRemove
        });
      });
    });
    
    logPWAAction('LOCAL_STORAGE_CLEAR_REQUESTED');
  } catch (error) {
    logPWAAction('LOCAL_STORAGE_CLEAR_ERROR', { error: error.message });
  }
}

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
    return;
  }
  
  // CRITICAL: Never cache admin routes - always fetch fresh data
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin')) {
    logPWAAction('ADMIN_BYPASS', { url: request.url });
    event.respondWith(fetch(request));
    return;
  }

  // CRITICAL: Never cache version.json - always fetch fresh data
  if (url.pathname === '/version.json') {
    logPWAAction('VERSION_CHECK_BYPASS', { url: request.url });
    event.respondWith(fetch(request));
    return;
  }
  
  // Handle different types of requests
  if (isStaticAsset(request)) {
    event.respondWith(handleStaticAsset(request));
  } else if (isAPIRequest(request)) {
    event.respondWith(handleAPIRequest(request));
  } else if (isImageRequest(request)) {
    event.respondWith(handleImageRequest(request));
  } else {
    event.respondWith(handleOtherRequest(request));
  }
});

// Check if request is for static asset
function isStaticAsset(request) {
  const url = new URL(request.url);
  // Match Vite build assets with content hashes (e.g., index-abc123.js)
  return url.pathname.match(/\.(html|js|css|json|svg|ico|woff2?)$/) ||
         url.pathname === '/' ||
         url.pathname.startsWith('/icons/') ||
         url.pathname.startsWith('/assets/') || // Vite build assets
         url.pathname === '/manifest.json';
}

// Check if request is for API
function isAPIRequest(request) {
  const url = new URL(request.url);
  
  // Exclude OCR API from caching (large image payloads)
  if (url.pathname.startsWith('/api/ocr')) {
    return false;
  }
  
  // Exclude admin API from caching (handled in fetch event)
  if (url.pathname.startsWith('/api/admin')) {
    return false;
  }
  
  return url.pathname.startsWith('/api/') ||
         API_ENDPOINTS.some(endpoint => url.pathname.startsWith(endpoint));
}

// Check if request is for images (only app icons, NOT OCR uploads)
function isImageRequest(request) {
  const url = new URL(request.url);
  // Only cache app icons from /icons/ directory
  // Do NOT cache OCR uploaded images or API image responses
  return url.pathname.startsWith('/icons/') && 
         url.pathname.match(/\.(svg|png|jpg|ico)$/);
}

// Handle static assets - Cache First strategy
async function handleStaticAsset(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      logPWAAction('STATIC_CACHE_HIT', { url: request.url });
      return cachedResponse;
    }
    
    logPWAAction('STATIC_CACHE_MISS', { url: request.url });
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      logPWAAction('STATIC_CACHED', { url: request.url });
    }
    
    return networkResponse;
  } catch (error) {
    logPWAAction('STATIC_FETCH_ERROR', { url: request.url, error: error.message });
    
    // Return cached version if available
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.destination === 'document') {
      const offlineResponse = await cache.match('/');
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    throw error;
  }
}

// Handle API requests - Network First with fallback
async function handleAPIRequest(request) {
  try {
    logPWAAction('API_NETWORK_REQUEST', { url: request.url, method: request.method });
    
    // For GET requests, try network first, then cache
    if (request.method === 'GET') {
      const networkResponse = await fetch(request);
      
      if (networkResponse.ok) {
        const cache = await caches.open(API_CACHE);
        
        // Manage cache size
        await manageCacheSize(cache, MAX_API_CACHE_SIZE);
        
        cache.put(request, networkResponse.clone());
        logPWAAction('API_CACHED', { url: request.url });
        
        return networkResponse;
      }
    }
    
    // For non-GET or failed requests, try cache
    const cache = await caches.open(API_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      logPWAAction('API_CACHE_FALLBACK', { url: request.url });
      return cachedResponse;
    }
    
    // If no cache, try network anyway
    return await fetch(request);
    
  } catch (error) {
    logPWAAction('API_FETCH_ERROR', { url: request.url, error: error.message });
    
    // Return cached version for GET requests
    if (request.method === 'GET') {
      const cache = await caches.open(API_CACHE);
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        logPWAAction('API_OFFLINE_SERVED', { url: request.url });
        return cachedResponse;
      }
    }
    
    // Return offline indicator for failed API requests
    return new Response(
      JSON.stringify({ 
        error: 'Offline', 
        message: 'This request failed and no cached data is available',
        offline: true 
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle image requests - Cache First with size management
async function handleImageRequest(request) {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      logPWAAction('IMAGE_CACHE_HIT', { url: request.url });
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Manage cache size before adding new images
      await manageCacheSize(cache, MAX_IMAGE_CACHE_SIZE);
      
      cache.put(request, networkResponse.clone());
      logPWAAction('IMAGE_CACHED', { url: request.url });
    }
    
    return networkResponse;
  } catch (error) {
    logPWAAction('IMAGE_FETCH_ERROR', { url: request.url, error: error.message });
    
    // Return cached version if available
    const cache = await caches.open(IMAGE_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// Handle other requests - Network only
async function handleOtherRequest(request) {
  try {
    return await fetch(request);
  } catch (error) {
    logPWAAction('OTHER_FETCH_ERROR', { url: request.url, error: error.message });
    throw error;
  }
}

// Manage cache size by removing oldest entries
async function manageCacheSize(cache, maxSize) {
  const keys = await cache.keys();
  
  if (keys.length >= maxSize) {
    const keysToDelete = keys.slice(0, keys.length - maxSize + 1);
    
    for (const key of keysToDelete) {
      await cache.delete(key);
      logPWAAction('CACHE_CLEANUP', { url: key.url });
    }
  }
}

// Handle background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync-ocr-results') {
    logPWAAction('BACKGROUND_SYNC_START', { tag: event.tag });
    event.waitUntil(syncOCRResults());
  }
  
  if (event.tag === 'background-sync-addresses') {
    logPWAAction('BACKGROUND_SYNC_START', { tag: event.tag });
    event.waitUntil(syncAddresses());
  }
});

// Sync OCR results when back online
async function syncOCRResults() {
  try {
    // This would integrate with your IndexedDB service
    logPWAAction('SYNC_OCR_RESULTS_SUCCESS');
  } catch (error) {
    logPWAAction('SYNC_OCR_RESULTS_ERROR', { error: error.message });
    throw error;
  }
}

// Sync addresses when back online
async function syncAddresses() {
  try {
    // This would integrate with your IndexedDB service
    logPWAAction('SYNC_ADDRESSES_SUCCESS');
  } catch (error) {
    logPWAAction('SYNC_ADDRESSES_ERROR', { error: error.message });
    throw error;
  }
}

// Handle push notifications (future enhancement)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    logPWAAction('PUSH_RECEIVED', data);
    
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.svg',
      badge: '/icons/apple-touch-icon.svg',
      vibrate: [200, 100, 200],
      data: data,
      actions: [
        {
          action: 'view',
          title: 'View Details'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  logPWAAction('NOTIFICATION_CLICK', { action: event.action });
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/scanner')
    );
  }
});

// Communication with main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    logPWAAction('SKIP_WAITING_REQUESTED');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

logPWAAction('SERVICE_WORKER_LOADED', { version: CACHE_NAME });