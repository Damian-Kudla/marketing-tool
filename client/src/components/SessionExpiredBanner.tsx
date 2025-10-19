import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { sessionStatusManager } from '@/services/sessionStatusManager';
import { useAuth } from '@/contexts/AuthContext';
import { useCallBackSession } from '@/contexts/CallBackSessionContext';

/**
 * SessionExpiredBanner - Non-dismissible banner for expired sessions
 * 
 * Features:
 * - Fixed at top of page
 * - Cannot be closed
 * - Appears automatically when any 401 error occurs
 * - Forces user to logout and login again
 */
export function SessionExpiredBanner() {
  const [isExpired, setIsExpired] = useState(false);
  const { logout } = useAuth();
  const { clearSession } = useCallBackSession();

  useEffect(() => {
    // Subscribe to session status changes
    const unsubscribe = sessionStatusManager.subscribe((expired) => {
      setIsExpired(expired);
    });

    return unsubscribe;
  }, []);

  // Don't render if session is not expired
  if (!isExpired) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '64px', // Unter dem Header (Header ist ca. 64px hoch)
        left: 0,
        right: 0,
        zIndex: 40, // Unter Header (z-50) aber über allem anderen
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
