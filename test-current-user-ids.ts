import dotenv from 'dotenv';
dotenv.config();

import { googleSheetsService } from './server/services/googleSheets';

async function checkCurrentUserIds() {
  console.log('🔍 Checking current User IDs and FollowMee Device IDs...\n');
  
  // Wait for cache initialization
  console.log('⏳ Waiting for cache initialization (5 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    console.log('📋 Getting all users from cache...');
    const users = await googleSheetsService.getAllUsers();
    
    console.log(`\n✅ Found ${users.length} total users\n`);
    
    // Show all users with their IDs and FollowMee Device IDs
    console.log('👥 All users:');
    for (const user of users) {
      const worksheetName = `${user.username}_${user.userId}`;
      const deviceInfo = user.followMeeDeviceId ? `📱 FollowMee: ${user.followMeeDeviceId}` : '❌ No FollowMee Device';
      console.log(`  - ${user.username} (ID: ${user.userId})`);
      console.log(`    📄 Worksheet: ${worksheetName}`);
      console.log(`    ${deviceInfo}`);
      console.log();
    }
    
    // Filter users with FollowMee devices
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);
    console.log(`\n📱 ${usersWithDevices.length} users with FollowMee devices:`);
    for (const user of usersWithDevices) {
      console.log(`  - ${user.username}: Device ID ${user.followMeeDeviceId} → Worksheet: ${user.username}_${user.userId}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkCurrentUserIds().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
});
