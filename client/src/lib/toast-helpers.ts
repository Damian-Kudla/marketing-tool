/**
 * Convenience functions for creating toasts with specific categories
 * 
 * Usage:
 * import { systemToast, errorToast, successToast } from '@/lib/toast-helpers';
 * 
 * systemToast({ title: 'Saved', description: 'Changes saved' });
 * errorToast({ title: 'Error', description: 'Something went wrong' });
 */

import { toast } from '@/hooks/use-toast';
import { type ToastCategory, getToastDuration } from './toast-categories';

interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  duration?: number;
  [key: string]: any;
}

function createCategorizedToast(category: ToastCategory, variant?: 'default' | 'destructive') {
  return (options: ToastOptions) => {
    const duration = getToastDuration(category, options.duration);
    
    return toast({
      ...options,
      variant,
      duration,
    } as any);
  };
}

// System messages (1 second, can be disabled)
export const systemToast = createCategorizedToast('system', 'default');

// Error messages (5 seconds, always shown)
export const errorToast = createCategorizedToast('error', 'destructive');

// Warning messages (4 seconds, always shown)
export const warningToast = createCategorizedToast('warning', 'default');

// Success messages (2 seconds, always shown)
export const successToast = createCategorizedToast('success', 'default');

// Info messages (3 seconds, can be disabled)
export const infoToast = createCategorizedToast('info', 'default');
