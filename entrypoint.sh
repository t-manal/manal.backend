#!/bin/bash
set -e

echo "============================================"
echo "  LMS Marketplace — Container Starting"
echo "  Mode: ${CONTAINER_MODE:-api}"
echo "============================================"

# Wait for PostgreSQL to be ready (extra safety beyond depends_on healthcheck)
echo "[Entrypoint] Waiting for PostgreSQL..."
until npx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1; do
  echo "[Entrypoint] PostgreSQL not ready yet, retrying in 2s..."
  sleep 2
done
echo "[Entrypoint] PostgreSQL is ready."

# Run Prisma migrations
echo "[Entrypoint] Running database migrations..."
npx prisma migrate deploy
echo "[Entrypoint] Migrations complete."

# Start the appropriate process based on CONTAINER_MODE
if [ "${CONTAINER_MODE}" = "worker" ]; then
  echo "[Entrypoint] Starting PDF Worker..."
  exec node dist/workers/pdf.worker.js
else
  echo "[Entrypoint] Starting API Server..."
  exec node dist/index.js
fi
