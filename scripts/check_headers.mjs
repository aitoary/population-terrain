import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// Local workerd only. Own the process group, bound requests/runtime, and never authenticate.
const origin = 'http://127.0.0.1:8787';
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(8787, '127.0.0.1', resolve); });
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0'], {
  detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
});
let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });
const report = { startedAt: new Date().toISOString(), scope: 'Local Workers Static Assets, not Vite or deployed headers', checks: [], cleanup: {} };
const signalGroup = (signal) => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
const alive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
const deadline = Date.now() + 120000;
const timer = setTimeout(() => signalGroup('SIGKILL'), 120000);
try {
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* Wait for local workerd startup. */ }
    await sleep(250);
  }
  assert(ready, `Local Workers startup failed: ${logs}`);
  const js = (await readdir('dist/assets')).find((name) => name.endsWith('.js'));
  const worker = (await readdir('dist/cesium/Workers')).find((name) => name.endsWith('.js'));
  const wasm = (await readdir('dist/cesium/ThirdParty')).filter((name) => name.endsWith('.wasm'));
  const cases = [['/', 'text/html', 'dist/index.html'], ['/security-spa-route', 'text/html', 'dist/index.html'], [`/assets/${js}`, 'javascript', `dist/assets/${js}`], [`/cesium/Workers/${worker}`, 'javascript', `dist/cesium/Workers/${worker}`], ...wasm.map((name) => [`/cesium/ThirdParty/${name}`, 'application/wasm', `dist/cesium/ThirdParty/${name}`]), ['/NOTICE.txt', 'text/plain', 'dist/NOTICE.txt'], ['/THIRD_PARTY_LICENSES.txt', 'text/plain', 'dist/THIRD_PARTY_LICENSES.txt']];
  for (const [url, mime, file] of cases) {
    const response = await fetch(origin + url, { headers: { Accept: url === '/security-spa-route' ? 'text/html' : '*/*' }, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, url);
    assert(response.headers.get('content-type')?.includes(mime), `${url}: MIME`);
    for (const [key, value] of Object.entries({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(),microphone=(),geolocation=()' })) assert.equal(response.headers.get(key), value, `${url}: ${key}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file), `${url}: bytes/SPA fallback`);
    report.checks.push({ url, headers: Object.fromEntries(response.headers), passed: true });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  clearTimeout(timer);
  const started = Date.now();
  signalGroup('SIGTERM');
  while (alive() && Date.now() - started < 10000) await sleep(100);
  if (alive()) signalGroup('SIGKILL');
  while (alive() && Date.now() - started < 15000) await sleep(100);
  report.cleanup = { stopped: !alive(), milliseconds: Date.now() - started };
  if (alive()) process.exitCode = 1;
  await writeFile('artifacts/security-workers-headers.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
