# Implementierungszusammenfassung - Große Erweiterungen

## ✅ Bereits implementiert

### 1. Toast-Benachrichtigungen wegklickbar machen
- **Geänderte Dateien:**
  - `client/src/hooks/use-toast.ts`: TOAST_LIMIT erhöht auf 5, TOAST_REMOVE_DELAY auf 10 Sekunden
  - `client/src/components/ui/toast.tsx`: Close-Button immer sichtbar (opacity-100 statt opacity-0)

### 2. Textfeld-Rotation-Bug beheben
- **Geänderte Dateien:**
  - `server/routes.ts`: Backend-Rotation komplett deaktiviert (Zeilen 235-245)
  - **Grund:** Backend rotiert Bild, aber nicht die Bounding-Boxen → Textfelder um 90° verdreht
  - **Lösung:** Frontend handled Rotation, Backend macht keine Rotation mehr

### 3. Namen-Matching mit ß/ss und Umlauten erweitern
- **Geänderte Dateien:**
  - `server/storage.ts`: Neue `normalizeName()` Funktion
  - Ersetzt: ß → ss, ä → ae, ö → oe, ü → ue
  - Beide Namen (Suche + Datenbank) werden normalisiert vor Vergleich

### 4. Hausnummern-Abgleich strikter machen
- **Geänderte Dateien:**
  - `server/storage.ts`: `getCustomersByAddress()` Funktion
  - **ALT:** "1" matched "1", "1a", "1b", "1c"
  - **NEU:** "1" matched NUR "1" (exakt)

### 5. Schema-Erweiterungen für weitere Features
- **Geänderte Dateien:**
  - `shared/schema.ts`:
    - `originalName` und `originalCategory` zu `EditableResident` hinzugefügt
    - `CategoryChangeLog` Schema erstellt
    - `LogCategoryChangeRequest` Schema erstellt

## 🚧 Noch zu implementieren

### 6. Etagenangabe optional machen ⭐ WICHTIG
**Status:** Schema bereits korrekt (floor ist optional)
**Noch zu tun:**
1. `client/src/components/ResidentEditPopup.tsx`:
   - Validation entfernen: "floor required if status is set"
   - Zeilen 58-67 anpassen
2. `client/src/components/AddressOverview.tsx` (oder ähnliche Tabellenansicht):
   - Einträge ohne Etagenangabe in Sammeletage "keine Etagenangabe" gruppieren
   - Als letzte Zeile anzeigen

### 7. Status "Geschrieben" hinzufügen ⭐ WICHTIG
**Zu tun:**
1. `shared/schema.ts`:
   ```typescript
   export const residentStatusSchema = z.enum([
     'no_interest', 
     'not_reached', 
     'interest_later', 
     'appointment',
     'written'  // NEU
   ]);
   ```

2. `client/src/components/ResidentEditPopup.tsx`:
   - Neuen Status in `statusOptions` hinzufügen:
   ```typescript
   { value: 'written', label: t('resident.status.written', 'Geschrieben') }
   ```

3. Tabellenansicht (AddressOverview.tsx oder ClickableAddressHeader):
   - Dunkelgrünes Styling für Status "written"
   - z.B.: `bg-green-800` oder `text-green-800`

### 8. Kategorie-Änderungs-Logging implementieren ⭐⭐ SEHR WICHTIG
**Komplex - mehrere Schritte:**

1. **Backend: Google Sheets Service erweitern**
   `server/services/googleSheets.ts`:
   ```typescript
   class CategoryChangeLoggingService {
     private readonly SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
     private readonly WORKSHEET_NAME = 'Log_Änderung_Kategorie';
     
     async ensureSheetExists() {
       // Sheet mit Spalten erstellen:
       // ID | Dataset-ID | Original Name | Current Name | 
       // Old Category | New Category | Changed By | Changed At | Dataset Snapshot
     }
     
     async logCategoryChange(log: CategoryChangeLog) {
       // Eintrag in Sheet schreiben
     }
   }
   ```

2. **Backend: API Route erstellen**
   `server/routes.ts` (oder neue Datei):
   ```typescript
   app.post("/api/log-category-change", requireAuth, async (req, res) => {
     // Validieren mit logCategoryChangeRequestSchema
     // CategoryChangeLoggingService aufrufen
   });
   ```

3. **Frontend: Original-Werte speichern**
   `client/src/components/ResultsDisplay.tsx`:
   - Bei Initialisierung von `editableResidents` aus OCR-Result:
     - `originalName` setzen auf aktuellen Namen
     - `originalCategory` setzen auf aktuelle Kategorie
   - Zeilen ca. 120-150 anpassen

