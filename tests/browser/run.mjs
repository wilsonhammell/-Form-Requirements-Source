// Runs the browser check in headless Chrome and prints the result.
//
// Talks to Chrome over the DevTools protocol using node's built in WebSocket, so
// there is no browser automation dependency to install. Chrome's virtual time
// flag is deliberately not used, it fires timers instantly and breaks any wait
// on real work like a pdf.js render.
//
// Usage: node tests/browser/run.mjs [url], defaulting to the dev server's port.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5173/tests/browser/';
const PORT = 9222;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(2);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'formcheck-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--window-size=1600,1200',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT}`,
    URL_UNDER_TEST,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome is not listening yet.
    }
    await sleep(100);
  }
  throw new Error('Chrome never opened a debuggable page.');
}

function cleanup(code) {
  try {
    chrome.kill();
  } catch {
    // Already gone.
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the profile briefly, it is a temp dir either way.
  }
  process.exit(code);
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
  // Surface anything the page logged, it is usually the reason for a failure.
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    console.error('[console]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.error('[page error]', msg.params.exceptionDetails.exception?.description ?? '');
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')));
});

await send('Runtime.enable');

const timeout = setTimeout(() => {
  console.error('Timed out waiting for the page to finish.');
  cleanup(1);
}, 120000);

// The module is still loading when this connects, so wait for the harness to
// publish its promise before awaiting it.
const WAIT_FOR_HARNESS = `new Promise((resolve) => {
  const tick = () =>
    window.__browserCheck ? resolve(window.__browserCheck) : setTimeout(tick, 100);
  tick();
})`;

async function runOnce() {
  const evaluated = await send('Runtime.evaluate', {
    expression: WAIT_FOR_HARNESS,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description ?? 'page threw');
  }
  return evaluated.result.value;
}

// The dev server reloads the page when a file changes, which destroys the
// context mid run. That is the harness losing a race, not a failure, so retry.
let result;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    result = await runOnce();
    break;
  } catch (err) {
    const reloaded = /context was destroyed|Inspected target navigated/i.test(err.message);
    if (!reloaded || attempt === 3) {
      clearTimeout(timeout);
      console.error('Harness failed:', err.message);
      cleanup(1);
    }
    console.error(`Page reloaded mid run, retrying (${attempt} of 3).`);
    await sleep(1500);
  }
}
clearTimeout(timeout);

for (const line of result.lines) console.log(line);
if (result.diagnostics?.length) {
  console.log('\nDiagnostics:');
  for (const line of result.diagnostics) console.log('  ' + line);
}
console.log(`\n${result.passed} passed, ${result.failed} failed`);
cleanup(result.failed === 0 ? 0 : 1);
