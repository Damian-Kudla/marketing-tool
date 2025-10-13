import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewMode } from '@/contexts/ViewModeContext';
import type { MaximizedPanel } from '@/contexts/ViewModeContext';

interface MaximizeButtonProps {
  panel: MaximizedPanel;
  className?: string;
}

export function MaximizeButton({ panel, className = '' }: MaximizeButtonProps) {
  const { maximizedPanel, toggleMaximize } = useViewMode();
  
  if (!panel) return null;
  
  const isMaximized = maximizedPanel === panel;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        toggleMaximize(panel);
      }}
      className={`absolute top-2 right-2 z-20 h-7 w-7 p-0 rounded-md bg-background/80 hover:bg-accent border border-border/50 shadow-sm opacity-70 hover:opacity-100 transition-all duration-200 ${className}`}
      aria-label={isMaximized ? 'Minimize panel' : 'Maximize panel'}
      title={isMaximized ? 'Minimieren' : 'Maximieren'}
    >
      {isMaximized ? (
        <Minimize2 className="h-3.5 w-3.5" />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
