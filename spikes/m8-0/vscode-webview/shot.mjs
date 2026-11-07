// captures the VS Code workbench page over CDP to a PNG
import fs from 'fs';
const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
ws.onmessage = m => { const r = JSON.parse(m.data); if (r.id === 1) { fs.writeFileSync(process.argv[2], Buffer.from(r.result.data, 'base64')); process.exit(0); } };
