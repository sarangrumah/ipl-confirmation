# workflow.md — Data Journey

This document traces the full lifecycle of a payment confirmation, from the moment a WhatsApp message arrives to the dashboard rendering the result.

---

## Step 1 — Trigger: Incoming WhatsApp Message

The user sends a WhatsApp message to the bot's number with the following format:

```
PAY#<BLOCK>#<MONTH>
```

**Example:**
```
PAY#A3#MARCH2025
```

Accompanied by a **payment proof image** (JPEG or PNG) attached as media.

**Handler:** `src/bot/whatsappClient.js` — `client.on('message', handler)`

```
[User WA] ──► [whatsapp-web.js client]
                    │
                    ├── message.hasMedia? ──► NO  ──► send format error reply, STOP
                    │
                    └── YES ──► proceed to Step 2
```

---

## Step 2 — Parsing: Extract Metadata from Message Text

Parse the message body to extract structured payment data.

**Parser function:** `src/bot/parseMessage.js`

```js
// Expected format: PAY#<BLOCK>#<MONTH>
const parsePaymentMessage = (body) => {
  const regex = /^PAY#([A-Z0-9]+)#([A-Z0-9]+)$/i;
  const match = body.trim().match(regex);
  if (!match) return null;
  return {
    block: match[1].toUpperCase(),
    month: match[2].toUpperCase(),
  };
};
```

**Outputs:**

| Field | Source | Example |
|---|---|---|
| `block` | Regex group 1 | `A3` |
| `month` | Regex group 2 | `MARCH2025` |
| `phoneNumber` | `message.from` | `628123456789@c.us` |
| `senderName` | `message.notifyName` | `Budi Santoso` |
| `mediaBuffer` | `await message.downloadMedia()` | Raw image buffer |

> `downloadMedia()` is called immediately after format validation to prevent media expiry.

---

## Step 3 — Parallel Processing: Drive Upload + DB Validation

Once metadata is parsed and the media buffer is ready, two operations run **simultaneously** using `Promise.all`.

```js
const [driveResult, resident] = await Promise.all([
  driveService.uploadProof(mediaBuffer, mimeType, `${block}_${month}_${phoneNumber}`),
  paymentService.findResident(phoneNumber, block),
]);
```

### 3a — Upload Image to Google Drive

**Handler:** `src/drive/driveService.js`

