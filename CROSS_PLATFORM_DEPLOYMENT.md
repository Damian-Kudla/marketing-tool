# Cross-Platform Deployment Guide

## Overview

This guide explains how to deploy the Energy Scan Capture PWA on different platforms (Windows, Linux, Replit, etc.) without requiring code changes.

---

## ✅ Cross-Platform Fixes Applied

### 1. Environment Variables (Windows/Linux Compatible)

**Problem**: Windows uses `set VAR=value` while Linux uses `export VAR=value`

**Solution**: Using `cross-env` package

```json
"scripts": {
  "dev": "cross-env NODE_ENV=development tsx server/index.ts",
  "start": "cross-env NODE_ENV=production node dist/index.js"
}
```

### 2. Dynamic Port Configuration

**Problem**: Hardcoded port `5173` didn't work on Replit (requires port `5000` or `PORT` env var)

**Solution**: Dynamic port from environment

```typescript
// server/index.ts
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
```

### 3. React Hooks Error in Replit Preview

**Problem**: `Cannot read properties of null (reading 'useState')` in Replit preview browser

**Root Cause**: 
- Multiple React instances due to Vite bundling
- Replit Runtime Error Modal Plugin compatibility issue
- HMR (Hot Module Replacement) context issues

**Solutions Applied**:

#### a) Explicit React Import in AuthContext
```typescript
// Before
import { createContext, useContext, useState, ... } from 'react';

// After
import React, { createContext, useContext, useState, ... } from 'react';
```

#### b) React Deduplication in Vite Config
```typescript
// vite.config.ts
resolve: {
  dedupe: ['react', 'react-dom'],
},
optimizeDeps: {
  include: ['react', 'react-dom'],
}
```

**Note**: This error only affects the Replit preview browser. Regular browsers (Chrome, Firefox, Safari) work perfectly fine.

---

## Platform-Specific Instructions

### Windows (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Create .env file (optional)
cp .env.example .env
# Edit .env with your credentials

# 3. Run development server
npm run dev
# Opens on http://localhost:5000

# 4. Build for production
npm run build
npm start
```

**Environment Variables**:
- No special setup needed
- `cross-env` handles Windows command syntax
- Port: `5000` (default)

### Linux (Server Deployment)

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
nano .env  # Edit configuration

# 3. Run development
npm run dev

# 4. Production deployment
npm run build
npm start

# Or with PM2
npm install -g pm2
pm2 start npm --name "energy-scan" -- start
pm2 save
pm2 startup
```

**Environment Variables**:
- Same commands as Windows (thanks to `cross-env`)
- Port: Use `PORT` env var or defaults to `5000`

### Replit Deployment

**Automatic Configuration**:
- Port is automatically set to `5000` via `.replit` config
- Node environment is pre-configured
- No manual environment variable setup needed

**Steps**:

1. **Import from GitHub**:
   - Go to Replit
   - Click "Create" → "Import from GitHub"
   - Paste: `https://github.com/Damian-Kudla/marketing-tool`
   - Click "Import from GitHub"

2. **Install Dependencies** (automatic):
   ```bash
   npm install
   ```

3. **Configure Secrets** (optional):
   - Click "Secrets" (🔒 icon) in left sidebar
   - Add optional secrets:
     - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
     - `GOOGLE_PRIVATE_KEY`
     - `GOOGLE_SPREADSHEET_ID`
   
   **Note**: App works without these - Google features are optional

4. **Run Application**:
   - Click "Run" button
   - Or: `npm run dev`
   - Opens on Replit URL (e.g., `https://your-repl.replit.app`)

5. **Test PWA**:
   - Open Webview URL in external browser (Chrome/Safari)
   - Install PWA to home screen
   - Test functionality

**Replit-Specific Notes**:
- ✅ Port `5000` is automatically configured
- ✅ `NODE_ENV` is set in `.replit` file
- ✅ Hot reload works via Vite HMR
- ⚠️ Replit preview browser may show React hooks error (cosmetic only)
- ✅ External browsers work perfectly

### Docker Deployment

```dockerfile
# Dockerfile (example)
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build application
RUN npm run build

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Start server
CMD ["npm", "start"]
```

**Build & Run**:
```bash
docker build -t energy-scan-capture .
docker run -p 5000:5000 -e PORT=5000 energy-scan-capture
```

---

## Environment Variables Reference

### Required
None! The app works out of the box.

### Optional (Enhanced Features)

#### Google Sheets Integration
```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id
```

**What it enables**:
- Automatic data export to Google Sheets
- Real-time logging of scans
- Team collaboration features

**Without it**: Data is still saved locally (offline storage)

#### Google Cloud Vision API
```env
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
```

**What it enables**:
- Enhanced OCR accuracy
- Automatic orientation detection
- Better text recognition

**Without it**: Falls back to Tesseract.js (client-side OCR)

#### Database (Production)
```env
DATABASE_URL=postgresql://user:password@host:port/database
```

**What it enables**:
- Persistent data storage
- Multi-user support
- Historical data

**Without it**: Uses in-memory storage (resets on restart)

#### Session Configuration
```env
SESSION_SECRET=your-random-secret-here
```

**What it enables**:
- Secure session management
- Persistent authentication

**Without it**: Auto-generated secret (sessions reset on restart)

---

## Troubleshooting

### Issue: React Hooks Error in Replit Preview

**Symptom**:
```
Cannot read properties of null (reading 'useState')
```

**When**: Only in Replit's built-in preview browser

**Solutions**:
1. ✅ **Use External Browser** (Recommended):
   - Copy the Webview URL
   - Open in Chrome, Firefox, or Safari
   - Works perfectly

