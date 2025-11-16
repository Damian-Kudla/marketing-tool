import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Eye, EyeOff } from "lucide-react";
import { authAPI } from '@/services/api';
import { deviceFingerprintService } from '@/services/deviceFingerprint';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Initialize device fingerprint on component mount
  useEffect(() => {
    deviceFingerprintService.getDeviceId().then(deviceId => {
      console.log('[Login] Device fingerprint initialized:', deviceId);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      setError('Bitte geben Sie ein Passwort ein');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Device info is automatically included in authAPI.login
      const response = await authAPI.login(password.trim());
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setError(`Zu viele Anmeldeversuche. Versuchen Sie es in ${data.retryAfter || 900} Sekunden erneut.`);
        } else if (response.status === 401) {
          setError('Ungültiges Passwort');
        } else {
          setError(data.error || 'Anmeldung fehlgeschlagen');
        }
        return;
      }

      // Login successful
      console.log('[Login] Login successful, user data:', data);
      
      // Call onLogin to update AuthContext
      onLogin();
      
      // Wait a moment for AuthContext to update, then check if admin
      setTimeout(async () => {
        // Re-check auth to get isAdmin status
        const authCheck = await authAPI.checkAuth();
        if (authCheck.ok) {
          const authData = await authCheck.json();
          console.log('[Login] Auth check after login:', authData);
          
          // Redirect admin users to dashboard
          if (authData.isAdmin) {
            console.log('[Login] Admin user detected, redirecting to /admin/dashboard');
            setLocation('/admin/dashboard');
          } else {
            console.log('[Login] Regular user, staying on scanner page');
            // Regular users stay on scanner page (default route)
          }
        }
      }, 100);
    } catch (error) {
      console.error('Login error:', error);
      setError('Verbindungsfehler. Bitte versuchen Sie es erneut.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-blue-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">
            Anmeldung
          </CardTitle>
          <CardDescription>
            Geben Sie Ihr Passwort ein, um fortzufahren
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">
                Passwort
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Passwort eingeben"
                  className="pr-12"
                  disabled={isLoading}
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading || !password.trim()}
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Anmeldung läuft...
                </div>
              ) : (
                'Anmelden'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}