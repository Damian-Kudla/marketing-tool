import { useToast as useOriginalToast } from './use-toast';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
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
