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

// Check the structure of the user_logs table
console.log('\n=== user_logs structure ===');
const columns = db.prepare("PRAGMA table_info(user_logs)").all();
console.log(columns.map(c => `${c.name} (${c.type})`).join(', '));

// Count entries
const count = db.prepare("SELECT COUNT(*) as cnt FROM user_logs").get();
console.log(`\nTotal entries: ${count.cnt}`);

// Get sample entries
console.log('\n=== Sample user_logs entries ===');
const sample = db.prepare("SELECT * FROM user_logs LIMIT 3").all();
sample.forEach((s, i) => {
  console.log(`\n--- Entry ${i + 1} ---`);
  Object.keys(s).forEach(key => {
    let val = s[key];
    if (typeof val === 'string' && val.length > 200) {
      val = val.substring(0, 200) + '...';
    }
    console.log(`  ${key}: ${val}`);
  });
});

// Find unique endpoints
console.log('\n=== Unique endpoints ===');
const endpoints = db.prepare("SELECT DISTINCT endpoint FROM user_logs").all();
console.log(endpoints.map(e => e.endpoint).join('\n'));

// Look for address-related entries
console.log('\n=== Looking for address dataset entries ===');

// Check for various possible patterns
const patterns = [
  "endpoint LIKE '%address%'",
  "endpoint LIKE '%dataset%'",
  "endpoint LIKE '%adressen%'",
  "data LIKE '%street%'",
  "data LIKE '%streetName%'",
  "data LIKE '%hausnummer%'",
  "data LIKE '%plz%'",
  "address LIKE '%'",
];

