/**
 * Test-Script um User-Reseller-Mapping zu debuggen
 * Führe aus mit: npx tsx server/test-user-reseller.ts
 */

import 'dotenv/config';

async function testUserReseller() {
  console.log('='.repeat(60));
  console.log('USER RESELLER MAPPING DEBUG');
  console.log('='.repeat(60));

  // Dynamischer Import um Service Account zu verwenden
  const { googleSheetsService } = await import('./services/googleSheets');

  const allUsers = await googleSheetsService.getAllUsers();
  
  console.log(`\n📊 Total users: ${allUsers.length}`);
  
  console.log('\n👥 Users with resellerName:');
  const usersWithReseller = allUsers.filter(u => u.resellerName);
  usersWithReseller.forEach(u => {
    console.log(`  ✅ ${u.username} (userId: ${u.userId}) → "${u.resellerName}"`);
  });

  console.log('\n⚠️  Users WITHOUT resellerName:');
  const usersWithoutReseller = allUsers.filter(u => !u.resellerName);
  usersWithoutReseller.forEach(u => {
    console.log(`  ❌ ${u.username} (userId: ${u.userId})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(60));
}

testUserReseller().catch(console.error);
