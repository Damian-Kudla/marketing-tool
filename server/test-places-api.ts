/**
 * Test script for Google Places API - POI Detection
 * Compares Geocoding vs Places API for POI name extraction
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;

if (!API_KEY) {
  console.error('❌ GOOGLE_GEOCODING_API_KEY not found in .env');
  process.exit(1);
}

// Test coordinates
const testLocations = [
  {
    name: 'Shell Tankstelle (erwartet)',
    lat: 51.17362559,
    lng: 6.686829809
  },
  {
    name: 'Kamps Bäckerei (erwartet)',
    lat: 51.16722107,
    lng: 6.685068085
  },
  {
    name: 'Parkplatz (erwartet)',
    lat: 51.1758668,
    lng: 6.681433994
  }
];

/**
 * Fetch from Places API (Nearby Search)
 */
async function fetchPlacesNearby(lat: number, lng: number): Promise<any> {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=50&key=${API_KEY}&language=de`;
  
  console.log(`\n🌐 Places API Request (radius 50m)`);
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
  }
  
  return data;
}

/**
 * Test a single location with Places API
 */
async function testLocation(location: typeof testLocations[0]) {
  console.log('\n' + '='.repeat(80));
  console.log(`📍 Testing: ${location.name}`);
  console.log(`   Coordinates: ${location.lat}, ${location.lng}`);
  console.log('='.repeat(80));
  
  try {
    const placesData = await fetchPlacesNearby(location.lat, location.lng);
    
    console.log(`\n✅ Places API Status: ${placesData.status}`);
    console.log(`📊 Total Results: ${placesData.results?.length || 0}`);
    
    if (placesData.results && placesData.results.length > 0) {
      console.log('\n📋 Places Found (sorted by distance):');
      
      placesData.results.slice(0, 5).forEach((place: any, index: number) => {
        console.log(`\n   [${index + 1}] ${place.name}`);
        console.log(`       Address: ${place.vicinity || 'N/A'}`);
        console.log(`       Types: ${place.types.join(', ')}`);
        console.log(`       Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews)`);
        console.log(`       Business Status: ${place.business_status || 'N/A'}`);
        console.log(`       Place ID: ${place.place_id}`);
      });
      
      // Best match (first result, closest)
      const bestMatch = placesData.results[0];
      console.log('\n🎯 BEST MATCH (nächstgelegener POI):');
      console.log(`   ✅ Name: ${bestMatch.name}`);
      console.log(`   📍 Address: ${bestMatch.vicinity || 'N/A'}`);
      console.log(`   🏷️  Type: ${bestMatch.types[0]}`);
      
    } else {
      console.log('\n❌ NO PLACES FOUND in 50m radius');
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('\n🔬 Google Places API - POI Detection Test');
  console.log(`🔑 API Key: ${API_KEY?.substring(0, 10)}...`);
  console.log(`📅 Date: ${new Date().toLocaleString('de-DE')}`);
  console.log('\n⚠️  Note: Places API costs $17 per 1000 requests (vs Geocoding $5)');
  console.log('   This test will make 3 API calls (~$0.05)');
  
  for (const location of testLocations) {
    await testLocation(location);
    // Wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ All tests completed!');
  console.log('\n📝 Recommendation:');
  console.log('   1. Use Geocoding API first (cheaper, $5/1000)');
  console.log('   2. If no specific POI name → Fallback to Places API ($17/1000)');
  console.log('   3. Cache results aggressively to minimize costs');
  console.log('='.repeat(80) + '\n');
}

// Run tests
main().catch(console.error);
