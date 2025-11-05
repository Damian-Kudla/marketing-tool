/**
 * FollowMee API Test Script
 * 
 * Tests the FollowMee API connection and displays responses
 */

import 'dotenv/config';

const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API;
const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';
const FOLLOWMEE_BASE_URL = 'https://www.followmee.com/api/tracks.aspx';

async function testFollowMeeAPI() {
  console.log('🧪 FollowMee API Test Starting...\n');
  console.log('Configuration:');
  console.log('- API Key:', FOLLOWMEE_API_KEY ? `${FOLLOWMEE_API_KEY.substring(0, 8)}...` : '❌ NOT SET');
  console.log('- Username:', FOLLOWMEE_USERNAME);
  console.log('- Base URL:', FOLLOWMEE_BASE_URL);
  console.log('\n' + '='.repeat(80) + '\n');

  if (!FOLLOWMEE_API_KEY) {
    console.error('❌ ERROR: FOLLOWMEE_API environment variable not set!');
    process.exit(1);
  }

  // Test 1: History for all devices (last 1 hour)
  console.log('📍 Test 1: Fetching 1 hour history for all devices...\n');
  try {
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'historyforalldevices');
    url.searchParams.set('history', '1');

    console.log('Request URL:', url.toString().replace(FOLLOWMEE_API_KEY, '***API_KEY***'));
    console.log('Sending request...\n');

    const response = await fetch(url.toString());
    
    console.log('Response Status:', response.status, response.statusText);
    console.log('Response Headers:');
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log();

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log('✅ Response received!\n');
    console.log('Response Structure:');
    console.log('- Type:', typeof data);
    console.log('- Keys:', Object.keys(data));
    
    if (data.data) {
      console.log('- data.length:', data.data.length);
      console.log('\n' + '='.repeat(80) + '\n');
      
      if (data.data.length > 0) {
        console.log('📊 Sample Location Data (first entry):\n');
        const sample = data.data[0];
        console.log(JSON.stringify(sample, null, 2));
        
        console.log('\n' + '='.repeat(80) + '\n');
        console.log('📊 All Location Data:\n');
        
        // Group by device
        const deviceMap = new Map<string, any[]>();
        for (const location of data.data) {
          if (!deviceMap.has(location.DeviceID)) {
            deviceMap.set(location.DeviceID, []);
          }
          deviceMap.get(location.DeviceID)!.push(location);
        }
        
        console.log(`Found ${deviceMap.size} unique device(s):\n`);
        
        deviceMap.forEach((locations, deviceId) => {
          console.log(`Device: ${deviceId} (${locations.length} location points)`);
          console.log(`  Device Name: ${locations[0].DeviceName}`);
          console.log(`  First Point: ${locations[0].Date}`);
          console.log(`  Last Point: ${locations[locations.length - 1].Date}`);
          console.log();
        });
        
        console.log('Detailed Data:');
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log('⚠️  No location data returned (empty array)');
        console.log('This is normal if no devices have been active in the last hour.');
      }
    } else {
      console.log('⚠️  Response has no "data" property');
      console.log('Full Response:', JSON.stringify(data, null, 2));
    }

  } catch (error: any) {
    console.error('\n❌ Test 1 Failed:');
    console.error('Error:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 2: Date range for all devices (today)
  console.log('📍 Test 2: Fetching today\'s data for all devices...\n');
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const url = new URL(FOLLOWMEE_BASE_URL);
    url.searchParams.set('key', FOLLOWMEE_API_KEY);
    url.searchParams.set('username', FOLLOWMEE_USERNAME);
    url.searchParams.set('output', 'json');
    url.searchParams.set('function', 'daterangeforalldevices');
    url.searchParams.set('from', today);
    url.searchParams.set('to', today);

    console.log('Request URL:', url.toString().replace(FOLLOWMEE_API_KEY, '***API_KEY***'));
    console.log('Date Range:', today, 'to', today);
    console.log('Sending request...\n');

    const response = await fetch(url.toString());
    
    console.log('Response Status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log('✅ Response received!\n');
    
    if (data.data) {
      console.log(`Found ${data.data.length} location points for today\n`);
      
      if (data.data.length > 0) {
        // Group by device
        const deviceMap = new Map<string, any[]>();
        for (const location of data.data) {
          if (!deviceMap.has(location.DeviceID)) {
            deviceMap.set(location.DeviceID, []);
          }
          deviceMap.get(location.DeviceID)!.push(location);
        }
        
        console.log(`Devices active today: ${deviceMap.size}\n`);
        
        deviceMap.forEach((locations, deviceId) => {
          locations.sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime());
          console.log(`Device: ${deviceId}`);
          console.log(`  Device Name: ${locations[0].DeviceName}`);
          console.log(`  Location Count: ${locations.length}`);
          console.log(`  First: ${locations[0].Date}`);
          console.log(`  Last: ${locations[locations.length - 1].Date}`);
          console.log();
        });
        
        console.log('Sample Locations (first 3):');
        console.log(JSON.stringify(data.data.slice(0, 3), null, 2));
      } else {
        console.log('⚠️  No location data for today');
      }
    } else {
      console.log('⚠️  Response has no "data" property');
      console.log('Full Response:', JSON.stringify(data, null, 2));
    }

  } catch (error: any) {
    console.error('\n❌ Test 2 Failed:');
    console.error('Error:', error.message);
  }

  console.log('\n' + '='.repeat(80) + '\n');
  console.log('🎉 FollowMee API Test Complete!\n');
}

// Run the test
testFollowMeeAPI().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
