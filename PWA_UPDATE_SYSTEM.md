# PWA Automatic Update System

## Overview

This documentation describes the automatic update system for the Energy Scan Capture PWA that eliminates the need for manual reinstallation when updates are deployed.

## Problem Solved

**Previous Issue**: Users had to manually:
1. Delete PWA from home screen
2. Clear browser data
3. Reload page
4. Reinstall PWA

**New Solution**: Updates are detected automatically and applied seamlessly with user notification.

---

## Architecture

### 1. Version Management

**File**: `scripts/update-sw-version.ts`

- Reads version from `package.json`
- Injects version into service worker during build
- Creates `version.json` for client-side version checking
- Runs automatically before each build via `prebuild` script

**Usage**:
```bash
# Automatic (runs before build)
npm run build

# Manual version bumping
npm run version:bump        # Patch: 1.0.0 → 1.0.1
npm run version:bump:minor  # Minor: 1.0.0 → 1.1.0
npm run version:bump:major  # Major: 1.0.0 → 2.0.0
```

### 2. Update Manager

**File**: `client/src/services/pwaUpdateManager.ts`

**Key Features**:
- **Automatic Update Detection**: Checks for new service worker every 30 seconds
- **Version Monitoring**: Compares server version with local version every 5 minutes
- **Update Application**: Sends `SKIP_WAITING` message to service worker
- **State Management**: Saves and restores app state during updates
- **Force Clear**: Nuclear option to clear all caches if needed

**API**:
```typescript
// Initialize (happens automatically)
const manager = PWAUpdateManager.getInstance();

// Register update callback
manager.onUpdate((status) => {
  console.log('Update available!', status);
});

// Check for updates manually
await manager.checkForUpdates();

// Apply update
await manager.applyUpdate();

// Force clear (for debugging)
await manager.forceClearAndReload();

// Get current status
const status = manager.getUpdateStatus();
```

### 3. Update Prompt UI

**File**: `client/src/components/PWAUpdatePrompt.tsx`

**Features**:
- Animated slide-in notification from bottom-right
- Shows version information (current → new)
- Three action options:
  1. **"Jetzt aktualisieren"** - Apply update immediately
  2. **"Später"** - Dismiss (will show again in 30s)
  3. **"Cache löschen & neu laden"** - Force clear (dev mode only)

**Visual Design**:
- Blue accent colors for positive update message
- Responsive (full-width on mobile, fixed width on desktop)
- Loading state during update
- Auto-hides after action

### 4. Service Worker Updates

**File**: `client/public/sw.js`

**Changes Made**:
- Added `VERSION` constant (updated by build script)
- Version-based cache names (e.g., `energy-scan-v1.0.0`)
- `skipWaiting()` on install
- Message handler for `SKIP_WAITING` command
- Automatic cache cleanup on activation

**Update Flow**:
```
1. New SW detected (updatefound event)
2. New SW installs in background
3. New SW enters "waiting" state
4. User notified via PWAUpdatePrompt
5. User clicks "Jetzt aktualisieren"
6. App sends SKIP_WAITING message to SW
7. SW calls skipWaiting() → becomes active
8. SW calls clients.claim() → takes control
9. controllerchange event fires
10. App reloads with new version
```

---

## Implementation Details

### Version Injection Process

**Build Time**:
```bash
npm run prebuild  # Runs update-sw-version.ts
│
├─ Read package.json version (e.g., "1.0.5")
├─ Update sw.js:
│  ├─ const VERSION = '1.0.5'
│  ├─ const CACHE_NAME = 'energy-scan-v1.0.5'
│  ├─ const STATIC_CACHE = 'static-cache-v1.0.5'
│  ├─ const API_CACHE = 'api-cache-v1.0.5'
│  └─ const IMAGE_CACHE = 'image-cache-v1.0.5'
│
└─ Create version.json:
   {
     "version": "1.0.5",
     "buildTime": "2025-01-10T12:34:56.789Z",
     "buildNumber": "123"
   }
```

### Update Detection Flow

**Client Side**:
```typescript
// Every 30 seconds
registration.update() → Fetches /sw.js from server

// Compare byte-for-byte
if (server_sw.js !== cached_sw.js) {
  // New SW found!
  Install new SW in background
  
  // Wait for install complete
  newSW.state === 'installed'
  
  // Notify user
  PWAUpdatePrompt.show()
}
```

**Version Checking**:
```typescript
// Every 5 minutes
fetch('/version.json?t=' + Date.now())
  .then(res => res.json())
  .then(data => {
    if (data.version !== localStorage.getItem('app-version')) {
      // Version mismatch - force update check
      registration.update()
    }
  })
```

### State Preservation

**Before Reload**:
```typescript
// Save current path
sessionStorage.setItem('pwa-reload-path', window.location.pathname)

// Reload
window.location.reload()
```

**After Reload**:
```typescript
// Restore path if needed
const savedPath = sessionStorage.getItem('pwa-reload-path')
if (savedPath) {
  // Navigate to saved path
  // Clean up
  sessionStorage.removeItem('pwa-reload-path')
}
```

---

