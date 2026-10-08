// Serves the current folder on 127.0.0.1 and reloads open pages whenever a file in it changes.
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const at = process.argv.indexOf('--port');
const port = Number(at !== -1 ? process.argv[at + 1] : process.env.PORT || 3000);
const root = resolve('.');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const RELOAD = `<script>(() => { let v = null; setInterval(async () => { try { const n = await (await fetch('/__version')).text(); if (v !== null && n !== v) location.reload(); v = n; } catch {} }, 700); })();</script>`;
const WAITING = `<!doctype html><meta charset="utf-8"><title>Building</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666">Building this variant; the page appears here as soon as index.html is written.</body>`;

let version = 0;
watch(root, { recursive: true }, (_e, name) => {
  if (name && !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(name)) version++;
});

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__version') return res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end(String(version));
  let file = resolve(join(root, decodeURIComponent(url.pathname)));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(type === 'text/html' ? body.toString('utf8') + RELOAD : body);
  } catch {
    const home = url.pathname === '/' || url.pathname === '/index.html';
    res.writeHead(home ? 200 : 404, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(home ? WAITING + RELOAD : 'not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
