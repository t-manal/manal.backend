#!/bin/bash
# ============================================================
# deploy.sh — LMS Marketplace Deployment Script
# Usage: ./deploy.sh
# Run this every time you push new code to the server
# ============================================================
set -e

echo "============================================"
echo "  LMS Marketplace — Deployment Starting"
echo "  $(date)"
echo "============================================"

# ── 1. Pull latest code ──────────────────────────────────────
echo "[Deploy] Pulling latest code..."
git pull origin main

# ── 2. Rebuild the app image ─────────────────────────────────
echo "[Deploy] Building Docker image..."
docker compose build api

# The worker uses the same image — no separate build needed

# ── 3. Restart API (brief ~3s downtime) ─────────────────────
echo "[Deploy] Restarting API container..."
docker compose up -d --no-deps api

# Wait for API to be healthy before restarting worker
echo "[Deploy] Waiting for API to become healthy..."
sleep 5
until docker compose exec -T api curl -sf http://localhost:4000/health > /dev/null 2>&1; do
  echo "[Deploy] API not ready yet, waiting..."
  sleep 3
done
echo "[Deploy] API is healthy."

# ── 4. Restart Worker ────────────────────────────────────────
echo "[Deploy] Restarting Worker container..."
docker compose up -d --no-deps worker

# ── 5. Reload Nginx (zero downtime) ─────────────────────────
echo "[Deploy] Reloading Nginx..."
docker compose exec nginx nginx -s reload

# ── 6. Show container status ─────────────────────────────────
echo ""
echo "============================================"
echo "  Deployment Complete — Container Status"
echo "============================================"
docker compose ps

echo ""
echo "[Deploy] Done! API health: $(curl -sf https://YOUR_DOMAIN/health | head -c 200)"
