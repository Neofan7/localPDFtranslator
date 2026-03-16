const { app, BrowserWindow } = require('electron');
const path = require('path');

// Set writable data directory for config.json before loading server
process.env.PDF_TRANSLATOR_DATA = app.getPath('userData');

const { startServer } = require('./server');

let mainWindow;
let server;

async function createWindow() {
  // Start Express server
  server = await startServer(3000);
  const port = server.address().port;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'PDF Immersive Translator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