## iOS Compatibility

### Manifest Changes

**Fixed Icon Paths** (`manifest.json`):
```json
"icons": [
  {
    "src": "/icons/icon-192x192.svg",  // ✅ Changed from .png
    "sizes": "192x192",
    "type": "image/svg+xml",            // ✅ Correct MIME type
    "purpose": "any maskable"
  },
  {
    "src": "/icons/apple-touch-icon.svg",  // ✅ iOS specific
    "sizes": "180x180",
    "type": "image/svg+xml"
  }
]
```

### iOS Service Worker Behavior

**Important Notes**:
- iOS Safari fully supports Service Workers (since iOS 11.3)
- Update detection works identically to Android
- `skipWaiting()` and `clients.claim()` work correctly
- Standalone mode (`display: "standalone"`) required for PWA
- Must be added to home screen for full PWA experience

**iOS Testing Checklist**:
- ✅ Install PWA to home screen
- ✅ Open from home screen (standalone mode)
- ✅ Deploy new version
- ✅ Wait 30 seconds (update detection)
- ✅ Update prompt appears
- ✅ Click "Jetzt aktualisieren"
- ✅ App reloads with new version
- ✅ No manual reinstallation needed

---

## Usage Guide

### For Developers

**1. Making Changes**:
```bash
# Make your code changes
git add .
git commit -m "feat: Add new feature"
```

**2. Bump Version**:
```bash
# Choose version bump type
npm run version:bump        # Patch: bug fixes
npm run version:bump:minor  # Minor: new features
npm run version:bump:major  # Major: breaking changes

# This will:
# - Update package.json version
# - Update service worker version
# - Create git tag
```

**3. Build & Deploy**:
```bash
npm run build  # Prebuild script updates versions automatically
npm run start

# Or deploy to production
git push origin main
git push --tags
```

**4. Verify Update**:
- Open app in browser
- Wait 30 seconds
- Update prompt should appear
- Click "Jetzt aktualisieren"
- App reloads with new version

### For Users

**Automatic Updates**:
1. Use app normally
2. Update notification appears when available
3. Click "Jetzt aktualisieren" to update immediately
4. Or click "Später" to update later (prompt reappears in 30s)
5. App reloads automatically with new version

**No manual action required** - updates are seamless!

---

## Troubleshooting

### Update Not Detected

**Problem**: New version deployed but no update prompt

**Solutions**:
1. Check service worker registration:
   ```javascript
   navigator.serviceWorker.getRegistration()
     .then(reg => console.log('SW registered:', reg))
   ```

2. Check version in `version.json`:
   ```bash
   curl https://your-app.com/version.json
   ```

3. Verify version was updated in build:
   ```bash
   grep "const VERSION" client/public/sw.js
   ```

4. Force update check:
   ```javascript
   pwaUpdateManager.checkForUpdates()
   ```

### Update Stuck in Waiting

**Problem**: Update detected but not applying

**Solution**:
1. Check if SKIP_WAITING message is sent:
   ```javascript
   // Should see in console
   console.log('Sending SKIP_WAITING message')
   ```

2. Verify message handler in service worker:
   ```javascript
   self.addEventListener('message', (event) => {
     if (event.data?.type === 'SKIP_WAITING') {
       self.skipWaiting()
     }
   })
   ```

3. Use force clear option:
   - Enable dev mode (`import.meta.env.DEV`)
   - Click "Cache löschen & neu laden"

### iOS Specific Issues

**Problem**: Updates not working on iOS

**Solutions**:
1. Verify PWA is installed (not just bookmarked):
   - Must use "Add to Home Screen"
   - Must open from home screen icon
   - Should see standalone mode (no browser UI)

2. Check iOS version:
   - iOS 11.3+ required for Service Workers
   - iOS 16.4+ recommended for best PWA support

3. Check manifest:
   - `display: "standalone"` required
   - Apple touch icon must be present
   - Must be served over HTTPS

4. Safari-specific debugging:
   - Connect iPhone to Mac
   - Safari → Develop → [Your iPhone] → [Your PWA]
   - Check console for errors

### Old Cache Persisting

**Problem**: Still seeing old cached content after update

**Solution**:
```javascript
// Force clear all caches
await pwaUpdateManager.forceClearAndReload()
```

Or manually:
```javascript
// Unregister all service workers
const registrations = await navigator.serviceWorker.getRegistrations()
for (const reg of registrations) {
  await reg.unregister()
}

// Delete all caches
const cacheNames = await caches.keys()
for (const name of cacheNames) {
  await caches.delete(name)
}

// Reload
location.reload()
```

---

## Advanced Configuration

### Update Check Intervals

**Modify in** `pwaUpdateManager.ts`:
```typescript
// Default: 30 seconds
private readonly UPDATE_CHECK_INTERVAL = 30000;

// Default: 5 minutes
private readonly VERSION_CHECK_INTERVAL = 300000;

// Customize as needed:
private readonly UPDATE_CHECK_INTERVAL = 60000;      // 1 minute
private readonly VERSION_CHECK_INTERVAL = 600000;    // 10 minutes
```

