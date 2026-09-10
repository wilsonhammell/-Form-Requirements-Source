// Same job as serve.py, for a machine that has Node but not Python.
// Node's standard library only, no install, no package.json.
//
// Usage: node serve.mjs [port]

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ROOT_RESOLVED = resolve(ROOT);

// .mjs must be a JavaScript type or the browser refuses to run the pdf.js
// worker as a module, and no page ever renders.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // resolve() collapses any ".." and the prefix check then rejects anything
  // that climbed out of this folder, so a crafted URL cannot read the disk.
  const file = resolve(ROOT, path === '/' ? 'index.html' : path.slice(1));
  if (file !== ROOT_RESOLVED && !file.startsWith(ROOT_RESOLVED + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

const lan = process.argv.includes('--lan');
const port = Number(process.argv.filter((a) => a !== '--lan')[2] ?? 8000);

// Loopback unless --lan is passed. With --lan anyone who can reach this
// machine on this port gets the app, and nothing here checks who is asking.
const host = lan ? '0.0.0.0' : '127.0.0.1';
server.listen(port, host, () => {
  if (lan) {
    console.log('*** --lan: this is now reachable by other machines on the network. ***');
    console.log('*** There is no authentication. Check this is allowed before use. ***');
    console.log(`Others use: http://${os.hostname()}:${port}/`);
  }
  console.log(`PDF Requirement Designer running at http://127.0.0.1:${port}/`);
  console.log('Leave this window open. Press Ctrl+C to stop.');
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is busy, try: node serve.mjs 8080` : err.message);
  process.exit(1);
});
