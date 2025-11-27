#!/usr/bin/env tsx

/**
 * Activity Log Backup Script
 *
 * Sichert alle heutigen Activity Logs nach Google Drive
 * AUSFÜHREN VOR DEPLOYMENT/PUSH:
 *
 * npx tsx backup-activity-logs.ts
 */

import 'dotenv/config';
import { activityLogBackupService } from './server/services/activityLogBackup';

async function main() {
  console.log('========================================');
  console.log('🔒 ACTIVITY LOG BACKUP');
  console.log('========================================\n');

  try {
    // Initialize service
    console.log('[Backup] Initializing service...');
    await activityLogBackupService.initialize();

    // Backup today's logs
    console.log('[Backup] Collecting and backing up today\'s activity logs...\n');
    const result = await activityLogBackupService.backupTodayLogs();

    console.log('\n========================================');
    console.log('✅ BACKUP COMPLETED');
    console.log('========================================');
    console.log(`📊 SQLite Entries:  ${result.sqliteEntries}`);
    console.log(`📊 Sheets Entries:  ${result.sheetsEntries}`);
    console.log(`📁 Drive File ID:   ${result.driveFileId}`);
    console.log(`📄 Backup File:     ${result.backupFilePath}`);
    console.log('========================================\n');

    console.log('✅ Backup erfolgreich! Du kannst jetzt committen und pushen.');
    console.log('💡 Tipp: Die Backup-Datei liegt in Google Drive und kann für Datenwiederherstellung verwendet werden.\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ BACKUP FAILED:', error);
    console.error('\n⚠️  WARNUNG: Backup fehlgeschlagen! Überprüfe die Logs und versuche es erneut.');
    process.exit(1);
  }
}

main();
