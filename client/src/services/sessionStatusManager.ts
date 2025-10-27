/**
 * Global Session Status Manager
 * Detects 401 errors and triggers session expiration banner
 */

type SessionStatusListener = (isExpired: boolean) => void;

class SessionStatusManager {
  private static instance: SessionStatusManager;
  private listeners: Set<SessionStatusListener> = new Set();
  private _isSessionExpired: boolean = false;
  private hasShownBanner: boolean = false;

  private constructor() {
    console.log('[SessionStatus] 🏗️ SessionStatusManager constructor called');
    // Listen for global fetch errors
    this.interceptFetch();
  }

  static getInstance(): SessionStatusManager {
    if (!SessionStatusManager.instance) {
      console.log('[SessionStatus] 🆕 Creating new SessionStatusManager instance');
      SessionStatusManager.instance = new SessionStatusManager();
    }
    return SessionStatusManager.instance;
  }

  /**
   * Intercept fetch to detect 401 responses globally
   */
  private interceptFetch() {
    console.log('[SessionStatus] 🔧 Installing fetch interceptor...');
    const originalFetch = window.fetch;
    
    if (!originalFetch) {
      console.error('[SessionStatus] ❌ window.fetch is not available!');
      return;
    }
    
    window.fetch = async (...args) => {
      console.log('[SessionStatus] 🌐 Intercepted fetch:', args[0]);
      
      try {
        const response = await originalFetch(...args);
        
        console.log('[SessionStatus] 📥 Response status:', response.status, 'for', args[0]);
        
        // Check for 401 Unauthorized
        if (response.status === 401 && !this._isSessionExpired) {
          // ✅ NEW STRATEGY: Check if user was previously authenticated
          // We check localStorage for a flag that's set when user logs in
          const wasAuthenticated = localStorage.getItem('was_authenticated') === 'true';
          
          if (wasAuthenticated) {
            console.warn('[SessionStatus] 🔴 401 detected - User was authenticated but session expired!');
            console.warn('[SessionStatus] 📍 URL:', args[0]);
            this.markSessionExpired();
          } else {
            console.log('[SessionStatus] ℹ️ 401 detected but user was never authenticated');
          }
        }
        
        return response;
      } catch (error) {
        console.error('[SessionStatus] ❌ Fetch error:', error);
        throw error;
      }
    };
    
    console.log('[SessionStatus] ✅ Fetch interceptor installed');
  }

  /**
   * Mark session as expired and notify all listeners
   */
  private markSessionExpired() {
    if (this._isSessionExpired) return; // Already marked
    
    console.warn('[SessionStatus] 🚨 MARKING SESSION AS EXPIRED');
    this._isSessionExpired = true;
    this.hasShownBanner = true;
    
    // Notify all listeners
    console.warn('[SessionStatus] 📢 Notifying', this.listeners.size, 'listeners');
    this.listeners.forEach(listener => listener(true));
  }

  /**
   * Check if session is expired
   */
  isExpired(): boolean {
    return this._isSessionExpired;
  }

  /**
   * Reset session status (after successful re-login or explicit logout)
   */
  reset() {
    console.log('[SessionStatus] 🔄 Resetting session status');
    console.log('[SessionStatus] 🔍 Current state - isExpired:', this._isSessionExpired, 'hasShownBanner:', this.hasShownBanner);
    console.log('[SessionStatus] 🔍 Number of listeners:', this.listeners.size);
    
    this._isSessionExpired = false;
    this.hasShownBanner = false;
    
    // Notify all listeners that session is no longer expired
    console.log('[SessionStatus] 📢 Notifying', this.listeners.size, 'listeners that session is OK');
    let listenerIndex = 0;
    this.listeners.forEach((listener) => {
      listenerIndex++;
      console.log('[SessionStatus] 📤 Notifying listener', listenerIndex);
      listener(false);
    });
    console.log('[SessionStatus] ✅ Session status reset complete');
  }

  /**
   * Subscribe to session status changes
   */
  subscribe(listener: SessionStatusListener): () => void {
    this.listeners.add(listener);
    
    // Immediately notify with current state
    listener(this._isSessionExpired);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ✅ CRITICAL: Initialize immediately when module is imported
// This must happen BEFORE any fetch calls are made
console.log('[SessionStatus] 📦 Module loaded, initializing manager...');
export const sessionStatusManager = SessionStatusManager.getInstance();
console.log('[SessionStatus] ✅ Manager initialized and exported');
