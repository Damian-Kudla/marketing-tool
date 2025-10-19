#!/usr/bin/env node
/**
 * Test script for update-version.js
 * Validates that all version numbers are correctly updated
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing version update script...\n');

// Read version files
const versionPath = path.join(__dirname, '../client/public/version.json');
const swPath = path.join(__dirname, '../client/public/sw.js');
const indexPath = path.join(__dirname, '../client/index.html');

const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const swContent = fs.readFileSync(swPath, 'utf8');
const indexContent = fs.readFileSync(indexPath, 'utf8');

const currentVersion = versionData.version;

console.log(`📦 Current version: ${currentVersion}\n`);

// Test 1: Check VERSION constant in sw.js
const versionMatch = swContent.match(/const VERSION = '([^']+)';/);
const swVersion = versionMatch ? versionMatch[1] : null;

console.log('Test 1: VERSION constant in sw.js');
if (swVersion === currentVersion) {
  console.log(`  ✅ PASS: VERSION = '${swVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected '${currentVersion}', got '${swVersion}'`);
}

// Test 2: Check CACHE_NAME in sw.js
const cacheMatch = swContent.match(/const CACHE_NAME = 'akquise-tool-v([^']+)';/);
const cacheVersion = cacheMatch ? cacheMatch[1] : null;

console.log('Test 2: CACHE_NAME in sw.js');
if (cacheVersion === currentVersion) {
  console.log(`  ✅ PASS: CACHE_NAME = 'akquise-tool-v${cacheVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected 'akquise-tool-v${currentVersion}', got 'akquise-tool-v${cacheVersion}'`);
}

// Test 3: Check STATIC_CACHE in sw.js
const staticMatch = swContent.match(/const STATIC_CACHE = 'static-cache-v([^']+)';/);
const staticVersion = staticMatch ? staticMatch[1] : null;

console.log('Test 3: STATIC_CACHE in sw.js');
if (staticVersion === currentVersion) {
  console.log(`  ✅ PASS: STATIC_CACHE = 'static-cache-v${staticVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected 'static-cache-v${currentVersion}', got 'static-cache-v${staticVersion}'`);
}

// Test 4: Check API_CACHE in sw.js
const apiMatch = swContent.match(/const API_CACHE = 'api-cache-v([^']+)';/);
const apiVersion = apiMatch ? apiMatch[1] : null;

console.log('Test 4: API_CACHE in sw.js');
if (apiVersion === currentVersion) {
  console.log(`  ✅ PASS: API_CACHE = 'api-cache-v${apiVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected 'api-cache-v${currentVersion}', got 'api-cache-v${apiVersion}'`);
}

// Test 5: Check IMAGE_CACHE in sw.js
const imageMatch = swContent.match(/const IMAGE_CACHE = 'image-cache-v([^']+)';/);
const imageVersion = imageMatch ? imageMatch[1] : null;

console.log('Test 5: IMAGE_CACHE in sw.js');
if (imageVersion === currentVersion) {
  console.log(`  ✅ PASS: IMAGE_CACHE = 'image-cache-v${imageVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected 'image-cache-v${currentVersion}', got 'image-cache-v${imageVersion}'`);
}

// Test 6: Check meta tag in index.html
const metaMatch = indexContent.match(/<meta name="app-version" content="([^"]+)"/);
const metaVersion = metaMatch ? metaMatch[1] : null;

console.log('Test 6: app-version meta tag in index.html');
if (metaVersion === currentVersion) {
  console.log(`  ✅ PASS: meta version = '${metaVersion}'`);
} else {
  console.log(`  ❌ FAIL: Expected '${currentVersion}', got '${metaVersion}'`);
}

// Summary
console.log('\n' + '='.repeat(50));
const allPassed = 
  swVersion === currentVersion &&
  cacheVersion === currentVersion &&
  staticVersion === currentVersion &&
  apiVersion === currentVersion &&
  imageVersion === currentVersion &&
  metaVersion === currentVersion;

if (allPassed) {
  console.log('✅ All tests PASSED! Version consistency verified.');
  process.exit(0);
} else {
  console.log('❌ Some tests FAILED! Version inconsistency detected.');
  console.log('\n💡 Run "node scripts/update-version.js" to fix inconsistencies.');
  process.exit(1);
}
