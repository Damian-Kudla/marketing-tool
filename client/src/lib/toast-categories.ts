/**
 * Toast Category System
 * Centralized management for toast notifications with categories
 */

export type ToastCategory = 
  | 'system'      // System messages (success, info) - can be toggled
  | 'error'       // Error messages - always shown
  | 'warning'     // Warning messages - always shown
  | 'success'     // Explicit success messages - always shown
  | 'info';       // Info messages - can be toggled

export interface ToastConfig {
  category: ToastCategory;
  duration?: number;
  canBeDisabled: boolean;
  defaultDuration: number;
}

// Default durations for each category (in milliseconds)
export const TOAST_DURATIONS: Record<ToastCategory, number> = {
  system: 1000,    // 1 second for system messages
  error: 5000,     // 5 seconds for errors
  warning: 4000,   // 4 seconds for warnings
  success: 2000,   // 2 seconds for success
  info: 3000,      // 3 seconds for info
};

// Configuration for each category
export const TOAST_CATEGORIES: Record<ToastCategory, ToastConfig> = {
  system: {
    category: 'system',
    defaultDuration: TOAST_DURATIONS.system,
    canBeDisabled: true,
  },
  error: {
    category: 'error',
    defaultDuration: TOAST_DURATIONS.error,
    canBeDisabled: false,
  },
  warning: {
    category: 'warning',
    defaultDuration: TOAST_DURATIONS.warning,
    canBeDisabled: false,
  },
  success: {
    category: 'success',
    defaultDuration: TOAST_DURATIONS.success,
    canBeDisabled: false,
  },
  info: {
    category: 'info',
    defaultDuration: TOAST_DURATIONS.info,
    canBeDisabled: true,
  },
};

/**
 * Determine toast category from variant
 */
export function getCategoryFromVariant(variant?: string): ToastCategory {
  if (variant === 'destructive') return 'error';
  return 'system';
}

/**
 * Get duration for a toast based on category and custom duration
 */
export function getToastDuration(category: ToastCategory, customDuration?: number): number {
  if (customDuration !== undefined) return customDuration;
  return TOAST_DURATIONS[category];
}

/**
 * Check if a toast category can be disabled by user preference
 */
export function canDisableCategory(category: ToastCategory): boolean {
  return TOAST_CATEGORIES[category].canBeDisabled;
}

/**
 * Check if a toast should be shown based on category and user preferences
 */
export function shouldShowToast(
  category: ToastCategory,
  showSystemMessages: boolean
): boolean {
  // Always show non-disableable categories
  if (!canDisableCategory(category)) {
    return true;
  }
  
  // For disableable categories, check user preference
  return showSystemMessages;
}
