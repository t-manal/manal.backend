#!/bin/bash
# ============================================================
# backup.sh — Automated PostgreSQL Backup
# Setup: Add to crontab → crontab -e
#   0 */6 * * * /home/deploy/lms/backup.sh >> /var/log/lms-backup.log 2>&1
# ============================================================
set -e

BACKUP_DIR="/home/deploy/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/lms_${TIMESTAMP}.sql.gz"
KEEP_DAYS=7  # Keep 7 days of backups

echo "[Backup] Starting PostgreSQL backup — $(date)"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Load env vars for DB credentials
source /home/deploy/lms/.env.production

# Run pg_dump inside the postgres container, compress output
docker compose -f /home/deploy/lms/docker-compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip > "${BACKUP_FILE}"

# Verify the backup is not empty
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[Backup] ERROR: Backup file is empty! Something went wrong."
  exit 1
fi

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[Backup] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Remove backups older than KEEP_DAYS
echo "[Backup] Cleaning up backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "lms_*.sql.gz" -mtime +${KEEP_DAYS} -delete
echo "[Backup] Cleanup done."

# List current backups
echo "[Backup] Current backups:"
ls -lh "${BACKUP_DIR}"/lms_*.sql.gz 2>/dev/null || echo "  (none)"

echo "[Backup] Finished — $(date)"
