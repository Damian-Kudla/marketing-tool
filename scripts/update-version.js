#!/usr/bin/env node
/**
 * Automatic version updater for deployment
 * Updates version in sw.js and version.json
 * Run before building: node scripts/update-version.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read current version from version.json
const versionPath = path.join(__dirname, '../client/public/version.json');
const swPath = path.join(__dirname, '../client/public/sw.js');

const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const currentVersion = versionData.version;

// Parse version
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Increment patch version
const newPatch = patch + 1;
const newVersion = `${major}.${minor}.${newPatch}`;

console.log(`📦 Updating version: ${currentVersion} → ${newVersion}`);

// Update version.json
versionData.version = newVersion;
versionData.buildTime = new Date().toISOString();
versionData.buildNumber = `build-${Date.now()}`;

fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2) + '\n');
console.log('✅ Updated version.json');

// Update sw.js
let swContent = fs.readFileSync(swPath, 'utf8');

// Replace VERSION constant
swContent = swContent.replace(
  /const VERSION = '[^']+';/,
  `const VERSION = '${newVersion}';`
);

// Replace all cache names with correct patterns from sw.js
swContent = swContent.replace(
  /const CACHE_NAME = 'akquise-tool-v[^']+';/,
  `const CACHE_NAME = 'akquise-tool-v${newVersion}';`
);
swContent = swContent.replace(
  /const STATIC_CACHE = 'static-cache-v[^']+';/,
  `const STATIC_CACHE = 'static-cache-v${newVersion}';`
);
swContent = swContent.replace(
  /const API_CACHE = 'api-cache-v[^']+';/,
  `const API_CACHE = 'api-cache-v${newVersion}';`
);
swContent = swContent.replace(
  /const IMAGE_CACHE = 'image-cache-v[^']+';/,
  `const IMAGE_CACHE = 'image-cache-v${newVersion}';`
);

fs.writeFileSync(swPath, swContent);
console.log('✅ Updated sw.js');

// Also update index.html meta tag
const indexPath = path.join(__dirname, '../client/index.html');
let indexContent = fs.readFileSync(indexPath, 'utf8');
indexContent = indexContent.replace(
  /(<meta name="app-version" content=")[^"]+(")/,
  `$1${newVersion}$2`
);
fs.writeFileSync(indexPath, indexContent);
console.log('✅ Updated index.html meta tag');

console.log(`🎉 Version updated successfully to ${newVersion}`);
console.log('📝 Next steps:');
console.log('   1. npm run build');
console.log('   2. git add .');
console.log(`   3. git commit -m "Release v${newVersion}"`);
console.log('   4. git push origin main');
