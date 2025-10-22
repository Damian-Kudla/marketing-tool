# 🏢 Etagen-Feld: Erdgeschoss (0) erlauben

## Problem

**Symptom:** Nutzer können im Bearbeitungsfeld keine "0" für Erdgeschoss eingeben.

**Vermutung des Users:** Möglicherweise wurden früher verschiedene Bearbeitungsfelder verwendet (für Tabellenansicht vs. Ergebnisliste), die unterschiedlich konfiguriert waren.

---

## Analyse

### ✅ **Bestätigung: Es gibt NUR EINE zentrale Komponente**

**Komponente:** `client/src/components/ResidentEditPopup.tsx`

**Verwendet in:**
1. ✅ `ResultsDisplay.tsx` (Zeile 28) - Ergebnisliste nach OCR-Scan
2. ✅ `ImageWithOverlays.tsx` (Zeile 8) - Foto mit Overlays (Click auf Namen)
3. ✅ `AddressOverview.tsx` (Zeile 10) - Tabellenansicht (Click auf Header-Adresse)

**Resultat:** Alle drei Stellen verwenden **dieselbe Komponente** → Änderungen gelten überall! ✅

---

## Ursprüngliches Problem

### **Input-Feld (Zeile 410-422):**

**Vorher:**
```tsx
<Input
  id="floor"
  type="number"
  min="0"              // ✅ Technisch erlaubt
  max="100"
  value={formData.floor || ''}     // ❌ PROBLEM: 0 wird zu ''
  onChange={(e) => 
    setFormData({ 
      ...formData, 
      floor: e.target.value ? parseInt(e.target.value) : undefined  // ❌ 0 wird zu undefined
    })
  }
  placeholder="z.B. 3"
/>
```

**Problem-Analyse:**
1. `value={formData.floor || ''}` → Wenn `floor = 0`, wird es zu `''` (leer)
2. `e.target.value ? parseInt(...) : undefined` → Wenn User "0" eingibt, wird es zu `undefined`
3. User sieht leeres Feld statt "0"

### **Validierung (Zeile 97):**

```typescript
if (formData.floor !== undefined && (formData.floor < 0 || formData.floor > 100)) {
  toast({
    variant: 'destructive',
    title: 'Ungültige Etage',
    description: 'Etage muss zwischen 0 und 100 liegen',  // ✅ Korrekte Meldung
  });
  return;
}
```

**Analyse:** Validierung war bereits korrekt (erlaubt 0-100)!

---

## Lösung

### **1. Input-Feld korrigiert (Zeile 410-424):**

```tsx
<Label htmlFor="floor">
  {t('resident.edit.floor', 'Etage')} 
  <span className="text-muted-foreground text-xs">(0 = Erdgeschoss, optional)</span>
</Label>
<Input
  id="floor"
  type="number"
  min="0"
  max="100"
  value={formData.floor !== undefined ? formData.floor : ''}  // ✅ 0 bleibt 0
  onChange={(e) => {
    const value = e.target.value;
    setFormData({ 
      ...formData, 
      floor: value === '' ? undefined : parseInt(value)  // ✅ Expliziter Check
    });
  }}
  placeholder={t('resident.edit.floorPlaceholder', '0 für Erdgeschoss')}  // ✅ Klarer Hinweis
  disabled={loading}
/>
```

**Änderungen:**
1. ✅ `value={formData.floor !== undefined ? formData.floor : ''}` 
   - Wenn `floor = 0` → Zeigt "0" an (nicht leer)
   - Wenn `floor = undefined` → Zeigt "" an (leer)

2. ✅ `value === '' ? undefined : parseInt(value)`
   - Expliziter Check auf leeren String
   - "0" wird korrekt als `0` gespeichert

3. ✅ Label-Text: `"(0 = Erdgeschoss, optional)"`
   - Macht klar, dass 0 = Erdgeschoss

4. ✅ Placeholder: `"0 für Erdgeschoss"`
   - Gibt Beispiel für Erdgeschoss

---

## Beispiele: Vorher vs. Nachher

### **Beispiel 1: Erdgeschoss eingeben**

**Vorher:**
```
User gibt "0" ein → Feld zeigt "" (leer) → formData.floor = undefined ❌
```

**Nachher:**
```
User gibt "0" ein → Feld zeigt "0" → formData.floor = 0 ✅
```

---

### **Beispiel 2: Datensatz mit Erdgeschoss laden**

**Vorher:**
```javascript
resident = { name: "Max Müller", floor: 0, door: "A" }
// Popup öffnen → Etagen-Feld ist LEER (weil value={formData.floor || ''})
```

**Nachher:**
```javascript
resident = { name: "Max Müller", floor: 0, door: "A" }
// Popup öffnen → Etagen-Feld zeigt "0" ✅
```