### Custom Update Notifications

**Modify** `PWAUpdatePrompt.tsx`:
```typescript
// Change notification position
<div className="fixed top-4 left-4 ...">  // Top-left

// Change colors
<Alert className="border-green-500 bg-green-50 ...">

// Add custom actions
<Button onClick={handleCustomAction}>
  Custom Action
</Button>
```

### Build Number Integration

**CI/CD Integration**:
```bash
# Set BUILD_NUMBER environment variable
export BUILD_NUMBER=$CI_BUILD_ID

# Build with build number
npm run build

# version.json will contain:
{
  "version": "1.0.5",
  "buildTime": "2025-01-10T12:34:56.789Z",
  "buildNumber": "1234"  // From CI/CD
}
```

---

## Testing Checklist

### Local Testing

- [ ] Install PWA locally
- [ ] Make code change
- [ ] Bump version (`npm run version:bump`)
- [ ] Build (`npm run build`)
- [ ] Start server (`npm start`)
- [ ] Wait 30 seconds
- [ ] Verify update prompt appears
- [ ] Click "Jetzt aktualisieren"
- [ ] Verify app reloads
- [ ] Verify changes are visible

### iOS Testing

- [ ] Deploy to HTTPS server
- [ ] Open in Safari on iPhone
- [ ] Add to Home Screen
- [ ] Open from home screen
- [ ] Verify standalone mode (no browser UI)
- [ ] Deploy new version
- [ ] Wait 30 seconds in app
- [ ] Verify update prompt appears
- [ ] Apply update
- [ ] Verify changes visible
- [ ] Test offline functionality

### Android Testing

- [ ] Deploy to HTTPS server
- [ ] Open in Chrome on Android
- [ ] Install PWA
- [ ] Open PWA
- [ ] Deploy new version
- [ ] Wait 30 seconds
- [ ] Verify update prompt
- [ ] Apply update
- [ ] Verify changes visible

---

## Best Practices

### Version Bumping Strategy

- **Patch (1.0.x)**: Bug fixes, small changes
- **Minor (1.x.0)**: New features, backwards compatible
- **Major (x.0.0)**: Breaking changes, major rewrites

### Deployment Strategy

1. **Test locally first**
2. **Deploy to staging** (if available)
3. **Test on real devices** (iOS + Android)
4. **Deploy to production**
5. **Monitor update adoption** (check logs)

### Update Timing

- **Immediate updates**: Critical bug fixes, security patches
- **Deferred updates**: New features (allow "Later" option)
- **Forced updates**: Breaking changes (don't allow dismissal)

### Monitoring

**Log Key Events**:
```typescript
pwaLogger.log('UPDATE_AVAILABLE', { version })
pwaLogger.log('UPDATE_APPLIED', { version })
pwaLogger.log('UPDATE_DISMISSED', { version })
```

**Track Metrics**:
- Update detection rate
- Update application rate
- Time to update (detection → application)
- Update failures

---

## Files Modified

### New Files Created
- ✅ `client/src/services/pwaUpdateManager.ts` - Update management logic
- ✅ `client/src/components/PWAUpdatePrompt.tsx` - Update UI component
- ✅ `scripts/update-sw-version.ts` - Version injection script
- ✅ `client/public/version.json` - Version metadata
- ✅ `PWA_UPDATE_SYSTEM.md` - This documentation

### Modified Files
- ✅ `client/public/manifest.json` - Fixed icon paths (.png → .svg)
- ✅ `client/public/sw.js` - Added VERSION constant
- ✅ `client/src/App.tsx` - Added PWAUpdatePrompt component
- ✅ `package.json` - Added prebuild and version bump scripts

---

## Future Enhancements

### Planned Features
- [ ] Show changelog in update prompt
- [ ] Allow update scheduling ("Update at 3 AM")
- [ ] Background update with silent activation
- [ ] Update progress indicator
- [ ] Rollback mechanism if update fails
- [ ] A/B testing for gradual rollouts
- [ ] Analytics integration
- [ ] Update notifications via push

### Considered Improvements
- [ ] Differential updates (only changed files)
- [ ] Background sync for offline updates
- [ ] Update prioritization (critical vs optional)
- [ ] User preferences (auto-update setting)
- [ ] Update history log
- [ ] Network-aware updates (WiFi only)

---

## Support

### Issues & Questions

Create an issue on GitHub with:
- Device type (iPhone 15, Pixel 8, etc.)
- OS version (iOS 17.2, Android 14, etc.)
- Browser (Safari, Chrome, etc.)
- Steps to reproduce
- Console logs (if available)

### Contact

- GitHub: https://github.com/Damian-Kudla/marketing-tool
- Email: Damian-Kudla@users.noreply.github.com

---

## Changelog

### Version 1.0.0 (Initial Release)
- ✅ Automatic update detection
- ✅ User-facing update notifications
- ✅ Seamless update application
- ✅ iOS compatibility
- ✅ Version management system
- ✅ State preservation during updates
- ✅ Force clear option for debugging

---

**Last Updated**: 2025-01-10  
**Author**: Damian Kudla  
**License**: MIT
