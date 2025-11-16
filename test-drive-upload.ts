/**
 * Google Drive Upload Test
 *
 * Testet ob:
 * 1. Credentials korrekt geladen werden
 * 2. Drive API erreichbar ist
 * 3. Folder-ID korrekt ist
 * 4. Upload-Berechtigungen vorhanden sind
 */

import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

dotenv.config();

const DRIVE_FOLDER_ID = '1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U';

async function testDriveUpload() {
  console.log('\n========================================');
  console.log('🧪 GOOGLE DRIVE UPLOAD TEST');
  console.log('========================================\n');

  try {
    // STEP 1: Check credentials
    console.log('--- Step 1: Check Credentials ---');

    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;

    if (!sheetsKey) {
      console.error('❌ GOOGLE_SHEETS_KEY not found in environment');
      console.log('\nℹ️  Make sure .env contains:');
      console.log('   GOOGLE_SHEETS_KEY={"type":"service_account",...}');
      process.exit(1);
    }

    console.log('✅ GOOGLE_SHEETS_KEY found');

    let credentials: any;
    try {
      credentials = JSON.parse(sheetsKey);
      console.log('✅ JSON parsed successfully');
    } catch (error) {
      console.error('❌ Failed to parse GOOGLE_SHEETS_KEY as JSON');
      console.error('Error:', error);
      process.exit(1);
    }

    if (!credentials.client_email || !credentials.private_key) {
      console.error('❌ Credentials missing client_email or private_key');
      console.log('\nFound keys:', Object.keys(credentials));
      process.exit(1);
    }

    console.log('✅ client_email:', credentials.client_email);
    console.log('✅ private_key: [PRESENT]');
    console.log('✅ project_id:', credentials.project_id || '[NOT SET]');

    // STEP 2: Initialize Drive client
    console.log('\n--- Step 2: Initialize Drive Client ---');

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });

    const drive = google.drive({ version: 'v3', auth });
    console.log('✅ Drive client created');

    // STEP 3: Test authentication
    console.log('\n--- Step 3: Test Authentication ---');

    try {
      const aboutResponse = await drive.about.get({ fields: 'user' });
      console.log('✅ Authentication successful');
      console.log('   User:', aboutResponse.data.user?.emailAddress);
    } catch (error: any) {
      console.error('❌ Authentication failed');
      console.error('Error:', error.message);

      if (error.code === 401) {
        console.log('\nℹ️  This is likely a credentials issue:');
        console.log('   - Check that GOOGLE_SHEETS_KEY is the service account JSON');
        console.log('   - Ensure private_key is properly escaped (\\n for newlines)');
      }

      process.exit(1);
    }

    // STEP 4: Check folder access
    console.log('\n--- Step 4: Check Folder Access ---');

    try {
      const folderResponse = await drive.files.get({
        fileId: DRIVE_FOLDER_ID,
        fields: 'id, name, permissions',
        supportsAllDrives: true
      });

      console.log('✅ Folder accessible');
      console.log('   Folder ID:', folderResponse.data.id);
      console.log('   Folder Name:', folderResponse.data.name);
    } catch (error: any) {
      console.error('❌ Cannot access folder');
      console.error('Error:', error.message);

      if (error.code === 404) {
        console.log('\nℹ️  Folder not found or not accessible:');
        console.log('   1. Verify folder ID: 1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U');
        console.log('   2. Share folder with service account email:');
        console.log(`      ${credentials.client_email}`);
        console.log('   3. Give "Editor" permissions');
      } else if (error.code === 403) {
        console.log('\nℹ️  Permission denied:');
        console.log('   Share the folder with:');
        console.log(`   ${credentials.client_email}`);
        console.log('   Role: Editor');
      }

      process.exit(1);
    }

    // STEP 5: Create test file
    console.log('\n--- Step 5: Create Test File ---');

    const testFilePath = path.join(process.cwd(), 'drive-test.txt');
    const testContent = `
Google Drive Upload Test
========================
Timestamp: ${new Date().toISOString()}
Service Account: ${credentials.client_email}
Folder ID: ${DRIVE_FOLDER_ID}

This file was created by the EnergyScanCapture SQLite logging system test.
If you see this file in Google Drive, the upload is working correctly!

✅ SUCCESS
    `.trim();

    fs.writeFileSync(testFilePath, testContent);
    console.log('✅ Test file created:', testFilePath);

    // STEP 6: Upload test file
    console.log('\n--- Step 6: Upload Test File ---');

    try {
      const uploadResponse = await drive.files.create({
        requestBody: {
          name: `drive-test-${Date.now()}.txt`,
          parents: [DRIVE_FOLDER_ID],
          mimeType: 'text/plain'
        },
        media: {
          mimeType: 'text/plain',
          body: fs.createReadStream(testFilePath)
        },
        fields: 'id, name, webViewLink'
      });

      console.log('✅ Upload successful!');
      console.log('   File ID:', uploadResponse.data.id);
      console.log('   File Name:', uploadResponse.data.name);
      console.log('   View Link:', uploadResponse.data.webViewLink);

      // Cleanup local test file
      fs.unlinkSync(testFilePath);
      console.log('✅ Local test file cleaned up');

      console.log('\n========================================');
      console.log('✅ ALL TESTS PASSED');
      console.log('========================================\n');

      console.log('📋 Next Steps:');
      console.log('1. Check Google Drive folder for the test file');
      console.log('2. Add to .env: GOOGLE_DRIVE_LOG_FOLDER_ID=1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U');
      console.log('3. Deploy to Railway');
      console.log('4. SQLite backup system is ready! 🚀\n');

      process.exit(0);

    } catch (error: any) {
      console.error('❌ Upload failed');
      console.error('Error:', error.message);
      console.error('Code:', error.code);

      if (error.code === 403) {
        console.log('\nℹ️  Permission denied during upload:');
        console.log('   1. Go to: https://drive.google.com/drive/folders/1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U');
        console.log('   2. Click "Share"');
        console.log(`   3. Add: ${credentials.client_email}`);
        console.log('   4. Role: "Editor" (not "Viewer")');
        console.log('   5. Uncheck "Notify people" (it\'s a service account)');
        console.log('   6. Click "Share"');
      }

      // Cleanup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }

      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n❌ UNEXPECTED ERROR');
    console.error(error);
    process.exit(1);
  }
}

// Run test
testDriveUpload();
