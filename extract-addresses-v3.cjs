/**
 * Extract Address Datasets from User Logs DB
 * Outputs tab-separated data for Google Sheets import
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'logs-2025-11-27.db');
const OUTPUT_PATH = path.join(__dirname, 'address-datasets-2025-11-27.txt');

console.log('Opening database:', DB_PATH);

const db = new Database(DB_PATH, { readonly: true });

// Count entries by log_type
console.log('\n=== Entries by log_type ===');
const byType = db.prepare("SELECT log_type, COUNT(*) as cnt FROM user_logs GROUP BY log_type ORDER BY cnt DESC").all();
byType.forEach(t => console.log(`  ${t.log_type}: ${t.cnt}`));

// Look for address-related log types
console.log('\n=== Looking for address-related entries ===');

// Get all non-GPS entries (GPS entries are location tracking, not addresses)
const nonGpsEntries = db.prepare(`
  SELECT * FROM user_logs 
  WHERE log_type != 'gps' 
  ORDER BY timestamp ASC
`).all();

console.log(`Non-GPS entries: ${nonGpsEntries.length}`);

// Show unique log_types that are not GPS
const uniqueNonGps = [...new Set(nonGpsEntries.map(e => e.log_type))];
console.log('Non-GPS log types:', uniqueNonGps.join(', '));

// Look at sample of each type
for (const logType of uniqueNonGps) {
  const sample = nonGpsEntries.find(e => e.log_type === logType);
  if (sample) {
    console.log(`\n--- Sample ${logType} ---`);
    try {
      const data = JSON.parse(sample.data);
      console.log(JSON.stringify(data, null, 2).substring(0, 800));
    } catch {
      console.log(sample.data?.substring(0, 500) || 'No data');
    }
  }
}

// Search for entries containing address-like data
console.log('\n=== Searching for address data in all entries ===');

const addressRelated = db.prepare(`
  SELECT * FROM user_logs 
  WHERE data LIKE '%"street"%' 
     OR data LIKE '%"streetName"%'
     OR data LIKE '%"strasse"%'
     OR data LIKE '%"hausnummer"%'
     OR data LIKE '%"plz"%'
     OR data LIKE '%"postalCode"%'
     OR log_type LIKE '%address%'
     OR log_type LIKE '%dataset%'
  ORDER BY timestamp ASC
`).all();

console.log(`Entries with address-like data: ${addressRelated.length}`);

if (addressRelated.length > 0) {
  console.log('\nSample address entries:');
  addressRelated.slice(0, 3).forEach((entry, i) => {
    console.log(`\n--- Address Entry ${i + 1} (${entry.log_type}) ---`);
    try {
      const data = JSON.parse(entry.data);
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(entry.data);
    }
  });
}

// Extract address datasets
const datasets = [];
const seenAddresses = new Map();

for (const entry of addressRelated) {
  try {
    const data = JSON.parse(entry.data);
    if (!data || typeof data !== 'object') continue;
    
    // Look for address info in various locations
    let addressInfo = null;
    
    // Direct fields
    if (data.street || data.streetName || data.strasse) {
      addressInfo = data;
    }
    // In body
    else if (data.body && (data.body.street || data.body.streetName || data.body.strasse)) {
      addressInfo = data.body;
    }
    // In address field
    else if (data.address && typeof data.address === 'object') {
      addressInfo = data.address;
    }
    // In dataset field
    else if (data.dataset && typeof data.dataset === 'object') {
      addressInfo = data.dataset;
    }
    // Recursive search
    else {
      const findAddress = (obj, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== 'object') return null;
        if (obj.street || obj.streetName || obj.strasse) return obj;
        for (const key of Object.keys(obj)) {
          if (Array.isArray(obj[key])) continue; // Skip arrays for now
          const result = findAddress(obj[key], depth + 1);
          if (result) return result;
        }
        return null;
      };
      addressInfo = findAddress(data);
    }
    
    if (!addressInfo) continue;
    
    // Extract fields
    const street = addressInfo.street || addressInfo.streetName || addressInfo.strasse || '';
    const houseNumber = addressInfo.hausnummer || addressInfo.houseNumber || addressInfo.number || '';
    const plz = addressInfo.plz || addressInfo.postalCode || addressInfo.zip || '';
    const city = addressInfo.city || addressInfo.stadt || addressInfo.ort || '';
    const status = addressInfo.status || addressInfo.kategorie || '';
    const notes = addressInfo.notes || addressInfo.bemerkungen || '';
    const residents = addressInfo.residents || addressInfo.bewohner || [];
    
    if (!street) continue;
    
    // Unique key
    const key = `${street}-${houseNumber}-${plz}`.toLowerCase().trim();
    
    const record = {
      timestamp: new Date(entry.timestamp).toISOString(),
      username: entry.username || '',
      logType: entry.log_type || '',
      street,
      houseNumber,
      plz,
      city,
      status,
      residentsCount: Array.isArray(residents) ? residents.length : 0,
      residents: Array.isArray(residents) ? residents : [],
      notes
    };
    
    seenAddresses.set(key, record);
    
  } catch (e) {
    // Skip
  }
}

const uniqueDatasets = Array.from(seenAddresses.values());
console.log(`\n✅ Found ${uniqueDatasets.length} unique address datasets`);

// If still no results, look at ALL data more carefully
if (uniqueDatasets.length === 0) {
  console.log('\n=== No address datasets found. Analyzing all data... ===');
  
  // Get entries that might contain address info
  const allWithData = db.prepare(`
    SELECT log_type, data FROM user_logs 
    WHERE log_type != 'gps' AND data IS NOT NULL AND LENGTH(data) > 50
    LIMIT 100
  `).all();
  
  console.log(`\nNon-GPS entries with data: ${allWithData.length}`);
  
  allWithData.forEach((entry, i) => {
    console.log(`\n--- ${i + 1}. ${entry.log_type} ---`);
    try {
      const parsed = JSON.parse(entry.data);
      console.log(JSON.stringify(parsed, null, 2).substring(0, 600));
    } catch {
      console.log(entry.data.substring(0, 400));
    }
  });
}

// Output
if (uniqueDatasets.length > 0) {
  // Sort by timestamp
  uniqueDatasets.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Header
  const header = 'Timestamp\tUsername\tLogType\tStreet\tHouseNumber\tPLZ\tCity\tStatus\tResidentsCount\tNotes';
  
  // Rows
  const rows = uniqueDatasets.map(d => 
    `${d.timestamp}\t${d.username}\t${d.logType}\t${d.street}\t${d.houseNumber}\t${d.plz}\t${d.city}\t${d.status}\t${d.residentsCount}\t${d.notes}`
  );
  
  const output = [header, ...rows].join('\n');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  
  console.log(`\n✅ Written to: ${OUTPUT_PATH}`);
  console.log('\n=== Preview ===');
  console.log(header);
  rows.slice(0, 10).forEach(r => console.log(r));
  
  // Also output detailed JSON with residents
  const detailed = uniqueDatasets.map(d => ({
    ...d,
    residents: d.residents
  }));
  fs.writeFileSync(
    OUTPUT_PATH.replace('.txt', '-detailed.json'),
    JSON.stringify(detailed, null, 2),
    'utf8'
  );
}

db.close();
console.log('\n\nDone!');
