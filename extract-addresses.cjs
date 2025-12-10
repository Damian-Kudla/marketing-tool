/**
 * Extract Address Datasets from Activity Log DB
 * Outputs tab-separated data for Google Sheets import
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'logs-2025-11-27.db');
const OUTPUT_PATH = path.join(__dirname, 'address-datasets-2025-11-27.txt');

console.log('Opening database:', DB_PATH);

const db = new Database(DB_PATH, { readonly: true });

// First, let's see what tables exist
console.log('\n=== Tables in database ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name).join(', '));

// Check the structure of the activity_logs table
console.log('\n=== activity_logs structure ===');
try {
  const columns = db.prepare("PRAGMA table_info(activity_logs)").all();
  console.log(columns.map(c => `${c.name} (${c.type})`).join(', '));
} catch (e) {
  console.log('No activity_logs table');
}

// Let's look at sample data
console.log('\n=== Sample activity_logs entries ===');
try {
  const sample = db.prepare("SELECT * FROM activity_logs LIMIT 5").all();
  console.log(JSON.stringify(sample, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

// Find all address-related entries
console.log('\n=== Looking for address/dataset creation entries ===');

// Try different approaches to find address data
let addressData = [];

// Approach 1: Look for createAddressDataset or similar endpoints
try {
  const createEntries = db.prepare(`
    SELECT * FROM activity_logs 
    WHERE endpoint LIKE '%address%' 
       OR endpoint LIKE '%dataset%'
       OR action LIKE '%address%'
       OR action LIKE '%dataset%'
    ORDER BY timestamp ASC
  `).all();
  console.log(`Found ${createEntries.length} address/dataset related entries`);
  
  if (createEntries.length > 0) {
    console.log('Sample:', JSON.stringify(createEntries[0], null, 2));
  }
  
  addressData = createEntries;
} catch (e) {
  console.log('Approach 1 failed:', e.message);
}

// Approach 2: Look for POST requests that might contain address data
try {
  const postEntries = db.prepare(`
    SELECT * FROM activity_logs 
    WHERE method = 'POST'
    ORDER BY timestamp ASC
  `).all();
  console.log(`Found ${postEntries.length} POST entries total`);
  
  // Filter for those that might be address-related
  const addressPosts = postEntries.filter(entry => {
    const dataStr = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data || {});
    return dataStr.includes('street') || 
           dataStr.includes('address') || 
           dataStr.includes('hausnummer') ||
           dataStr.includes('Hausnummer') ||
           dataStr.includes('plz') ||
           dataStr.includes('PLZ');
  });
  
  console.log(`Found ${addressPosts.length} POST entries with address data`);
  
  if (addressPosts.length > addressData.length) {
    addressData = addressPosts;
  }
} catch (e) {
  console.log('Approach 2 failed:', e.message);
}

// Approach 3: Search in all data for address patterns
try {
  const allEntries = db.prepare(`SELECT * FROM activity_logs ORDER BY timestamp ASC`).all();
  console.log(`\nTotal entries in activity_logs: ${allEntries.length}`);
  
  // Find unique endpoints
  const endpoints = [...new Set(allEntries.map(e => e.endpoint))];
  console.log('\nUnique endpoints:', endpoints.slice(0, 20).join(', '));
  
  // Look for entries with address-like data
  const withAddressData = allEntries.filter(entry => {
    try {
      const data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
      if (!data) return false;
      
      // Check if it has address-related fields
      return data.street || data.streetName || data.address || 
             data.hausnummer || data.houseNumber || data.plz || data.postalCode ||
             data.city || data.stadt || data.ort;
    } catch {
      return false;
    }
  });
  
  console.log(`Entries with address-like data: ${withAddressData.length}`);
  
  if (withAddressData.length > 0) {
    addressData = withAddressData;
  }
} catch (e) {
  console.log('Approach 3 failed:', e.message);
}

// Now extract and format the address data
console.log('\n=== Extracting address datasets ===');

const datasets = [];
const seenAddresses = new Set();

for (const entry of addressData) {
  try {
    let data = entry.data;
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }
    
    if (!data) continue;
    
    // Extract address info from various possible structures
    let addressInfo = null;
    
    // Check if it's a direct address object
    if (data.street || data.streetName || data.plz) {
      addressInfo = data;
    }
    // Check if it's nested in body or request
    else if (data.body && (data.body.street || data.body.streetName || data.body.plz)) {
      addressInfo = data.body;
    }
    // Check if it's in address field
    else if (data.address && typeof data.address === 'object') {
      addressInfo = data.address;
    }
    
    if (!addressInfo) continue;
    
    // Create unique key to avoid duplicates
    const key = `${addressInfo.street || addressInfo.streetName || ''}-${addressInfo.hausnummer || addressInfo.houseNumber || ''}-${addressInfo.plz || addressInfo.postalCode || ''}`;
    
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    
    datasets.push({
      timestamp: entry.timestamp,
      username: entry.username || entry.userId || '',
      street: addressInfo.street || addressInfo.streetName || '',
      houseNumber: addressInfo.hausnummer || addressInfo.houseNumber || '',
      plz: addressInfo.plz || addressInfo.postalCode || '',
      city: addressInfo.city || addressInfo.stadt || addressInfo.ort || '',
      status: addressInfo.status || '',
      notes: addressInfo.notes || addressInfo.bemerkungen || ''
    });
  } catch (e) {
    // Skip entries that can't be parsed
  }
}

console.log(`Extracted ${datasets.length} unique address datasets`);

// Output to file
if (datasets.length > 0) {
  // Header
  const header = 'Timestamp\tUsername\tStreet\tHouseNumber\tPLZ\tCity\tStatus\tNotes';
  
  // Data rows
  const rows = datasets.map(d => 
    `${d.timestamp}\t${d.username}\t${d.street}\t${d.houseNumber}\t${d.plz}\t${d.city}\t${d.status}\t${d.notes}`
  );
  
  const output = [header, ...rows].join('\n');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`\n✅ Output written to: ${OUTPUT_PATH}`);
  console.log('\nFirst 5 entries:');
  rows.slice(0, 5).forEach(r => console.log(r));
} else {
  console.log('\n⚠️ No address datasets found. Let me show you what data is available...');
  
  // Show sample of all data to understand structure
  try {
    const allEntries = db.prepare(`SELECT * FROM activity_logs LIMIT 20`).all();
    console.log('\nSample entries (showing data field):');
    allEntries.forEach((e, i) => {
      console.log(`\n--- Entry ${i + 1} ---`);
      console.log('Endpoint:', e.endpoint);
      console.log('Method:', e.method);
      console.log('Data:', typeof e.data === 'string' ? e.data.substring(0, 500) : JSON.stringify(e.data).substring(0, 500));
    });
  } catch (e) {
    console.log('Error showing samples:', e.message);
  }
}

db.close();
console.log('\nDone!');