---

### **Beispiel 3: Etage löschen (zurück zu optional)**

**Vorher:**
```
User löscht Inhalt des Feldes → formData.floor = undefined ✅ (korrekt)
```

**Nachher:**
```
User löscht Inhalt des Feldes → formData.floor = undefined ✅ (weiterhin korrekt)
```

---

## Validierung

Die Validierung bleibt unverändert:

```typescript
if (formData.floor !== undefined && (formData.floor < 0 || formData.floor > 100)) {
  // ❌ Fehler anzeigen
}
```

**Erlaubte Werte:**
- `undefined` - Keine Etage (optional) ✅
- `0` - Erdgeschoss ✅
- `1-100` - Etagen 1 bis 100 ✅

**Nicht erlaubte Werte:**
- `-1, -2, ...` - Negative Zahlen ❌
- `101, 102, ...` - Über 100 ❌

---

## Testing

### **Test 1: Erdgeschoss eingeben**
1. Bewohner bearbeiten
2. Etagen-Feld: "0" eingeben
3. Speichern
4. ✅ Erwartung: `floor = 0` gespeichert
5. ✅ Popup erneut öffnen → Feld zeigt "0"

### **Test 2: Bestehenden Erdgeschoss-Bewohner laden**
1. Datensatz mit `floor = 0` laden
2. Bewohner anklicken → Popup öffnet
3. ✅ Erwartung: Etagen-Feld zeigt "0"

### **Test 3: Etage löschen**
1. Bewohner mit Etage bearbeiten
2. Etagen-Feld leeren (Backspace/Delete)
3. Speichern
4. ✅ Erwartung: `floor = undefined`

### **Test 4: Über alle Einstiegspunkte**
1. ✅ Ergebnisliste (ResultsDisplay) → Bewohner klicken → Popup → "0" eingeben → Speichern
2. ✅ Foto-Overlay (ImageWithOverlays) → Name klicken → Popup → "0" eingeben → Speichern
3. ✅ Tabellenansicht (AddressOverview) → Bewohner klicken → Popup → "0" eingeben → Speichern

**Erwartung:** Alle drei Wege verwenden **dieselbe Komponente** → "0" funktioniert überall! ✅

---

## UI-Verbesserungen

### **Vorher:**
```tsx
<Label>Etage <span>(optional)</span></Label>
<Input placeholder="z.B. 3" />
```

### **Nachher:**
```tsx
<Label>Etage <span>(0 = Erdgeschoss, optional)</span></Label>
<Input placeholder="0 für Erdgeschoss" />
```

**Vorteile:**
- ✅ Klarer Hinweis, dass 0 = Erdgeschoss
- ✅ Beispiel im Placeholder
- ✅ User weiß sofort, wie Erdgeschoss eingegeben wird

---

## Technische Details

### **JavaScript Truthiness Problem:**

```javascript
// Problem mit ||
0 || 'default'  // → 'default' ❌ (0 ist falsy!)
1 || 'default'  // → 1 ✅

// Lösung mit !== undefined
0 !== undefined ? 0 : 'default'  // → 0 ✅
undefined !== undefined ? undefined : 'default'  // → 'default' ✅
```

### **Input onChange Logik:**

```javascript
// Vorher: Ternary mit Truthiness
e.target.value ? parseInt(e.target.value) : undefined
// Problem: "0" ist truthy als String, ABER parseInt("0") = 0 ist falsy als Number

// Nachher: Expliziter Leerstring-Check
value === '' ? undefined : parseInt(value)
// ✅ "0" → parseInt("0") → 0
// ✅ "" → undefined
```

---

## Zusammenfassung

### ✅ Was wurde geändert?

1. **Input value:** `formData.floor || ''` → `formData.floor !== undefined ? formData.floor : ''`
2. **onChange:** Expliziter Check `value === ''` statt Truthiness
3. **Label:** Hinweis "(0 = Erdgeschoss, optional)"
4. **Placeholder:** "0 für Erdgeschoss" statt "z.B. 3"

### ✅ Was funktioniert jetzt?

- ✅ Erdgeschoss (0) kann eingegeben werden
- ✅ Erdgeschoss wird korrekt angezeigt beim Laden
- ✅ Funktioniert über alle 3 Einstiegspunkte (Ergebnisliste, Foto, Tabelle)
- ✅ Etage kann weiterhin gelöscht werden (optional)
- ✅ Validierung 0-100 bleibt bestehen

### 🎯 Bestätigung:

**Es gibt nur EINE zentrale Komponente** (`ResidentEditPopup.tsx`), die von allen Stellen verwendet wird. Die Änderung gilt daher **überall** automatisch! ✅
