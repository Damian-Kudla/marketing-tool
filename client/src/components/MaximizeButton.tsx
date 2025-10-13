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
      className={`absolute top-2 right-2 z-10 h-8 w-8 p-0 hover:bg-accent ${className}`}
      aria-label={isMaximized ? 'Minimize panel' : 'Maximize panel'}
      title={isMaximized ? 'Minimieren' : 'Maximieren'}
    >
      {isMaximized ? (
        <Minimize2 className="h-4 w-4" />
      ) : (
        <Maximize2 className="h-4 w-4" />
      )}
    </Button>
  );
}
