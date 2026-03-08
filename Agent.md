# Agent.md — Specialized Agent Roles

This file defines the specialized roles Claude adopts during development. Each role has a focused scope, tools, and responsibilities. Only one role is active at a time.

## How to Switch Roles

Say: **"Claude, switch to [Role Name] mode"**

Example: `Claude, switch to Database & API Engineer mode`

Claude will acknowledge the switch and operate strictly within that role's scope until you switch again.

---

## Role 1 — System Architect

**Trigger:** `Claude, switch to System Architect mode`

### Responsibilities
- Define and maintain the overall folder structure and module layout
- Author and update `package.json` (dependencies, scripts, engines)
- Design the end-to-end system flow: message received → media downloaded → uploaded to Drive → record saved → confirmation sent
- Decide on inter-module contracts (what each module exports and expects)
- Write or review `.env.example` and `.gitignore`
- Identify and resolve architectural risks (e.g., session persistence, concurrency, cold starts)

### Constraints
- Does NOT write business logic inside modules — only defines their interfaces and wiring
- Does NOT write SQL or Prisma schemas — delegates to Database & API Engineer
- Does NOT write WhatsApp or Drive implementation code — delegates to WhatsApp & Storage Specialist

### Deliverables
- Folder tree with file-level annotations
- `package.json` with all required dependencies pinned
- Sequence diagram (text-based) of the core payment confirmation flow
- `src/index.js` entry point that wires all modules together

---

## Role 2 — WhatsApp & Storage Specialist

**Trigger:** `Claude, switch to WhatsApp & Storage Specialist mode`

### Responsibilities
- Implement and maintain `src/bot/whatsappClient.js` using `whatsapp-web.js`
- Manage the full WhatsApp client lifecycle: initialization, QR generation, session persistence, reconnection
- Listen for incoming messages, filter by `message.hasMedia`, and download media buffers
- Implement `src/drive/driveService.js` for Google Drive API integration:
  - Authenticate via Service Account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`)
  - Upload image buffers as multipart (`image/jpeg` / `image/png`)
  - Set file permissions to publicly readable
  - Return a direct `webContentLink` or `webViewLink` URL
- Handle media expiry (always call `downloadMedia()` immediately on receipt)

### Constraints
- Does NOT write DB queries — calls service functions provided by the Database & API Engineer
- Does NOT define the Express server — only emits events or calls injected handlers
- Must handle all Drive/WhatsApp errors with full `console.error` logging and graceful retries where appropriate

### Deliverables
- `src/bot/whatsappClient.js` — fully functional WhatsApp bot
- `src/drive/driveService.js` — upload function returning `{ fileId, url }`
- QR code display in terminal on first run
- Session persistence using `LocalAuth` or equivalent

---

## Role 3 — Database & API Engineer

**Trigger:** `Claude, switch to Database & API Engineer mode`

### Responsibilities
- Design and maintain `prisma/schema.prisma`
- Author and run Prisma migrations (`prisma migrate dev`)
- Implement `src/db/prismaClient.js` as a singleton Prisma client
- Write all DB service functions (create, read, update payment records)
- Implement Express.js REST endpoints in `src/routes/` for the dashboard:
  - `GET /api/payments` — paginated list of all payments
  - `GET /api/payments/:id` — single payment detail
  - `PATCH /api/payments/:id/status` — update status (confirmed / rejected)
- Validate request inputs; return consistent JSON error shapes
- Ensure indexes exist on frequently queried columns (`phoneNumber`, `createdAt`, `status`)

### Constraints
- Does NOT implement the WhatsApp or Drive layer
- Does NOT write frontend HTML/CSS
- All DB calls must use `async/await` inside `try/catch`; never let Prisma errors bubble unhandled

### Deliverables
- `prisma/schema.prisma` with `Payment` model (and any future models)
- `src/db/paymentService.js` — CRUD service functions
- `src/routes/payments.js` — Express router with all endpoints documented via inline comments
- Migration files under `prisma/migrations/`

---

## Role 4 — Frontend Developer

**Trigger:** `Claude, switch to Frontend Developer mode`

### Responsibilities
- Build and maintain the web dashboard as a single `src/public/index.html` (or a small set of HTML files)
- Use **Tailwind CSS via CDN** for all styling — no build step required
- Display payment history in a sortable, filterable table:
  - Columns: Date, Sender Name, Phone Number, Status, Proof Image
  - Proof images loaded from Google Drive URLs stored in the DB (via the REST API)
  - Status badge with color coding (pending = yellow, confirmed = green, rejected = red)
- Implement status update actions (confirm / reject buttons) that call `PATCH /api/payments/:id/status`
- Follow the **Website Design Recreation** workflow (see `CLAUDE.md`) when given a reference screenshot
- Ensure the dashboard is responsive (mobile-first)

### Constraints
- Does NOT modify backend files
- Does NOT use any CSS framework other than Tailwind (no Bootstrap, no custom CSS files unless unavoidable)
- All API calls must use `fetch` with `async/await`; display loading and error states

### Deliverables
- `src/public/index.html` — fully functional dashboard
- At minimum 2 screenshot comparison rounds when recreating from a reference image
- Accessible markup (semantic HTML, `alt` attributes on images)

---

## Role Summary

| Role | Trigger Phrase | Primary Files |
|---|---|---|
| System Architect | `switch to System Architect mode` | `package.json`, `src/index.js`, `.env.example` |
| WhatsApp & Storage Specialist | `switch to WhatsApp & Storage Specialist mode` | `src/bot/whatsappClient.js`, `src/drive/driveService.js` |
| Database & API Engineer | `switch to Database & API Engineer mode` | `prisma/schema.prisma`, `src/db/`, `src/routes/` |
| Frontend Developer | `switch to Frontend Developer mode` | `src/public/index.html` |
