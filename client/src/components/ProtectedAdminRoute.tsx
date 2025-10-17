/**
 * Protected Admin Route Component
 * 
 * Wrapper für Admin-only Routes
 * Zeigt Access Denied wenn User nicht admin ist
 */

import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from './ui/card';
import { ShieldAlert } from 'lucide-react';

interface ProtectedAdminRouteProps {
  children: React.ReactNode;
}

export function ProtectedAdminRoute({ children }: ProtectedAdminRouteProps) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = '/';
    }
  }, [isAuthenticated, isLoading]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Access denied if not admin
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-3 rounded-full bg-red-100">
                <ShieldAlert className="h-10 w-10 text-red-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-2">Zugriff verweigert</h2>
                <p className="text-muted-foreground">
                  Diese Seite ist nur für Administratoren zugänglich.
                </p>
                <p className="text-muted-foreground mt-2">
                  Bitte kontaktieren Sie Ihren Administrator, wenn Sie glauben, dass dies ein Fehler ist.
                </p>
              </div>
              <button
                onClick={() => window.location.href = '/scanner'}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Zurück zur Scanner-Seite
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render protected content
  return <>{children}</>;
}
