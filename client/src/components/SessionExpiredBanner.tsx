import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { sessionStatusManager } from '@/services/sessionStatusManager';

/**
 * SessionExpiredBanner - Non-dismissible banner for expired sessions
 * 
 * Features:
 * - Fixed at top of page
 * - Cannot be closed
 * - Appears automatically when any 401 error occurs
 * - Forces user to logout and login again
 * - Does NOT use AuthContext to avoid initialization race conditions
 */
export function SessionExpiredBanner() {
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    console.log('[SessionExpiredBanner] 🎬 Component mounted, subscribing to session status');
    
    // Subscribe to session status changes
    const unsubscribe = sessionStatusManager.subscribe((expired) => {
      console.log('[SessionExpiredBanner] 📨 Received status update:', expired);
      setIsExpired(expired);
    });

    return () => {
      console.log('[SessionExpiredBanner] 🧹 Component unmounting, unsubscribing');
      unsubscribe();
    };
  }, []);

  console.log('[SessionExpiredBanner] 🔍 Render - isExpired:', isExpired);

  // Don't render if session is not expired
  if (!isExpired) {
    console.log('[SessionExpiredBanner] ✅ Session OK - not rendering banner');
    return null;
  }

  console.log('[SessionExpiredBanner] 🚨 Session expired - rendering banner');

  return (
    <div
      style={{
        position: 'fixed',
        top: '64px', // Direkt unter dem Header (Header ist 64px hoch)
        left: 0,
        right: 0,
        zIndex: 45, // Unter Header (z-50) aber über Content (z-40)
        backgroundColor: '#dc2626', // red-600
        color: 'white',
        padding: '16px 24px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      }}
      role="alert"
      aria-live="assertive"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertCircle size={24} />
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>
              🔄 Server wurde aktualisiert
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px' }}>
              Deine Sitzung ist abgelaufen. Bitte logge dich über das Benutzer-Menü aus und wieder ein.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
