import React, { createContext, useContext, useState, ReactNode } from 'react';

interface CallBackSessionContextType {
  currentCallBackList: any[];
  currentCallBackIndex: number;
  callBackPeriod: 'today' | 'yesterday' | 'custom' | null;
  startCallBackSession: (list: any[], period: 'today' | 'yesterday' | 'custom', startIndex?: number) => void;
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

  const startCallBackSession = (list: any[], period: 'today' | 'yesterday' | 'custom', startIndex: number = 0) => {
    setCurrentCallBackList(list);
    setCurrentCallBackIndex(startIndex);
    setCallBackPeriod(period);
    setLoadedFromCallBack(true);
  };

  const moveToNext = (): string | null => {
    // Move forward in the list (increase index)
    if (currentCallBackIndex < currentCallBackList.length - 1) {
      const nextIndex = currentCallBackIndex + 1;
      setCurrentCallBackIndex(nextIndex);
      return currentCallBackList[nextIndex].datasetId;
    }
    return null;
  };

  const moveToPrevious = (): string | null => {
    // Move backward in the list (decrease index)
    if (currentCallBackIndex > 0) {
      const prevIndex = currentCallBackIndex - 1;
      setCurrentCallBackIndex(prevIndex);
      return currentCallBackList[prevIndex].datasetId;
    }
    return null;
  };

  const hasNext = (): boolean => {
    // Can move forward if not at the end
    return currentCallBackIndex < currentCallBackList.length - 1;
  };

  const hasPrevious = (): boolean => {
    // Can move backward if not at the beginning
    return currentCallBackIndex > 0;
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
