'use strict';

require('dotenv').config();

const express = require('express');
const path    = require('path');
const { initWhatsAppClient } = require('./bot/whatsappClient');
const { validateDriveAccess } = require('./drive/driveService');
const { basicAuth } = require('./middleware/auth');
const paymentRoutes = require('./routes/payments');

// ── Fail fast: refuse to start if auth credentials are not configured ────────
if (!process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
  console.error(
    '[server] FATAL: DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set in .env.\n' +
    '         Copy .env.example to .env and fill in the credentials before starting.'
  );
  process.exit(1);
}

const PORT    = process.env.PORT    || 3000;
const BASE    = process.env.BASE_PATH || '';  // e.g. "/ipl-confirmation"

const app = express();

// Trust the Nginx reverse proxy so req.ip, req.protocol, etc. are correct
app.set('trust proxy', 1);
app.use(express.json());

// ── Public: health check ─────────────────────────────────────────────────────
app.get(`${BASE}/health`, (_req, res) => res.json({ status: 'ok' }));

// ── Auth gate ────────────────────────────────────────────────────────────────
app.use(basicAuth);

// ── Protected: dashboard static files ───────────────────────────────────────
app.use(BASE, express.static(path.join(__dirname, 'public')));

// ── Protected: REST API ──────────────────────────────────────────────────────
app.use(`${BASE}/api/payments`, paymentRoutes);

// ── Boot sequence ────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    app.listen(PORT, '127.0.0.1', () => {
      // Bind to localhost only — Nginx is the public-facing entry point
      console.log(`[server] Listening on 127.0.0.1:${PORT} (base path: "${BASE || '/'}")`);
      console.log(`[server] Dashboard protected — username: ${process.env.DASHBOARD_USERNAME}`);
    });

    await validateDriveAccess();
    await initWhatsAppClient();
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
};

startServer();
