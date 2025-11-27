#!/usr/bin/env tsx

/**
 * Address Dataset Recovery Script
 *
 * Analysiert Activity Log Backups und stellt verlorene Address Datasets wieder her
 *
 * VERWENDUNG:
 * 1. Lade die Backup-JSON-Datei von Google Drive herunter
 * 2. Führe das Skript aus:
 *    npx tsx restore-address-datasets.ts <path-to-backup.json>
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { google } from './server/services/googleApiWrapper';

interface ActivityLogEntry {
  timestamp: string;
  userId: string;
  username: string;
  endpoint: string;
  method: string;
  address?: string;
  newProspects?: string;
  existingCustomers?: string;
  userAgent: string;
  data?: string;
}

interface BackupData {
  backupDate: string;
  dateRange: string;
  sqliteCount: number;
  sheetsCount: number;
  totalCount: number;
  logs: ActivityLogEntry[];
}

interface AddressDataset {
  id: string;
  normalizedAddress: string;
  street: string;
  houseNumber: string;
  city?: string;
  postalCode: string;
  createdBy: string;
  createdAt: string;
  rawResidentData: string;
  editableResidents: string;
  fixedCustomers: string;
}

async function analyzeBackup(backupPath: string): Promise<AddressDataset[]> {
  console.log(`[Restore] Reading backup file: ${backupPath}`);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  const backupData: BackupData = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
  console.log(`[Restore] Loaded ${backupData.totalCount} log entries from ${backupData.dateRange}`);

  const datasets: AddressDataset[] = [];
  const seenIds = new Set<string>();

  // Analyze each log entry
  for (const log of backupData.logs) {
    // Look for address dataset creation
    if (log.endpoint === '/api/address-datasets' && log.method === 'POST' && log.data) {
      try {
        const data = JSON.parse(log.data);

        // Extract dataset information
        if (data.id && data.normalizedAddress) {
          // Skip if we already processed this ID
          if (seenIds.has(data.id)) {
            continue;
          }
          seenIds.add(data.id);

          datasets.push({
            id: data.id,
            normalizedAddress: data.normalizedAddress,
            street: data.street || '',
            houseNumber: data.houseNumber || '',
            city: data.city,
            postalCode: data.postalCode || '',
            createdBy: log.username,
            createdAt: log.timestamp,
            rawResidentData: JSON.stringify(data.rawResidentData || []),
            editableResidents: JSON.stringify(data.editableResidents || []),
            fixedCustomers: JSON.stringify(data.fixedCustomers || [])
          });

          console.log(`[Restore]   ✓ Found dataset: ${data.normalizedAddress} (created by ${log.username})`);
        }
      } catch (error) {
        console.warn(`[Restore]   ⚠ Failed to parse data at ${log.timestamp}:`, error);
      }
    }

    // Also look for resident updates (might contain dataset info)
    if (log.endpoint.includes('/api/residents') && log.method === 'PUT' && log.data) {
      try {
        const data = JSON.parse(log.data);

        // Check if this contains dataset info
        if (data.datasetId && data.address) {
          // Try to reconstruct dataset from update
          if (!seenIds.has(data.datasetId)) {
            console.log(`[Restore]   ℹ Found dataset update: ${data.address} (ID: ${data.datasetId})`);
            // Note: This is incomplete data, mark it for manual review
          }
        }
      } catch (error) {
        // Ignore parse errors for non-JSON data
      }
    }
  }

  console.log(`\n[Restore] Found ${datasets.length} complete address datasets`);
  return datasets;
}

async function restoreToSheets(datasets: AddressDataset[]): Promise<void> {
  console.log('\n[Restore] Restoring datasets to Google Sheets...');

  // Initialize Google Sheets client
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_SHEETS_KEY;
  if (!credentialsJson) {
    throw new Error('Google credentials not configured');
  }

  const credentials = JSON.parse(credentialsJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SYSTEM_SHEET_ID = process.env.GOOGLE_SYSTEM_SHEET_ID || '1OsXBfxE2Pe7cPBGjPD9C2-03gm8cNfMdR9_EfZicMyw';

  // Get existing datasets from Sheets
  console.log('[Restore] Checking for existing datasets in Sheets...');
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SYSTEM_SHEET_ID,
    range: 'Adressen!A2:K'
  });

  const existingRows = response.data.values || [];
  const existingIds = new Set(existingRows.map(row => row[0]));

  // Filter out datasets that already exist
  const newDatasets = datasets.filter(d => !existingIds.has(d.id));

  if (newDatasets.length === 0) {
    console.log('[Restore] All datasets already exist in Sheets. Nothing to restore.');
    return;
  }

  console.log(`[Restore] Restoring ${newDatasets.length} new datasets...`);

  // Prepare rows for insertion
  const rows = newDatasets.map(d => [
    d.id,
    d.normalizedAddress,
    d.street,
    d.houseNumber,
    d.city || '',
    d.postalCode,
    d.createdBy,
    d.createdAt,
    d.rawResidentData,
    d.editableResidents,
    d.fixedCustomers
  ]);

  // Append to Sheets
  await sheets.spreadsheets.values.append({
    spreadsheetId: SYSTEM_SHEET_ID,
    range: 'Adressen!A:K',
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });

  console.log(`[Restore] ✅ Restored ${newDatasets.length} datasets to Sheets`);
}

async function exportToJSON(datasets: AddressDataset[], outputPath: string): Promise<void> {
  console.log(`\n[Restore] Exporting datasets to: ${outputPath}`);

  const exportData = {
    exportDate: new Date().toISOString(),
    totalDatasets: datasets.length,
    datasets
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`[Restore] ✅ Exported ${datasets.length} datasets`);
}

async function main() {
  console.log('========================================');
  console.log('🔧 ADDRESS DATASET RECOVERY');
  console.log('========================================\n');

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ ERROR: No backup file specified');
    console.error('\nUSAGE:');
    console.error('  npx tsx restore-address-datasets.ts <path-to-backup.json>');
    console.error('\nEXAMPLE:');
    console.error('  npx tsx restore-address-datasets.ts ./data/temp/activity-logs-backup-2025-11-27.json');
    process.exit(1);
  }

  const backupPath = args[0];
  const autoRestore = args.includes('--auto-restore');

  try {
    // Step 1: Analyze backup
    const datasets = await analyzeBackup(backupPath);

    if (datasets.length === 0) {
      console.log('\n⚠️  No datasets found in backup. Nothing to restore.');
      process.exit(0);
    }

    // Step 2: Export to JSON for manual review
    const exportPath = path.join(process.cwd(), 'data', 'temp', `recovered-datasets-${Date.now()}.json`);
    await exportToJSON(datasets, exportPath);

    // Step 3: Ask user if they want to restore to Sheets
    if (autoRestore) {
      console.log('\n[Restore] Auto-restore mode enabled. Restoring to Sheets...');
      await restoreToSheets(datasets);
    } else {
      console.log('\n========================================');
      console.log('✅ ANALYSIS COMPLETE');
      console.log('========================================');
      console.log(`📊 Datasets found: ${datasets.length}`);
      console.log(`📄 Export file: ${exportPath}`);
      console.log('\n💡 NEXT STEPS:');
      console.log('1. Review the exported JSON file');
      console.log('2. Run with --auto-restore to restore to Google Sheets:');
      console.log(`   npx tsx restore-address-datasets.ts ${backupPath} --auto-restore`);
      console.log('========================================\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ RESTORE FAILED:', error);
    process.exit(1);
  }
}

main();
