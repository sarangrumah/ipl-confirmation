'use strict';

// ------------------------------------------------------------
// WhatsApp & Storage Specialist domain
// Owned by: WhatsApp & Storage Specialist agent
// ------------------------------------------------------------

const { google } = require('googleapis');
const { Readable } = require('stream');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Create an authenticated JWT client using Service Account credentials
 * sourced entirely from environment variables — no JSON file on disk.
 *
 * The GOOGLE_PRIVATE_KEY env var may arrive from the shell/dotenv in two forms:
 *   1. With literal "\n" sequences  →  we replace /\\n/g with real newlines
 *   2. Already containing real newlines  →  replace is a no-op, safe to call
 *
 * Using google.auth.JWT (instead of GoogleAuth) gives us an explicit, eager
 * auth object we can validate at startup rather than lazily on first request.
 *
 * @returns {import('googleapis').Auth.JWT}
 */
const createAuthClient = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      '[driveService] Missing required env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL and/or GOOGLE_PRIVATE_KEY'
    );
  }

  // Normalise escaped newlines that shell environments sometimes inject
  const privateKey = rawKey.replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: SCOPES,
  });
};

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical direct-serve URL for a Drive file.
 * Uses the /uc endpoint with export=view so the browser renders the raw image
 * inline inside <img> tags — no Drive UI wrapper, no forced download.
 *
 * Format: https://drive.google.com/uc?export=view&id={fileId}
 *
 * @param {string} fileId
 * @returns {string}
 */
const buildEvidenceUrl = (fileId) =>
  `https://drive.google.com/uc?export=view&id=${fileId}`;

// ---------------------------------------------------------------------------
// Core upload
// ---------------------------------------------------------------------------

/**
 * Upload a payment proof image to Google Drive.
 *
 * Design constraints (from workflow.md):
 *  - Buffer-only: media stays in memory, zero disk I/O on the VPS
 *  - Permissions: drive.permissions.create is called immediately after upload
 *    with role:'reader' / type:'anyone' — without this the <img> tag returns 403
 *  - URL: returns the canonical buildEvidenceUrl() result, never webContentLink
 *  - Fallback: if URL construction somehow fails, logs the raw fileId and
 *    returns evidenceUrl: null so the caller can still save the DB record
 *
 * @param {Buffer}  buffer    - In-memory image buffer from whatsapp-web.js
 * @param {string}  mimeType  - e.g. "image/jpeg", "image/png"
 * @param {string}  fileName  - Base filename without extension, e.g. "A3_MARCH2025_628xxx"
 * @returns {Promise<{ fileId: string, evidenceUrl: string|null }>}
 */
const uploadProof = async (buffer, mimeType, fileName) => {
  const auth = createAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // Derive extension from mimeType; default to jpg for unknown subtypes
  const ext = mimeType.includes('/') ? mimeType.split('/')[1].split(';')[0] : 'jpg';
  const fullFileName = `${fileName}.${ext}`;

  // ── Step 1: upload ──────────────────────────────────────────────────────
  let fileId;
  try {
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: fullFileName,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      media: {
        mimeType,
        body: Readable.from(buffer), // stream from buffer — no temp file
      },
      fields: 'id',
    });
    fileId = uploadResponse.data.id;
    console.log(`[driveService.uploadProof] Uploaded "${fullFileName}" → fileId: ${fileId}`);
  } catch (err) {
    console.error('[driveService.uploadProof] Upload to Drive failed:', err);
    throw err; // propagate — caller must not save a DB record without a fileId
  }

  // ── Step 2: set public read permission ──────────────────────────────────
  // Must succeed — a file without this permission returns 403 in the dashboard.
  // Treated as part of the same atomic operation; failure throws and aborts.
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
    console.log(`[driveService.uploadProof] Permission set to public-reader for fileId: ${fileId}`);
  } catch (err) {
    console.error('[driveService.uploadProof] Failed to set public permission. fileId:', fileId, err);
    throw err;
  }

  // ── Step 3: build canonical evidence URL ────────────────────────────────
  let evidenceUrl = null;
  try {
    evidenceUrl = buildEvidenceUrl(fileId);
  } catch (err) {
    // buildEvidenceUrl is a pure string template — this branch is a safety net only
    console.error(
      '[driveService.buildEvidenceUrl] URL construction failed. Raw fileId for manual recovery:',
      fileId,
      err
    );
  }

  return { fileId, evidenceUrl };
};

// ---------------------------------------------------------------------------
// Startup validation (optional — call from index.js to fail fast)
// ---------------------------------------------------------------------------

/**
 * Validate that the Service Account credentials are structurally correct and
 * that the configured Drive folder is accessible.
 * Call once at app startup to surface misconfiguration before any WA message arrives.
 *
 * @returns {Promise<void>}
 */
const validateDriveAccess = async () => {
  try {
    const auth = createAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.list({
      q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      pageSize: 1,
      fields: 'files(id)',
    });

    console.log('[driveService.validateDriveAccess] Drive folder access confirmed');
  } catch (err) {
    console.error('[driveService.validateDriveAccess] Cannot access Drive folder:', err.message);
    throw err;
  }
};

// Alias used by whatsappClient.js per integration spec
const uploadBufferToDrive = uploadProof;

module.exports = { uploadProof, uploadBufferToDrive, buildEvidenceUrl, validateDriveAccess };
