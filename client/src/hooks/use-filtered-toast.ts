import { useToast as useOriginalToast } from './use-toast';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import { sessionStatusManager } from '@/services/sessionStatusManager';
import { 
  type ToastCategory, 
  getCategoryFromVariant, 
  getToastDuration, 
  shouldShowToast 
} from '@/lib/toast-categories';

interface FilteredToastProps {
  category?: ToastCategory;
  duration?: number;
  variant?: 'default' | 'destructive';
  title?: React.ReactNode;
  description?: React.ReactNode;
  [key: string]: any;
}

/**
 * Custom hook that wraps useToast with category-based filtering and duration management
 * 
 * Categories:
 * - 'system': System messages (1s) - can be disabled by user
 * - 'error': Error messages (5s) - always shown
 * - 'warning': Warning messages (4s) - always shown
 * - 'success': Success messages (2s) - always shown
 * - 'info': Info messages (3s) - can be disabled by user
 */
export function useFilteredToast() {
  const originalToast = useOriginalToast();
  const { showSystemMessages } = useUIPreferences();

  const toast = (props: FilteredToastProps) => {
    // ✅ PRIORITY CHECK: If session is expired, suppress ALL error toasts
    // The SessionExpiredBanner will handle the user notification
    if (sessionStatusManager.isExpired()) {
      // Suppress all error messages - banner is already showing
      return {
        id: 'session-expired-suppressed',
        dismiss: () => {},
        update: () => {},
      };
    }
    
    // Check for auth-related errors
    const description = props.description;
    const title = props.title;
    
    const descStr = typeof description === 'string' ? description : String(description || '');
    const titleStr = typeof title === 'string' ? title : String(title || '');
    
    // Detect auth errors
    const isAuthError = descStr.includes('SESSION_EXPIRED') ||
                        titleStr.includes('SESSION_EXPIRED') ||
                        descStr.includes('Authentication required') || 
                        descStr.includes('Authentifizierung fehlgeschlagen') ||
                        descStr.includes('authentication failed') ||
                        descStr.includes('Unauthorized') ||
                        descStr.includes('401');
    
    // ✅ NEW: Check if user was authenticated (using localStorage instead of cookies)
    const wasAuthenticated = localStorage.getItem('was_authenticated') === 'true';
    
    // If it's an auth error and user was previously authenticated, suppress it (banner will handle)
    if (isAuthError && wasAuthenticated) {
      console.log('[FilteredToast] 🚫 Suppressing auth error toast - banner will show');
      return {
        id: 'auth-error-suppressed',
        dismiss: () => {},
        update: () => {},
      };
    }
    
    // Determine category from explicit prop or variant
    const category = props.category || getCategoryFromVariant(props.variant);
    
    // Check if this toast should be shown based on user preferences
    if (!shouldShowToast(category, showSystemMessages)) {
      // Return dummy object for disabled toasts
      return {
        id: '',
        dismiss: () => {},
        update: () => {},
      };
    }

    // Get appropriate duration for this category
    const duration = getToastDuration(category, props.duration);

    // Show the toast with category-based duration
    return originalToast.toast({
      ...props,
      duration,
    } as any);
  };

  return {
    ...originalToast,
    toast,
  };
}
