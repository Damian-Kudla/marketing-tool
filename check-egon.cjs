const Database = require('better-sqlite3');
// Check root directory first
const db = new Database('./egon_orders.db');
console.log('Using: ./egon_orders.db');

// Get tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);

// Get table info for each table
tables.forEach(t => {
  const info = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n${t.name} columns:`, info.map(c => c.name));
  
  // Show sample data
  const sample = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
  console.log(`${t.name} sample:`, sample);
});

db.close();
