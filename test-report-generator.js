/**
 * Test Script für PDF Report Generator V2.0
 * 
 * Verwendung:
 * node test-report-generator.js [DATUM]
 * 
 * Beispiel:
 * node test-report-generator.js 2025-01-15
 * 
 * Ohne Datum wird das gestrige Datum verwendet.
 */

// Setze NODE_ENV auf development für bessere Logs
process.env.NODE_ENV = 'development';

// Import erforderlich (ES Modules Syntax für TypeScript)
const { generateDailyReport, reportExists, getReportPath } = require('./server/services/reportGenerator');

// Parse Command Line Arguments
const args = process.argv.slice(2);
const testDate = args[0] || getYesterday();

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   PDF Report Generator V2.0 - Test Suite                  ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

console.log(`📅 Test-Datum: ${testDate}`);
console.log('');

// Haupt-Test-Funktion
async function runTests() {
  try {
    // Test 1: Prüfe ob Report bereits existiert
    console.log('🔍 Test 1: Prüfe ob Report existiert...');
    if (reportExists(testDate)) {
      console.log('   ✅ Report existiert bereits:', getReportPath(testDate));
      console.log('   ℹ️  Lösche den Report oder verwende ein anderes Datum für den Test.');
      console.log('');
    } else {
      console.log('   ✅ Report existiert noch nicht');
      console.log('');
    }

    // Test 2: Generiere Report
    console.log('📊 Test 2: Generiere Report...');
    console.log('   (Dies kann 5-30 Sekunden dauern, abhängig von der Datenmenge)');
    console.log('');
    
    const startTime = Date.now();
    const filePath = await generateDailyReport(testDate);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('');
    console.log('✅ Report erfolgreich generiert!');
    console.log(`   Dauer: ${duration} Sekunden`);
    console.log(`   Pfad: ${filePath}`);
    console.log('');

    // Test 3: Verifiziere Dateierstellung
    console.log('🔍 Test 3: Verifiziere Dateierstellung...');
    if (reportExists(testDate)) {
      console.log('   ✅ Report-Datei wurde erfolgreich erstellt');
      
      const fs = require('fs');
      const stats = fs.statSync(filePath);
      const fileSizeKB = (stats.size / 1024).toFixed(2);
      
      console.log(`   📦 Dateigröße: ${fileSizeKB} KB`);
      
      if (stats.size < 10 * 1024) {
        console.log('   ⚠️  Warnung: Datei scheint sehr klein zu sein (< 10 KB)');
        console.log('      Möglicherweise enthält der Report keine oder wenig Daten');
      } else {
        console.log('   ✅ Dateigröße ist plausibel');
      }
    } else {
      console.log('   ❌ Report-Datei wurde NICHT erstellt');
      throw new Error('Report file was not created');
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ ALLE TESTS BESTANDEN!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📄 Öffne den Report mit:');
    console.log(`   start "${filePath}"`);
    console.log('');
    console.log('💡 Tipps:');
    console.log('   - Prüfe ob alle User-Daten korrekt angezeigt werden');
    console.log('   - Kontrolliere die Status-Änderungen Sektion');
    console.log('   - Verifiziere die GPS-Route Top 10');
    console.log('   - Teste die Links zwischen Übersicht und Detail-Seiten');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ TEST FEHLGESCHLAGEN!');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('');
    console.error('Fehler:', error.message);
    console.error('');
    
    if (error.message.includes('No activity data found')) {
      console.error('💡 Mögliche Ursache:');
      console.error('   - Keine Daten für dieses Datum in Google Sheets');
      console.error('   - Verwende ein Datum, an dem Mitarbeiter aktiv waren');
      console.error('');
    } else if (error.message.includes('No users with sufficient activity')) {
      console.error('💡 Mögliche Ursache:');
      console.error('   - Alle User hatten < 10 GPS-Punkte UND < 5 Actions');
      console.error('   - Verwende ein Datum mit mehr Aktivität');
      console.error('');
    } else if (error.message.includes('Google Sheets')) {
      console.error('💡 Mögliche Ursache:');
      console.error('   - GOOGLE_SHEETS_KEY nicht konfiguriert');
      console.error('   - Service Account hat keine Berechtigung');
      console.error('   - Netzwerkproblem beim Zugriff auf Google Sheets API');
      console.error('');
    }
    
    console.error('Stack Trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Helper: Gestern als YYYY-MM-DD
function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

// Run Tests
runTests();
