  GNU nano 7.2                                                                    entrypoint.sh                                                                             
#!/bin/bash
set -e

echo "============================================"
echo "  LMS Marketplace — Container Starting"
echo "  Mode: ${CONTAINER_MODE:-api}"
echo "============================================"

# Validate migration files before any DB operation
echo "[Entrypoint] Validating migration SQL encoding..."
node prisma/validate-migrations.js
echo "[Entrypoint] Migration SQL encoding check passed."

echo "[Entrypoint] Running database migrations (with retry)..."
MAX_TRIES=60
TRY=1

until npx prisma migrate deploy --schema prisma/schema.prisma >/dev/null 2>&1; do
  echo "[Entrypoint] migrate deploy failed (try $TRY/$MAX_TRIES). Retrying in 2s..."
  TRY=$((TRY+1))
  if [ "$TRY" -gt "$MAX_TRIES" ]; then
    echo "[Entrypoint] ERROR: PostgreSQL not reachable or migration failed repeatedly."
    echo "[Entrypoint] Printing last migrate deploy output:"
    npx prisma migrate deploy --schema prisma/schema.prisma
    exit 1
  fi
  sleep 2
done

echo "[Entrypoint] Migrations complete."

if [ "${CONTAINER_MODE}" = "worker" ]; then
  echo "[Entrypoint] Starting PDF Worker..."
  exec node dist/workers/pdf.worker.js
else
  echo "[Entrypoint] Starting API Server..."
  exec node dist/index.js
fi