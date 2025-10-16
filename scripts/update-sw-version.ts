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

    // Replace version in all cache names
    // Pattern: const CACHE_NAME = 'akquise-tool-v1.0.0';
    swContent = swContent.replace(
      /const CACHE_NAME = ['"]akquise-tool-v[\d.]+['"];/g,
      `const CACHE_NAME = 'akquise-tool-v${version}';`
    );
    swContent = swContent.replace(
      /const STATIC_CACHE = ['"]static-cache-v[\d.]+['"];/g,
      `const STATIC_CACHE = 'static-cache-v${version}';`
    );
    swContent = swContent.replace(
      /const API_CACHE = ['"]api-cache-v[\d.]+['"];/g,
      `const API_CACHE = 'api-cache-v${version}';`
    );
    swContent = swContent.replace(
      /const IMAGE_CACHE = ['"]image-cache-v[\d.]+['"];/g,
      `const IMAGE_CACHE = 'image-cache-v${version}';`
    );
    console.log(`✅ Updated all cache names to version ${version}`);

    // Also update version constant if exists
    const versionRegex = /const VERSION = ['"][\d.]+['"];/;
    const newVersion = `const VERSION = '${version}';`;
    
    if (versionRegex.test(swContent)) {
      swContent = swContent.replace(versionRegex, newVersion);
      console.log(`✅ Updated VERSION constant to: ${version}`);
    } else {
      // Add VERSION constant if it doesn't exist
      const firstLine = '// Akquise-Tool PWA Service Worker\n';
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
