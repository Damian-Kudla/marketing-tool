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
      onClick={() => toggleMaximize(panel)}
      className={`absolute top-1 right-1 z-10 h-6 w-6 p-0 hover:bg-accent/50 opacity-60 hover:opacity-100 transition-opacity ${className}`}
      aria-label={isMaximized ? 'Minimize panel' : 'Maximize panel'}
      title={isMaximized ? 'Minimieren' : 'Maximieren'}
    >
      {isMaximized ? (
        <Minimize2 className="h-3 w-3" />
      ) : (
        <Maximize2 className="h-3 w-3" />
      )}
    </Button>
  );
}
