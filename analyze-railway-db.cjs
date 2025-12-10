const Database = require('better-sqlite3');

const db = new Database('logs-2025-11-18-railway.db', { readonly: true });

// Check tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in Railway DB:', tables.map(t => t.name).join(', '));

if (tables.length === 0) {
  console.log('❌ Keine Tabellen gefunden - leere oder korrupte Datenbank');
  db.close();
  process.exit(0);
}

// Check if logs table exists
const hasLogsTable = tables.some(t => t.name === 'logs');

if (!hasLogsTable) {
  console.log('❌ Keine "logs" Tabelle gefunden');
  db.close();
  process.exit(0);
}

// Analyze Kiri's logs
const kirisLogs = db.prepare('SELECT * FROM logs WHERE username = ? ORDER BY timestamp ASC').all('Kiri');
console.log('\n=== KIRI LOGS IN RAILWAY DB ===');
console.log('Total logs:', kirisLogs.length);

if (kirisLogs.length === 0) {
  console.log('❌ Keine Logs für Kiri gefunden');
  db.close();
  process.exit(0);
}

// Time range
const firstLog = new Date(kirisLogs[0].timestamp);
const lastLog = new Date(kirisLogs[kirisLogs.length - 1].timestamp);
console.log('First log:', firstLog.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
console.log('Last log:', lastLog.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));

// Analyze GPS sources
let nativeLogs = 0;
let externalLogs = 0;
let firstExternalLog = null;
let lastExternalLog = null;

kirisLogs.forEach(log => {
  try {
    const data = JSON.parse(log.data);
    const source = data?.data?.source;
    
    if (source === 'native') {
      nativeLogs++;
    } else if (source === 'external') {
      externalLogs++;
      if (!firstExternalLog) firstExternalLog = log;
      lastExternalLog = log;
    }
  } catch (e) {
    // Ignore parse errors
  }
});

console.log('\n=== GPS SOURCE BREAKDOWN ===');
console.log('Native GPS logs:', nativeLogs);
console.log('External GPS logs:', externalLogs);

if (externalLogs > 0) {
  const firstExt = new Date(firstExternalLog.timestamp);
  const lastExt = new Date(lastExternalLog.timestamp);
  console.log('\nExternal GPS time range:');
  console.log('  First:', firstExt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
  console.log('  Last:', lastExt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
}

// Show last 5 logs
console.log('\n=== LAST 5 LOGS ===');
kirisLogs.slice(-5).forEach((log, i) => {
  const date = new Date(log.timestamp);
  const timeStr = date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  
  try {
    const data = JSON.parse(log.data);
    const action = data.action;
    const source = data?.data?.source || 'unknown';
    console.log(`${i + 1}. ${timeStr} - ${action} (${source})`);
  } catch (e) {
    console.log(`${i + 1}. ${timeStr} - Parse error`);
  }
});

db.close();
