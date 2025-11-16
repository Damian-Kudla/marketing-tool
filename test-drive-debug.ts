/**
 * Google Drive Debug Test
 * Erweiterte Diagnose für Berechtigungsprobleme
 */

import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const DRIVE_FOLDER_ID = '1PTEhP99u_IqMy5dGZRkwa9_GJK1dW75U';

async function debugDriveAccess() {
  console.log('\n========================================');
  console.log('🔍 GOOGLE DRIVE DEBUG TEST');
  console.log('========================================\n');

  try {
    // Initialize
    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    if (!sheetsKey) {
      console.error('❌ GOOGLE_SHEETS_KEY not found');
      process.exit(1);
    }

    const credentials = JSON.parse(sheetsKey);
    console.log('Service Account:', credentials.client_email);

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ]
    });

    const drive = google.drive({ version: 'v3', auth });

    // TEST 1: List all accessible folders
    console.log('\n--- Test 1: List All Accessible Folders ---');
    try {
      const listResponse = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name, owners, shared, capabilities)',
        pageSize: 20
      });

      const folders = listResponse.data.files || [];
      console.log(`Found ${folders.length} accessible folders:\n`);

      folders.forEach((folder, index) => {
        console.log(`${index + 1}. ${folder.name}`);
        console.log(`   ID: ${folder.id}`);
        console.log(`   Shared: ${folder.shared}`);
        console.log(`   Can Edit: ${folder.capabilities?.canEdit}`);
        console.log('');
      });

      // Check if our folder is in the list
      const targetFolder = folders.find(f => f.id === DRIVE_FOLDER_ID);
      if (targetFolder) {
        console.log('✅ Target folder FOUND in accessible list!');
        console.log('   Name:', targetFolder.name);
      } else {
        console.log('❌ Target folder NOT in accessible list');
      }
    } catch (error: any) {
      console.error('❌ Failed to list folders:', error.message);
    }

    // TEST 2: Try to access folder with different scopes
    console.log('\n--- Test 2: Direct Folder Access Attempt ---');
    try {
      const folderResponse = await drive.files.get({
        fileId: DRIVE_FOLDER_ID,
        fields: 'id, name, mimeType, owners, shared, capabilities, permissions',
        supportsAllDrives: true
      });

      console.log('✅ Folder accessible!');
      console.log('   ID:', folderResponse.data.id);
      console.log('   Name:', folderResponse.data.name);
      console.log('   Shared:', folderResponse.data.shared);
      console.log('   Can Edit:', folderResponse.data.capabilities?.canEdit);
      console.log('   Can Add Children:', folderResponse.data.capabilities?.canAddChildren);

      if (folderResponse.data.permissions) {
        console.log('\n   Permissions:');
        folderResponse.data.permissions.forEach((perm: any) => {
          console.log(`   - ${perm.emailAddress || perm.type}: ${perm.role}`);
        });
      }
    } catch (error: any) {
      console.error('❌ Cannot access folder');
      console.error('   Error Code:', error.code);
      console.error('   Error Message:', error.message);

      if (error.code === 404) {
        console.log('\n🔍 Troubleshooting 404 Error:');
        console.log('   1. The folder ID might be incorrect');
        console.log('   2. The service account might not have been added yet');
        console.log('   3. Permissions might not have propagated (can take 1-2 minutes)');
        console.log('\n💡 Try these steps:');
        console.log('   1. Go to Google Drive folder');
        console.log('   2. Right-click → Share');
        console.log('   3. Remove the service account if already added');
        console.log('   4. Add it again with "Editor" role');
        console.log('   5. Make sure "Notify people" is UNCHECKED');
        console.log('   6. Wait 1-2 minutes');
        console.log('   7. Run this test again');
      }
    }

    // TEST 3: Try to create a folder (to verify write permissions)
    console.log('\n--- Test 3: Create Test Folder (Write Permissions) ---');
    try {
      const testFolderResponse = await drive.files.create({
        requestBody: {
          name: `TEST-${Date.now()}`,
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id, name, webViewLink'
      });

      console.log('✅ Can create folders (write permissions work)');
      console.log('   Created test folder:', testFolderResponse.data.name);
      console.log('   Folder ID:', testFolderResponse.data.id);
      console.log('   Link:', testFolderResponse.data.webViewLink);

      console.log('\n⚠️  This test folder was created in "My Drive" of the service account');
      console.log('   You can delete it from: https://drive.google.com/drive/u/0/my-drive');

    } catch (error: any) {
      console.error('❌ Cannot create folders');
      console.error('   Error:', error.message);
    }

    // TEST 4: Check if folder is in a Shared Drive
    console.log('\n--- Test 4: Check Shared Drives ---');
    try {
      const drivesResponse = await drive.drives.list({
        fields: 'drives(id, name)'
      });

      const drives = drivesResponse.data.drives || [];

      if (drives.length > 0) {
        console.log(`Found ${drives.length} Shared Drives:`);
        drives.forEach((d, index) => {
          console.log(`${index + 1}. ${d.name} (ID: ${d.id})`);
        });

        console.log('\n💡 If your folder is in a Shared Drive:');
        console.log('   - Service account needs to be added to the Shared Drive');
        console.log('   - Not just to the individual folder');
      } else {
        console.log('No Shared Drives accessible');
      }
    } catch (error: any) {
      console.log('No Shared Drives found or accessible');
    }

    console.log('\n========================================');
    console.log('📊 DEBUG TEST COMPLETED');
    console.log('========================================\n');

    console.log('📋 Next Actions:');
    console.log('1. Check the output above for any "✅ Folder accessible" message');
    console.log('2. If folder NOT found:');
    console.log('   - Wait 2-3 minutes after sharing');
    console.log('   - Try removing and re-adding the service account');
    console.log('   - Make sure you shared the FOLDER, not a file');
    console.log('3. If folder FOUND but can\'t upload:');
    console.log('   - Check "Can Add Children" capability');
    console.log('   - Service account needs "Editor" role, not "Viewer"\n');

  } catch (error: any) {
    console.error('\n❌ UNEXPECTED ERROR');
    console.error(error);
    process.exit(1);
  }
}

debugDriveAccess();
