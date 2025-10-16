import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, Clock, MapPin, Trash2, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFilteredToast } from "@/hooks/use-filtered-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Appointment {
  id: string;
  datasetId: string;
  residentName: string;
  address: string;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string;
  createdBy: string;
  createdAt: Date;
}

interface AppointmentsListProps {
  onLoadDataset?: (datasetId: string) => Promise<void>;
}

export function AppointmentsList({ onLoadDataset }: AppointmentsListProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useFilteredToast();
  const queryClient = useQueryClient();

  const { data: appointments, isLoading } = useQuery<Appointment[]>({
    queryKey: ['/api/appointments/upcoming'],
    queryFn: async () => {
      const response = await fetch('/api/appointments/upcoming', {
        credentials: 'include',
        cache: 'no-store' // Prevent browser caching
      });
      if (!response.ok) {
        throw new Error("Fehler beim Laden der Termine");
      }
      return response.json();
    },
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't keep in cache after component unmounts
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/appointments/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error("Fehler beim Löschen des Termins");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appointments/upcoming'] });
      toast({
        title: "Termin gelöscht",
        description: "Der Termin wurde erfolgreich gelöscht",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Termin konnte nicht gelöscht werden",
      });
    }
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const isToday = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isPast = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const handleAppointmentClick = async (datasetId: string, address: string) => {
    if (onLoadDataset) {
      try {
        setLoading(true);
        await onLoadDataset(datasetId);
        toast({
          title: "Datensatz geladen",
          description: `${address} wurde geöffnet`,
        });
      } catch (error) {
        console.error('Error loading dataset:', error);
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Datensatz konnte nicht geladen werden",
        });
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-6 w-6" />
                Termine
              </CardTitle>
              <CardDescription>Anstehende Termine</CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neuer Termin
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Loading state */}
          {(isLoading || loading) && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">{isLoading ? 'Lade Termine...' : 'Lade Datensatz...'}</span>
            </div>
          )}

          {/* Appointments list */}
          {!isLoading && appointments && appointments.length > 0 && (
            <div className="space-y-2">
              {appointments.map((appointment: Appointment) => (
                <Card
                  key={appointment.id}
                  className={`cursor-pointer hover:bg-accent transition-colors ${
                    isToday(appointment.appointmentDate)
                      ? 'border-blue-500 border-2'
                      : isPast(appointment.appointmentDate)
                      ? 'opacity-60'
                      : ''
                  }`}
                  onClick={() => handleAppointmentClick(appointment.datasetId, appointment.address)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-lg">
                            {appointment.residentName}
                          </span>
                          {isToday(appointment.appointmentDate) && (
                            <Badge variant="default">Heute</Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          {appointment.address}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDate(appointment.appointmentDate)}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {appointment.appointmentTime} Uhr
                          </div>
                        </div>
                        
                        {appointment.notes && (
                          <div className="text-sm text-muted-foreground mt-2">
                            <span className="font-medium">Notizen:</span> {appointment.notes}
                          </div>
                        )}
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent card click event
                          deleteMutation.mutate(appointment.id);
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && appointments && appointments.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Keine anstehenden Termine</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create appointment dialog would go here - simplified for now */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Termin</DialogTitle>
            <DialogDescription>
              Termine werden direkt beim Bearbeiten eines Bewohners erstellt
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center text-sm text-muted-foreground">
            Bitte verwenden Sie den "Termin vereinbaren" Button beim Bearbeiten eines Bewohners
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