4. **Frontend: Category-Change Detection**
   `client/src/components/ResidentEditPopup.tsx`:
   - In `handleSave()`:
     ```typescript
     // Prüfen ob Kategorie geändert wurde
     if (resident.originalCategory && 
         resident.originalCategory !== formData.category) {
       // API Call: logCategoryChange
       await fetch('/api/log-category-change', {
         method: 'POST',
         body: JSON.stringify({
           datasetId: currentDatasetId,
           residentOriginalName: resident.originalName,
           residentCurrentName: formData.name,
           oldCategory: resident.originalCategory,
           newCategory: formData.category,
           addressDatasetSnapshot: JSON.stringify(currentDataset)
         })
       });
     }
     ```

### 9. Call Back Liste implementieren ⭐⭐⭐ SEHR WICHTIG & KOMPLEX
**Mehrere Komponenten betroffen:**

1. **Backend: Call Back API**
   `server/services/googleSheets.ts`:
   ```typescript
   async getCallBackAddresses(username: string, date: Date) {
     // Datasets vom aktuellen Tag holen
     // Filtern nach Datasets mit Status "not_reached" oder "interest_later"
     // Anzahl der Anwohner mit diesen Status zählen
     // Return: { address, datasetId, notReachedCount, interestLaterCount }[]
   }
   ```
   
   `server/routes.ts`:
   ```typescript
   app.get("/api/call-backs", requireAuth, async (req: AuthenticatedRequest, res) => {
     const username = req.user.username;
     const today = new Date();
     const callBacks = await addressDatasetService.getCallBackAddresses(username, today);
     res.json(callBacks);
   });
   ```

2. **Frontend: Call Back Komponente**
   `client/src/components/CallBackList.tsx` (NEU erstellen):
   ```typescript
   export function CallBackList() {
     const [callBacks, setCallBacks] = useState([]);
     
     useEffect(() => {
       // API Call: /api/call-backs
     }, []);
     
     return (
       <div>
         {callBacks.map(cb => (
           <div key={cb.datasetId}>
             <h3>{cb.address}</h3>
             <p>Nicht erreicht: {cb.notReachedCount}</p>
             <p>Interesse später: {cb.interestLaterCount}</p>
             <Button onClick={() => loadDataset(cb.datasetId)}>
               Laden
             </Button>
           </div>
         ))}
       </div>
     );
   }
   ```

3. **Frontend: User Dropdown Menu erweitern**
   `client/src/components/UserButton.tsx`:
   - Menüpunkt "Call Back" hinzufügen
   - onClick: Dialog/Page mit CallBackList öffnen

### 10. Call Back Anzeige im Verlauf ⭐ WICHTIG
**Zu tun:**
1. `client/src/components/UserHistory.tsx`:
   - Für jeden Dataset-Eintrag Anwohner durchlaufen
   - Zählen: `notReachedCount` und `interestLaterCount`
   - Kompakte Anzeige hinzufügen:
     ```tsx
     {(notReachedCount > 0 || interestLaterCount > 0) && (
       <div className="text-xs text-muted-foreground">
         {notReachedCount > 0 && <span>Nicht erreicht: {notReachedCount}</span>}
         {interestLaterCount > 0 && <span>Interesse später: {interestLaterCount}</span>}
       </div>
     )}
     ```

### 11. Termin-System mit Datum/Uhrzeit implementieren ⭐⭐⭐ SEHR KOMPLEX
**Große Feature-Erweiterung:**

1. **Schema erweitern**
   `shared/schema.ts`:
   ```typescript
   export const appointmentSchema = z.object({
     id: z.string(),
     datasetId: z.string(),
     residentName: z.string(),
     appointmentDate: z.date(),
     appointmentTime: z.string(), // HH:MM format
     address: z.string(),
     createdBy: z.string(),
     createdAt: z.date(),
   });
   ```

2. **Backend: Appointment Service**
   `server/services/appointments.ts` (NEU):
   ```typescript
   class AppointmentService {
     private appointments: Map<string, Appointment> = new Map();
     private readonly SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
     private readonly WORKSHEET_NAME = 'Termine';
     
     async initialize() {
       // Lade alle Termine aus Sheet in RAM
     }
     
     async createAppointment(appointment: Omit<Appointment, 'id' | 'createdAt'>) {
       // In RAM speichern
       // In Sheet schreiben (background)
     }
     
     async getUserAppointments(username: string, fromDate: Date) {
       // Filtern nach Username und zukünftigen Terminen
       // Sortieren chronologisch
     }
   }
   ```

3. **Backend: API Routes**
   ```typescript
   app.post("/api/appointments", requireAuth, async (req, res) => {
     // Termin erstellen
   });
   
   app.get("/api/appointments", requireAuth, async (req, res) => {
     // Termine für User laden
   });
   ```

