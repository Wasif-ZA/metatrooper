// The demo-fixture engine (M6-16); the prompt is the role. preview serves a page and prints its URL the way a dev
// server does, asker idles, driver runs the scripted agent. Each role names its terminal after itself.
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const role = process.argv[2] || 'asker';
process.stdout.write(`\x1b]0;${role}\x07`);
console.log(`demo-fixture: ${role}`);
const idle = () => setInterval(() => {}, 1 << 30);

if (role === 'preview') {
  http.createServer((_q, r) => r.end('shop-cart preview')).listen(0, '127.0.0.1', function () {
    console.log(`  Local:   http://localhost:${this.address().port}/`);
  });
} else if (role === 'driver') {
  const agent = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'desktop-agent.mjs')], { stdio: 'inherit' });
  agent.on('exit', (code) => { console.log(`desktop-agent exited ${code}`); idle(); });
} else {
  idle();
}
