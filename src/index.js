'use strict';

require('dotenv').config();

const express = require('express');
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

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(express.json());

// ── Public: health check ─────────────────────────────────────────────────────
// Declared before basicAuth so uptime monitors never need credentials.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Auth gate: all routes below this line are protected ──────────────────────
app.use(basicAuth);

// ── Protected: dashboard static files ───────────────────────────────────────
// basicAuth runs before express.static — unauthenticated requests never touch
// the filesystem and never reveal that a dashboard exists.
app.use(express.static('src/public'));

// ── Protected: REST API ──────────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);

// ── Boot sequence ────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`[server] Listening on port ${PORT}`);
      console.log(`[server] Dashboard protected — username: ${process.env.DASHBOARD_USERNAME}`);
    });

    await validateDriveAccess(); // fail fast if Drive credentials or folder are misconfigured
    await initWhatsAppClient();
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
};

startServer();
