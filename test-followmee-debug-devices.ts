/**
 * Debug script to analyze why David (12858099) and Imi (12858100) have no data
 */

const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API;
const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';

async function debugFollowMeeDevices() {
  console.log('='.repeat(80));
  console.log('FOLLOWMEE DEBUG ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  if (!FOLLOWMEE_API_KEY) {
    console.error('ERROR: FOLLOWMEE_API environment variable not set');
    process.exit(1);
  }

  // STEP 1: Fetch device list
  console.log('STEP 1: Fetching device list...');
  const infoUrl = `https://www.followmee.com/api/info.aspx?key=${FOLLOWMEE_API_KEY}&username=${FOLLOWMEE_USERNAME}&function=devicelist`;

  const infoResponse = await fetch(infoUrl);
  const devices = await infoResponse.json();

  console.log(`Found ${devices.Data?.length || 0} devices`);
  console.log();

  // Print all devices with their IDs
  if (devices.Data) {
    devices.Data.forEach((device: any) => {
      const deviceId = device.ID || device.DeviceID || device.Id || 'unknown';
      const deviceName = device.DeviceName || device.Name || 'unknown';
      console.log(`  Device ${deviceId}: ${deviceName}`);
    });
  }
  console.log();

  // STEP 2: Fetch 26 hours of history for ALL devices
  console.log('STEP 2: Fetching 26h history for ALL devices...');
  const historyUrl = `https://www.followmee.com/api/tracks.aspx?key=${FOLLOWMEE_API_KEY}&username=${FOLLOWMEE_USERNAME}&output=json&function=historyforalldevices&history=26`;

  const historyResponse = await fetch(historyUrl);
  const history = await historyResponse.json();

  console.log(`Received ${history.Data?.length || 0} total location points`);
  console.log();

  // STEP 3: Group by device and analyze
  console.log('STEP 3: Analyzing location data by device...');
  const locationsByDevice = new Map<string, any[]>();

  if (history.Data) {
    for (const location of history.Data) {
      const deviceId = location.DeviceID;
      if (!locationsByDevice.has(deviceId)) {
        locationsByDevice.set(deviceId, []);
      }
      locationsByDevice.get(deviceId)!.push(location);
    }
  }

  console.log(`Devices with location data: ${locationsByDevice.size}`);
  console.log();

  // Print summary for each device
  for (const [deviceId, locations] of locationsByDevice.entries()) {
    const deviceName = locations[0]?.DeviceName || 'Unknown';
    const timestamps = locations.map(loc => new Date(loc.Date));
    const oldest = new Date(Math.min(...timestamps.map(d => d.getTime())));
    const newest = new Date(Math.max(...timestamps.map(d => d.getTime())));

    console.log(`  Device ${deviceId} (${deviceName}): ${locations.length} points`);
    console.log(`    Oldest: ${oldest.toISOString()}`);
    console.log(`    Newest: ${newest.toISOString()}`);
  }
  console.log();

  // STEP 4: Specifically check David (12858099) and Imi (12858100)
  console.log('STEP 4: Checking specific problem devices...');
  console.log();

  const davidId = '12858099';
  const imiId = '12858100';

  console.log(`David (${davidId}):`);
  if (locationsByDevice.has(davidId)) {
    const davidLocations = locationsByDevice.get(davidId)!;
    console.log(`  ✓ HAS ${davidLocations.length} locations in API response`);
    console.log(`  Sample location:`, JSON.stringify(davidLocations[0], null, 2));
  } else {
    console.log(`  ✗ NO LOCATIONS in API response`);
    console.log(`  Checking if device exists in device list...`);
    const davidDevice = devices.Data?.find((d: any) => {
      const id = d.ID || d.DeviceID || d.Id;
      return id === davidId || id === parseInt(davidId);
    });
    if (davidDevice) {
      console.log(`  ✓ Device exists:`, JSON.stringify(davidDevice, null, 2));
    } else {
      console.log(`  ✗ Device NOT FOUND in device list`);
    }
  }
  console.log();

  console.log(`Imi (${imiId}):`);
  if (locationsByDevice.has(imiId)) {
    const imiLocations = locationsByDevice.get(imiId)!;
    console.log(`  ✓ HAS ${imiLocations.length} locations in API response`);
    console.log(`  Sample location:`, JSON.stringify(imiLocations[0], null, 2));
  } else {
    console.log(`  ✗ NO LOCATIONS in API response`);
    console.log(`  Checking if device exists in device list...`);
    const imiDevice = devices.Data?.find((d: any) => {
      const id = d.ID || d.DeviceID || d.Id;
      return id === imiId || id === parseInt(imiId);
    });
    if (imiDevice) {
      console.log(`  ✓ Device exists:`, JSON.stringify(imiDevice, null, 2));
    } else {
      console.log(`  ✗ Device NOT FOUND in device list`);
    }
  }
  console.log();

  // STEP 5: Try fetching specific device history (if API supports it)
  console.log('STEP 5: Trying to fetch individual device histories...');

  for (const deviceId of [davidId, imiId]) {
    console.log(`\nTrying device ${deviceId}:`);
    const deviceUrl = `https://www.followmee.com/api/tracks.aspx?key=${FOLLOWMEE_API_KEY}&username=${FOLLOWMEE_USERNAME}&output=json&function=history&deviceid=${deviceId}&history=26`;

    try {
      const deviceResponse = await fetch(deviceUrl);
      const deviceData = await deviceResponse.json();
      console.log(`  Response: ${deviceData.Data?.length || 0} points`);
      if (deviceData.Data && deviceData.Data.length > 0) {
        console.log(`  Sample:`, JSON.stringify(deviceData.Data[0], null, 2));
      }
    } catch (error) {
      console.log(`  Error:`, error);
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

debugFollowMeeDevices().catch(console.error);
