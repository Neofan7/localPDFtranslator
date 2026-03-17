# PDF Immersive Translator | PDF 沉浸式翻譯器

**英文 PDF 一鍵翻譯成繁體中文，右鍵即可切換原文/譯文。**

Translate English PDFs to Traditional Chinese with one click. Right-click to toggle between original and translated text in-place. Powered by local LLMs or cloud APIs.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/electron-desktop_app-blue)](https://www.electronjs.org/)

> **Keywords**: PDF翻譯, PDF translator, 英翻中, English to Chinese, 沉浸式翻譯, immersive translation, 本地翻譯, local translation, Ollama, Claude, 繁體中文, 論文翻譯, 學術翻譯, academic paper translation, PDF全文翻譯, 桌面翻譯工具

---

## What is this? | 這是什麼？

一個**本地優先**的 PDF 沉浸式翻譯桌面工具。上傳英文 PDF，自動翻譯整份文件為繁體中文，右鍵一點即可在原文與譯文之間切換。翻譯文字精準覆蓋在原文上方，閱讀體驗如同原生中文文件。

A **local-first** PDF immersive translator desktop app. Upload an English PDF, auto-translate the entire document to Traditional Chinese, and right-click to toggle between the original and translated text in-place.

---

## Features | 功能特色

- **沉浸式翻譯** — 中文譯文精準疊加在英文原文上方，右鍵切換，無跳頁、無版面偏移
- **表格智慧辨識** — AI 驅動的表格偵測，自動識別表格結構並逐欄翻譯
- **多種 LLM 後端** — 支援 Ollama（本地模型）、Anthropic（Claude）、OpenAI 相容 API（vLLM、LM Studio 等）
- **完全本地運行** — PDF 和 API 金鑰不離開你的電腦
- **領域感知翻譯** — 翻譯前自動分析文件領域，大幅提升專業術語準確度
- **翻譯可中斷** — 隨時取消翻譯或上傳新檔案，前一個翻譯任務自動中止
- **桌面應用** — 可打包為 Windows / macOS / Linux 安裝檔
- **零建構步驟** — 前端為單一 HTML 檔案，基於 PDF.js

---

## Quick Start | 快速開始

### 環境需求

- [Node.js](https://nodejs.org/) v18+
- LLM 後端（擇一）：
  - [Ollama](https://ollama.com/) 本地運行（免費，不需要 API Key）
  - Anthropic API Key
  - 任何 OpenAI 相容端點

### 以網頁應用啟動

```bash
git clone https://github.com/Neofan7/localPDFtranslator.git
cd localPDFtranslator
npm install
npm run dev
```

瀏覽器開啟 `http://localhost:3000` 即可使用。

### 以桌面應用啟動

```bash
npm start
```

### 打包安裝檔

```bash
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage)
```

---

## Configuration | 設定

點擊應用中的 **Settings** 按鈕進行設定：

| 設定項 | 說明 |
|--------|------|
| Provider | `ollama`、`anthropic` 或 `openai` |
| Endpoint | API 網址（如 Ollama: `http://localhost:11434`） |
| API Key | Anthropic 必填；本地模型可留空 |
| Model | 模型名稱（如 `gemma3:12b`、`claude-sonnet-4-20250514`） |
| Context Size | Ollama 模型的 token 上下文長度 |
| Batch Size | 每次 API 呼叫翻譯的文字區塊數量 |
| Source / Target Language | 來源語言 / 目標語言 |

首次運行自動產生 `config.json`，參考 `config.json.example`。

---

## How It Works | 運作原理

1. **PDF.js** 將 PDF 渲染至 `<canvas>`
2. 從 PDF.js 文字內容中擷取文字區塊及精確位置
3. AI 表格偵測：辨識表格結構並拆分為獨立欄位
4. 文字區塊分批送至 LLM 翻譯（支援領域分析 + 術語表累積）
5. 譯文以定位 `<div>` 覆蓋在 canvas 上方
6. 右鍵切換覆蓋層顯示/隱藏 — 原始 PDF 始終完整保留

---

## Tech Stack | 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | Vanilla JS + PDF.js 3.11.174 |
| 後端 | Express.js (Node.js) |
| 桌面 | Electron |
| LLM | Anthropic / Ollama / OpenAI-compatible |

---

## Project Structure | 專案結構

```
├── main.js              # Electron 主程序
├── preload.js           # Electron 預載腳本
├── server.js            # Express 後端（API 代理 + 靜態檔案）
├── public/
│   └── index.html       # 前端（PDF 閱覽器 + 翻譯覆蓋層）
├── config.json.example  # 設定範例
└── package.json
```

---

## Use Cases | 適用場景

- 閱讀英文學術論文、研究報告
- 翻譯技術文件、產品規格書
- 閱讀英文電子書、白皮書
- 需要對照原文的專業翻譯工作

---

## License

[MIT](LICENSE)
