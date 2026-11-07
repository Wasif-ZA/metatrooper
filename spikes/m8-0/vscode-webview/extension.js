const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const LOG = 'C:/Users/User/.cache/claude-scratch/ouros-overnight-2026-11-08/m8-0-spikes/spike-a/events.log';
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const CSS = ['tiles', 'ide', 'r2', 'r3', 'r4', 'kit', 'assets'].map(n => `<style>${read(n + '.css')}</style>`).join('');

function activate() {
  const f = JSON.parse(read('f-done.json'));
  const out = vscode.window.createOutputChannel('Ouros events');
  const panel = vscode.window.createWebviewPanel('ourosKit', f.tab, vscode.ViewColumn.One, { enableScripts: true });
  // kit.js and assets.js run first, then surface() renders into .main
  panel.webview.html = `<!doctype html><html data-d="1"><head><meta charset="utf-8">${CSS}</head><body><div class="main" style="height:100vh;overflow:auto"></div><script>${read('kit.js')}</script><script>${read('assets.js')}</script><script>
const vscode = acquireVsCodeApi();
document.querySelector('.main').innerHTML = surface(${JSON.stringify(f.spec)}, ${JSON.stringify(f.source || 'agent')}, ${JSON.stringify(f.agent || 'agent')});
document.addEventListener('click', e => { const el = e.target.closest('[data-event]'); if (el) vscode.postMessage({ event: el.dataset.event }); });
</script></body></html>`;
  // each webview message is logged to the output channel and the scratch file
  panel.webview.onDidReceiveMessage(m => { const l = 'event ' + JSON.stringify(m); out.appendLine(l); fs.appendFileSync(LOG, l + '\n'); });
}
exports.activate = activate;
