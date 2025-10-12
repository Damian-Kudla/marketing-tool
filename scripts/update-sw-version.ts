/**
 * Build script to inject version from package.json into service worker
 * This runs during the build process to ensure SW always has current version
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function updateServiceWorkerVersion() {
  try {
    // Read package.json to get current version
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const version = packageJson.version;

    console.log(`📦 Updating Service Worker to version ${version}`);

    // Read service worker file
    const swPath = join(process.cwd(), 'client', 'public', 'sw.js');
    let swContent = readFileSync(swPath, 'utf-8');

    // Replace version in cache name
    // Pattern: const CACHE_NAME = 'energy-scan-v1.0.0';
    const cacheNameRegex = /const CACHE_NAME = ['"]energy-scan-v[\d.]+['"];/;
    const newCacheName = `const CACHE_NAME = 'energy-scan-v${version}';`;
    
    if (cacheNameRegex.test(swContent)) {
      swContent = swContent.replace(cacheNameRegex, newCacheName);
      console.log(`✅ Updated CACHE_NAME to: energy-scan-v${version}`);
    } else {
      console.warn('⚠️ Could not find CACHE_NAME pattern in sw.js');
    }

    // Also update version constant if exists
    const versionRegex = /const VERSION = ['"][\d.]+['"];/;
    const newVersion = `const VERSION = '${version}';`;
    
    if (versionRegex.test(swContent)) {
      swContent = swContent.replace(versionRegex, newVersion);
      console.log(`✅ Updated VERSION constant to: ${version}`);
    } else {
      // Add VERSION constant if it doesn't exist
      const firstLine = '// Service Worker for Energy Scan Capture PWA\n';
      if (swContent.startsWith(firstLine)) {
        swContent = swContent.replace(
          firstLine,
          `${firstLine}const VERSION = '${version}';\n`
        );
        console.log(`✅ Added VERSION constant: ${version}`);
      }
    }

    // Write updated service worker
    writeFileSync(swPath, swContent, 'utf-8');
    console.log('✅ Service Worker version updated successfully');

    // Create version.json for version checking
    const versionJsonPath = join(process.cwd(), 'client', 'public', 'version.json');
    const versionJson = {
      version: version,
      buildTime: new Date().toISOString(),
      buildNumber: process.env.BUILD_NUMBER || 'local'
    };
    
    writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2), 'utf-8');
    console.log(`✅ Created version.json with version ${version}`);

    return version;
  } catch (error) {
    console.error('❌ Error updating Service Worker version:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateServiceWorkerVersion();
}

export { updateServiceWorkerVersion };
