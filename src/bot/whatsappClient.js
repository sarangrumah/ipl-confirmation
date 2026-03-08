'use strict';

// ------------------------------------------------------------
// WhatsApp & Integration Specialist domain
// Owned by: WhatsApp & Storage Specialist agent
// ------------------------------------------------------------

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parsePaymentMessage } = require('./parseMessage');
const { uploadBufferToDrive } = require('../drive/driveService');
const paymentService = require('../db/paymentService');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Only messages whose body starts with this prefix are processed.
// All other messages (group chats, unrelated DMs) are silently ignored.
const PAY_PREFIX = 'PAY#';

// ---------------------------------------------------------------------------
// Client bootstrap
// ---------------------------------------------------------------------------

let client;

const initWhatsAppClient = async () => {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('[whatsapp] Scan the QR code below to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('[whatsapp] Client is ready and listening for messages');
  });

  client.on('authenticated', () => {
    console.log('[whatsapp] Authenticated — session saved locally');
  });

  client.on('auth_failure', (msg) => {
    console.error('[whatsapp] Authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    console.warn('[whatsapp] Disconnected:', reason);
    console.log('[whatsapp] Attempting to reinitialize...');
    client.initialize().catch((err) => {
      console.error('[whatsapp] Reinitialization failed:', err);
    });
  });

  // Attach the payment listener
  client.on('message', handleIncomingMessage);

  await client.initialize();
};

// ---------------------------------------------------------------------------
// Reply helpers
// ---------------------------------------------------------------------------

const replySuccess = (message, { block, month, amount, id }) =>
  message.reply(
    `✅ *Pembayaran IPL Diterima!*\n\n` +
    `Blok   : ${block}\n` +
    `Bulan  : ${month}\n` +
    `Jumlah : Rp ${Number(amount).toLocaleString('id-ID')}\n` +
    `ID     : ${id}\n` +
    `Status : Menunggu Verifikasi\n\n` +
    `Bukti pembayaran Anda telah tersimpan. Admin akan memverifikasi segera. Terima kasih! 🙏`
  );

const replyMissingPhoto = (message) =>
  message.reply(
    `📎 *Foto bukti pembayaran tidak ditemukan.*\n\n` +
    `Mohon kirim ulang pesan *dalam satu pesan yang sama* dengan format:\n\n` +
    `  PAY#<BLOK>#<BULAN>#<JUMLAH>\n\n` +
    `Contoh:\n  PAY#A3#MARCH2025#150000\n\n` +
    `_Lampirkan foto struk/bukti transfer sebagai gambar di pesan yang sama._`
  );

const replyInvalidFormat = (message) =>
  message.reply(
    `❌ *Format pesan tidak valid.*\n\n` +
    `Gunakan format berikut:\n` +
    `  PAY#<BLOK>#<BULAN>#<JUMLAH>\n\n` +
    `Contoh:\n  PAY#A3#MARCH2025#150000\n\n` +
    `Pastikan:\n` +
    `• Tidak ada spasi\n` +
    `• Jumlah hanya angka (tanpa Rp atau titik)\n` +
    `• Foto bukti dilampirkan dalam pesan yang sama`
  );

const replyDuplicate = (message, { block, month }) =>
  message.reply(
    `ℹ️ Pembayaran untuk *Blok ${block}* bulan *${month}* sudah pernah tercatat.\n\n` +
    `Hubungi admin jika Anda merasa ini adalah kesalahan.`
  );

const replyError = (message, context) =>
  message.reply(
    `⚠️ *Terjadi kesalahan saat memproses pembayaran Anda.*\n\n` +
    `Detail: ${context}\n\n` +
    `Silakan coba kirim ulang dalam beberapa menit, atau hubungi admin jika masalah berlanjut.`
  ).catch(() => {}); // never let a reply failure crash the handler

// ---------------------------------------------------------------------------
// Core message handler
// ---------------------------------------------------------------------------

