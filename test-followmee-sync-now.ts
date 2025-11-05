import { followMeeSyncScheduler } from './server/services/followMeeSyncScheduler';

async function testSync() {
  console.log('🧪 Testing FollowMee Sync...\n');
  
  try {
    console.log('Status before sync:');
    console.log(JSON.stringify(followMeeSyncScheduler.getStatus(), null, 2));
    
    console.log('\n📡 Starting manual sync...');
    await followMeeSyncScheduler.syncNow();
    
    console.log('\n✅ Sync completed!');
    
    console.log('\nStatus after sync:');
    console.log(JSON.stringify(followMeeSyncScheduler.getStatus(), null, 2));
    
  } catch (error: any) {
    console.error('\n❌ Error during sync:', error.message);
    console.error(error);
  }
  
  process.exit(0);
}

testSync();
