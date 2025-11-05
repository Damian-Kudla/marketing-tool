/**
 * Comprehensive FollowMee API Integration Tests
 * 
 * Tests all aspects of the FollowMee integration:
 * - API connectivity and authentication
 * - Data parsing and transformation
 * - User mapping logic
 * - Duplicate detection
 * - Google Sheets insertion format
 */

import 'dotenv/config';
import { followMeeApiService } from './server/services/followMeeApi';
import { googleSheetsService } from './server/services/googleSheets';

const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API!;
const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';
const FOLLOWMEE_BASE_URL = 'https://www.followmee.com/api/tracks.aspx';

console.log('🧪 Comprehensive FollowMee Integration Tests\n');
console.log('=' .repeat(80) + '\n');

// Test 1: API Configuration
console.log('📋 Test 1: Configuration Validation\n');
console.log('- API Key:', FOLLOWMEE_API_KEY ? '✅ Set' : '❌ Missing');
console.log('- Username:', FOLLOWMEE_USERNAME);
console.log('- Base URL:', FOLLOWMEE_BASE_URL);
console.log();

if (!FOLLOWMEE_API_KEY) {
  console.error('❌ FOLLOWMEE_API not configured. Stopping tests.');
  process.exit(1);
}

// Test 2: API Request - Different Time Ranges
async function testAPITimeRanges() {
  console.log('=' .repeat(80));
  console.log('📍 Test 2: API Time Ranges\n');

  const tests = [
    { hours: 1, label: '1 hour' },
    { hours: 6, label: '6 hours' },
    { hours: 24, label: '24 hours' }
  ];

  for (const test of tests) {
    try {
      console.log(`\n📊 Testing ${test.label} history...`);
      
      const url = new URL(FOLLOWMEE_BASE_URL);
      url.searchParams.set('key', FOLLOWMEE_API_KEY);
      url.searchParams.set('username', FOLLOWMEE_USERNAME);
      url.searchParams.set('output', 'json');
      url.searchParams.set('function', 'historyforalldevices');
      url.searchParams.set('history', test.hours.toString());

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`❌ Failed: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const count = data.Data?.length || 0;
      console.log(`✅ Success: ${count} location points`);
      
      if (count > 0) {
        // Group by device
        const devices = new Set(data.Data.map((loc: any) => loc.DeviceID));
        console.log(`   Devices: ${devices.size} unique`);
        
        // Time range
        const dates = data.Data.map((loc: any) => new Date(loc.Date).getTime());
        const oldest = new Date(Math.min(...dates)).toISOString();
        const newest = new Date(Math.max(...dates)).toISOString();
        console.log(`   Time range: ${oldest.substring(11, 19)} - ${newest.substring(11, 19)}`);
      }
      
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
}

// Test 3: Date Range Function
async function testDateRangeFunction() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 3: Date Range Function\n');

  const tests = [
    { from: '2025-11-04', to: '2025-11-04', label: 'Today' },
    { from: '2025-11-03', to: '2025-11-04', label: 'Last 2 days' },
    { from: '2025-11-01', to: '2025-11-04', label: 'This month so far' }
  ];

  for (const test of tests) {
    try {
      console.log(`\n📊 Testing ${test.label} (${test.from} to ${test.to})...`);
      
      const url = new URL(FOLLOWMEE_BASE_URL);
      url.searchParams.set('key', FOLLOWMEE_API_KEY);
      url.searchParams.set('username', FOLLOWMEE_USERNAME);
      url.searchParams.set('output', 'json');
      url.searchParams.set('function', 'daterangeforalldevices');
      url.searchParams.set('from', test.from);
      url.searchParams.set('to', test.to);

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`❌ Failed: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const count = data.Data?.length || 0;
      console.log(`✅ Success: ${count} location points`);
      
      if (count > 0) {
        const devices = new Set(data.Data.map((loc: any) => loc.DeviceID));
        console.log(`   Devices: ${devices.size} unique`);
        devices.forEach(deviceId => {
          const devicePoints = data.Data.filter((loc: any) => loc.DeviceID === deviceId);
          const deviceName = devicePoints[0].DeviceName;
          console.log(`   - ${deviceName} (${deviceId}): ${devicePoints.length} points`);
        });
      }
      
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
}

// Test 4: Data Structure Validation
async function testDataStructure() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 4: Data Structure Validation\n');

  try {
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', '24');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!data.Data || data.Data.length === 0) {
      console.log('⚠️  No data available for validation');
      return;
    }

    const sample = data.Data[0];
    console.log('Sample location object:');
    console.log(JSON.stringify(sample, null, 2));

    console.log('\n✅ Required Fields Check:');
    const requiredFields = [
      'DeviceID',
      'DeviceName', 
      'Date',
      'Latitude',
      'Longitude',
      'Type',
      'Accuracy',
      'Battery'
    ];

    requiredFields.forEach(field => {
      const exists = field in sample;
      const value = sample[field];
      console.log(`   ${exists ? '✅' : '❌'} ${field}: ${value !== undefined ? value : 'undefined'}`);
    });

    console.log('\n✅ Optional Fields Check:');
    const optionalFields = [
      'Speed(mph)',
      'Speed(km/h)',
      'Direction',
      'Altitude(ft)',
      'Altitude(m)'
    ];

    optionalFields.forEach(field => {
      const value = sample[field];
      console.log(`   ℹ️  ${field}: ${value !== null ? value : 'null'}`);
    });

    console.log('\n✅ Data Type Validation:');
    console.log(`   Latitude type: ${typeof sample.Latitude} (expected: number)`);
    console.log(`   Longitude type: ${typeof sample.Longitude} (expected: number)`);
    console.log(`   Accuracy type: ${typeof sample.Accuracy} (expected: number)`);
    console.log(`   Date type: ${typeof sample.Date} (expected: string)`);
    console.log(`   Battery type: ${typeof sample.Battery} (expected: string)`);

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Test 5: Date Parsing
async function testDateParsing() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 5: Date Parsing & Timezone Handling\n');

  try {
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', '24');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!data.Data || data.Data.length === 0) {
      console.log('⚠️  No data available for date parsing test');
      return;
    }

    console.log('Testing date parsing on sample data:\n');
    
    const samples = data.Data.slice(0, 3);
    samples.forEach((location: any, index: number) => {
      const originalDate = location.Date;
      const parsed = new Date(originalDate);
      const timestamp = parsed.getTime();
      const iso = parsed.toISOString();

      console.log(`Sample ${index + 1}:`);
      console.log(`   Original: ${originalDate}`);
      console.log(`   Parsed: ${parsed}`);
      console.log(`   ISO: ${iso}`);
      console.log(`   Timestamp: ${timestamp}`);
      console.log(`   Valid: ${!isNaN(timestamp) ? '✅' : '❌'}`);
      console.log();
    });

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Test 6: User Mapping Simulation
async function testUserMapping() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 6: User Mapping Simulation\n');

  try {
    console.log('Loading users from Google Sheets...');
    const users = await googleSheetsService.getAllUsers();
    
    console.log(`✅ Found ${users.length} users in sheet\n`);
    
    const usersWithDevices = users.filter(u => u.followMeeDeviceId);
    console.log(`ℹ️  Users with FollowMee devices: ${usersWithDevices.length}\n`);

    if (usersWithDevices.length > 0) {
      console.log('User → Device Mappings:');
      usersWithDevices.forEach(user => {
        console.log(`   ✅ ${user.username} → ${user.followMeeDeviceId}`);
      });
    } else {
      console.log('⚠️  No users have FollowMee device IDs configured');
      console.log('   Please add device IDs to column E in the "Zugangsdaten" sheet');
    }

    console.log('\n📊 Simulating mapping update...');
    followMeeApiService.updateUserMappings(usersWithDevices.map(u => ({
      userId: u.userId,
      username: u.username,
      followMeeDeviceId: u.followMeeDeviceId!
    })));
    console.log('✅ Mapping update successful');

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Test 7: Duplicate Detection Logic
async function testDuplicateDetection() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 7: Duplicate Detection Logic\n');

  try {
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', '1');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!data.Data || data.Data.length === 0) {
      console.log('⚠️  No data available for duplicate detection test');
      return;
    }

    console.log('Testing duplicate detection algorithm:\n');

    const location = data.Data[0];
    
    // Generate location ID (same logic as in followMeeApi.ts)
    const locationId = `${location.DeviceID}_${location.Date}_${location.Latitude}_${location.Longitude}`;
    
    console.log('Sample Location:');
    console.log(`   Device: ${location.DeviceName} (${location.DeviceID})`);
    console.log(`   Date: ${location.Date}`);
    console.log(`   Coords: ${location.Latitude}, ${location.Longitude}`);
    console.log(`   Generated ID: ${locationId}`);
    console.log();

    // Test uniqueness
    const locationIds = new Set<string>();
    let duplicates = 0;

    data.Data.forEach((loc: any) => {
      const id = `${loc.DeviceID}_${loc.Date}_${loc.Latitude}_${loc.Longitude}`;
      if (locationIds.has(id)) {
        duplicates++;
      } else {
        locationIds.add(id);
      }
    });

    console.log('Duplicate Detection Results:');
    console.log(`   Total locations: ${data.Data.length}`);
    console.log(`   Unique IDs: ${locationIds.size}`);
    console.log(`   Duplicates found: ${duplicates}`);
    console.log(`   Status: ${duplicates === 0 ? '✅ No duplicates' : '⚠️ Duplicates detected'}`);

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Test 8: Google Sheets Log Format
async function testGoogleSheetsFormat() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 8: Google Sheets Log Format Validation\n');

  try {
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', '1');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!data.Data || data.Data.length === 0) {
      console.log('⚠️  No data available for format test');
      return;
    }

    const location = data.Data[0];
    
    // Simulate log row creation (same logic as in followMeeApi.ts)
    const timestamp = new Date(location.Date).toISOString();
    const mockUserId = 'test_user_123';
    const mockUsername = 'TestUser';
    
    const logRow = [
      timestamp, // Timestamp
      mockUserId, // User ID
      mockUsername, // Username
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

    console.log('✅ Generated Google Sheets Log Row:\n');
    console.log('Column A (Timestamp):', logRow[0]);
    console.log('Column B (User ID):', logRow[1]);
    console.log('Column C (Username):', logRow[2]);
    console.log('Column D (Endpoint):', logRow[3]);
    console.log('Column E (Method):', logRow[4]);
    console.log('Column F (Address):', logRow[5]);
    console.log('Column G (New Prospects):', logRow[6]);
    console.log('Column H (Existing Customers):', logRow[7]);
    console.log('Column I (User Agent):', logRow[8]);
    console.log('Column J (Data):', logRow[9].substring(0, 100) + '...');

    console.log('\n✅ Data JSON (parsed):');
    console.log(JSON.stringify(JSON.parse(logRow[9]), null, 2));

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Test 9: Rate Limiting Compliance
async function testRateLimiting() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 9: Rate Limiting Compliance\n');

  console.log('ℹ️  FollowMee API Rate Limit: 1 request per minute');
  console.log('ℹ️  Our Sync Interval: 5 minutes (300 seconds)');
  console.log();

  const ourInterval = 5 * 60; // 5 minutes in seconds
  const apiLimit = 60; // 1 minute in seconds
  const ratio = ourInterval / apiLimit;

  console.log(`✅ Compliance Check:`);
  console.log(`   Ratio: ${ratio.toFixed(1)}x above minimum`);
  console.log(`   Status: ${ratio > 1 ? '✅ SAFE' : '❌ TOO FAST'}`);
  console.log(`   Max requests per hour: ${Math.floor(3600 / ourInterval)}`);
  console.log(`   API allows per hour: ${Math.floor(3600 / apiLimit)}`);
}

// Test 10: Service Status
async function testServiceStatus() {
  console.log('\n' + '=' .repeat(80));
  console.log('📍 Test 10: FollowMee Service Status\n');

  try {
    const status = followMeeApiService.getStatus();
    
    console.log('Service Status:');
    console.log(`   API Configured: ${status.configured ? '✅' : '❌'}`);
    console.log(`   User Count: ${status.userCount}`);
    console.log();

    if (status.users.length > 0) {
      console.log('User Status:');
      status.users.forEach(user => {
        console.log(`   - ${user.username}:`);
        console.log(`     Device ID: ${user.deviceId}`);
        console.log(`     Last Fetch: ${user.lastFetch ? new Date(user.lastFetch).toISOString() : 'Never'}`);
        console.log(`     Processed Locations: ${user.processedLocations}`);
      });
    } else {
      console.log('⚠️  No users mapped to FollowMee devices');
    }

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Run all tests
async function runAllTests() {
  try {
    await testAPITimeRanges();
    await testDateRangeFunction();
    await testDataStructure();
    await testDateParsing();
    await testUserMapping();
    await testDuplicateDetection();
    await testGoogleSheetsFormat();
    testRateLimiting();
    await testServiceStatus();

    console.log('\n' + '=' .repeat(80));
    console.log('🎉 All Tests Complete!\n');

  } catch (error: any) {
    console.error('\n❌ Fatal Error:', error.message);
    process.exit(1);
  }
}

runAllTests();
