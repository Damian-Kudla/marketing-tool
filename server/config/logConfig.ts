/**
 * Centralized Logging Configuration
 * Controls verbosity of logs across the entire application
 */

export const LOG_CONFIG = {
  // Express API logs (server/index.ts middleware)
  EXPRESS: {
    // Log ALL API requests (default: true)
    // Turn off to reduce noise from frequent polling endpoints
    logAllRequests: false,
    
    // Only log these endpoints (empty = log none if logAllRequests=false)
    // Add endpoints you want to monitor specifically
    includeEndpoints: [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/address-datasets/', // POST (create dataset)
      '/api/address-datasets/bulk-residents', // PUT (update residents)
      '/api/log-category-change',
      '/api/search-address',
      '/api/geocode',
      '/api/ocr',
      '/api/appointments/create',
    ] as string[],
    
    // Skip logging these endpoints entirely (reduces clutter)
    excludeEndpoints: [
      '/api/auth/check',
      '/api/tracking/device',
      '/api/tracking/session',
      '/api/address-datasets/search-local', // Called on every keystroke
    ] as string[],
  },
  
  // Cache operations logs
  CACHE: {
    // Dataset cache search operations
    logDatasetSearch: false, // [DatasetCache.getByAddress] logs
    
    // User dataset by date queries
    logUserDatasetQueries: false, // [getUserDatasetsByDate] logs
    
    // Only log cache hits/misses for important operations
    logValidatedStreetCache: true, // Keep for API monitoring
  },
  
  // Batch logger operations
  BATCH_LOGGER: {
    // Log every queue addition (very noisy)
    logQueueAdd: false,
    
    // Log empty queue flushes
    logEmptyFlush: false,
    
    // Log successful flushes (keep for monitoring)
    logFlushSuccess: true,
  },
  
  // Data cleaning/parsing warnings
  DATA_CLEANING: {
    // Log skipped rows during customer data parsing
    logSkippedRows: false, // Only show summary
    
    // Show summary at end
    logSummary: true,
  },
  
  // Appointment service filtering
  APPOINTMENTS: {
    // Log each filtered-out appointment (very noisy with 40+ appointments)
    logEachFilter: false,
    
    // Log final count
    logSummary: true,
  },
  
  // Bulk update operations
  BULK_UPDATES: {
    // Log BEFORE/AFTER states (very verbose)
    logBeforeAfter: false,
    
    // Log success messages
    logSuccess: true,
  },
  
  // Historical data scraper (server startup)
  HISTORICAL_SCRAPER: {
    // Log per-user stats during initialization
    logPerUserStats: false, // Reduce startup noise

    // Log final summary
    logSummary: true,
  },

  // Historical matching service
  HISTORICAL_MATCHING: {
    // Log dataset lookup operations
    logDatasetLookup: false,

    // Log detailed matching results
    logDetailedResults: false,

    // Log previous tenant detection
    logPreviousTenant: false,
  },
};

/**
 * Helper to check if an endpoint should be logged
 */
export function shouldLogEndpoint(path: string): boolean {
  const config = LOG_CONFIG.EXPRESS;
  
  // Check exclusions first
  if (config.excludeEndpoints.some(excluded => path.includes(excluded))) {
    return false;
  }
  
  // If logAllRequests=true, log everything not excluded
  if (config.logAllRequests) {
    return true;
  }
  
  // Otherwise only log included endpoints
  return config.includeEndpoints.some(included => path.includes(included));
}

/**
 * Conditional logger with username injection
 */
export function logWithUser(
  message: string, 
  username?: string,
  enabled: boolean = true
): void {
  if (!enabled) return;
  
  const prefix = username ? `[${username}]` : '';
  console.log(`${prefix} ${message}`.trim());
}
