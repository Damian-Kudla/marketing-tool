/**
 * Test to get latest location for David and Imi
 */

const FOLLOWMEE_API_KEY = process.env.FOLLOWMEE_API;
const FOLLOWMEE_USERNAME = process.env.FOLLOWMEE_USERNAME || 'Saskia.zucht';

async function getLatestLocations() {
  console.log('Testing "latest" function for David and Imi...\n');

  const deviceIds = ['12858099', '12858100', '12858102']; // David, Imi, Nic (for comparison)

  for (const deviceId of deviceIds) {
    console.log(`Device ${deviceId}:`);

    // Try "latest" function
    const latestUrl = `https://www.followmee.com/api/tracks.aspx?key=${FOLLOWMEE_API_KEY}&username=${FOLLOWMEE_USERNAME}&output=json&function=latest&deviceid=${deviceId}`;

    try {
      const response = await fetch(latestUrl);
      const data = await response.json();

      if (data.Data && data.Data.length > 0) {
        console.log(`  Latest location:`, JSON.stringify(data.Data[0], null, 2));
      } else {
        console.log(`  No latest location available`);
      }
    } catch (error) {
      console.log(`  Error:`, error);
    }
    console.log();
  }
}

getLatestLocations().catch(console.error);
