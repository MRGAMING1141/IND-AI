# IND AGENT

Multi-user AI coding & business workspace with Claude-style live Interactive Website Artifacts, copyable AI prompt cards, Google Search grounding, automatic exponential backoff for Gemini API rate limits, and optional Gmail / Google Drive integrations.

## Features
- **Interactive Website Artifacts**: Split-pane Workbench with live sandboxed preview, viewport switcher (Desktop / Tablet / Mobile), multi-file code editor, and `v1 / v2 / v3` version history.
- **IND Standard & IND HYPER Models**: Optimized for both crisp 1–2 line prompts and deep, production-grade code builds with automatic code verification & self-debugging loops.
- **Resilient Gemini API Handling**: Automatic exponential backoff retries with jitter on `429 RESOURCE_EXHAUSTED` / `503` errors, live retry progress in the Task Timeline, resumable server-side streaming jobs, and a graceful auto-retry **AI Quota Cooldown** card.
- **Live Web Grounding & Copyable Prompts**: Native Google Search grounding with clickable source chips and one-click Copy Prompt cards.
- **Multi-User Cloud Sync**: Firebase Authentication & Firestore persistence for chat history, custom instructions, custom slash skills, memory facts, and rolling 5-hour usage limits.

## Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in your secrets (never commit `.env` — it is ignored by `.gitignore`):
   ```bash
   cp .env.example .env
   ```
   Required variables:
   - `GEMINI_API_KEY` — Your Google Gemini API key.
   - `TOKEN_ENCRYPTION_KEY` — 32+ character secret used to encrypt per-user OAuth tokens (AES-256-GCM).
   - `SESSION_SECRET` — Random secret for signing session cookies in production.
   - `PORT` — Server port (defaults to `3000`).
   - `APP_URL` — Public origin URL for production deployment.

3. **Start the development server**
   ```bash
   npm run dev
   ```
   The app runs on `http://localhost:3000`.

## Production Build & Start

```bash
npm run lint
npm run build
NODE_ENV=production npm start
```

## Testing

```bash
npx tsx --test server/*.test.ts src/utils/*.test.ts
```

## Security & GitHub Hygiene
- `.env`, `.env.*`, `*.pem`, `*.key`, `*firebase-adminsdk*.json`, `*service-account*.json`, build artifacts (`dist/`), and browser test caches (`.playwright-cli/`) are excluded via `.gitignore`.
- Never hardcode `GEMINI_API_KEY` or private service account keys in source files.
