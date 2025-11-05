/**
 * Test Script für External Tracking API
 *
 * Testet das Senden von Location-Daten an den neuen API-Endpunkt
 */

import type { LocationData } from './shared/externalTrackingTypes';

const API_BASE_URL = 'http://localhost:5000/api/external-tracking';

async function testStatusEndpoint() {
  console.log('\n🧪 Test 1: Status Endpoint');
  console.log('=' .repeat(50));

  try {
    const response = await fetch(`${API_BASE_URL}/status`);
    const data = await response.json();

    if (response.ok) {
      console.log('✅ Status Endpoint erfolgreich');
      console.log('Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Status Endpoint fehlgeschlagen');
      console.log('Status:', response.status);
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error: any) {
    console.error('❌ Fehler beim Status-Test:', error.message);
  }
}

async function testLocationEndpoint() {
  console.log('\n🧪 Test 2: Location Data Endpoint');
  console.log('=' .repeat(50));

  // Beispiel-Location-Daten
  const testLocationData: LocationData = {
    timestamp: new Date().toISOString(),
    latitude: 52.520008,
    longitude: 13.404954,
    altitude: 34.5,
    accuracy: 5.0,
    altitudeAccuracy: 3.0,
    heading: 180.5,
    speed: 1.5,
    userName: "Test User",
    batteryLevel: 85.5,
    batteryState: "UNPLUGGED",
    isCharging: false,
    deviceName: "iPhone 14 Pro",
    deviceModel: "iPhone15,2",
    osVersion: "17.2",
    isConnected: true,
    connectionType: "wifi"
  };

  console.log('Sende Location-Daten:', JSON.stringify(testLocationData, null, 2));

  try {
    const response = await fetch(`${API_BASE_URL}/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testLocationData),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('\n✅ Location-Daten erfolgreich gesendet');
      console.log('Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('\n❌ Fehler beim Senden der Location-Daten');
      console.log('Status:', response.status);
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error: any) {
    console.error('❌ Fehler beim Location-Test:', error.message);
  }
}

async function testInvalidData() {
  console.log('\n🧪 Test 3: Invalid Data (Missing Required Fields)');
  console.log('=' .repeat(50));

  const invalidData = {
    timestamp: new Date().toISOString(),
    // latitude fehlt absichtlich
    longitude: 13.404954,
    userName: "Test User",
    isCharging: false,
    isConnected: true
  };

  console.log('Sende ungültige Daten (latitude fehlt):', JSON.stringify(invalidData, null, 2));

  try {
    const response = await fetch(`${API_BASE_URL}/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invalidData),
    });

    const data = await response.json();

    if (!response.ok && response.status === 400) {
      console.log('\n✅ Validierung funktioniert korrekt (400 Bad Request erwartet)');
      console.log('Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('\n❌ Validierung fehlgeschlagen (400 erwartet, aber bekam:', response.status, ')');
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error: any) {
    console.error('❌ Fehler beim Invalid-Data-Test:', error.message);
  }
}

async function runTests() {
  console.log('\n🚀 Starting External Tracking API Tests');
  console.log('=' .repeat(50));

  await testStatusEndpoint();
  await testLocationEndpoint();
  await testInvalidData();

  console.log('\n' + '=' .repeat(50));
  console.log('✅ Alle Tests abgeschlossen!');
  console.log('=' .repeat(50));
  console.log('\n📊 Prüfe jetzt das Google Sheet mit ID: 1OspTbAfG6TM4SiUIHeRAF_QlODy3oHjubbiUTRGDo3Y');
  console.log('   → Es sollte ein neues Tabellenblatt "Test User" existieren');
  console.log('   → Die gesendeten Daten sollten dort eingetragen sein\n');

  process.exit(0);
}

runTests();