2. ✅ **Already Fixed in Code**:
   - React deduplication added
   - Explicit React imports
   - No action needed

3. ⚠️ **If Problem Persists**:
   ```bash
   # Clear Vite cache
   rm -rf node_modules/.vite
   npm run dev
   ```

### Issue: Port Already in Use

**Symptom**: `Error: listen EADDRINUSE: address already in use`

**Solution**:
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Linux
lsof -ti:5000 | xargs kill -9

# Or change port
PORT=5001 npm run dev
```

### Issue: Environment Variables Not Working

**Windows**:
```bash
# Check if cross-env is installed
npm list cross-env

# Reinstall if missing
npm install --save-dev cross-env
```

**Linux/Replit**:
```bash
# Verify .env file
cat .env

# Check environment
printenv | grep PORT
```

### Issue: Google Services Not Working

**Symptom**: Warnings in console about missing credentials

**Check**:
1. Are Google credentials configured?
   ```bash
   printenv | grep GOOGLE
   ```

2. Is service account JSON valid?
   ```bash
   # Validate JSON
   node -e "console.log(JSON.parse(process.env.GOOGLE_PRIVATE_KEY))"
   ```

3. **Remember**: Google services are OPTIONAL
   - App works without them
   - Features degrade gracefully
   - Local storage is fallback

---

## Platform Compatibility Matrix

| Feature | Windows | Linux | Replit | Docker |
|---------|---------|-------|--------|--------|
| Development Server | ✅ | ✅ | ✅ | ✅ |
| Production Build | ✅ | ✅ | ✅ | ✅ |
| PWA Installation | ✅ | ✅ | ✅ | ✅ |
| Hot Module Reload | ✅ | ✅ | ✅ | ❌ |
| Environment Variables | ✅ | ✅ | ✅ | ✅ |
| Google Sheets | ✅ | ✅ | ✅ | ✅ |
| Google Vision API | ✅ | ✅ | ⚠️¹ | ✅ |
| PostgreSQL Database | ✅ | ✅ | ✅ | ✅ |
| SSL/HTTPS | ⚠️² | ⚠️² | ✅ | ⚠️² |

**Notes**:
- ¹ Replit may have restrictions on file system access for credentials
- ² Requires reverse proxy (nginx) or certificate configuration

---

## Testing Checklist

### Local Testing (Any Platform)
- [ ] `npm install` completes successfully
- [ ] `npm run dev` starts server on port 5000
- [ ] Can access http://localhost:5000
- [ ] Login page loads
- [ ] Can authenticate
- [ ] Camera capture works
- [ ] OCR detection works
- [ ] Data saves successfully

### Replit Testing
- [ ] Import from GitHub successful
- [ ] Dependencies install automatically
- [ ] Server starts on port 5000
- [ ] Webview URL accessible
- [ ] External browser works (Chrome/Safari)
- [ ] PWA installable from external browser
- [ ] Hot reload works (file changes reflect)

### Cross-Platform Testing
- [ ] Windows: `npm run dev` works
- [ ] Linux: `npm run dev` works
- [ ] Replit: Run button works
- [ ] All use same codebase (no modifications)
- [ ] Environment variables work on all platforms

### PWA Testing
- [ ] Manifest.json loads correctly
- [ ] Service worker registers
- [ ] Icons display properly (SVG)
- [ ] Install prompt appears
- [ ] Offline mode works
- [ ] Update notifications work
- [ ] iOS Safari installation works
- [ ] Android Chrome installation works

---

## Deployment Best Practices

### 1. Environment-Specific Configuration

**Development**:
- Use `.env` file
- Enable hot reload
- Detailed logging
- Source maps enabled

**Production**:
- Use environment variables (not `.env` file)
- Minified builds
- Error logging only
- No source maps

### 2. Port Configuration

**Development**: `PORT=5000` (default)

**Production**:
- Replit: Automatic (5000)
- Cloud Run: From `PORT` env var
- Heroku: From `PORT` env var
- Custom: Configure in hosting platform

### 3. Security

**Always**:
- Keep `.env` in `.gitignore`
- Use `.env.example` for documentation
- Rotate secrets regularly
- Use HTTPS in production

**Never**:
- Commit `.env` file
- Hardcode secrets
- Use development mode in production
- Expose internal ports

---

## Quick Reference

### Commands
```bash
# Development (all platforms)
npm run dev

# Build production
npm run build

# Run production
npm start

# Version bumping
npm run version:bump        # 1.0.0 → 1.0.1
npm run version:bump:minor  # 1.0.0 → 1.1.0
npm run version:bump:major  # 1.0.0 → 2.0.0

# Database migration
npm run db:push
```

### Ports
- **Development**: 5000 (default)
- **Production**: From `PORT` env var or 5000
- **Vite Dev Server**: 5050 (internal)

### URLs
- **Local**: http://localhost:5000
- **Replit**: https://your-repl.replit.app
- **Custom Domain**: Configure in hosting platform

---

## Support

### Issues
- GitHub: https://github.com/Damian-Kudla/marketing-tool/issues
- Check existing issues first
- Include platform information (Windows/Linux/Replit)
- Attach console logs if possible

### Documentation
- Main README: See root README.md
- PWA Updates: See PWA_UPDATE_SYSTEM.md
- Quick Start: See QUICK_START_PWA_UPDATES.md

---

**Last Updated**: 2025-10-12  
**Tested On**: Windows 11, Ubuntu 22.04, Replit (Node 20)  
**Status**: ✅ Production Ready
