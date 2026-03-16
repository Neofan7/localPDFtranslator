# CLAUDE.md — PDF Immersive Translator

## What This Project Is

A local-first PDF immersive translator desktop app. Upload an English PDF → auto-translate entire document to Traditional Chinese → right-click to toggle between original English and Chinese translation in-place. The Chinese text overlays precisely on top of the original English, covering it with a white background. When toggled back, the original PDF renders untouched.

## Core UX Concept

"Immersive translation" means: switching languages should NOT feel like switching layers. The text should smoothly transform in-place — no font jumps, no position shifts, no layer occlusion artifacts. English mode = pure PDF canvas (zero HTML interference). Chinese mode = precisely positioned white-background divs covering original text.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (public/index.html)               │
│  - PDF.js renders PDF to <canvas>           │
│  - Extract text blocks with positions       │
│  - Overlay <div>s for Chinese translation   │
│  - Right-click toggles overlay opacity 0↔1  │
│  - Calls /api/* for translation + config    │
└──────────────┬──────────────────────────────┘
               │ HTTP (localhost)
┌──────────────▼──────────────────────────────┐
│  Backend (Express.js — server.js)           │
│  - Serves static files from public/        │
│  - /api/config GET/POST — read/write JSON   │
│  - /api/translate POST — proxy to LLM API   │
│  - Supports: Anthropic, VLLM, OpenAI compat │
│  - config.json persisted next to executable │
└─────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Desktop Shell (Electron — main.js)         │
│  - Launches Express server on startup       │
│  - Opens BrowserWindow to localhost         │
│  - Packages as installable desktop app      │
└─────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Vanilla JS + PDF.js 3.11.174 | No build step, single HTML file |
| Backend | Express.js (Node.js) | Robust HTTP server, easy API routing |
| Desktop | Electron | Cross-platform desktop app packaging |
| LLM API | Anthropic / VLLM / OpenAI | Configurable via Settings UI |

## File Structure

```
PDFreader/
├── CLAUDE.md            # This file
├── package.json         # Node.js project config + build scripts
├── main.js              # Electron main process
├── preload.js           # Electron preload (context bridge)
├── server.js            # Express backend (API proxy + static files)
├── config.json          # Auto-generated on first run (gitignored)
├── public/
│   └── index.html       # Frontend UI (PDF.js + overlay logic)
├── claude-code-handoff/ # Original PowerShell prototype (reference)
└── .gitignore
```

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Run as web app (opens in browser)
npm start            # Run as Electron desktop app
npm run build:win    # Build Windows installer (.exe)
npm run build:mac    # Build macOS installer (.dmg)
npm run build:linux  # Build Linux installer (.AppImage)
```

## API Endpoints

```
GET  /api/health         → {"status":"ok"}
GET  /api/config         → {provider, endpoint, apiKey (masked), model, hasKey}
POST /api/config         → Save {provider, endpoint, apiKey, model}
POST /api/translate      → Proxy to LLM API, body: {messages, max_tokens}
GET  /                   → Serve index.html
```

## Key Algorithms

### Text Block Extraction (`extractBlocks` in index.html)

1. Parse PDF.js `textContent.items` → get `{str, x, y, fontSize, width}` per text item
2. Sort top-to-bottom (descending y), left-to-right (ascending x)
3. Group into lines: items within `0.4 * fontSize` vertical distance
4. Merge lines into paragraph blocks with split conditions:
   - **Font size change > 20%** → force new block (title ↔ body boundary)
   - **Bullet point detected** (`• `, `1. `, etc.) → force new block
   - **Extreme indent shift** (> 8× fontSize) → force new block
   - **Same font + consecutive** → keep together (handles wrapped captions)
5. Compute bounding box in canvas coordinates
6. Classify: `isTitle` (fontSize > median * 1.15 && lines ≤ 3), `isBullet`

### Translation Pipeline

1. **Analyze context** — Send first 3000 chars to LLM for domain/key_terms
2. **Batch translate** — 5 blocks per API call, tagged as `(TITLE)/(BULLET)/(BODY)`
3. **Parse response** — Extract `[N] translation` format + `GLOSSARY: EN -> CN`
4. **Incremental render** — Update overlays after each page completes

## Known Issues

1. **Caption splitting** — Figure captions wrapping across lines sometimes split into separate blocks
2. **Chinese font size** — Auto-shrink algorithm sometimes makes text too small
3. **Image/table text** — Text inside rasterized images not extracted (needs OCR)
4. **Overlay position accuracy** — Heuristic ascender/descender ratios may not match all fonts

## Design Decisions

| Decision | Why |
|----------|-----|
| Vanilla JS, no React | Single-file distribution, no build step needed |
| Express.js backend | Replaced fragile PowerShell; robust and portable |
| Electron desktop shell | Cross-platform installable app |
| Canvas + overlay | English mode = pixel-perfect PDF, zero HTML artifacts |
| Domain analysis before translation | Dramatically improves technical term accuracy |
| Batch 5 blocks per API call | Balance between latency and context quality |
