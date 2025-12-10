/**
 * Test script for Google Geocoding API - POI Detection
 * Tests three real-world coordinates to verify POI extraction
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

interface GeocodingResult {
  formatted_address: string;
  types: string[];
  address_components: any[];
  place_id: string;
}

interface POIInfo {
  name: string;
  address: string;
  types: string[];
  isPOI: boolean;
}

/**
 * Fetch geocoding data from Google API
 */
async function fetchGeocoding(lat: number, lng: number): Promise<any> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&language=de`;
  
  console.log(`\n🌐 API Request: ${url.replace(API_KEY!, 'API_KEY')}`);
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK') {
    throw new Error(`Geocoding API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
  }
  
  return data;
}

/**
 * Extract POI information from geocoding result
 */
function extractPOI(geocodingData: any): POIInfo | null {
  const results: GeocodingResult[] = geocodingData.results;
  
  if (!results || results.length === 0) {
    return null;
  }
  
  // Find first result that is a POI (has point_of_interest or establishment type)
  const poiResult = results.find(r => 
    r.types.includes('point_of_interest') || 
    r.types.includes('establishment') ||
    r.types.includes('store') ||
    r.types.includes('gas_station') ||
    r.types.includes('bakery') ||
    r.types.includes('parking')
  );
  
  if (!poiResult) {
    // No POI found - might be just a street address
    return null;
  }
  
  // Extract POI name from formatted_address (before first comma)
  const parts = poiResult.formatted_address.split(',');
  const name = parts[0].trim();
  const address = parts.slice(1).join(',').trim();
  
  return {
    name,
    address,
    types: poiResult.types,
    isPOI: poiResult.types.includes('point_of_interest') || 
           poiResult.types.includes('establishment')
  };
}

/**
 * Test a single location
 */
async function testLocation(location: typeof testLocations[0]) {
  console.log('\n' + '='.repeat(80));
  console.log(`📍 Testing: ${location.name}`);
  console.log(`   Coordinates: ${location.lat}, ${location.lng}`);
  console.log('='.repeat(80));
  
  try {
    const geocodingData = await fetchGeocoding(location.lat, location.lng);
    
    console.log(`\n✅ API Response Status: ${geocodingData.status}`);
    console.log(`📊 Total Results: ${geocodingData.results.length}`);
    
    // Show all results
    console.log('\n📋 All Results:');
    geocodingData.results.forEach((result: GeocodingResult, index: number) => {
      console.log(`\n   [${index + 1}] ${result.formatted_address}`);
      console.log(`       Types: ${result.types.join(', ')}`);
      console.log(`       Place ID: ${result.place_id}`);
    });
    
    // Extract POI
    const poi = extractPOI(geocodingData);
    
    if (poi) {
      console.log('\n🎯 POI EXTRACTED:');
      console.log(`   Name: ${poi.name}`);
      console.log(`   Address: ${poi.address}`);
      console.log(`   Types: ${poi.types.join(', ')}`);
      console.log(`   Is POI: ${poi.isPOI ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log('\n❌ NO POI FOUND (nur Straßenadresse)');
      console.log(`   Fallback: ${geocodingData.results[0]?.formatted_address || 'N/A'}`);
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('\n🔬 Google Geocoding API - POI Detection Test');
  console.log(`🔑 API Key: ${API_KEY?.substring(0, 10)}...`);
  console.log(`📅 Date: ${new Date().toLocaleString('de-DE')}`);
  
  for (const location of testLocations) {
    await testLocation(location);
    // Wait 1 second between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ All tests completed!');
  console.log('='.repeat(80) + '\n');
}

// Run tests
main().catch(console.error);
