import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ViewMode = 'list' | 'grid';
export type MaximizedPanel = 'location' | 'photo' | 'overlays' | 'results' | string | null;

interface ViewModeContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  maximizedPanel: MaximizedPanel;
  setMaximizedPanel: (panel: MaximizedPanel) => void;
  toggleMaximize: (panel: MaximizedPanel) => void;
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [maximizedPanel, setMaximizedPanel] = useState<MaximizedPanel>(null);

  const toggleMaximize = (panel: MaximizedPanel) => {
    setMaximizedPanel(maximizedPanel === panel ? null : panel);
  };

  // Auto-switch to list view on narrow screens (< 700px)
  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 700 && viewMode === 'grid') {
        setViewMode('list');
      }
    };

    // Check on mount
    handleResize();

    // Listen for resize events
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewMode]);

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        maximizedPanel,
        setMaximizedPanel,
        toggleMaximize,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  const context = useContext(ViewModeContext);
  if (context === undefined) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
}
