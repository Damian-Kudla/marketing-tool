#!/bin/bash

# Download Server SQLite Databases Script
#
# Lädt alle SQLite-Datenbanken vom Railway Server herunter
# für manuelle Analyse und Datenwiederherstellung
#
# VERWENDUNG:
#   chmod +x download-server-dbs.sh
#   ./download-server-dbs.sh

echo "========================================"
echo "📥 DOWNLOAD SERVER DATABASES"
echo "========================================"
echo ""

# Railway CLI check
if ! command -v railway &> /dev/null; then
    echo "❌ ERROR: Railway CLI not installed"
    echo ""
    echo "Install Railway CLI first:"
    echo "  npm install -g @railway/cli"
    echo ""
    exit 1
fi

# Create local download directory
DOWNLOAD_DIR="./downloaded-dbs-$(date +%Y-%m-%d-%H-%M-%S)"
mkdir -p "$DOWNLOAD_DIR"

echo "[Download] Created directory: $DOWNLOAD_DIR"
echo ""

# Get Railway project info
echo "[Download] Connecting to Railway..."
railway status

echo ""
echo "[Download] Starting database downloads..."
echo ""

# Download System DBs (in /app/data/system-dbs/)
echo "📦 Downloading System Databases..."
railway run bash -c "cd /app/data/system-dbs && ls -lh *.db" 2>/dev/null

SYSTEM_DBS=(
    "cookies.db"
    "appointments.db"
    "pause-locations.db"
    "auth-logs.db"
    "category-changes.db"
    "address-datasets.db"
)

for db in "${SYSTEM_DBS[@]}"; do
    echo "  - Downloading $db..."
    railway run bash -c "cat /app/data/system-dbs/$db" > "$DOWNLOAD_DIR/$db" 2>/dev/null

    if [ -f "$DOWNLOAD_DIR/$db" ] && [ -s "$DOWNLOAD_DIR/$db" ]; then
        SIZE=$(du -h "$DOWNLOAD_DIR/$db" | cut -f1)
        echo "    ✓ Downloaded: $SIZE"
    else
        echo "    ⚠ Not found or empty"
        rm -f "$DOWNLOAD_DIR/$db"
    fi
done

echo ""

# Download User Activity Logs (in /app/data/user-logs/)
echo "📦 Downloading User Activity Logs..."
railway run bash -c "cd /app/data/user-logs && ls -lh logs-*.db" 2>/dev/null

# Get list of log DBs from server
LOG_DBS=$(railway run bash -c "cd /app/data/user-logs && ls logs-*.db 2>/dev/null" | tr '\n' ' ')

if [ -n "$LOG_DBS" ]; then
    for db in $LOG_DBS; do
        echo "  - Downloading $db..."
        railway run bash -c "cat /app/data/user-logs/$db" > "$DOWNLOAD_DIR/$db" 2>/dev/null

        if [ -f "$DOWNLOAD_DIR/$db" ] && [ -s "$DOWNLOAD_DIR/$db" ]; then
            SIZE=$(du -h "$DOWNLOAD_DIR/$db" | cut -f1)
            echo "    ✓ Downloaded: $SIZE"
        else
            echo "    ⚠ Not found or empty"
            rm -f "$DOWNLOAD_DIR/$db"
        fi
    done
else
    echo "  ⚠ No user activity logs found"
fi

echo ""
echo "========================================"
echo "✅ DOWNLOAD COMPLETE"
echo "========================================"
echo ""

# Count downloaded files
DOWNLOADED_COUNT=$(ls -1 "$DOWNLOAD_DIR"/*.db 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$DOWNLOAD_DIR" | cut -f1)

echo "📊 Summary:"
echo "   Files downloaded: $DOWNLOADED_COUNT"
echo "   Total size: $TOTAL_SIZE"
echo "   Location: $DOWNLOAD_DIR"
echo ""
echo "💡 Next steps:"
echo "   1. Analyze DBs with sqlite3:"
echo "      sqlite3 $DOWNLOAD_DIR/address-datasets.db"
echo ""
echo "   2. Run recovery script:"
echo "      npx tsx restore-address-datasets.ts <backup-file.json>"
echo ""
echo "========================================"
echo ""
