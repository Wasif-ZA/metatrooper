const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const size = Number(arg('--size')) || 0;
const state = arg('--state');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 600, height: 500, show: false, title: 'M8-38 electron fixture' });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => { win.showInactive(); poll(); });
  win.loadFile(path.join(__dirname, 'index.html'), { query: { size: String(size) } });
  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  // Writes the page state to the state file every 50 ms via a temp file and rename
  const poll = () => setInterval(async () => {
    try {
      const page = await win.webContents.executeJavaScript('({ text: document.getElementById("fixtureInput").value, clicks: window.clicks, checked: document.getElementById("fixtureToggle").checked })');
      fs.writeFileSync(state + '.tmp', JSON.stringify({ hwnd, ...page, size }));
      fs.renameSync(state + '.tmp', state);
    } catch {}
  }, 50);
});
app.on('window-all-closed', () => app.quit());