4. **Frontend: ResidentEditPopup erweitern**
   - Bei status === 'appointment':
     - Date/Time Picker zeigen
     - Beim Speichern: POST /api/appointments

5. **Frontend: Appointments Liste**
   `client/src/components/AppointmentsList.tsx` (NEU):
   - Termine laden von API
   - Chronologisch anzeigen
   - Laden-Button pro Termin

6. **Frontend: User Dropdown Menu**
   - "Termine" Menüpunkt hinzufügen
   - Dialog mit AppointmentsList öffnen

### 12. Postleitzahlen-Zuordnung für Nutzer ⭐⭐ WICHTIG
**Zu tun:**

1. **Backend: User Service erweitern**
   `server/services/googleSheets.ts`:
   ```typescript
   async getUserPostalCodes(username: string): Promise<string[]> {
     // Spalte C aus "Zugangsdaten" Sheet lesen
     // Format: "12345,67890,11111" → ['12345', '67890', '11111']
   }
   
   async validatePostalCodeForUser(username: string, postalCode: string): Promise<boolean> {
     const allowedCodes = await getUserPostalCodes(username);
     if (allowedCodes.length === 0) return true; // Keine Einschränkung
     return allowedCodes.includes(postalCode);
   }
   ```

2. **Backend: Geocode Route anpassen**
   `server/routes.ts` - in `/api/geocode`:
   ```typescript
   // VOR dem Geocoding API Call:
   if (address.postal) {
     const isAllowed = await validatePostalCodeForUser(req.user.username, address.postal);
     if (!isAllowed) {
       return res.status(403).json({
         error: "Diese Postleitzahl liegt außerhalb Ihres zugewiesenen Bereichs. Bitte kontaktieren Sie Ihren Leiter.",
         errorCode: "POSTAL_CODE_RESTRICTED"
       });
     }
   }
   ```

3. **Backend: Manual Address Route**
   - Auch für manuelle Adresseingabe prüfen
   - Vor OCR/Search: PLZ validieren

4. **Frontend: Error Handling**
   - Bei errorCode "POSTAL_CODE_RESTRICTED": Spezielle Fehlermeldung anzeigen

### 13. Adress-Normalisierung über Geocoding API ⭐
**Bereits weitgehend implementiert, Feintuning:**

1. `server/services/googleSheets.ts`:
   - `normalizeAddress()` Funktion existiert bereits
   - Wird bei Dataset-Erstellung verwendet

2. Sicherstellen in `server/routes/addressDatasets.ts`:
   ```typescript
   // Bei Dataset Creation:
   const normalizedAddress = await normalizeAddress(
     address.street,
     address.number,
     address.city,
     address.postal
   );
   ```

## 📝 Zusätzliche Hinweise

### Prioritäten für Implementierung:
1. **Hoch:** Status "Geschrieben", Etagenangabe optional, PLZ-Zuordnung
2. **Sehr Hoch:** Kategorie-Logging, Call Back Liste
3. **Komplex aber wichtig:** Termin-System

### Testing-Checkliste:
- [ ] Toast-Meldungen haben Close-Button
- [ ] Textfelder nicht mehr rotiert
- [ ] Namen mit ß/Umlauten werden gefunden
- [ ] Hausnummer "1" findet nicht "1a"
- [ ] Status "Geschrieben" verfügbar
- [ ] Etage optional, Sammeletage funktioniert
- [ ] Kategorie-Änderungen werden geloggt
- [ ] Call Back Liste zeigt richtige Adressen
- [ ] Termine können erstellt und angezeigt werden
- [ ] PLZ-Beschränkung funktioniert

### Datenbank-Schema (Google Sheets):

#### Sheet "Log_Änderung_Kategorie":
| Spalte A | Spalte B | Spalte C | Spalte D | Spalte E | Spalte F | Spalte G | Spalte H | Spalte I |
|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| ID | Dataset-ID | Original Name | Current Name | Old Category | New Category | Changed By | Changed At | Dataset Snapshot |

#### Sheet "Termine":
| Spalte A | Spalte B | Spalte C | Spalte D | Spalte E | Spalte F | Spalte G | Spalte H |
|----------|----------|----------|----------|----------|----------|----------|----------|
| ID | Dataset-ID | Resident Name | Appointment Date | Appointment Time | Address | Created By | Created At |

#### Sheet "Zugangsdaten" Spalte C:
- Kommagetrennte PLZ-Liste: "12345,67890,11111"
- Leer = keine Beschränkung

## 🔧 Entwicklungs-Workflow

1. Features einzeln implementieren und testen
2. Nach jedem Feature: Commit mit aussagekräftiger Message
3. Testing in lokaler Umgebung vor Deployment
4. Dokumentation in entsprechenden README-Dateien aktualisieren
