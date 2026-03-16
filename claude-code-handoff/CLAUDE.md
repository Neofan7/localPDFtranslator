# CLAUDE.md — PDF Immersive Translator

## What This Project Is

A local-first PDF immersive translator. Upload an English PDF → auto-translate entire document to Traditional Chinese → right-click to toggle between original English and Chinese translation in-place. The Chinese text overlays precisely on top of the original English, covering it with a white background. When toggled back, the original PDF renders untouched.

## Core UX Concept

"Immersive translation" means: switching languages should NOT feel like switching layers. The text should smoothly transform in-place — no font jumps, no position shifts, no layer occlusion artifacts. English mode = pure PDF canvas (zero HTML interference). Chinese mode = precisely positioned white-background divs covering original text.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (Single HTML file)                │
│  - PDF.js renders PDF to <canvas>           │
│  - Extract text blocks with positions       │
│  - Overlay <div>s for Chinese translation   │
│  - Right-click toggles overlay opacity 0↔1  │
│  - Calls /api/* for translation + config    │
└──────────────┬──────────────────────────────┘
               │ HTTP (localhost)
┌──────────────▼──────────────────────────────┐
│  Backend (PowerShell HttpListener)          │
│  - Serves static HTML                      │
│  - /api/config GET/POST — read/write JSON   │
│  - /api/translate POST — proxy to LLM API   │
│  - Supports: Anthropic, VLLM, OpenAI compat │
│  - config.json persisted next to executable │
└─────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Vanilla JS + PDF.js 3.11.174 | No build step, single HTML file |
| Backend | PowerShell 5.1 HttpListener | Zero dependencies on Windows 10/11 |
| Deployment | .bat + .ps1 (2 files) | No Node.js, no Python, no install |
| LLM API | Anthropic / VLLM / OpenAI | Configurable via Settings UI |

## Current Status

### ✅ Working
- PDF upload + rendering via PDF.js
- Text block extraction with position detection
- Title / body / bullet point separation (font size + indent heuristics)
- Domain-aware translation (analyzes document first, then translates with context)
- Right-click toggle Chinese ↔ English
- Settings panel (Provider / Endpoint / API Key / Model)
- PowerShell HTTP server with API proxy
- Auto-find free port (if 3000 is busy)
- Auto-kill stale processes on port 3000
- Glossary generation from translations

### ⚠️ Known Issues to Fix
1. **Caption splitting** — Figure captions that wrap across lines sometimes get split into separate blocks
2. **Chinese font size** — When Chinese translation is much longer than English, the auto-shrink algorithm sometimes makes text too small
3. **Image/table text** — Text inside rasterized images (not PDF text objects) is not extracted. Needs OCR (e.g., Tesseract.js)
4. **Overlay position accuracy** — Bounding box calculation uses heuristic ascender/descender ratios (0.85/0.25) that may not match all fonts

## Key Algorithms

### Text Block Extraction (`extractBlocks`)

1. Parse PDF.js `textContent.items` → get `{str, x, y, fontSize, width}` per text item
2. Sort top-to-bottom (descending y), left-to-right (ascending x)
3. Group into lines: items within `0.4 * fontSize` vertical distance
4. Merge lines into paragraph blocks with split conditions:
   - **Font size change > 20%** → force new block (title ↔ body boundary)
   - **Bullet point detected** (`• `, `1. `, etc.) → force new block
   - **Extreme indent shift** (> 8× fontSize) → force new block
   - **Same font + consecutive** → keep together (handles wrapped captions)
5. Compute bounding box in canvas coordinates:
   - `top = pageHeight - (firstLine.y + fontSize * 0.85)`
   - `bottom = pageHeight - (lastLine.y - fontSize * 0.25)`
6. Classify: `isTitle` (fontSize > median * 1.15 && lines ≤ 3), `isBullet`

### Translation Pipeline

1. **Analyze context** — Send first 3000 chars to LLM, ask for domain/organizations/key_terms as JSON
2. **Batch translate** — Send 5 blocks per API call, tagged as `(TITLE)/(BULLET)/(BODY)`
3. **Parse response** — Extract `[N] translation` format + `GLOSSARY: EN -> CN` section
4. **Incremental render** — Update overlays after each page completes

### Overlay Rendering

- English mode: all overlays have `opacity: 0; pointer-events: none; z-index: -1`
- Chinese mode: `opacity: 1; pointer-events: auto; z-index: 5`
- Each overlay: white background div at exact block position, with `transition: opacity 0.15s`
- Font auto-sizing: estimate chars-per-line from block width, shrink if Chinese text needs more lines than available height

## API Endpoints

```
GET  /api/health         → {"status":"ok"}
GET  /api/config         → {provider, endpoint, apiKey (masked), model, hasKey}
POST /api/config         → Save {provider, endpoint, apiKey, model}
POST /api/translate      → Proxy to LLM API, body: {messages, max_tokens}
GET  /                   → Serve index.html
```

## Translation Prompt Structure

```
System: You translate English to Traditional Chinese for "{domain}".
        Terms: {key_terms}
        Rules:
        1. Domain-specific terminology
        2. Keep [N] prefix
        3. Tags (TITLE)/(BULLET)/(BODY) = block type, exclude from output
        4. Proper nouns keep English in parentheses
        5. End with GLOSSARY: EN->CN pairs
        6. ONLY translations + glossary

User: Translate:

[0] (TITLE) Key Findings
[1] (BULLET) The AI-generated images and, to a lesser extent...
[2] (BODY) Registrants on the purported dating sites stand to lose...
```

## File Structure (Current)

```
PDFTranslator/
├── run.bat              # Entry point: kills stale port, unblocks ps1, launches
├── _server.ps1          # PowerShell server + embedded base64 HTML
├── config.json          # Auto-generated on first run
└── _web/
    └── index.html       # Auto-extracted from base64 on startup
```

## Deployment Constraints

- **Target: Windows 10/11** (PowerShell 5.1 built-in)
- **Zero install** — No Node.js, no Python, no npm
- **No .exe** — Unsigned executables get blocked by Windows Defender
- **Email-safe** — .bat + .ps1 won't be blocked by most email filters (rename to .txt if needed)
- **Execution Policy** — User may have `RemoteSigned`; bat runs `Unblock-File` and uses `-ExecutionPolicy Bypass`
- **Port conflicts** — Auto-detect free port starting from 3000

## Recommended Next Steps for Claude Code

### Priority 1: Rewrite as a proper Node.js project
The PowerShell server was a workaround for zero-dependency deployment. For development:
```
npm create vite@latest pdf-translator -- --template vanilla
# or
npx create-next-app pdf-translator
```

Use Express or Hono for the backend. The PDF.js + overlay logic from the frontend is solid and can be reused directly.

### Priority 2: Fix text extraction accuracy
- Use PDF.js `getTextContent({ includeMarkedContent: true })` for better structure hints
- Consider page-level OCR fallback for scanned PDFs (Tesseract.js)
- Improve bounding box with actual font metrics instead of heuristic ratios

### Priority 3: Translation quality
- Cache translations (localStorage or file-based)
- Allow re-translation of individual blocks
- Support more language pairs (not just EN→ZH-TW)

### Priority 4: Packaging
- Electron or Tauri for true single-file desktop app
- Or Docker for server deployment
- GitHub Actions for CI/CD

## Design Decisions & Rationale

| Decision | Why |
|----------|-----|
| Vanilla JS, no React | Single-file distribution, no build step needed |
| PowerShell backend | Zero dependencies on Windows, but fragile — migrate to Node.js |
| Base64 HTML in PS1 | Avoid multiple files, but makes debugging painful |
| Canvas + overlay (not text replacement) | English mode = pixel-perfect PDF, zero HTML artifacts |
| Paragraph-level overlay (not line-level) | Chinese text can wrap naturally within the block |
| Domain analysis before translation | Dramatically improves technical term accuracy |
| Batch 5 blocks per API call | Balance between latency and context quality |
