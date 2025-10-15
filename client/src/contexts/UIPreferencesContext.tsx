import React, { createContext, useContext, useState, ReactNode } from 'react';

interface UIPreferencesContextType {
  callBackMode: boolean;
  setCallBackMode: (enabled: boolean) => void;
  showSystemMessages: boolean;
  setShowSystemMessages: (enabled: boolean) => void;
}

const UIPreferencesContext = createContext<UIPreferencesContextType | undefined>(undefined);

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [callBackMode, setCallBackMode] = useState(false);
  const [showSystemMessages, setShowSystemMessages] = useState(true);

  return (
    <UIPreferencesContext.Provider
      value={{
        callBackMode,
        setCallBackMode,
        showSystemMessages,
        setShowSystemMessages,
      }}
    >
      {children}
    </UIPreferencesContext.Provider>
  );
}

export function useUIPreferences() {
  const context = useContext(UIPreferencesContext);
  if (context === undefined) {
    throw new Error('useUIPreferences must be used within a UIPreferencesProvider');
  }
  return context;
}
