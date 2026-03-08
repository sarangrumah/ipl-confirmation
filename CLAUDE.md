# CLAUDE.md — Source of Truth

## Project Overview

A **WhatsApp-based IPL (Iuran Pemeliharaan Lingkungan) payment confirmation system**. Residents send payment proof images via WhatsApp. The bot receives the message, stores the image to Google Drive, logs the transaction in PostgreSQL, and replies with a confirmation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (LTS) |
| Web Framework | Express.js |
| Database | PostgreSQL via Prisma ORM |
| WhatsApp Bot | whatsapp-web.js (Puppeteer-based, no paid API) |
| File Storage | Google Drive API (Service Account) |
| Environment Config | dotenv |

---

## Core Principles

1. **100% free-tier services** — No paid third-party APIs (e.g., no Twilio, no Vonage). Use only `whatsapp-web.js` which runs a real WhatsApp Web session.
2. **No paid storage** — Google Drive via a Service Account provides free storage within quota limits.
3. **Modular code structure** — Each concern lives in its own module (bot, drive, db, routes). Avoid god files.
4. **Secure environment variable handling** — All secrets (DB URL, Google credentials, etc.) must live in `.env`. Never commit `.env` or service account JSON files.
5. **Idempotent and resilient** — Duplicate messages should be handled gracefully; failed uploads must be logged and not silently swallowed.

---

## Project Structure (Target)

```
ipl_confirmation/
├── prisma/
│   └── schema.prisma          # DB schema
├── src/
│   ├── bot/
│   │   └── whatsappClient.js  # whatsapp-web.js setup & event handlers
│   ├── drive/
│   │   └── driveService.js    # Google Drive upload logic
│   ├── db/
│   │   └── prismaClient.js    # Prisma client singleton
│   ├── routes/
│   │   └── webhooks.js        # Express routes (if needed)
│   └── index.js               # App entry point
├── .env                       # Secret config (never committed)
├── .env.example               # Template for required env vars
├── .gitignore
├── package.json
└── CLAUDE.md
```

---

## Build / Run Commands

```bash
# Install dependencies
npm install

# Generate Prisma client after schema changes
npx prisma generate

# Run DB migrations
npx prisma migrate dev --name <migration_name>

# Start development (with auto-restart)
npm run dev

# Start production
npm start
```

### Expected `package.json` scripts:

```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  }
}
```

---

## Environment Variables

All required variables must be present in `.env`. Use `.env.example` as the canonical list.

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ipl_db"

# Google Drive (Service Account)
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-sa@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID="your_shared_folder_id"

# App
PORT=3000
```

> The `GOOGLE_PRIVATE_KEY` must have literal `\n` replaced with actual newlines when loaded — handle this in `driveService.js`.

---

## Coding Style

- **Functional programming where possible** — prefer pure functions, avoid mutating shared state.
- **`async/await` for all I/O** — no raw `.then()` chains. Always wrap in `try/catch`.
- **Comprehensive error logging** — log the full error object (`console.error(err)`) at every failure boundary. Never silently catch errors.
- **No magic strings** — define constants for repeated strings (event names, status values, etc.).
- **Explicit over implicit** — function signatures should be self-documenting; avoid overly clever one-liners.

### Example pattern for I/O functions:

```js
const uploadProof = async (fileBuffer, fileName) => {
  try {
    const fileId = await driveService.upload(fileBuffer, fileName);
    return { success: true, fileId };
  } catch (err) {
    console.error('[uploadProof] Failed to upload to Drive:', err);
    throw err;
  }
};
```

---

## WhatsApp Bot Notes

- `whatsapp-web.js` requires a persistent session (stored locally or in DB) to avoid re-scanning QR on every restart.
- On first run, a QR code is printed to the terminal — scan with the bot's WhatsApp account.
- The bot listens for incoming messages with media (payment proof images). Filter by `message.hasMedia`.
- Always call `message.downloadMedia()` before the media expires.

---

## Google Drive Notes

- Share the target folder with the Service Account email (Editor access).
- Use `googleapis` npm package with `google.auth.GoogleAuth` for authentication.
- Upload files as `multipart` with MIME type `image/jpeg` or `image/png`.
- Store the returned `fileId` in the database for reference.

---

## Database Schema (Prisma — target)

```prisma
model Payment {
  id          String   @id @default(cuid())
  phoneNumber String
  senderName  String?
  driveFileId String
  driveUrl    String?
  status      String   @default("pending") // pending | confirmed | rejected
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

---

## Website Design Recreation

### Workflow

When the user provides a reference image (screenshot) and optionally some CSS classes or style notes:

1. **Generate** a single `index.html` file using Tailwind CSS (via CDN). Include all content inline — no external files unless requested.
2. **Screenshot** the rendered page using Puppeteer (`npx puppeteer screenshot index.html --fullpage` or equivalent). If the page has distinct sections, capture those individually too.
3. **Compare** the screenshot against the reference image. Check for mismatches in:
   - Spacing and padding (measure in px)
   - Font sizes, weights, and line heights
   - Colors (exact hex values)
   - Alignment and positioning
   - Border radii, shadows, and effects
   - Responsive behavior
   - Image/icon sizing and placement
4. **Fix** every mismatch found. Edit the HTML/Tailwind code.
5. **Re-screenshot** and compare again.
6. **Repeat** steps 3–5 until the result is within ~2–3px of the reference everywhere.

Do NOT stop after one pass. Always do at least 2 comparison rounds. Only stop when the user says so or when no visible differences remain.

### Technical Defaults

- Use Tailwind CSS via CDN (`<script src="https://cdn.tailwindcss.com"></script>`)
- Use placeholder images from `https://placehold.co/` when source images aren't provided
- Mobile-first responsive design
- Single `index.html` file unless the user requests otherwise

### Rules

- Do not add features, sections, or content not present in the reference image
- Match the reference exactly — do not "improve" the design
- If the user provides CSS classes or style tokens, use them verbatim
- Keep code clean but don't over-abstract — inline Tailwind classes are fine
- When comparing screenshots, be specific about what's wrong (e.g., "heading is 32px but reference shows ~24px", "gap between cards is 16px but should be 24px")
