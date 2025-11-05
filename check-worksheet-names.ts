import { googleSheetsService } from './server/services/googleSheets';

async function checkWorksheetNames() {
  console.log('🔍 Checking existing worksheet names in Google Sheets...\n');
  
  // @ts-ignore - Access private property for inspection
  const sheets = googleSheetsService.sheets;
  const spreadsheetId = process.env.GOOGLE_SHEETS_LOG_SPREADSHEET_ID;
  
  if (!spreadsheetId) {
    console.error('❌ GOOGLE_SHEETS_LOG_SPREADSHEET_ID not set');
    return;
  }
  
  const response = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId
  });
  
  console.log('📊 All worksheets in the logging spreadsheet:\n');
  
  const worksheets = response.data.sheets || [];
  const userWorksheets = worksheets.filter((sheet: any) => {
    const title = sheet.properties?.title || '';
    return title.includes('_') && !title.startsWith('Übersicht');
  });
  
  console.log(`Found ${userWorksheets.length} user worksheets:\n`);
  
  for (const sheet of userWorksheets) {
    const title = sheet.properties?.title || '';
    const parts = title.split('_');
    if (parts.length >= 2) {
      const username = parts[0];
      const userId = parts[1];
      console.log(`  ${username} → User ID: ${userId}`);
    }
  }
  
  console.log('\n✅ Done');
}

checkWorksheetNames().catch(console.error);
