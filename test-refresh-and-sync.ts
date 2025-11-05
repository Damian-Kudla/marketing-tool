import dotenv from 'dotenv';
dotenv.config();

import { googleSheetsService } from './server/services/googleSheets';
import { followMeeSyncScheduler } from './server/services/followMeeSyncScheduler';

async function testUserCacheRefresh() {
  console.log('🧪 Testing User Cache Refresh...\n');
  
  // IMPORTANT: Wait for cache initialization (happens on module import)
  console.log('⏳ Waiting for cache initialization (5 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    console.log('📋 Step 1: Get users from cache');
    let users = await googleSheetsService.getAllUsers();
    let usersWithDevices = users.filter(u => u.followMeeDeviceId);
    
    console.log(`   Total users: ${users.length}`);
    console.log(`   Users with FollowMee devices: ${usersWithDevices.length}`);
    
    if (usersWithDevices.length > 0) {
      console.log('\n   Users with devices:');
      for (const user of usersWithDevices) {
        console.log(`     - ${user.username} (${user.userId}): Device ${user.followMeeDeviceId}`);
      }
    }
    
    console.log('\n📡 Step 2: Force refresh user cache...');
    await googleSheetsService.refreshUserCache();
    
    console.log('\n📋 Step 3: Get users AFTER cache refresh');
    users = await googleSheetsService.getAllUsers();
    usersWithDevices = users.filter(u => u.followMeeDeviceId);
    
    console.log(`   Total users: ${users.length}`);
    console.log(`   Users with FollowMee devices: ${usersWithDevices.length}`);
    
    if (usersWithDevices.length > 0) {
      console.log('\n   Users with devices:');
      for (const user of usersWithDevices) {
        console.log(`     - ${user.username} (${user.userId}): Device ${user.followMeeDeviceId}`);
      }
      
      console.log('\n✅ Cache refresh successful! Now testing sync...');
      
      console.log('\n📡 Step 4: Trigger FollowMee sync');
      await followMeeSyncScheduler.syncNow();
      
      console.log('\n🎉 All done! Check your Google Sheets logs for new FollowMee GPS data.');
    } else {
      console.log('\n⚠️ No users with FollowMee Device IDs found.');
      console.log('   Make sure you have added Device IDs to column E in the "Zugangsdaten" sheet.');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  }
  
  process.exit(0);
}

testUserCacheRefresh();
