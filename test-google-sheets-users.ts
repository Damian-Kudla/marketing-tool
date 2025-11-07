/**
 * Test to check Google Sheets Users sheet directly
 */

import { google } from 'googleapis';

async function testUsersSheet() {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY;

  if (!sheetsKey) {
    console.error('ERROR: GOOGLE_SHEETS_KEY not set');
    process.exit(1);
  }

  try {
    const credentials = JSON.parse(sheetsKey);

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      ],
    });

    const sheetsClient = google.sheets({ version: 'v4', auth });

    const SHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s'; // From googleSheets.ts - GoogleSheetsService

    console.log('Testing Users sheet...\n');

    // Try to get sheet info
    const sheetInfo = await sheetsClient.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    console.log('Available sheets:');
    sheetInfo.data.sheets?.forEach(sheet => {
      console.log(`  - ${sheet.properties?.title}`);
    });
    console.log();

    // Try to read Zugangsdaten sheet (the correct worksheet name)
    console.log('Reading Zugangsdaten sheet (ALL ROWS)...\n');

    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Zugangsdaten!A2:F', // All rows, skip header
    });

    const rows = response.data.values || [];

    console.log(`Found ${rows.length} rows`);
    console.log();

    // Check which users have FollowMee IDs
    console.log('Users WITH FollowMee IDs:');
    const usersWithFollowMee = rows.filter(row => {
      const followMeeId = row[4]?.trim();
      return followMeeId && followMeeId.length > 0;
    });

    if (usersWithFollowMee.length === 0) {
      console.log('  ⚠️  NO USERS have FollowMee IDs!');
    } else {
      usersWithFollowMee.forEach(row => {
        const username = row[1]?.trim();
        const followMeeId = row[4]?.trim();
        console.log(`  - ${username}: ${followMeeId}`);
      });
    }
    console.log();

    console.log('All users (showing FollowMee ID column):');
    rows.forEach((row, i) => {
      const username = row[1]?.trim() || '(no username)';
      const followMeeId = row[4]?.trim() || '(empty)';
      console.log(`  Row ${i + 2}: ${username} → FollowMee ID: ${followMeeId}`);
    });

  } catch (error:any) {
    console.error('Error:', error.message);
    if (error.errors) {
      console.error('Details:', error.errors);
    }
  }

  process.exit(0);
}

testUsersSheet();
