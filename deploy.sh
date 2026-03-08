#!/bin/bash
# =============================================================
# deploy.sh — Production deployment script for IPL Confirmation
# Run by GitHub Actions via SSH on the Ubuntu VPS.
# Never run manually unless you know what you are doing.
# =============================================================

set -euo pipefail  # exit on error, unset var, or pipe failure

APP_DIR="${APP_DIR:-/var/www/ipl_confirmation}"
LOG_TAG="[deploy]"

echo "$LOG_TAG ── Starting deployment at $(date '+%Y-%m-%d %H:%M:%S') ──"

# ── 1. Navigate to app directory ─────────────────────────────────────────────
cd "$APP_DIR"
echo "$LOG_TAG Working directory: $(pwd)"

# ── 2. Pull latest code from main branch ─────────────────────────────────────
echo "$LOG_TAG Pulling latest code..."
git pull origin main

# ── 3. Install production dependencies only ──────────────────────────────────
echo "$LOG_TAG Installing production dependencies..."
npm install --production --ignore-scripts

# ── 4. Regenerate Prisma client to match installed binaries ──────────────────
echo "$LOG_TAG Generating Prisma client..."
npx prisma generate

# ── 5. Apply any pending DB migrations (safe on empty diff) ──────────────────
echo "$LOG_TAG Running database migrations..."
npx prisma migrate deploy

# ── 6. Reload app with PM2 (zero-downtime) ───────────────────────────────────
echo "$LOG_TAG Reloading PM2 app..."
pm2 reload ecosystem.config.js --update-env

echo "$LOG_TAG ── Deployment complete at $(date '+%Y-%m-%d %H:%M:%S') ──"
