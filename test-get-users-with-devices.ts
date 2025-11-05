import dotenv from 'dotenv';
dotenv.config();

import { googleSheetsService } from './server/services/googleSheets';

async function testGetUsers() {
  console.log('🧪 Testing getAllUsers()...\n');
  
  try {
    const users = await googleSheetsService.getAllUsers();
    
    console.log(`✅ Loaded ${users.length} users`);
    console.log(`✅ Users with FollowMee devices: ${users.filter(u => u.followMeeDeviceId).length}`);
    
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);
    
    if (usersWithDevices.length > 0) {
      console.log('\nUsers with devices:');
      for (const user of usersWithDevices) {
        console.log(`  - ${user.username} (ID: ${user.userId})`);
        console.log(`    Device ID: ${user.followMeeDeviceId}`);
        console.log(`    Admin: ${user.isAdmin}`);
      }
    } else {
      console.log('\n⚠️ No users have FollowMee Device IDs configured!');
      console.log('   Please add Device IDs to column E in the "Zugangsdaten" sheet');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  }
  
  process.exit(0);
}

testGetUsers();
