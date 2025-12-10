/**
 * Analyze SQLite database for external tracking data
 */
import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('logs-2025-11-18.db', { readonly: true });

console.log('=== DATABASE ANALYSIS ===\n');

// 1. Overview: Log counts per user and type
console.log('1. LOG COUNTS PER USER AND TYPE:');
console.log('─'.repeat(80));
const overview = db.prepare(`
  SELECT username, log_type, COUNT(*) as count 
  FROM user_logs 
  GROUP BY username, log_type 
  ORDER BY username, log_type
`).all();

let currentUser = '';
overview.forEach(row => {
  if (row.username !== currentUser) {
    if (currentUser) console.log('');
    currentUser = row.username;
    console.log(`\n${row.username}:`);
  }
  console.log(`  ${row.log_type.padEnd(10)} : ${row.count.toLocaleString()}`);
});

// 2. Detailed analysis for Kiri
console.log('\n\n2. DETAILED ANALYSIS FOR KIRI:');
console.log('─'.repeat(80));

const kiriLogs = db.prepare(`
  SELECT log_type, COUNT(*) as count 
  FROM user_logs 
  WHERE username = 'Kiri' 
  GROUP BY log_type
`).all();

console.log('\nKiri Log Types:');
kiriLogs.forEach(row => {
  console.log(`  ${row.log_type.padEnd(10)} : ${row.count.toLocaleString()}`);
});

// Check GPS logs for Kiri
const kiriGPS = db.prepare(`
  SELECT COUNT(*) as total,
         SUM(CASE WHEN json_extract(data, '$.source') = 'external_app' THEN 1 ELSE 0 END) as external,
         SUM(CASE WHEN json_extract(data, '$.source') = 'native' THEN 1 ELSE 0 END) as native
  FROM user_logs 
  WHERE username = 'Kiri' AND log_type = 'gps'
`).get();

console.log('\nKiri GPS Breakdown:');
console.log(`  Total GPS:    ${kiriGPS.total.toLocaleString()}`);
console.log(`  External:     ${kiriGPS.external.toLocaleString()}`);
console.log(`  Native:       ${kiriGPS.native.toLocaleString()}`);

// Sample external tracking data for Kiri
console.log('\nSample External GPS Data (first 5):');
const externalSamples = db.prepare(`
  SELECT timestamp, data
  FROM user_logs 
  WHERE username = 'Kiri' 
    AND log_type = 'gps' 
    AND json_extract(data, '$.source') = 'external_app'
  ORDER BY timestamp
  LIMIT 5
`).all();

externalSamples.forEach((row, idx) => {
  const data = JSON.parse(row.data);
  const date = new Date(row.timestamp);
  console.log(`  ${idx + 1}. ${date.toISOString()} - Lat: ${data.latitude}, Lng: ${data.longitude}, Source: ${data.source}`);
});

// 3. Export all logs for comparison
console.log('\n\n3. EXPORTING ALL LOGS TO CSV...');
console.log('─'.repeat(80));

const allLogs = db.prepare(`
  SELECT 
    timestamp,
    username,
    log_type,
    data
  FROM user_logs 
  ORDER BY username, timestamp
`).all();

// Create CSV
let csv = 'Timestamp,Username,Log Type,Latitude,Longitude,Source,Endpoint,Action\n';

allLogs.forEach(log => {
  const data = JSON.parse(log.data);
  const date = new Date(log.timestamp).toISOString();
  
  const lat = data.latitude || data.gps?.latitude || '';
  const lng = data.longitude || data.gps?.longitude || '';
  const source = data.source || '';
  const endpoint = data.endpoint || '';
  const action = data.data?.action || data.action || '';
  
  csv += `${date},"${log.username}",${log.log_type},"${lat}","${lng}","${source}","${endpoint}","${action}"\n`;
});

fs.writeFileSync('logs-2025-11-18-export.csv', csv);
console.log('✅ Exported to: logs-2025-11-18-export.csv');
console.log(`   Total rows: ${allLogs.length.toLocaleString()}`);

// 4. Time range analysis for Kiri
console.log('\n\n4. TIME RANGE ANALYSIS FOR KIRI:');
console.log('─'.repeat(80));

const kiriTimeRange = db.prepare(`
  SELECT 
    MIN(timestamp) as first_log,
    MAX(timestamp) as last_log,
    log_type
  FROM user_logs 
  WHERE username = 'Kiri'
  GROUP BY log_type
`).all();

kiriTimeRange.forEach(row => {
  const first = new Date(row.first_log);
  const last = new Date(row.last_log);
  console.log(`\n${row.log_type}:`);
  console.log(`  First: ${first.toISOString()}`);
  console.log(`  Last:  ${last.toISOString()}`);
  console.log(`  Duration: ${((last - first) / 1000 / 60 / 60).toFixed(2)} hours`);
});

db.close();
console.log('\n✅ Analysis complete!\n');
