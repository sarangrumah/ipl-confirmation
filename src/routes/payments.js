'use strict';

// ------------------------------------------------------------
// Database & API Engineer domain
// Owned by: Database & API Engineer agent
// REST endpoints consumed by the dashboard frontend.
// ------------------------------------------------------------

const { Router } = require('express');
const paymentService = require('../db/paymentService');

const router = Router();

const VALID_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];

// GET /api/payments?page=1&limit=20&status=PENDING
// Returns all payments sorted by created_at DESC, with pagination metadata.
router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 100));
    const status = VALID_STATUSES.includes(req.query.status?.toUpperCase())
      ? req.query.status.toUpperCase()
      : undefined;

    const result = await paymentService.listPayments({ page, limit, status });
    res.json(result);
  } catch (err) {
    console.error('[GET /api/payments]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/payments/export/csv
// Streams all payments as a downloadable CSV file — no pagination, full dataset.
// Must be declared BEFORE /:id to avoid route shadowing.
router.get('/export/csv', async (req, res) => {
  try {
    const { data } = await paymentService.listPayments({ page: 1, limit: 10000 });

    const headers = ['ID', 'Tanggal', 'No. WA', 'Blok', 'Bulan', 'Jumlah (IDR)', 'Status', 'Bukti URL'];
    const rows = data.map((p) => [
      p.id,
      new Date(p.created_at).toLocaleString('id-ID'),
      p.sender_number.replace('@c.us', ''),
      p.block_number,
      p.payment_month,
      p.amount,
      p.status,
      p.evidence_url || '',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const filename = `ipl-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent); // BOM prefix for correct Excel encoding
  } catch (err) {
    console.error('[GET /api/payments/export/csv]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/payments/:id
router.get('/:id', async (req, res) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (err) {
    console.error('[GET /api/payments/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/payments/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const status = req.body.status?.toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const payment = await paymentService.getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const updated = await paymentService.updatePaymentStatus(req.params.id, status);
    res.json(updated);
  } catch (err) {
    console.error('[PATCH /api/payments/:id/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
