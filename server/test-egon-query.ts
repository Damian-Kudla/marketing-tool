/**
 * Test-Script um EGON Orders Abfrage zu debuggen
 * Führe aus mit: npx tsx server/test-egon-query.ts
 */

import 'dotenv/config';
import { egonOrdersDB } from './services/egonScraperService';

async function testEgonQuery() {
  console.log('='.repeat(60));
  console.log('EGON ORDERS DATABASE DEBUG');
  console.log('='.repeat(60));

  // 1. Zeige alle Orders in der Datenbank
  const allOrders = egonOrdersDB.getAll();
  console.log(`\n📊 Total orders in database: ${allOrders.length}`);

  // 2. Zeige die letzten 10 Orders
  console.log('\n📋 Last 10 orders:');
  allOrders.slice(0, 10).forEach((order, i) => {
    console.log(`  ${i+1}. ${order.reseller_name} | ${order.timestamp} | Order: ${order.order_no}`);
  });

  // 3. Zeige alle einzigartigen Reseller-Namen
  const uniqueResellers = [...new Set(allOrders.map(o => o.reseller_name))];
  console.log(`\n👥 Unique reseller names (${uniqueResellers.length}):`);
  uniqueResellers.forEach(name => {
    const count = allOrders.filter(o => o.reseller_name === name).length;
    console.log(`  - "${name}" (${count} orders)`);
  });

  // 4. Zeige alle einzigartigen Daten
  const uniqueDates = [...new Set(allOrders.map(o => {
    const match = o.timestamp.match(/^(\d{2}\.\d{2}\.\d{4})/);
    return match ? match[1] : 'unknown';
  }))];
  console.log(`\n📅 Unique dates (${uniqueDates.length}):`);
  uniqueDates.forEach(date => {
    const count = allOrders.filter(o => o.timestamp.startsWith(date)).length;
    console.log(`  - ${date} (${count} orders)`);
  });

  // 5. Teste spezifische Abfrage für heute (27.11.2025)
  const today = '27.11.2025';
  console.log(`\n🔍 Testing query for today (${today}):`);
  
  for (const reseller of uniqueResellers) {
    const result = egonOrdersDB.getByResellerAndDate(reseller, today);
    if (result.length > 0) {
      console.log(`  ✅ ${reseller}: ${result.length} orders`);
      result.forEach(r => console.log(`     - ${r.timestamp}`));
    }
  }

  // 6. Teste spezifische Abfrage für gestern (26.11.2025)
  const yesterday = '26.11.2025';
  console.log(`\n🔍 Testing query for yesterday (${yesterday}):`);
  
  for (const reseller of uniqueResellers) {
    const result = egonOrdersDB.getByResellerAndDate(reseller, yesterday);
    if (result.length > 0) {
      console.log(`  ✅ ${reseller}: ${result.length} orders`);
      result.forEach(r => console.log(`     - ${r.timestamp}`));
    }
  }

  // 7. Teste spezifische Abfrage für 25.11.2025
  const nov25 = '25.11.2025';
  console.log(`\n🔍 Testing query for ${nov25}:`);
  
  for (const reseller of uniqueResellers) {
    const result = egonOrdersDB.getByResellerAndDate(reseller, nov25);
    if (result.length > 0) {
      console.log(`  ✅ ${reseller}: ${result.length} orders`);
      result.forEach(r => console.log(`     - ${r.timestamp}`));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(60));
}

testEgonQuery().catch(console.error);
