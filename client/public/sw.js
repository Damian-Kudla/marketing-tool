// Energy Scan Capture PWA Service Worker
// Optimized for performance with comprehensive caching strategies
const VERSION = '2.2.0';

const CACHE_NAME = 'energy-scan-v2.2.0';
const STATIC_CACHE = 'static-cache-v2.2.0';
const API_CACHE = 'api-cache-v2.2.0';
const IMAGE_CACHE = 'image-cache-v2.2.0';

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
  '/api/ocr',
  '/api/addresses',
  '/api/results'
];

// Cache size limits
const MAX_API_CACHE_SIZE = 50;
const MAX_IMAGE_CACHE_SIZE = 20;

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

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  logPWAAction('SW_ACTIVATE');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      const deletePromises = cacheNames
        .filter(cacheName => 
          cacheName !== STATIC_CACHE && 
          cacheName !== API_CACHE && 
          cacheName !== IMAGE_CACHE &&
          cacheName.startsWith('energy-scan-') || 
          cacheName.startsWith('static-cache-') ||
          cacheName.startsWith('api-cache-') ||
          cacheName.startsWith('image-cache-')
        )
        .map(cacheName => {
          logPWAAction('DELETING_OLD_CACHE', { cacheName });
          return caches.delete(cacheName);
        });
      
      return Promise.all(deletePromises);
    }).then(() => {
      logPWAAction('SW_ACTIVATE_COMPLETE');
      return self.clients.claim();
    }).catch(error => {
      logPWAAction('SW_ACTIVATE_ERROR', { error: error.message });
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
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
  return url.pathname.startsWith('/api/') ||
         API_ENDPOINTS.some(endpoint => url.pathname.startsWith(endpoint));
}

// Check if request is for images
function isImageRequest(request) {
  const url = new URL(request.url);
  return url.pathname.match(/\.(png|jpg|jpeg|gif|webp)$/) ||
         request.destination === 'image';
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