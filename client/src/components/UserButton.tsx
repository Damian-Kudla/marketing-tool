import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User, LogOut, ChevronDown, History } from 'lucide-react';
import { UserHistory } from './UserHistory';
import { datasetAPI } from '@/services/api';

interface UserButtonProps {
  onDatasetLoad?: (dataset: any) => void;
}

export function UserButton({ onDatasetLoad }: UserButtonProps) {
  const { username, userId, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleLoadDataset = async (datasetId: string) => {
    try {
      const dataset = await datasetAPI.getDatasetById(datasetId);
      if (onDatasetLoad) {
        onDatasetLoad(dataset);
      }
    } catch (error) {
      console.error('Failed to load dataset:', error);
      throw error; // Re-throw to be handled by UserHistory component
    }
  };

  if (!username) {
    return null;
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          className="flex items-center gap-2 px-3 py-2 h-auto"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium text-gray-900">
                {username}
              </span>
              <span className="text-xs text-gray-500">
                ID: {userId}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-gray-900">{username}</p>
          <p className="text-xs text-gray-500">Benutzer-ID: {userId}</p>
        </div>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          className="cursor-pointer"
          onClick={() => setShowHistory(true)}
        >
          <History className="w-4 h-4 mr-2" />
          Verlauf
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <DropdownMenuItem 
              className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
              onSelect={(e) => e.preventDefault()}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Abmelden
            </DropdownMenuItem>
          </AlertDialogTrigger>
          
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Abmelden bestätigen</AlertDialogTitle>
              <AlertDialogDescription>
                Möchten Sie sich wirklich abmelden? Sie müssen sich erneut anmelden, um die Anwendung zu verwenden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {isLoggingOut ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Abmelden...
                  </div>
                ) : (
                  'Abmelden'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>

    {/* User History Dialog */}
    {username && (
      <UserHistory
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        username={username}
        onLoadDataset={handleLoadDataset}
      />
    )}
    </>
  );
}