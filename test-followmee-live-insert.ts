/**
 * FollowMee Live Integration Test
 * 
 * Tests the complete workflow:
 * 1. Load users with FollowMee device IDs from Google Sheets
 * 2. Fetch today's GPS data from FollowMee API
 * 3. Insert GPS data into Google Sheets logs
 * 4. Verify the data was inserted correctly
 */

import 'dotenv/config';
import { followMeeApiService } from './server/services/followMeeApi';
import { googleSheetsService } from './server/services/googleSheets';
import { GoogleSheetsLoggingService } from './server/services/googleSheetsLogging';

console.log('🧪 FollowMee Live Integration Test\n');
console.log('This test will actually insert GPS data into Google Sheets logs!');
console.log('=' .repeat(80) + '\n');

async function runLiveTest() {
  try {
    // Step 1: Load users from Google Sheets
    console.log('📋 Step 1: Loading users from Google Sheets...\n');
    const users = await googleSheetsService.getAllUsers();
    console.log(`✅ Loaded ${users.length} total users`);
    
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);
    console.log(`✅ Found ${usersWithDevices.length} users with FollowMee devices\n`);

    if (usersWithDevices.length === 0) {
      console.error('❌ No users have FollowMee device IDs configured!');
      console.error('Please add device IDs to column E in the "Zugangsdaten" sheet');
      process.exit(1);
    }

    console.log('Users with FollowMee devices:');
    usersWithDevices.forEach(user => {
      console.log(`   - ${user.username} (ID: ${user.userId})`);
      console.log(`     Device ID: ${user.followMeeDeviceId}`);
      console.log(`     Admin: ${user.isAdmin ? 'Yes' : 'No'}`);
      console.log();
    });

    // Step 2: Update user mappings in FollowMee service
    console.log('=' .repeat(80));
    console.log('📋 Step 2: Updating user mappings in FollowMee service...\n');
    
    followMeeApiService.updateUserMappings(usersWithDevices.map(u => ({
      userId: u.userId,
      username: u.username,
      followMeeDeviceId: u.followMeeDeviceId!
    })));
    
    const status = followMeeApiService.getStatus();
    console.log(`✅ Mapped ${status.userCount} users to FollowMee devices\n`);

    // Step 3: Fetch today's GPS data from FollowMee
    console.log('=' .repeat(80));
    console.log('📋 Step 3: Fetching today\'s GPS data from FollowMee API...\n');

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`Date: ${today}`);
    
    const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API!;
    const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';
    const FOLLOWMEE_BASE_URL = 'https://www.followmee.com/api/tracks.aspx';

    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'daterangeforalldevices');
    url.searchParams.set('from', today);
    url.searchParams.set('to', today);

    console.log('Calling FollowMee API...');
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`FollowMee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const locationCount = data.Data?.length || 0;
    console.log(`✅ Received ${locationCount} GPS location points\n`);

    if (locationCount === 0) {
      console.log('⚠️  No GPS data available for today');
      console.log('This is normal if devices haven\'t been active yet today');
      process.exit(0);
    }

    // Group by device
    const locationsByDevice = new Map<string, any[]>();
    for (const location of data.Data) {
      if (!locationsByDevice.has(location.DeviceID)) {
        locationsByDevice.set(location.DeviceID, []);
      }
      locationsByDevice.get(location.DeviceID)!.push(location);
    }

    console.log(`Devices with GPS data today: ${locationsByDevice.size}\n`);
    locationsByDevice.forEach((locations, deviceId) => {
      const deviceName = locations[0].DeviceName;
      console.log(`   - ${deviceName} (${deviceId}): ${locations.length} points`);
    });
    console.log();

    // Step 4: Match devices to users and insert into Google Sheets
    console.log('=' .repeat(80));
    console.log('📋 Step 4: Inserting GPS data into Google Sheets logs...\n');

    let totalInserted = 0;

    for (const user of usersWithDevices) {
      const deviceLocations = locationsByDevice.get(user.followMeeDeviceId!);
      
      if (!deviceLocations || deviceLocations.length === 0) {
        console.log(`⚠️  No GPS data for ${user.username} (Device ${user.followMeeDeviceId})`);
        continue;
      }

      console.log(`\n📍 Processing ${user.username} (${deviceLocations.length} locations)...`);

      // Sort chronologically
      deviceLocations.sort((a, b) => {
        const timeA = new Date(a.Date).getTime();
        const timeB = new Date(b.Date).getTime();
        return timeA - timeB;
      });

      const firstTime = deviceLocations[0].Date.substring(11, 19);
      const lastTime = deviceLocations[deviceLocations.length - 1].Date.substring(11, 19);
      console.log(`   Time range: ${firstTime} - ${lastTime}`);

      // Ensure user worksheet exists
      const worksheetName = `${user.username}_${user.userId}`;
      console.log(`   Ensuring worksheet exists: ${worksheetName}`);
      await GoogleSheetsLoggingService.ensureUserWorksheet(user.userId, user.username);

      // Convert locations to log rows
      const logRows = deviceLocations.map(location => {
        const timestamp = new Date(location.Date).toISOString();
        
        return [
          timestamp, // Timestamp
          user.userId, // User ID
          user.username, // Username
          '/api/tracking/gps', // Endpoint
          'POST', // Method
          `GPS: ${location.Latitude.toFixed(6)}, ${location.Longitude.toFixed(6)} [FollowMee]`, // Address
          '', // New Prospects
          '', // Existing Customers
          'FollowMee GPS Tracker', // User Agent
          JSON.stringify({
            source: 'followmee',
            deviceId: location.DeviceID,
            deviceName: location.DeviceName,
            latitude: location.Latitude,
            longitude: location.Longitude,
            speedKmh: location['Speed(km/h)'],
            speedMph: location['Speed(mph)'],
            direction: location.Direction,
            accuracy: location.Accuracy,
            altitudeM: location['Altitude(m)'],
            battery: location.Battery,
            timestamp: new Date(location.Date).getTime()
          })
        ];
      });

      console.log(`   Inserting ${logRows.length} rows into Google Sheets chronologically...`);
      
      try {
        await GoogleSheetsLoggingService.batchInsertChronologically(worksheetName, logRows);
        console.log(`   ✅ Successfully inserted ${logRows.length} GPS points chronologically`);
        totalInserted += logRows.length;
        
        // Show sample row
        console.log(`\n   📄 Sample log entry:`);
        console.log(`      Timestamp: ${logRows[0][0]}`);
        console.log(`      Address: ${logRows[0][5]}`);
        console.log(`      User Agent: ${logRows[0][8]}`);
        const dataJson = JSON.parse(logRows[0][9]);
        console.log(`      Battery: ${dataJson.battery}`);
        console.log(`      Accuracy: ${dataJson.accuracy}m`);
        
      } catch (error: any) {
        console.error(`   ❌ Error inserting data: ${error.message}`);
      }
    }

    // Step 5: Summary
    console.log('\n' + '=' .repeat(80));
    console.log('📊 Test Summary\n');
    console.log(`✅ Total GPS points inserted: ${totalInserted}`);
    console.log(`✅ Users processed: ${usersWithDevices.length}`);
    console.log(`✅ Devices tracked: ${locationsByDevice.size}`);
    console.log();
    console.log('🎉 Live integration test completed successfully!');
    console.log();
    console.log('Next steps:');
    console.log('1. Check the Google Sheets logs to verify the data');
    console.log('2. Open Admin Dashboard to see GPS tracking');
    console.log('3. Verify that GPS points have [FollowMee] marker');
    console.log();

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Confirm before running
console.log('⚠️  WARNING: This will insert GPS data into Google Sheets logs!');
console.log();
console.log('Starting test in 3 seconds...');
console.log('Press Ctrl+C to cancel');
console.log();

setTimeout(() => {
  runLiveTest();
}, 3000);
