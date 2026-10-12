// Fake engine that runs a dev server in its own process, prints its URL in Vite's colours, logs each request path, then acts as browser-engine.cjs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const hits = path.join(process.env.METATROOPER_HOME, `dev-hits-${process.env.TROOP_SESSION_ID}.log`);
const server = http.createServer((req, res) => {
  fs.appendFileSync(hits, req.url + '\n');
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>preview</title><main>preview-ok</main>');
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write(`\r\n  \x1b[32mLocal\x1b[39m:   \x1b[36mhttp://localhost:\x1b[1m${port}\x1b[22m/\x1b[39m\r\n`);
  require('./browser-engine.cjs');
});