/**
 * Handle a single incoming WhatsApp message.
 *
 * Flow:
 *  1. Filter   — ignore anything that doesn't start with PAY#
 *  2. Media    — if the prefix matches but no photo is attached, ask for one
 *  3. Parse    — extract block, month, amount from the message body
 *  4. Download — pull media into an in-memory Buffer immediately (expires fast)
 *  5. Parallel — upload buffer to Drive AND save the DB record simultaneously
 *  6. Reply    — send the resident a confirmation receipt
 */
const handleIncomingMessage = async (message) => {
  const body = (message.body || '').trim();

  // ── Step 1: prefix filter ────────────────────────────────────────────────
  // Silently ignore all messages that are not payment submissions.
  if (!body.toUpperCase().startsWith(PAY_PREFIX)) return;

  // ── Step 2: media presence check ────────────────────────────────────────
  // The user typed a PAY# command but forgot to attach the proof image.
  // Reply with clear instructions and stop — do NOT parse or save anything.
  if (!message.hasMedia) {
    await replyMissingPhoto(message);
    console.warn('[whatsappClient] PAY# message without media from:', message.from);
    return;
  }

  // ── Step 3: parse message body ───────────────────────────────────────────
  const parsed = parsePaymentMessage(body);
  if (!parsed) {
    await replyInvalidFormat(message);
    console.warn('[whatsappClient] Invalid PAY# format from:', message.from, '| Body:', body);
    return;
  }

  const { block, month, amount } = parsed;
  const senderNumber = message.from;
  const fileName = `${block}_${month}_${senderNumber.replace('@c.us', '')}`;

  // ── Step 4: download media into memory ──────────────────────────────────
  // Must happen before any await that might delay this — media links expire.
  let buffer, mimeType;
  try {
    const media = await message.downloadMedia();
    buffer   = Buffer.from(media.data, 'base64');
    mimeType = media.mimetype;
  } catch (err) {
    console.error('[whatsappClient] Failed to download media from:', senderNumber, err);
    await replyError(message, 'Gagal mengunduh foto bukti pembayaran.');
    return;
  }

  // ── Step 5: duplicate check ──────────────────────────────────────────────
  // Check for duplicate before uploading to Drive to avoid orphaned files.
  try {
    const isDuplicate = await paymentService.findDuplicatePayment(senderNumber, block, month);
    if (isDuplicate) {
      await replyDuplicate(message, { block, month });
      console.info('[whatsappClient] Duplicate submission blocked — sender:', senderNumber, block, month);
      return;
    }
  } catch (err) {
    console.error('[whatsappClient] Duplicate check failed:', err);
    await replyError(message, 'Gagal memeriksa data pembayaran sebelumnya.');
    return;
  }

  // ── Step 6: parallel — Drive upload + DB save ───────────────────────────
  // Both operations are independent so we run them concurrently.
  // If either fails the whole operation fails — we do NOT save a DB record
  // without a Drive URL, and we do NOT silently swallow errors.
  let payment;
  try {
    const [driveResult] = await Promise.all([
      uploadBufferToDrive(buffer, mimeType, fileName),
      // DB write is chained after Drive because it needs the evidenceUrl.
      // We keep Promise.all here so future parallel operations can be added.
    ]);

    payment = await paymentService.createPayment({
      senderNumber,
      blockNumber:  block,
      paymentMonth: month,
      amount,
      evidenceUrl:  driveResult.evidenceUrl,
    });

    console.info(
      `[whatsappClient] Payment saved — id: ${payment.id} | sender: ${senderNumber} | block: ${block} | month: ${month}`
    );
  } catch (err) {
    console.error('[whatsappClient] Upload or DB save failed for sender:', senderNumber, err);
    await replyError(message, 'Gagal menyimpan bukti pembayaran. Silakan coba lagi.');
    return;
  }

  // ── Step 7: success reply ────────────────────────────────────────────────
  try {
    await replySuccess(message, { block, month, amount, id: payment.id });
  } catch (err) {
    // The record is already saved — a reply failure is non-critical
    console.error('[whatsappClient] Success reply failed (record was saved):', err);
  }
};

module.exports = { initWhatsAppClient };
