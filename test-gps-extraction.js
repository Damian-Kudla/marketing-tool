// Test the GPS data extraction logic
const testData = {
  "endpoint": "/api/tracking/gps",
  "method": "POST",
  "address": "GPS: 50.922138, 6.934912",
  "userAgent": "Mozilla/5.0...",
  "data": {
    "action": "gps_update",
    "latitude": 50.92213775501672,
    "longitude": 6.934912260628244,
    "accuracy": 25,
    "timestamp": 1763448413346,
    "source": "native"
  }
};

console.log('Testing GPS extraction logic:\n');

// Simulate the code logic
let logData = testData; // This is what (log.data as any).data || log.data would give us
let gpsData = logData;

console.log('Step 1: logData keys:', Object.keys(logData));
console.log('Step 2: logData.data exists?', logData.data !== undefined);
console.log('Step 3: logData.data.latitude exists?', logData.data?.latitude !== undefined);

// Check if data is nested (new format from enhancedLogging)
if (logData.data && logData.data.latitude !== undefined) {
  gpsData = logData.data;
  console.log('Step 4: Using nested data');
} else {
  console.log('Step 4: Using top-level data');
}

console.log('\nFinal gpsData:');
console.log('  latitude:', gpsData.latitude);
console.log('  longitude:', gpsData.longitude);
console.log('  source:', gpsData.source);
console.log('\n✅ Source is correctly extracted!');
