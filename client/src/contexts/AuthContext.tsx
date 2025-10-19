import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { authAPI } from '@/services/api';
import { useQueryClient } from '@tanstack/react-query';
import { trackingManager } from '@/services/trackingManager';
import { sessionStatusManager } from '@/services/sessionStatusManager';

interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  isAdmin: boolean;
  login: () => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const checkAuth = async () => {
    try {
      const response = await authAPI.checkAuth();

      if (response.ok) {
        const data = await response.json();
        if (data.authenticated) {
          setIsAuthenticated(true);
          setUserId(data.userId);
          setUsername(data.username);
          setIsAdmin(data.isAdmin || false);
          
          // ✅ Set flag in localStorage for session expiration detection
          localStorage.setItem('was_authenticated', 'true');
          
          // Start tracking for non-admin users
          if (!data.isAdmin && data.userId && data.username) {
            await trackingManager.initialize(data.userId, data.username);
            console.log('[Auth] Tracking initialized for user:', data.username);
          }
        } else {
          setIsAuthenticated(false);
          setUserId(null);
          setUsername(null);
          setIsAdmin(false);
          // Don't remove flag here - we want to detect if session expired
        }
      } else {
        setIsAuthenticated(false);
        setUserId(null);
        setUsername(null);
        setIsAdmin(false);
        // Don't remove flag here - we want to detect if session expired
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setUserId(null);
      setUsername(null);
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  };

  const login = () => {
    setIsAuthenticated(true);
    
    // Clear all caches to ensure fresh data for new user
    queryClient.clear();
    
    checkAuth(); // Re-check to get userId and username
  };

  const logout = async () => {
    try {
      // Stop tracking before logout
      await trackingManager.shutdown();
      console.log('[Auth] Tracking stopped');
      
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsAuthenticated(false);
      setUserId(null);
      setUsername(null);
      setIsAdmin(false);
      
      // ✅ Clear the authentication flag on explicit logout
      localStorage.removeItem('was_authenticated');
      
      // ✅ Reset session status manager (hides banner if showing)
      sessionStatusManager.reset();
      
      // Clear all React Query caches to prevent showing wrong user's data
      queryClient.clear();
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    userId,
    username,
    isAdmin,
    login,
    logout,
    checkAuth,
    isLoading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}