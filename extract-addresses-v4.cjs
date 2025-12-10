/**
 * Extract REAL Address Datasets (with status, residents, etc.)
 * Not just geocoding lookups
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'logs-2025-11-27.db');
const OUTPUT_PATH = path.join(__dirname, 'address-datasets-2025-11-27.txt');

console.log('Opening database:', DB_PATH);

const db = new Database(DB_PATH, { readonly: true });

// Look for entries that contain dataset creation indicators
console.log('\n=== Looking for dataset creation entries ===');

// Search patterns for dataset creation
const datasetEntries = db.prepare(`
  SELECT * FROM user_logs 
  WHERE data LIKE '%createAddressDataset%'
     OR data LIKE '%/api/datasets%'
     OR data LIKE '%"status"%'
     OR data LIKE '%"residents"%'
     OR data LIKE '%"bewohner"%'
     OR data LIKE '%"kategorie"%'
     OR data LIKE '%dataset_create%'
     OR data LIKE '%address_create%'
  ORDER BY timestamp ASC
`).all();

console.log(`Found ${datasetEntries.length} potential dataset entries`);

// Analyze these entries
const realDatasets = [];
const seenAddresses = new Map();

for (const entry of datasetEntries) {
  try {
    const rawData = JSON.parse(entry.data);
    
    // Skip pure geocoding lookups (they don't have status/residents)
    if (rawData.endpoint === '/api/geocode' && !rawData.data?.status) continue;
    
    // Look for actual dataset data
    let datasetInfo = null;
    
    // Check different possible locations
    if (rawData.dataset) {
      datasetInfo = rawData.dataset;
    } else if (rawData.data?.dataset) {
      datasetInfo = rawData.data.dataset;
    } else if (rawData.body?.dataset) {
      datasetInfo = rawData.body.dataset;
    } else if (rawData.data?.status || rawData.data?.residents) {
      datasetInfo = rawData.data;
    } else if (rawData.status || rawData.residents) {
      datasetInfo = rawData;
    }
    
    if (!datasetInfo) continue;
    
    // Must have street to be valid
    const street = datasetInfo.street || datasetInfo.streetName || datasetInfo.strasse || '';
    if (!street) continue;
    
    const houseNumber = datasetInfo.hausnummer || datasetInfo.houseNumber || datasetInfo.number || '';
    const plz = datasetInfo.plz || datasetInfo.postalCode || datasetInfo.postal || '';
    const city = datasetInfo.city || datasetInfo.stadt || datasetInfo.ort || '';
    const status = datasetInfo.status || datasetInfo.kategorie || '';
    const residents = datasetInfo.residents || datasetInfo.bewohner || [];
    const notes = datasetInfo.notes || datasetInfo.bemerkungen || '';
    
    const key = `${street}-${houseNumber}-${plz}`.toLowerCase();
    
    const record = {
      timestamp: new Date(entry.timestamp).toISOString(),
      username: entry.username,
      street,
      houseNumber,
      plz,
      city,
      status,
      residents: Array.isArray(residents) ? residents : [],
      residentsCount: Array.isArray(residents) ? residents.length : 0,
      notes,
      endpoint: rawData.endpoint || entry.log_type,
      rawEntry: rawData
    };
    
    // Keep the latest entry for each address
    seenAddresses.set(key, record);
    
  } catch (e) {
    // Skip
  }
}

console.log(`Real datasets with status/residents: ${seenAddresses.size}`);

// If we didn't find any with status, let's look at ALL action entries
if (seenAddresses.size === 0) {
  console.log('\n=== Checking all "action" type entries ===');
  
  const actionEntries = db.prepare(`
    SELECT * FROM user_logs 
    WHERE log_type = 'action'
    ORDER BY timestamp ASC
  `).all();
  
  console.log(`Total action entries: ${actionEntries.length}`);
  
  // Show unique endpoints in action entries
  const endpointsInActions = new Map();
  actionEntries.forEach(e => {
    try {
      const data = JSON.parse(e.data);
      const endpoint = data.endpoint || 'unknown';
      endpointsInActions.set(endpoint, (endpointsInActions.get(endpoint) || 0) + 1);
    } catch {}
  });
  
  console.log('\nEndpoints in action entries:');
  [...endpointsInActions.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([endpoint, count]) => console.log(`  ${endpoint}: ${count}`));
  
  // Show sample of /api/datasets entries if they exist
  console.log('\n=== Sample /api/datasets entries ===');
  const datasetSamples = actionEntries.filter(e => {
    try {
      const data = JSON.parse(e.data);
      return data.endpoint?.includes('dataset');
    } catch { return false; }
  }).slice(0, 10);
  
  datasetSamples.forEach((e, i) => {
    console.log(`\n--- Dataset Action ${i + 1} ---`);
    try {
      console.log(JSON.stringify(JSON.parse(e.data), null, 2));
    } catch {
      console.log(e.data);
    }
  });
}

// Also check: maybe datasets are stored differently
console.log('\n=== Checking for POST /api/datasets entries ===');

const postDatasetEntries = db.prepare(`
  SELECT * FROM user_logs 
  WHERE data LIKE '%POST%' AND data LIKE '%dataset%'
  ORDER BY timestamp ASC
`).all();

console.log(`POST dataset entries: ${postDatasetEntries.length}`);

postDatasetEntries.slice(0, 5).forEach((e, i) => {
  console.log(`\n--- POST Dataset ${i + 1} ---`);
  console.log(`Username: ${e.username}, Timestamp: ${new Date(e.timestamp).toISOString()}`);
  try {
    const data = JSON.parse(e.data);
    console.log(JSON.stringify(data, null, 2).substring(0, 1000));
  } catch {
    console.log(e.data.substring(0, 500));
  }
});

// Let's also look for any entries with "Kein Interesse", "Termin", etc.
console.log('\n=== Looking for status keywords ===');

const statusKeywords = ['Kein Interesse', 'Termin', 'Nicht erreicht', 'Abschluss', 'Rückruf', 'Callback'];

for (const keyword of statusKeywords) {
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM user_logs WHERE data LIKE ?`).get(`%${keyword}%`);
  console.log(`"${keyword}": ${count.cnt} entries`);
  
  if (count.cnt > 0 && count.cnt < 20) {
    const samples = db.prepare(`SELECT * FROM user_logs WHERE data LIKE ? LIMIT 3`).all(`%${keyword}%`);
    samples.forEach((s, i) => {
      console.log(`  Sample ${i + 1}:`);
      try {
        const data = JSON.parse(s.data);
        console.log('  ', JSON.stringify(data, null, 2).substring(0, 400).replace(/\n/g, '\n  '));
      } catch {
        console.log('  ', s.data.substring(0, 300));
      }
    });
  }
}

// Final output - just give all geocoded addresses as that's what we have
console.log('\n=== Creating output with all geocoded addresses ===');

const allGeocodedAddresses = db.prepare(`
  SELECT * FROM user_logs 
  WHERE data LIKE '%"address":%' AND data LIKE '%"street"%'
  ORDER BY timestamp ASC
`).all();

const finalDatasets = new Map();

for (const entry of allGeocodedAddresses) {
  try {
    const rawData = JSON.parse(entry.data);
    
    // Find address object
    let address = rawData.data?.address || rawData.address;
    if (typeof address === 'string') continue; // Skip string addresses
    if (!address?.street) continue;
    
    const street = address.street || '';
    const number = address.number || address.hausnummer || '';
    const postal = address.postal || address.plz || '';
    const city = address.city || '';
    
    const key = `${street}-${number}-${postal}`.toLowerCase();
    
    finalDatasets.set(key, {
      timestamp: new Date(entry.timestamp).toISOString(),
      username: entry.username,
      street,
      houseNumber: number,
      plz: postal,
      city,
      endpoint: rawData.endpoint || '',
      // Status might not be available, but we can still output the addresses
      status: rawData.data?.status || rawData.status || '',
      notes: rawData.data?.notes || rawData.notes || ''
    });
    
  } catch {}
}

const finalList = Array.from(finalDatasets.values()).sort((a, b) => 
  new Date(a.timestamp) - new Date(b.timestamp)
);

console.log(`Final unique addresses: ${finalList.length}`);

// Write output
const header = 'Timestamp\tUsername\tStreet\tHouseNumber\tPLZ\tCity\tStatus\tNotes';
const rows = finalList.map(d => 
  `${d.timestamp}\t${d.username}\t${d.street}\t${d.houseNumber}\t${d.plz}\t${d.city}\t${d.status}\t${d.notes}`
);

const output = [header, ...rows].join('\n');
fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

console.log(`\n✅ Written ${finalList.length} addresses to: ${OUTPUT_PATH}`);
console.log('\n=== Preview (first 15) ===');
console.log(header);
rows.slice(0, 15).forEach(r => console.log(r));

// Also create a version formatted for Sheets "Adressen" tab
const sheetsOutput = finalList.map(d => 
  // Assuming Adressen sheet has columns: ID, Street, HouseNumber, PLZ, City, Status, ...
  `\t${d.street}\t${d.houseNumber}\t${d.plz}\t${d.city}\t${d.status}\t\t\t${d.notes}\t${d.username}\t${d.timestamp}`
).join('\n');

fs.writeFileSync(
  OUTPUT_PATH.replace('.txt', '-for-sheets.txt'),
  sheetsOutput,
  'utf8'
);
console.log(`\n✅ Sheets-formatted version: ${OUTPUT_PATH.replace('.txt', '-for-sheets.txt')}`);

db.close();
console.log('\nDone!');
