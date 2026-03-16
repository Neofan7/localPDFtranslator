const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  provider: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  numCtx: 8192,
  batchSize: 10,
  sourceLang: 'English',
  targetLang: 'Traditional Chinese (繁體中文)',
  systemPrompt: ''
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Ensure new fields have defaults
      if (!c.numCtx) c.numCtx = 8192;
      if (!c.batchSize) c.batchSize = 10;
      if (c.sourceLang === undefined) c.sourceLang = 'English';
      if (c.targetLang === undefined) c.targetLang = 'Traditional Chinese (繁體中文)';
      if (c.systemPrompt === undefined) c.systemPrompt = '';
      return c;
    }
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Initialize config if not exists
if (!fs.existsSync(CONFIG_PATH)) {
  saveConfig(DEFAULT_CONFIG);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get config (mask API key)
app.get('/api/config', (req, res) => {
  const c = loadConfig();
  const masked = c.apiKey ? c.apiKey.substring(0, Math.min(8, c.apiKey.length)) + '...' : '';
  res.json({
    provider: c.provider,
    endpoint: c.endpoint,
    apiKey: masked,
    model: c.model,
    hasKey: !!c.apiKey,
    numCtx: c.numCtx || 8192,
    batchSize: c.batchSize || 10,
    sourceLang: c.sourceLang || 'English',
    targetLang: c.targetLang || 'Traditional Chinese (繁體中文)',
    systemPrompt: c.systemPrompt || ''
  });
});

// Save config
app.post('/api/config', (req, res) => {
  const body = req.body;
  const c = loadConfig();
  if (body.provider !== undefined) c.provider = body.provider;
  if (body.endpoint !== undefined) c.endpoint = body.endpoint;
  if (body.model !== undefined) c.model = body.model;
  if (body.apiKey !== undefined && !body.apiKey.includes('...')) c.apiKey = body.apiKey;
  if (body.numCtx !== undefined) c.numCtx = parseInt(body.numCtx) || 8192;
  if (body.batchSize !== undefined) c.batchSize = parseInt(body.batchSize) || 10;
  if (body.sourceLang !== undefined) c.sourceLang = body.sourceLang;
  if (body.targetLang !== undefined) c.targetLang = body.targetLang;
  if (body.systemPrompt !== undefined) c.systemPrompt = body.systemPrompt;
  saveConfig(c);
  res.json({ ok: true });
});

// Translate proxy
app.post('/api/translate', async (req, res) => {
  const body = req.body;
  const msgPreview = body.messages && body.messages[0] ? body.messages[0].content.slice(0, 80) : '(no msg)';
  console.log(`  [API] translate request, max_tokens=${body.max_tokens}, preview: ${msgPreview}`);
  const c = loadConfig();

  if (!c.apiKey && c.provider === 'anthropic') {
    return res.status(400).json({ error: 'API key not set. Please configure in Settings.' });
  }

  try {
    const messages = body.messages || [];
    const maxTokens = body.max_tokens || 4000;
    let text;

    if (c.provider === 'anthropic') {
      // Anthropic API
      const url = `${c.endpoint.replace(/\/+$/, '')}/v1/messages`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': c.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: c.model,
          max_tokens: maxTokens,
          messages
        })
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Anthropic API error ${r.status}: ${err}`);
      }
      const data = await r.json();
      text = data.content[0].text;

    } else if (c.provider === 'ollama') {
      // Ollama native API — supports num_ctx for context length control
      const url = `${c.endpoint.replace(/\/+$/, '')}/api/chat`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: c.model,
          messages,
          stream: false,
          options: {
            num_ctx: c.numCtx || 8192,
            temperature: 0.3,
            num_predict: maxTokens
          }
        })
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Ollama API error ${r.status}: ${err}`);
      }
      const data = await r.json();
      text = data.message?.content || '';

    } else {
      // OpenAI / VLLM compatible
      const url = `${c.endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`;

      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: c.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3
        })
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`API error ${r.status}: ${err}`);
      }
      const data = await r.json();
      text = data.choices[0].message.content;
    }

    res.json({ text });
  } catch (e) {
    console.error('Translate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server (used in both dev mode and Electron)
function startServer(port = 3000, maxRetries = 20) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`  PDF Immersive Translator`);
      console.log(`  http://localhost:${port}`);
      resolve(server);
    }).on('error', (err) => {
      if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && maxRetries > 0) {
        console.log(`  Port ${port} unavailable (${err.code}), trying ${port + 1}...`);
        resolve(startServer(port + 1, maxRetries - 1));
      } else {
        reject(err);
      }
    });
  });
}

// If run directly (not imported by Electron), start server and open browser
if (require.main === module) {
  startServer().then(server => {
    const port = server.address().port;
    const url = `http://localhost:${port}`;
    // Open in default browser
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start ${url}`
      : process.platform === 'darwin' ? `open ${url}`
      : `xdg-open ${url}`;
    exec(cmd);
  });
}

module.exports = { app, startServer };