for (const pattern of patterns) {
  try {
    const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM user_logs WHERE ${pattern}`);
    const result = stmt.get();
    console.log(`${pattern}: ${result.cnt} matches`);
  } catch (e) {
    console.log(`${pattern}: Error - ${e.message}`);
  }
}

// Get all entries with meaningful data
console.log('\n=== Extracting address data ===');

const allLogs = db.prepare(`
  SELECT * FROM user_logs 
  WHERE data IS NOT NULL AND data != '' AND data != '{}'
  ORDER BY timestamp ASC
`).all();

console.log(`Entries with data: ${allLogs.length}`);

const datasets = [];
const seenAddresses = new Map(); // Use Map to track by key and keep latest

for (const entry of allLogs) {
  try {
    let data = entry.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        continue; // Skip if not valid JSON
      }
    }
    
    if (!data || typeof data !== 'object') continue;
    
    // Look for address info in various locations
    let addressInfo = null;
    let foundIn = '';
    
    // Direct fields
    if (data.street || data.streetName) {
      addressInfo = data;
      foundIn = 'direct';
    }
    // In body
    else if (data.body && (data.body.street || data.body.streetName)) {
      addressInfo = data.body;
      foundIn = 'body';
    }
    // In address field
    else if (data.address && typeof data.address === 'object' && (data.address.street || data.address.streetName)) {
      addressInfo = data.address;
      foundIn = 'address';
    }
    // In dataset field
    else if (data.dataset && typeof data.dataset === 'object') {
      addressInfo = data.dataset;
      foundIn = 'dataset';
    }
    // Look for specific patterns in the stringified data
    else {
      const dataStr = JSON.stringify(data);
      if (dataStr.includes('"street"') || dataStr.includes('"streetName"')) {
        // Try to extract from nested structure
        const findAddress = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj.street || obj.streetName) return obj;
          for (const key of Object.keys(obj)) {
            const result = findAddress(obj[key]);
            if (result) return result;
          }
          return null;
        };
        addressInfo = findAddress(data);
        foundIn = 'nested';
      }
    }
    
    if (!addressInfo) continue;
    
    // Extract fields with various possible names
    const street = addressInfo.street || addressInfo.streetName || addressInfo.strasse || '';
    const houseNumber = addressInfo.hausnummer || addressInfo.houseNumber || addressInfo.number || '';
    const plz = addressInfo.plz || addressInfo.postalCode || addressInfo.zip || '';
    const city = addressInfo.city || addressInfo.stadt || addressInfo.ort || '';
    const status = addressInfo.status || addressInfo.kategorie || '';
    const residents = addressInfo.residents || addressInfo.bewohner || [];
    const notes = addressInfo.notes || addressInfo.bemerkungen || addressInfo.notizen || '';
    
    if (!street && !plz) continue; // Skip if no meaningful address data
    
    // Create unique key
    const key = `${street}-${houseNumber}-${plz}`.toLowerCase().trim();
    
    // Keep track - we want the LATEST entry for each address
    const record = {
      timestamp: entry.timestamp,
      username: entry.username || entry.userId || '',
      endpoint: entry.endpoint || '',
      method: entry.method || '',
      street,
      houseNumber,
      plz,
      city,
      status,
      residentsCount: Array.isArray(residents) ? residents.length : 0,
      residents: Array.isArray(residents) ? JSON.stringify(residents) : '',
      notes,
      foundIn,
      rawData: JSON.stringify(addressInfo).substring(0, 500)
    };
    
    // Update map (keeps latest entry per address)
    seenAddresses.set(key, record);
    
  } catch (e) {
    // Skip entries that can't be parsed
  }
}

// Convert map to array
const uniqueDatasets = Array.from(seenAddresses.values());
console.log(`Found ${uniqueDatasets.length} unique address datasets`);

// Also look specifically for /api/datasets or similar endpoints
console.log('\n=== Checking specific endpoints ===');
const datasetEndpoints = db.prepare(`
  SELECT endpoint, COUNT(*) as cnt 
  FROM user_logs 
  WHERE endpoint LIKE '%dataset%' OR endpoint LIKE '%address%' OR endpoint LIKE '%adressen%'
  GROUP BY endpoint
`).all();
console.log('Dataset-related endpoints:', datasetEndpoints);

// Output to file
if (uniqueDatasets.length > 0) {
  // Sort by timestamp
  uniqueDatasets.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Header (tab-separated for easy Sheets paste)
  const header = 'Timestamp\tUsername\tStreet\tHouseNumber\tPLZ\tCity\tStatus\tResidentsCount\tNotes';
  
  // Data rows
  const rows = uniqueDatasets.map(d => 
    `${d.timestamp}\t${d.username}\t${d.street}\t${d.houseNumber}\t${d.plz}\t${d.city}\t${d.status}\t${d.residentsCount}\t${d.notes}`
  );
  
  const output = [header, ...rows].join('\n');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`\n✅ Output written to: ${OUTPUT_PATH}`);
  
  console.log('\n=== Preview (first 10 entries) ===');
  console.log(header);
  rows.slice(0, 10).forEach(r => console.log(r));
  
  // Also create a detailed version
  const detailedOutput = uniqueDatasets.map(d => ({
    timestamp: d.timestamp,
    username: d.username,
    street: d.street,
    houseNumber: d.houseNumber,
    plz: d.plz,
    city: d.city,
    status: d.status,
    residentsCount: d.residentsCount,
    notes: d.notes,
    endpoint: d.endpoint,
    foundIn: d.foundIn
  }));
  
  fs.writeFileSync(
    OUTPUT_PATH.replace('.txt', '-detailed.json'), 
    JSON.stringify(detailedOutput, null, 2), 
    'utf8'
  );
  console.log(`\n✅ Detailed JSON also written to: ${OUTPUT_PATH.replace('.txt', '-detailed.json')}`);
  
} else {
  console.log('\n⚠️ No address datasets found in expected format.');
  console.log('Let me show you the structure of entries with data...\n');
  
  // Show some examples of what data looks like
  const samplesWithData = db.prepare(`
    SELECT timestamp, endpoint, method, data 
    FROM user_logs 
    WHERE data IS NOT NULL AND data != '' AND data != '{}' AND LENGTH(data) > 10
    LIMIT 20
  `).all();
  
  samplesWithData.forEach((s, i) => {
    console.log(`\n--- Entry ${i + 1}: ${s.endpoint} (${s.method}) ---`);
    try {
      const parsed = JSON.parse(s.data);
      console.log(JSON.stringify(parsed, null, 2).substring(0, 800));
    } catch {
      console.log(s.data.substring(0, 500));
    }
  });
}

db.close();
console.log('\n\nDone!');
