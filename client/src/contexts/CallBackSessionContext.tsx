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
  const [isDescendingOrder, setIsDescendingOrder] = useState(true); // Track if list is in descending order

  const startCallBackSession = (list: any[], period: 'today' | 'yesterday' | 'custom', startIndex: number = 0, isDescending: boolean = true) => {
    setCurrentCallBackList(list);
    setCurrentCallBackIndex(startIndex);
    setCallBackPeriod(period);
    setLoadedFromCallBack(true);
    setIsDescendingOrder(isDescending);
  };

  const moveToNext = (): string | null => {
    // "Nächster" always means moving UP in the visual list (towards index 0)
    // This represents "next address to process" (from bottom to top)
    const nextIndex = currentCallBackIndex - 1;
    
    if (nextIndex >= 0) {
      setCurrentCallBackIndex(nextIndex);
      return currentCallBackList[nextIndex].datasetId;
    }
    return null;
  };

  const moveToPrevious = (): string | null => {
    // "Vorheriger" always means moving DOWN in the visual list (towards higher index)
    // This represents "go back to previous address" (from top to bottom)
    const prevIndex = currentCallBackIndex + 1;
    
    if (prevIndex < currentCallBackList.length) {
      setCurrentCallBackIndex(prevIndex);
      return currentCallBackList[prevIndex].datasetId;
    }
    return null;
  };

  const hasNext = (): boolean => {
    // Can move to "next" if there's an item above (lower index)
    return currentCallBackIndex > 0;
  };

  const hasPrevious = (): boolean => {
    // Can move to "previous" if there's an item below (higher index)
    return currentCallBackIndex < currentCallBackList.length - 1;
  };

  const clearSession = () => {
    setCurrentCallBackList([]);
    setCurrentCallBackIndex(-1);
    setCallBackPeriod(null);
    setLoadedFromCallBack(false);
    setIsDescendingOrder(true);
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
