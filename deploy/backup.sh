#!/usr/bin/env bash
# Nightly backup of the SQLite database and uploads.
# Cron (as the app user):  30 2 * * * /srv/jaathiya-vaarthalu/deploy/backup.sh >> /var/log/jv-backup.log 2>&1
# Needs: sudo apt install sqlite3
set -euo pipefail
APP=/srv/jaathiya-vaarthalu
OUT=/var/backups/jaathiya-vaarthalu
STAMP=$(date +%F)
mkdir -p "$OUT"

# consistent copy even while the site is running
sqlite3 "$APP/data/app.db" ".backup '$OUT/app-$STAMP.db'"
gzip -f "$OUT/app-$STAMP.db"

# uploads (images + e-paper PDFs)
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$APP" uploads

# keep 14 days locally
find "$OUT" -type f -mtime +14 -delete

# Off-server copy (recommended): configure rclone once, then uncomment
# rclone copy "$OUT" remote:jaathiya-vaarthalu-backups --max-age 2d
echo "backup done $STAMP"