1. Authenticate using Service Account credentials from env
2. Receive the WhatsApp media as an **in-memory `Buffer`** — never write a temp file to disk (see [Storage & Image Handling Strategy](#storage--image-handling-strategy))
3. Upload the buffer as multipart to the configured folder (`GOOGLE_DRIVE_FOLDER_ID`)
4. Call `drive.permissions.create` with `role: 'reader'` and `type: 'anyone'` for the new `fileId`
5. Construct the canonical direct URL and return `{ fileId, evidenceUrl }`

```
mediaBuffer ──► googleapis.drive.files.create()
                    │
                    ├── fileId returned
                    │
                    ├── drive.permissions.create({ role: 'reader', type: 'anyone' })
                    │
                    └── returns {
                          fileId,
                          evidenceUrl: "https://drive.google.com/uc?export=view&id={fileId}"
                        }
```

### 3b — Validate Resident in PostgreSQL

**Handler:** `src/db/paymentService.js`

1. Query the `Resident` table (if it exists) by `phoneNumber` and `block`
2. Check for duplicate payment for the same `block` + `month` combination
3. Return resident info or a validation result object

```
phoneNumber + block ──► prisma.resident.findFirst()
                            │
                            └── returns resident record (or null if not found)
```

---

## Step 4 — Storage: Save Transaction to PostgreSQL

After both parallel tasks resolve, persist the full record.

**Handler:** `src/db/paymentService.js` — `createPayment()`

```js
const payment = await prisma.payment.create({
  data: {
    phoneNumber,
    senderName,
    block,
    month,
    driveFileId:  driveResult.fileId,
    evidence_url: driveResult.evidenceUrl,  // canonical direct-serve URL
    status:       'pending',
  },
});
```

**Resulting DB record:**

| Column | Value |
|---|---|
| `id` | Auto-generated CUID |
| `phoneNumber` | `628123456789@c.us` |
| `senderName` | `Budi Santoso` |
| `block` | `A3` |
| `month` | `MARCH2025` |
| `driveFileId` | `1aBcDeFgH...` |
| `evidence_url` | `https://drive.google.com/uc?export=view&id=1aBcDeFgH...` |
| `status` | `pending` |
| `createdAt` | timestamp |

---

## Step 5 — Feedback: Send WhatsApp Confirmation Receipt

After the record is saved, the bot replies to the user's message with a confirmation.

**Handler:** `src/bot/whatsappClient.js`

```js
await message.reply(
  `✅ *Konfirmasi Pembayaran IPL*\n\n` +
  `Blok   : ${block}\n` +
  `Bulan  : ${month}\n` +
  `Status : Menunggu Verifikasi\n` +
  `ID     : ${payment.id}\n\n` +
  `Bukti pembayaran Anda telah diterima. Admin akan memverifikasi segera.`
);
```

The reply is threaded to the original message so the user has clear context.

---

## Step 6 — Visualization: Dashboard Data Flow

The web dashboard fetches and renders payment data from PostgreSQL via the Express REST API.

```
[Browser]
    │
    ├── GET /api/payments?page=1&status=pending
    │       │
    │       └── [Express Router] src/routes/payments.js
    │               │
    │               └── paymentService.listPayments({ page, status })
    │                       │
    │                       └── prisma.payment.findMany({ ... })
    │                               │
    │                               └── [PostgreSQL]
    │
    ├── Render table rows with:
    │     - Sender Name, Block, Month, Phone, Status badge, createdAt
    │     - <img src="{{ driveUrl }}"> for proof image thumbnail
    │
    └── PATCH /api/payments/:id/status   (admin confirms or rejects)
            │
            └── prisma.payment.update({ status: 'confirmed' | 'rejected' })
```

Dashboard renders `evidence_url` directly as an `<img>` src — no proxy needed since each file has `role: 'reader'` / `type: 'anyone'` set on upload.

---

## Full Sequence Diagram

```
User WA
  │
  │  "PAY#A3#MARCH2025" + [image]
  ▼
whatsappClient.js
  │── validate format ──► FAIL ──► reply error, END
  │── downloadMedia()
  │── parseMessage()
  │
  ├──────────────────────────────────┐
  │  Promise.all([...])              │
  │                                  │
  ▼                                  ▼
driveService.js               paymentService.js
uploadProof()                 findResident()
  │                                  │
  └─────────── both resolve ─────────┘
                    │
                    ▼
            paymentService.js
            createPayment()
                    │
                    ▼
              PostgreSQL
                    │
                    ▼
        whatsappClient.js
        message.reply(receipt)
                    │
                    ▼
              [User WA] ✅

         (async, later)
              │
              ▼
         [Browser Dashboard]
         GET /api/payments
              │
              ▼
         Express → Prisma → PostgreSQL
              │
              ▼
         Render table + Drive image URLs
```

---

## Storage & Image Handling Strategy

This section is the authoritative reference for how media is handled between WhatsApp, Google Drive, and the database. All agents must follow these rules without deviation.

---

### 1. Buffer-Only Processing (No Temp Files)

The WhatsApp media object must be kept **entirely in memory** as a `Buffer`. Writing to disk is forbidden to prevent filling VPS storage.

```js
// ✅ CORRECT — process in memory only
const media = await message.downloadMedia();
const buffer = Buffer.from(media.data, 'base64');
const mimeType = media.mimetype; // e.g. "image/jpeg"

// ❌ WRONG — never do this
fs.writeFileSync('/tmp/proof.jpg', buffer);
```

The `buffer` and `mimeType` are passed directly into `driveService.uploadProof(buffer, mimeType, fileName)` and streamed straight to the Drive API. No disk I/O at any point.

---

### 2. Public Permission — Required After Every Upload

Immediately after `drive.files.create()` succeeds, the **WhatsApp & Storage Specialist** agent must call `drive.permissions.create()` for that specific `fileId`. This step is **not optional**.

```js
await drive.permissions.create({
  fileId,
  requestBody: {
    role: 'reader',
    type: 'anyone',
  },
});
```

Without this call, the stored `evidence_url` will return a 403 when the dashboard tries to render the image. This call must be inside the same `try/catch` block as the upload — if it fails, treat the entire upload as failed.

---

### 3. Direct Link Transformation (Canonical URL Format)

After the upload and permission steps succeed, construct the `evidence_url` using the following **exact format**:

```
https://drive.google.com/uc?export=view&id={fileId}
```

**Why this format:**
- `uc` is Google's file proxy endpoint — it bypasses the Drive UI viewer
- `export=view` instructs Google to serve the raw file content with correct MIME type
- This URL renders inline in `<img>` tags without redirect issues
- The alternative `webContentLink` from the Drive API response triggers a download rather than inline display — do NOT use it

**Implementation in `driveService.js`:**

```js
const buildEvidenceUrl = (fileId) =>
  `https://drive.google.com/uc?export=view&id=${fileId}`;
```

---

### 4. Database Column — `evidence_url`

The **Database & API Engineer** agent must define the column as follows in `prisma/schema.prisma`:

```prisma
model Payment {
  // ... other fields ...
  driveFileId  String   // raw fileId from Drive API — kept as fallback
  evidence_url String   // canonical direct-serve URL (TEXT / VARCHAR)
  // ...
}
```

Rules for this column:
- Type: `String` in Prisma (maps to `TEXT` in PostgreSQL — no length cap, as URLs can be long)
- Always populated from `buildEvidenceUrl(fileId)` — never store the raw `webViewLink` or `webContentLink` here
- `driveFileId` is stored separately as the raw fallback (see section 5)
- Never nullable once a successful upload has occurred

---

### 5. Fallback — URL Construction Failure

If `buildEvidenceUrl()` throws or returns an invalid value for any reason, the system must:

1. Log the raw `fileId` so the URL can be reconstructed manually later
2. Store `null` in `evidence_url` rather than a broken URL
3. Still save the DB record — a missing image URL is recoverable; a lost record is not

```js
let evidenceUrl = null;
try {
  evidenceUrl = buildEvidenceUrl(fileId);
} catch (err) {
  console.error('[driveService.buildEvidenceUrl] URL construction failed. Raw fileId:', fileId, err);
}

// proceed to createPayment({ ..., driveFileId: fileId, evidence_url: evidenceUrl })
```

The admin dashboard must handle `evidence_url === null` gracefully — show a "No image" placeholder rather than a broken `<img>` tag.

---

### Summary Table

| Concern | Rule |
|---|---|
| Media buffer | In-memory `Buffer` only — no disk writes |
| Drive permission | `role: 'reader'`, `type: 'anyone'` on every upload |
| Canonical URL format | `https://drive.google.com/uc?export=view&id={fileId}` |
| DB column name | `evidence_url` (type `String` / `TEXT`) |
| Raw fileId | Also stored in `driveFileId` column as fallback |
| On URL build failure | Log `fileId`, store `null`, continue saving record |

---

## Failure Handling

### Invalid WhatsApp Message Format

**Condition:** Message body does not match `PAY#<BLOCK>#<MONTH>` or has no media attachment.

**Response:**
```
❌ Format pesan tidak valid.

Gunakan format berikut:
PAY#<BLOK>#<BULAN>
Contoh: PAY#A3#MARCH2025

Sertakan bukti pembayaran sebagai gambar.
```

**Action:** Log the raw message body, do not create any DB record.

---

### Google Drive Upload Failure

**Conditions:**
- Storage quota exceeded (15 GB free tier limit reached)
- Network timeout during upload
- Invalid Service Account credentials
- Folder ID not found or not shared with Service Account

**Response to user:**
```
⚠️ Terjadi kesalahan saat menyimpan bukti pembayaran.
Silakan coba kirim ulang dalam beberapa menit.
Hubungi admin jika masalah berlanjut.
```

**Internal action:**
```js
console.error('[driveService.uploadProof] Upload failed:', err);
// Do NOT create a DB record — no driveUrl to store
// Optionally: write to a local failed_uploads.log for retry
```

**Recovery:** Consider a retry queue (e.g., an in-memory array or a `FailedUpload` DB table) that retries on next message event.

---

### PostgreSQL / Prisma Error

**Conditions:**
- DB connection lost
- Migration not applied (missing columns)
- Unique constraint violation (duplicate payment for same block + month)

**Duplicate payment response to user:**
```
ℹ️ Pembayaran untuk Blok ${block} bulan ${month} sudah tercatat.
Hubungi admin jika ini merupakan kesalahan.
```

**General DB error response to user:**
```
⚠️ Gagal menyimpan data. Silakan coba lagi atau hubungi admin.
```

**Internal action:**
```js
console.error('[paymentService.createPayment] DB error:', err);
// If Drive upload already succeeded, log the orphaned fileId
// so it can be manually linked or deleted later
```

---

### Resident Not Found in DB (Optional Validation)

**Condition:** `phoneNumber` + `block` combination does not exist in the `Resident` table.

**Policy options (choose one per project requirement):**

| Option | Behavior |
|---|---|
| **Permissive** | Accept payment anyway, flag record with `status: 'unverified'` |
| **Strict** | Reject and reply with an error asking the user to register first |

Default: **Permissive** — always save the record; let the admin review.

---

### WhatsApp Session Dropped / QR Expired

**Condition:** `whatsapp-web.js` loses connection or session is invalidated.

**Internal action:**
- `client.on('disconnected', ...)` — log reason and attempt `client.initialize()` again
- If QR needs re-scan, print new QR to terminal and alert admin (e.g., log to a monitor file)
- In-flight messages during disconnect are lost — no automatic recovery for those

---

## Error Log Convention

All errors must follow this pattern:

```js
console.error('[module.functionName] Description of what failed:', err);
```

Examples:
```js
console.error('[driveService.uploadProof] Multipart upload failed:', err);
console.error('[paymentService.createPayment] Prisma write error:', err);
console.error('[whatsappClient] Message handler crashed:', err);
```

This makes log filtering (`grep '\[driveService'`) straightforward in production.
