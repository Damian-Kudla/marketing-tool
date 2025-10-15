import { useToast as useOriginalToast } from './use-toast';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import type { ToastProps } from '@/components/ui/toast';

/**
 * Custom hook that wraps useToast and filters system messages based on user preferences
 * Only shows error messages when showSystemMessages is disabled
 */
export function useFilteredToast() {
  const originalToast = useOriginalToast();
  const { showSystemMessages } = useUIPreferences();

  const toast = (props: any) => {
    // Always show error/destructive messages
    if (props.variant === 'destructive') {
      return originalToast.toast(props);
    }

    // Only show non-error messages if showSystemMessages is enabled
    if (showSystemMessages) {
      return originalToast.toast(props);
    }

    // If showSystemMessages is disabled and it's not an error, don't show
    return {
      id: '',
      dismiss: () => {},
      update: () => {},
    };
  };

  return {
    ...originalToast,
    toast,
  };
}
