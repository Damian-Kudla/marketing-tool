# AddressDatasets Fix - 2024-10-19

## 🐛 Probleme

### Problem 1: "Alte Datensätze verfügbar" geht nicht weg
**Symptom:**  
Nach dem Anzeigen von Datensätzen bleibt die Komponente sichtbar, selbst wenn:
- Die Adresse gelöscht wird
- Eine neue Adresse eingegeben wird
- Die Komponente sollte aktualisiert werden

**Ursache:**  
1. `useEffect` hatte nur `shouldLoad` als Dependency
2. Keine Prüfung ob die Adresse sich geändert hat
3. Datasets wurden nicht gelöscht bei Adresse-Änderung

---

### Problem 2: Adresse wird nicht bei mehreren Hausnummern angezeigt
**Symptom:**  
Die Adresse (Straße + Hausnummer) wird nur bei `isNonExactMatch` angezeigt, aber nicht wenn:
- User nach mehreren Hausnummern sucht (z.B. "23,24,25")
- Dataset mehrere Hausnummern abdeckt (z.B. "23/24")

**Erwartetes Verhalten:**  
Adresse soll angezeigt werden wenn:
1. Non-Exact Match (andere Hausnummer)
2. Query hat mehrere Nummern (`,` oder `-`)
3. Dataset hat mehrere Nummern (`,`, `/`, oder `-`)

---

## ✅ Implementierte Fixes

### Fix 1: Datasets werden jetzt korrekt aktualisiert/gelöscht

**Änderungen in `AddressDatasets.tsx`:**

1. **Neuer State für Last Loaded Address:**
```typescript
const [lastLoadedAddress, setLastLoadedAddress] = useState<string | null>(null);

// Create normalized address string for comparison
const normalizedAddress = address 
  ? `${address.street || ''} ${address.number || ''} ${address.postal || ''} ${address.city || ''}`.toLowerCase().trim()
  : null;
```

2. **UseEffect mit Address-Tracking:**
```typescript
// FIX: Load datasets when shouldLoad changes OR address changes
useEffect(() => {
  if (shouldLoad && normalizedAddress && normalizedAddress !== lastLoadedAddress) {
    console.log('[AddressDatasets] Loading datasets for:', normalizedAddress);
    loadDatasets();
    setLastLoadedAddress(normalizedAddress);
  }
}, [shouldLoad, normalizedAddress]);
```

**Funktionsweise:**
- ✅ Vergleicht normalisierte Adresse mit letzter geladener Adresse
- ✅ Lädt nur wenn Adresse tatsächlich geändert wurde
- ✅ Verhindert unnötige API-Calls bei gleichbleibender Adresse

3. **UseEffect zum Löschen bei Adresse-Clear:**
```typescript
// FIX: Clear datasets when address is cleared or changes dramatically
useEffect(() => {
  if (!normalizedAddress) {
    console.log('[AddressDatasets] Address cleared, resetting datasets');
    setDatasets([]);
    setLastLoadedAddress(null);
    setIsExpanded(false);
  }
}, [normalizedAddress]);
```

**Funktionsweise:**
- ✅ Löscht Datasets wenn Adresse gelöscht wird
- ✅ Collapsed die Liste automatisch
- ✅ Reset des Address-Trackings

---

### Fix 2: Adresse bei mehreren Hausnummern anzeigen

**Änderungen in `AddressDatasets.tsx` (Render-Logik):**

```typescript
{datasets.map((dataset) => {
  // Check if query has multiple house numbers (comma, slash, or hyphen)
  const queryHasMultipleNumbers = address.number && (
    address.number.includes(',') || 
    address.number.includes('/') ||
    address.number.includes('-')
  );
  
  // Check if dataset has multiple house numbers
  const datasetHasMultipleNumbers = dataset.houseNumber && (
    dataset.houseNumber.includes(',') || 
    dataset.houseNumber.includes('/') ||
    dataset.houseNumber.includes('-')
  );
  
  // Show address if:
  // 1. It's a non-exact match (different house number), OR
  // 2. Query has multiple numbers (e.g., "23,24"), OR
  // 3. Dataset covers multiple numbers (e.g., "23/24")
  const shouldShowAddress = 
    dataset.isNonExactMatch || 
    queryHasMultipleNumbers || 
    datasetHasMultipleNumbers;
  
  return (
    <div key={dataset.id} className="...">
      <div className="...">
        <div className="...">
          <User className="..." />
        </div>
        <div className="...">
          <p className="text-sm font-medium">{dataset.createdBy}</p>
          {shouldShowAddress && dataset.street && dataset.houseNumber && (
            <p className="text-xs font-medium text-blue-600 truncate">
              {dataset.street} {dataset.houseNumber}
            </p>
          )}
          <p className="text-xs text-muted-foreground truncate">
            {formatDate(dataset.createdAt)} • {dataset.residentCount} {t('datasets.residents', 'Bewohner')}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" ...>
        {t('datasets.load', 'Laden')}
      </Button>
    </div>
  );
})}
```

**Logik:**
1. **Query-Check:** Prüft ob User nach mehreren Nummern sucht (`23,24` oder `20-30`)
2. **Dataset-Check:** Prüft ob Dataset mehrere Nummern abdeckt (`23/24`)
3. **Non-Exact-Match:** Alte Logik für verschiedene Hausnummern bleibt erhalten
4. **Zeige Adresse wenn EINE dieser Bedingungen erfüllt ist**

---

## 📊 Vorher/Nachher-Vergleich

### Szenario 1: Adresse löschen

**Vorher:**
```
1. Adresse "Kaspar-Düppes-Str. 23" eingeben
2. Datasets werden geladen ✅
3. Adresse löschen
4. Datasets bleiben sichtbar ❌
5. "Alte Datensätze verfügbar (2)" bleibt da ❌
```

