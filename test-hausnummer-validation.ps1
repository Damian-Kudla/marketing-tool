# Test: Hausnummer-Validierung mit Nominatim
# Testet ob unbekannte Hausnummern auf existierenden Straßen akzeptiert werden

Write-Host "`n=== HAUSNUMMER-VALIDIERUNG TEST ===" -ForegroundColor Cyan
Write-Host "Testet Nominatim Fallback für unbekannte Hausnummern`n" -ForegroundColor Yellow

$testCases = @(
    @{
        name = "1. Bekannte Adresse (Regression-Test)"
        street = "Neusser Weyhe"
        number = "39"
        postal = "41462"
        city = "Neuss"
        expected = "GEFUNDEN (mit Hausnummer von OSM)"
    },
    @{
        name = "2. Unbekannte Hausnummer auf bekannter Straße"
        street = "Neusser Weyhe"
        number = "999"
        postal = "41462"
        city = "Neuss"
        expected = "GEFUNDEN (Straße existiert, User-Hausnummer verwendet)"
    },
    @{
        name = "3. Hohe Hausnummer (Neubau)"
        street = "Ferdinand-Stücker-Straße"
        number = "9999"
        postal = "51067"
        city = "Köln"
        expected = "GEFUNDEN (Straße existiert, User-Hausnummer verwendet)"
    },
    @{
        name = "4. Komplett unbekannte Adresse"
        street = "Nichtexistierende Straße"
        number = "123"
        postal = "12345"
        city = "Irgendwo"
        expected = "NICHT GEFUNDEN (weder mit Hausnummer noch ohne)"
    }
)

foreach ($test in $testCases) {
    Write-Host "$($test.name)" -ForegroundColor White
    Write-Host "  Input: $($test.street) $($test.number), $($test.postal) $($test.city)" -ForegroundColor Gray
    Write-Host "  Erwartung: $($test.expected)" -ForegroundColor DarkGray
    
    # Suche MIT Hausnummer
    $fullAddr = "$($test.street) $($test.number), $($test.postal) $($test.city), Deutschland"
    $url1 = "https://nominatim.openstreetmap.org/search?q=$([uri]::EscapeDataString($fullAddr))&format=json&addressdetails=1&limit=1"
    $headers = @{'User-Agent'='EnergyScanCapture/1.0'}
    
    try {
        Write-Host "    → Suche 1: MIT Hausnummer..." -ForegroundColor DarkGray
        $resp1 = Invoke-RestMethod -Uri $url1 -Headers $headers -Method Get
        
        if ($resp1.Count -gt 0) {
            $result1 = $resp1[0]
            $road = $result1.address.road
            $num = $result1.address.house_number
            $postcode = $result1.address.postcode
            $cityResult = $result1.address.city
            
            if ($road -and $num) {
                Write-Host "    ✅ GEFUNDEN (mit Hausnummer): $road $num, $postcode $cityResult" -ForegroundColor Green
                Write-Host "       Type: $($result1.type), Class: $($result1.class)" -ForegroundColor DarkGreen
            } else {
                Write-Host "    ⚠️ Gefunden aber unvollständig (kein house_number)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "    → Suche 1: Keine Ergebnisse" -ForegroundColor DarkGray
            
            # Warte 1 Sekunde (Rate Limiting)
            Start-Sleep -Milliseconds 1100
            
            # FALLBACK: Suche OHNE Hausnummer
            $streetOnly = "$($test.street), $($test.postal) $($test.city), Deutschland"
            $url2 = "https://nominatim.openstreetmap.org/search?q=$([uri]::EscapeDataString($streetOnly))&format=json&addressdetails=1&limit=1"
            
            Write-Host "    → Suche 2: NUR Straße (Fallback)..." -ForegroundColor DarkGray
            $resp2 = Invoke-RestMethod -Uri $url2 -Headers $headers -Method Get
            
            if ($resp2.Count -gt 0) {
                $result2 = $resp2[0]
                $road = $result2.address.road
                $postcode = $result2.address.postcode
                $cityResult = $result2.address.city
                
                if ($road) {
                    Write-Host "    ✅ STRASSE GEFUNDEN: $road, $postcode $cityResult" -ForegroundColor Green
                    Write-Host "       → User-Hausnummer wird verwendet: $($test.number)" -ForegroundColor Cyan
                    Write-Host "       Type: $($result2.type), Class: $($result2.class)" -ForegroundColor DarkGreen
                } else {
                    Write-Host "    ⚠️ Gefunden aber keine Straße (road) im Ergebnis" -ForegroundColor Yellow
                }
            } else {
                Write-Host "    ❌ NICHT GEFUNDEN (auch ohne Hausnummer)" -ForegroundColor Red
            }
        }
        
    } catch {
        Write-Host "    ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
    Start-Sleep -Milliseconds 1100
}

Write-Host "`n=== TEST ABGESCHLOSSEN ===" -ForegroundColor Cyan
Write-Host "Hinweis: Server-Implementierung prüft automatisch:" -ForegroundColor Yellow
Write-Host "  1. Suche mit Hausnummer" -ForegroundColor Gray
Write-Host "  2. Bei Misserfolg: Fallback auf Straße ohne Hausnummer" -ForegroundColor Gray
Write-Host "  3. Wenn Straße existiert: User-Hausnummer verwenden" -ForegroundColor Gray
Write-Host "  4. Wenn Straße nicht existiert: Fallback zu Google Geocoding`n" -ForegroundColor Gray
