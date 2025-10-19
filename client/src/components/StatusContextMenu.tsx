import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ResidentStatus, ResidentCategory } from '@shared/schema';
import { STATUS_LABELS } from '@/constants/statuses';

export interface StatusMenuItem {
  status: ResidentStatus;
  label: string;
  icon?: React.ReactNode;
}

interface StatusContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onSelectStatus?: (status: ResidentStatus) => void;
  onSelectCategory?: (category: ResidentCategory) => void;
  /**
   * NEU: Kombinierte Kategorie + Status Änderung in einem Schritt
   */
  onSelectCategoryAndStatus?: (category: ResidentCategory, status: ResidentStatus) => void;
  /**
   * Liste der verfügbaren Status-Optionen
   * Falls nicht angegeben, werden alle Status angezeigt
   */
  availableStatuses?: ResidentStatus[];
  /**
   * Aktueller Status (wird hervorgehoben)
   */
  currentStatus?: ResidentStatus;
  /**
   * Aktuelle Kategorie (bestimmt welches Menü angezeigt wird)
   */
  currentCategory?: ResidentCategory;
  /**
   * Modus: 'status' für Status-Auswahl, 'category' für Kategorie-Auswahl
   */
  mode?: 'status' | 'category';
}

/**
 * Kontextmenü für Status-Auswahl, optimiert für iOS/Safari PWA
 * Wird bei Long Press auf Resident-Einträge angezeigt
 */
export function StatusContextMenu({
  isOpen,
  x,
  y,
  onClose,
  onSelectStatus,
  onSelectCategory,
  onSelectCategoryAndStatus,
  availableStatuses,
  currentStatus,
  currentCategory,
  mode = 'status'
}: StatusContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Status-Icons für bessere UX
  const getStatusIcon = (status: ResidentStatus): string => {
    switch (status) {
      case 'no_interest':
        return '🚫';
      case 'not_reached':
        return '📞';
      case 'interest_later':
        return '⏰';
      case 'appointment':
        return '📅';
      case 'written':
        return '✅';
      default:
        return '•';
    }
  };

  // Status-Farben für visuelle Unterscheidung
  const getStatusColor = (status: ResidentStatus): string => {
    switch (status) {
      case 'no_interest':
        return 'text-red-600';
      case 'not_reached':
        return 'text-amber-600';
      case 'interest_later':
        return 'text-blue-600';
      case 'appointment':
        return 'text-purple-600';
      case 'written':
        return 'text-green-700';
      default:
        return 'text-gray-600';
    }
  };

  // Standard: Alle Status verfügbar AUSSER 'appointment' (nur über Bearbeitungsform mit Datum/Uhrzeit)
  const statusesToShow: ResidentStatus[] = availableStatuses || [
    'no_interest',
    'not_reached',
    'interest_later',
    // 'appointment' wird ausgelassen - nur über ResidentEditPopup mit Datum/Uhrzeit-Pflichtfeldern
    'written'
  ];

  // Menü positionieren (mit Viewport-Grenzen)
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Rechter Rand
    if (x + rect.width > viewportWidth - 16) {
      adjustedX = viewportWidth - rect.width - 16;
    }

    // Unterer Rand
    if (y + rect.height > viewportHeight - 16) {
      adjustedY = viewportHeight - rect.height - 16;
    }

    // Linker Rand
    if (adjustedX < 16) {
      adjustedX = 16;
    }

    // Oberer Rand
    if (adjustedY < 16) {
      adjustedY = 16;
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [isOpen, x, y]);

  // Schließen bei Klick außerhalb
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Timeout verhindert sofortiges Schließen nach Öffnen
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ESC zum Schließen
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleStatusClick = (status: ResidentStatus) => {
    onSelectStatus?.(status);
    onClose();
  };

  const handleCategoryClick = (category: ResidentCategory) => {
    onSelectCategory?.(category);
    onClose();
  };

  const handleCategoryWithStatusClick = (category: ResidentCategory, status: ResidentStatus) => {
    onSelectCategoryAndStatus?.(category, status);
    onClose();
  };

  // Category mode: Show category change options WITH status selection
  if (mode === 'category') {
    return createPortal(
      <>
        {/* Backdrop (dezent) */}
        <div 
          className="fixed inset-0 z-[9998]"
          style={{ 
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)'
          }}
        />
        
        {/* Menü */}
        <div
          ref={menuRef}
          className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200"
          style={{
            left: x,
            top: y,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: '16px',
            boxShadow: '0 12px 48px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.1)',
            minWidth: '200px',
            maxWidth: '280px',
            overflow: 'hidden',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none'
          }}
        >
          <div className="py-2">
            {/* Titel */}
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
              Zu Neukunden verschieben
            </div>

            {/* Status-Optionen für Neukunde */}
            <ul className="py-1">
              {statusesToShow.map((status) => (
                <li key={status}>
                  <button
                    onClick={() => handleCategoryWithStatusClick('potential_new_customer', status)}
                    className={`
                      w-full px-4 py-3 flex items-center gap-3
                      transition-colors duration-150
                      active:bg-gray-200 hover:bg-gray-50
                    `}
                    style={{
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  >
                    {/* Icon */}
                    <span className="text-xl flex-shrink-0">
                      {getStatusIcon(status)}
                    </span>
                    
                    {/* Label */}
                    <span className={`
                      flex-1 text-left font-medium text-[15px]
                      ${getStatusColor(status)}
                    `}>
                      {STATUS_LABELS[status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // Status mode: Show status options
  return createPortal(
    <>
      {/* Backdrop (dezent) */}
      <div 
        className="fixed inset-0 z-[9998]"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)'
        }}
      />
      
      {/* Menü */}
      <div
        ref={menuRef}
        className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200"
        style={{
          left: x,
          top: y,
          // iOS-ähnliches Design
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '16px',
          boxShadow: '0 12px 48px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.1)',
          minWidth: '200px',
          maxWidth: '280px',
          overflow: 'hidden',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        }}
      >
        <div className="py-2">
          {/* Titel */}
          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
            Status ändern
          </div>

          {/* Status-Optionen */}
          <ul className="py-1">
            {statusesToShow.map((status) => {
              const isCurrentStatus = status === currentStatus;
              
              return (
                <li key={status}>
                  <button
                    onClick={() => handleStatusClick(status)}
                    className={`
                      w-full px-4 py-3 flex items-center gap-3
                      transition-colors duration-150
                      active:bg-gray-200
                      ${isCurrentStatus ? 'bg-gray-100' : 'hover:bg-gray-50'}
                    `}
                    style={{
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  >
                    {/* Icon */}
                    <span className="text-xl flex-shrink-0">
                      {getStatusIcon(status)}
                    </span>
                    
                    {/* Label */}
                    <span className={`
                      flex-1 text-left font-medium text-[15px]
                      ${getStatusColor(status)}
                    `}>
                      {STATUS_LABELS[status]}
                    </span>

                    {/* Checkmark bei aktuellem Status */}
                    {isCurrentStatus && (
                      <span className="text-blue-600 text-lg">✓</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>,
    document.body
  );
}