**Nachher:**
```
1. Adresse "Kaspar-Düppes-Str. 23" eingeben
2. Datasets werden geladen ✅
3. Adresse löschen
4. Datasets verschwinden ✅
5. Komponente wird versteckt ✅
```

---

### Szenario 2: Adresse ändern

**Vorher:**
```
1. Adresse "Kaspar-Düppes-Str. 23" eingeben
2. Datasets werden geladen (zeigt Datensätze für Nr. 23) ✅
3. Adresse zu "Neusser Weyhe 39" ändern
4. Datasets bleiben von "Kaspar-Düppes-Str. 23" ❌
5. Keine Aktualisierung ❌
```

**Nachher:**
```
1. Adresse "Kaspar-Düppes-Str. 23" eingeben
2. Datasets werden geladen (zeigt Datensätze für Nr. 23) ✅
3. Adresse zu "Neusser Weyhe 39" ändern
4. Datasets werden neu geladen ✅
5. Zeigt jetzt Datensätze für "Neusser Weyhe 39" ✅
```

---

### Szenario 3: Query mit mehreren Hausnummern

**Vorher:**
```
1. Suche nach "Kaspar-Düppes-Str. 23,24,25"
2. Dataset gefunden: "Kaspar-Düppes-Str. 23/24" (von Leon)
3. Anzeige:
   Leon
   22.01.2024 10:30 • 3 Bewohner
   [Keine Adresse sichtbar] ❌
```

**Nachher:**
```
1. Suche nach "Kaspar-Düppes-Str. 23,24,25"
2. Dataset gefunden: "Kaspar-Düppes-Str. 23/24" (von Leon)
3. Anzeige:
   Leon
   Kaspar-Düppes-Str. 23/24 ✅ (blau)
   22.01.2024 10:30 • 3 Bewohner
```

---

### Szenario 4: Dataset mit mehreren Hausnummern

**Vorher:**
```
1. Suche nach "Ferdinand-Stücker-Str. 14"
2. Dataset gefunden: "Ferdinand-Stücker-Str. 14,15,16" (von Damian)
3. Anzeige:
   Damian
   22.01.2024 15:45 • 8 Bewohner
   [Keine Adresse sichtbar] ❌
```

**Nachher:**
```
1. Suche nach "Ferdinand-Stücker-Str. 14"
2. Dataset gefunden: "Ferdinand-Stücker-Str. 14,15,16" (von Damian)
3. Anzeige:
   Damian
   Ferdinand-Stücker-Str. 14,15,16 ✅ (blau)
   22.01.2024 15:45 • 8 Bewohner
```

---

## 🧪 Test-Szenarien

### Test 1: Datasets verschwinden bei Adresse löschen
1. Adresse eingeben: "Kaspar-Düppes-Str. 23, 51067 Köln"
2. Warten bis Datasets geladen
3. **Erwartung:** "Alte Datensätze verfügbar (X)" erscheint
4. Adresse komplett löschen
5. **Erwartung:** Komponente verschwindet sofort ✅

### Test 2: Datasets aktualisieren bei Adresse ändern
1. Adresse eingeben: "Kaspar-Düppes-Str. 23, 51067 Köln"
2. Datasets laden
3. **Erwartung:** Zeigt Datensätze für diese Adresse
4. Adresse ändern zu: "Neusser Weyhe 39, 41462 Neuss"
5. **Erwartung:** Datasets werden neu geladen, zeigt andere Datensätze ✅

### Test 3: Adresse bei Query mit mehreren Nummern
1. Adresse eingeben: "Kaspar-Düppes-Str. 23,24, 51067 Köln"
2. Datasets laden
3. Dropdown öffnen
4. **Erwartung:** Bei jedem Dataset wird "Straße + Hausnummer" in blau angezeigt ✅

### Test 4: Adresse bei Dataset mit mehreren Nummern
1. Adresse eingeben: "Kaspar-Düppes-Str. 23, 51067 Köln"
2. Datasets laden (einer davon: "23/24")
3. Dropdown öffnen
4. **Erwartung:** Dataset mit "23/24" zeigt "Kaspar-Düppes-Str. 23/24" in blau ✅

### Test 5: Adresse bei Non-Exact Match
1. Adresse eingeben: "Kaspar-Düppes-Str. 30, 51067 Köln"
2. Datasets laden (gefunden: Nr. 23, 25, 28)
3. Dropdown öffnen
4. **Erwartung:** Alle Datasets zeigen ihre jeweilige Hausnummer in blau ✅

---

## 🎯 Zusammenfassung

### Geänderte Datei:
- `client/src/components/AddressDatasets.tsx`

### Features:
- ✅ **Auto-Clear:** Datasets verschwinden bei Adresse löschen
- ✅ **Auto-Update:** Datasets laden neu bei Adresse ändern
- ✅ **Smart Display:** Adresse wird bei mehreren Hausnummern angezeigt
- ✅ **No Duplicates:** Verhindert unnötige API-Calls durch Address-Tracking

### Bug Fixes:
- ✅ "Alte Datensätze verfügbar" verschwindet korrekt
- ✅ Datasets aktualisieren sich bei Adresse-Änderung
- ✅ Adresse sichtbar bei Query mit mehreren Nummern
- ✅ Adresse sichtbar bei Dataset mit mehreren Nummern

---

## 🚀 Status

**Implementiert:** ✅  
**Ready for Testing:** ✅  
**Datum:** 2024-10-19

**Nächste Schritte:**
1. Frontend neu laden (F5)
2. Test-Szenarien durchführen
3. Feedback geben
