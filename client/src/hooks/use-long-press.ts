import { useRef, useCallback } from 'react';

export interface LongPressOptions {
  /**
   * Dauer in ms, nach der Long Press als erkannt gilt
   * @default 600
   */
  threshold?: number;
  
  /**
   * Maximale Bewegung in px, bevor Long Press abgebrochen wird
   * @default 10
   */
  moveThreshold?: number;
  
  /**
   * Callback wenn Long Press erkannt wurde
   */
  onLongPress: (x: number, y: number) => void;
  
  /**
   * Callback für normalen Click (optional)
   */
  onClick?: () => void;
  
  /**
   * Haptisches Feedback aktivieren
   * @default true
   */
  hapticFeedback?: boolean;
}

/**
 * Hook für Long Press Erkennung, optimiert für iOS/Safari PWA
 * 
 * Verwendung:
 * ```tsx
 * const longPressHandlers = useLongPress({
 *   onLongPress: (x, y) => showContextMenu(x, y),
 *   onClick: () => normalAction()
 * });
 * 
 * <button {...longPressHandlers}>Press me</button>
 * ```
 */
export function useLongPress(options: LongPressOptions) {
  const {
    threshold = 600,
    moveThreshold = 10,
    onLongPress,
    onClick,
    hapticFeedback = true
  } = options;

  const timerRef = useRef<NodeJS.Timeout>();
  const startPosRef = useRef<{ x: number; y: number }>();
  const isLongPressRef = useRef(false);

  const triggerHapticFeedback = useCallback(() => {
    if (hapticFeedback && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch (e) {
        // Vibration API kann in manchen Browsern fehlschlagen
        console.debug('Haptic feedback not available');
      }
    }
  }, [hapticFeedback]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    startPosRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
    
    isLongPressRef.current = false;

    // Timer für Long Press starten
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      triggerHapticFeedback();
      onLongPress(touch.clientX, touch.clientY);
    }, threshold);

    // DON'T preventDefault here - it blocks scrolling!
    // Only prevent context menu on long press (in handleTouchEnd)
  }, [threshold, onLongPress, triggerHapticFeedback]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPosRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    // Prüfe ob zu weit bewegt -> kein Long Press UND kein Click
    const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
    const deltaY = Math.abs(touch.clientY - startPosRef.current.y);

    if (deltaX > moveThreshold || deltaY > moveThreshold) {
      // Movement detected - cancel both long press and click
      clearTimer();
      // Mark that we moved, so we don't trigger onClick in handleTouchEnd
      startPosRef.current = undefined;
    }
  }, [moveThreshold, clearTimer]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    clearTimer();

    // Wenn es kein Long Press war, kein Scroll war (startPosRef exists), und onClick definiert ist
    // dann führe normalen Click aus
    if (!isLongPressRef.current && startPosRef.current && onClick) {
      onClick();
    }

    startPosRef.current = undefined;
    isLongPressRef.current = false;
  }, [clearTimer, onClick]);

  const handleTouchCancel = useCallback(() => {
    clearTimer();
    startPosRef.current = undefined;
    isLongPressRef.current = false;
  }, [clearTimer]);

  // Für Desktop-Unterstützung (Entwicklung)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY
    };
    
    isLongPressRef.current = false;

    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      triggerHapticFeedback();
      onLongPress(e.clientX, e.clientY);
    }, threshold);
  }, [threshold, onLongPress, triggerHapticFeedback]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!startPosRef.current || !timerRef.current) return;

    const deltaX = Math.abs(e.clientX - startPosRef.current.x);
    const deltaY = Math.abs(e.clientY - startPosRef.current.y);

    if (deltaX > moveThreshold || deltaY > moveThreshold) {
      clearTimer();
    }
  }, [moveThreshold, clearTimer]);

  const handleMouseUp = useCallback(() => {
    clearTimer();

    if (!isLongPressRef.current && onClick) {
      onClick();
    }

    startPosRef.current = undefined;
    isLongPressRef.current = false;
  }, [clearTimer, onClick]);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    // Verhindere Kontextmenü bei Rechtsklick (Desktop)
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    // CSS-Eigenschaften für iOS
    style: {
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      touchAction: 'manipulation'
    } as React.CSSProperties
  };
}
