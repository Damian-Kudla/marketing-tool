import Database from 'better-sqlite3';

const db = new Database('logs-2025-11-18.db', { readonly: true });

console.log('=== GPS DATA STRUCTURE CHECK ===\n');

// Get first 10 GPS logs for Kiri
const gpsLogs = db.prepare(`
  SELECT timestamp, data
  FROM user_logs 
  WHERE username = 'Kiri' AND log_type = 'gps'
  ORDER BY timestamp
  LIMIT 10
`).all();

console.log(`Found ${gpsLogs.length} GPS logs for Kiri\n`);

gpsLogs.forEach((log, idx) => {
  const data = JSON.parse(log.data);
  const date = new Date(log.timestamp);
  
  console.log(`${idx + 1}. ${date.toISOString()}`);
  console.log(`   Data keys: ${Object.keys(data).join(', ')}`);
  console.log(`   Full data: ${JSON.stringify(data)}`);
  console.log('');
});

db.close();
