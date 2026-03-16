# localPDFtranslator

一個可用地端模型的沉浸式翻譯，目前主要支援英翻中。

A local-first PDF immersive translator. Upload a PDF, auto-translate the entire document, and right-click to toggle between the original text and the translation in-place.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Immersive Translation** — Chinese text overlays precisely on top of the original English. Right-click to toggle between languages. No page jumps, no layout shifts.
- **Multiple LLM Backends** — Supports Anthropic (Claude), Ollama (local models), and any OpenAI-compatible API (vLLM, LM Studio, etc.)
- **Runs Locally** — Your PDFs and API keys never leave your machine.
- **Domain-Aware** — Analyzes document context before translating to improve technical term accuracy.
- **Desktop App** — Packages as an installable Electron app for Windows, macOS, and Linux.
- **Zero Build Step** — Frontend is a single vanilla JS + HTML file powered by PDF.js.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- An LLM backend (pick one):
  - [Ollama](https://ollama.com/) running locally (free, no API key needed)
  - Anthropic API key
  - Any OpenAI-compatible endpoint

### Run as Web App

```bash
git clone https://github.com/Neofan7/localPDFtranslator.git
cd localPDFtranslator
npm install
npm run dev
```

Opens in your browser at `http://localhost:3000`.

### Run as Desktop App

```bash
npm start
```

### Build Installer

```bash
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage)
```

## Configuration

Click the **Settings** button in the app to configure:

| Setting | Description |
|---------|-------------|
| Provider | `ollama`, `anthropic`, or `openai` |
| Endpoint | API base URL (e.g., `http://localhost:11434` for Ollama) |
| API Key | Required for Anthropic; optional for local models |
| Model | Model name (e.g., `gemma3:12b`, `claude-sonnet-4-20250514`) |
| Context Size | Token context window for Ollama models |
| Batch Size | Number of text blocks per translation API call |
| Source / Target Language | Configurable language pair |

A `config.json` file is auto-generated on first run. See `config.json.example` for reference.

## How It Works

1. **PDF.js** renders the PDF to a `<canvas>` element
2. Text blocks are extracted with precise positions from PDF.js text content
3. Blocks are batched and sent to the configured LLM for translation
4. Translated text is rendered as positioned `<div>` overlays on top of the canvas
5. Right-click toggles overlay visibility — original PDF is always preserved underneath

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS + PDF.js 3.11.174 |
| Backend | Express.js (Node.js) |
| Desktop | Electron |
| LLM | Anthropic / Ollama / OpenAI-compatible |

## Project Structure

```
├── main.js              # Electron main process
├── preload.js           # Electron preload script
├── server.js            # Express backend (API proxy + static files)
├── public/
│   └── index.html       # Frontend (PDF viewer + translation overlay)
├── config.json.example  # Example configuration
└── package.json
```

## License

[MIT](LICENSE)
