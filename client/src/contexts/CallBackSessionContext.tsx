import React, { createContext, useContext, useState, ReactNode } from 'react';

interface CallBackSessionContextType {
  currentCallBackList: any[];
  currentCallBackIndex: number;
  callBackPeriod: 'today' | 'yesterday' | 'custom' | null;
  startCallBackSession: (list: any[], period: 'today' | 'yesterday' | 'custom', startIndex?: number, isDescending?: boolean) => void;
  moveToNext: () => string | null; // Returns next dataset ID or null if at end
  moveToPrevious: () => string | null; // Returns previous dataset ID or null if at beginning
  hasNext: () => boolean;
  hasPrevious: () => boolean;
  clearSession: () => void;
  loadedFromCallBack: boolean;
  setLoadedFromCallBack: (value: boolean) => void;
}

const CallBackSessionContext = createContext<CallBackSessionContextType | undefined>(undefined);

export function CallBackSessionProvider({ children }: { children: ReactNode }) {
  const [currentCallBackList, setCurrentCallBackList] = useState<any[]>([]);
  const [currentCallBackIndex, setCurrentCallBackIndex] = useState(-1);
  const [callBackPeriod, setCallBackPeriod] = useState<'today' | 'yesterday' | 'custom' | null>(null);
  const [loadedFromCallBack, setLoadedFromCallBack] = useState(false);

  const startCallBackSession = (list: any[], period: 'today' | 'yesterday' | 'custom', startIndex: number = 0, isDescending: boolean = true) => {
    setCurrentCallBackList(list);
    setCurrentCallBackIndex(startIndex);
    setCallBackPeriod(period);
    setLoadedFromCallBack(true);
    // isDescending parameter is kept for backward compatibility but not used anymore
    // Navigation is always visual: "Nächster" = up (index-1), "Vorheriger" = down (index+1)
  };

  const moveToNext = (): string | null => {
    // "Nächster" = move UP in the visual list (towards index 0)
    // This works for any sort order because the list is already sorted visually
    const nextIndex = currentCallBackIndex - 1;

    if (nextIndex >= 0) {
      setCurrentCallBackIndex(nextIndex);
      return currentCallBackList[nextIndex].datasetId;
    }
    return null;
  };

  const moveToPrevious = (): string | null => {
    // "Vorheriger" = move DOWN in the visual list (towards end of list)
    // This works for any sort order because the list is already sorted visually
    const prevIndex = currentCallBackIndex + 1;

    if (prevIndex < currentCallBackList.length) {
      setCurrentCallBackIndex(prevIndex);
      return currentCallBackList[prevIndex].datasetId;
    }
    return null;
  };

  const hasNext = (): boolean => {
    // Has "next" (upwards) element when not at top of list
    return currentCallBackIndex > 0;
  };

  const hasPrevious = (): boolean => {
    // Has "previous" (downwards) element when not at bottom of list
    return currentCallBackIndex < currentCallBackList.length - 1;
  };

  const clearSession = () => {
    setCurrentCallBackList([]);
    setCurrentCallBackIndex(-1);
    setCallBackPeriod(null);
    setLoadedFromCallBack(false);
  };

  return (
    <CallBackSessionContext.Provider
      value={{
        currentCallBackList,
        currentCallBackIndex,
        callBackPeriod,
        startCallBackSession,
        moveToNext,
        moveToPrevious,
        hasNext,
        hasPrevious,
        clearSession,
        loadedFromCallBack,
        setLoadedFromCallBack,
      }}
    >
      {children}
    </CallBackSessionContext.Provider>
  );
}

export function useCallBackSession() {
  const context = useContext(CallBackSessionContext);
  if (context === undefined) {
    throw new Error('useCallBackSession must be used within a CallBackSessionProvider');
  }
  return context;
}
