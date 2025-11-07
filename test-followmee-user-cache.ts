/**
 * Test to check if user cache correctly loads users with FollowMee devices
 */

import { googleSheetsService } from './server/services/googleSheets';

async function testUserCache() {
  console.log('Testing User Cache for FollowMee devices...\n');

  try {
    // Get all users
    const users = await googleSheetsService.getAllUsers();

    console.log(`Total users in cache: ${users.length}`);
    console.log();

    // Filter users with FollowMee devices
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);

    console.log(`Users with FollowMee devices: ${usersWithDevices.length}`);
    console.log();

    if (usersWithDevices.length === 0) {
      console.log('⚠️  WARNING: No users have FollowMee Device IDs configured!');
      console.log('This explains why the scheduler finds no users to sync.');
      console.log();
      console.log('Checking all users for followMeeDeviceId field:');
      users.forEach(user => {
        console.log(`  ${user.username}:`, {
          hasField: 'followMeeDeviceId' in user,
          value: user.followMeeDeviceId || '(empty)'
        });
      });
    } else {
      console.log('Users with FollowMee devices:');
      usersWithDevices.forEach(user => {
        console.log(`  - ${user.username} (${user.userId}): Device ${user.followMeeDeviceId}`);
      });
    }

    console.log();
    console.log('Sample user object structure:');
    if (users.length > 0) {
      console.log(JSON.stringify(users[0], null, 2));
    }

  } catch (error) {
    console.error('Error testing user cache:', error);
  }

  process.exit(0);
}

testUserCache();
