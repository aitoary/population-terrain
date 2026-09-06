#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, writeFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { checkInitError, checkPublicUi, checkRenderError, checkMvp, waitMvpRendered } from './browser_mvp_checks.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const RUN_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const SERVER_TIMEOUT_MS = 25_000;
const SETTLE_MS = 2_000;
const VIEWPORT = { width: 1440, height: 1000 };
const CHROME_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const STATIC_DIRECTORIES = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];
const ION_HOSTS = ['api.cesium.com', 'assets.cesium.com', 'ion.cesium.com'];
const TERRAIN_METADATA_URL = 'https://tile.plateauview.mlit.go.jp/terrain/layer.json';
const TERRAIN_FAULT = 'terrain-metadata-503';
const USAGE = `Usage: node scripts/browser_smoke.mjs <dev|preview> [--stage <base|map|cells|mvp>]

Also accepts --stage=mvp or stage=mvp. The default stage is base (historical).
For the current app use mvp. Default: normal build, public UI only.
BROWSER_ACCEPTANCE=1 selects explicit acceptance mode (preview requires npm run build:acceptance).
Only acceptance builds expose inspection hooks; never deploy dist-acceptance.
The acceptance default suite checks all 11 years.
MVP_SUITE=controls checks controls; MVP_FOCUS=all|station-coast|slope|low-population|zero checks one camera/picking view.
MVP_YEARS=2050 limits numeric checks for focus/control runs; omit it for all 11 years.
MVP_FAULT=population|terrain|buildings|border checks one initial 503 and real independent retry.
Run these as separate bounded invocations, not concurrent GPU benchmarks.
CHROME_PATH overrides /Applications/Google Chrome.app/Contents/MacOS/Google Chrome.
CESIUM_BASE_URL overrides the static URL prefix (window.CESIUM_BASE_URL or /cesium/).
CHECK_TERRAIN_FAILURE=1 is supported only with preview --stage cells. It injects
an initial terrain metadata 503, checks the fault UI, then retries real terrain.
The fault screenshot is browser-cells-preview-terrain-failure.png alongside the usual outputs.
preview uses an existing build; this script does not install dependencies or build.
Each run has a 120-second deadline, plus at most 15 seconds for cleanup.
Outputs: artifacts/browser-<stage>-<mode>.json/.png and, for cells, -cell-1..3.png.
`;

function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  const [mode, ...options] = args;
  if (!['dev', 'preview'].includes(mode)) throw new Error('Mode must be dev or preview.');
  let stage = 'base';
  let stageSpecified = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    let value;
    if (option === '--stage') value = options[++index];
    else if (option.startsWith('--stage=')) value = option.slice('--stage='.length);
    else if (option.startsWith('stage=')) value = option.slice('stage='.length);
    else throw new Error(`Unknown option: ${option}`);
    if (stageSpecified || !['base', 'map', 'cells', 'mvp'].includes(value)) {
      throw new Error('Specify stage once, using base, map, cells, or mvp.');
    }
    stage = value;
    stageSpecified = true;
  }
  return { mode, stage };
}

function redact(value) {
  return String(value).replace(
    /([?&](?:[^\s?&#=]*(?:token|key|secret|signature|credential)[^\s?&#=]*)=)[^\s&#"'<>)]*/gi,
    '$1[REDACTED]',
  );
}

function errorDetails(error) {
  return {
    name: error?.name ?? 'Error',
    message: redact(error?.message ?? error),
    stack: error?.stack ? redact(error.stack) : undefined,
  };
}

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

async function bounded(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(description)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function withinDirectory(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function main({ mode, stage }) {
  const acceptance = process.env.BROWSER_ACCEPTANCE === '1';
  if (stage === 'mvp' && !acceptance && (process.env.MVP_FAULT || process.env.MVP_FOCUS || process.env.MVP_SUITE || process.env.MVP_YEARS)) throw new Error('Detailed MVP checks require BROWSER_ACCEPTANCE=1 and an acceptance build.');
  const checkTerrainFailure = process.env.CHECK_TERRAIN_FAILURE === '1';
  if (process.env.MVP_FOCUS && !['all', 'station-coast', 'slope', 'low-population', 'zero'].includes(process.env.MVP_FOCUS)) throw new Error('Invalid MVP_FOCUS');
  if (process.env.MVP_SUITE && !['years', 'controls', 'focus'].includes(process.env.MVP_SUITE)) throw new Error('Invalid MVP_SUITE');
  if (process.env.MVP_SUITE === 'focus' && !process.env.MVP_FOCUS) throw new Error('focus suite requires MVP_FOCUS');
  if (process.env.MVP_YEARS && !process.env.MVP_YEARS.split(',').every((year) => /^20[0-9]{2}$/.test(year) && Number(year) >= 2020 && Number(year) <= 2070 && Number(year) % 5 === 0)) throw new Error('Invalid MVP_YEARS');
  const mvpFault = process.env.MVP_FAULT;
  if (mvpFault && (stage !== 'mvp' || !['population', 'terrain', 'buildings', 'border'].includes(mvpFault))) throw new Error('MVP_FAULT requires mvp and population/terrain/buildings/border');
  let injectMvpFault = Boolean(mvpFault);
  const injectedMvpRequests = new Set();
  const manifest = mvpFault ? JSON.parse(await readFile(path.join(ROOT, 'data/source-manifest.json'), 'utf8')) : null;
  if (checkTerrainFailure && (mode !== 'preview' || stage !== 'cells')) {
    throw new Error('CHECK_TERRAIN_FAILURE=1 requires preview --stage cells.');
  }
  let injectTerrainFailure = checkTerrainFailure;
  const injectedTerrainRequests = new Set();
  const started = Date.now();
  const deadline = started + RUN_TIMEOUT_MS;
  const controller = new AbortController();
  const { signal } = controller;
  const port = mode === 'dev' ? 5173 : 4173;
  const origin = `http://127.0.0.1:${port}`;
  const suffix = `${process.env.MVP_YEARS ? `-${process.env.MVP_YEARS.replaceAll(',', '-')}` : ''}${process.env.MVP_FOCUS ? `-${process.env.MVP_FOCUS}` : ''}${process.env.MVP_SUITE === 'controls' ? '-controls' : ''}`;
  const stem = `browser-security-${acceptance ? 'acceptance' : 'production'}-${stage}-${mode}${mvpFault ? `-fault-${mvpFault}` : ''}${suffix}`;
  const mvpFaultUrl = mvpFault === 'terrain' ? TERRAIN_METADATA_URL : mvpFault === 'buildings' ? manifest.sources.buildings.url : `${origin}/data/miyako-${mvpFault}.geojson`;
  const artifactDirectory = path.join(ROOT, 'artifacts');
  const jsonPath = path.join(artifactDirectory, `${stem}.json`);
  const screenshotPath = path.join(artifactDirectory, `${stem}.png`);
  const terrainFailureScreenshotPath = path.join(artifactDirectory, `${stem}-terrain-failure.png`);
  const cellPaths = Array.from({ length: 3 }, (_, index) =>
    path.join(artifactDirectory, `${stem}-cell-${index + 1}.png`));
  const executablePath = path.resolve(ROOT, process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const vitePath = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const viteArgs = [vitePath, ...(mode === 'preview' ? ['preview'] : []),
    ...(acceptance ? ['--mode', 'acceptance'] : []),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const relativePath = (filename) => path.relative(ROOT, filename);
  const elapsed = () => Date.now() - started;
  let cleaningUp = false;
  let viteProcess;
  let browserServer;
  let browserProcess;
  let browser;
  let context;
  let page;
  let ownedProfileDirectory;
  let portProbe;
  let runFinished;
  let launchPromise;
  const requestRecords = new Map();
  const blockedRequests = new Map();
  const report = {
    schemaVersion: 1,
    mode,
    stage,
    status: 'running',
    startedAt: new Date(started).toISOString(),
    url: origin,
    runTimeoutMs: RUN_TIMEOUT_MS,
    cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
    timedOut: false,
    acceptance,
    scope: !acceptance ? 'Normal build: public UI checks, no inspection hooks.' : stage === 'mvp' ? 'All 692 cells; suite/years/focus/fault selected by MVP_* environment. Inspect checks for exact coverage. Not an exhaustive 410-tile validation.' : 'Historical base/map/three-cell smoke.',
    environment: {
      platform: os.platform(),
      osRelease: os.release(),
      architecture: os.arch(),
      node: process.version,
      nodeExecutable: process.execPath,
      playwright: null,
      chromeExecutable: executablePath,
      chromeVersion: null,
      headless: true,
      chromiumSandbox: true,
      chromeArgs: CHROME_ARGS,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      settleMs: SETTLE_MS,
      rendering: 'ANGLE / SwiftShader software WebGL; not a hardware GPU benchmark.',
      proxyEnvironment: Object.fromEntries(
        ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
          'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']
          .map((name) => [name, Boolean(process.env[name])]),
      ),
    },
    server: { command: [process.execPath, ...viteArgs], stdout: '', stderr: '' },
    checks: [],
    console: [],
    pageerrors: [],
    requests: [],
    failedRequests: [],
    non200: [],
    policyViolations: [],
    staticAssets: [],
    webgl: [],
    screenshots: { main: null, cells: [] },
    failures: [],
    cleanup: {},
  };
  if (checkTerrainFailure) {
    report.terrainFailure = {
      metadataUrl: TERRAIN_METADATA_URL,
      injectedStatus: 503,
      phase: 'injecting',
      injectedRequestIds: [],
      recoveryRequestIds: [],
      populationSource: 'public/data/miyako-population.geojson',
      year: 2050,
      cellMeasurements: [],
    };
  }

  const fail = (kind, error, extra = {}) => {
    report.failures.push({ atMs: elapsed(), kind, ...errorDetails(error), ...extra });
  };
  const abort = (error) => {
    if (!signal.aborted) controller.abort(error);
  };
  const remaining = (maximum = RUN_TIMEOUT_MS) => {
    signal.throwIfAborted();
    const milliseconds = deadline - Date.now();
    if (milliseconds <= 0) {
      const error = timeoutError(`The ${mode} run exceeded its 120-second deadline.`);
      report.timedOut = true;
      abort(error);
      throw error;
    }
    return Math.min(maximum, milliseconds);
  };
  const recordRequest = (request) => {
    if (requestRecords.has(request)) return requestRecords.get(request);
    const row = {
      id: report.requests.length + 1,
      source: 'browser',
      atMs: elapsed(),
      url: redact(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
    };
    requestRecords.set(request, row);
    report.requests.push(row);
    return row;
  };
  const addNon200 = (row, status, extra = {}) => {
    if (status !== 200) {
      report.non200.push({ requestId: row.id, url: row.url, status, atMs: elapsed(), ...extra });
    }
  };

  function ownedGroupMembers(child) {
    if (!child?.pid) return [];
    if (process.platform === 'win32') {
      return child.exitCode === null && child.signalCode === null ? [{ pid: child.pid }] : [];
    }
    // kill(-pgid, 0) is a permission probe, not a reliable process listing.
    // Inspect the detached group even after its leader exits, so descendants
    // are cleaned up without mistaking stale ChildProcess exit fields for life.
    const output = execFileSync('ps', ['-axo', 'pid=,pgid=,uid='], {
      encoding: 'utf8', timeout: 1_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const members = output.trim().split('\n').filter(Boolean).map((line) => {
      const [pid, pgid, uid] = line.trim().split(/\s+/).map(Number);
      return { pid, pgid, uid };
    }).filter((entry) => entry.pgid === child.pid);
    if (members.some((entry) => entry.uid !== process.getuid())) {
      throw new Error(`Refusing to signal group ${child.pid}: it contains a different UID.`);
    }
    return members;
  }

  function processGroupAlive(child) {
    return ownedGroupMembers(child).length > 0;
  }

  // Only these detached ChildProcess handles establish ownership, never a port
  // or executable-name search. A vanished group must not receive another signal.
  function signalOwnedProcess(child, processSignal) {
    if (!processGroupAlive(child)) return;
    try {
      if (process.platform === 'win32') child.kill(processSignal);
      else process.kill(-child.pid, processSignal);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      if (error.code === 'EPERM' && !processGroupAlive(child)) return;
      throw error;
    }
  }

  async function stopOwnedProcess(child, name) {
    if (!child?.pid) return;
    const result = { pid: child.pid, membersBefore: ownedGroupMembers(child), forced: false, stopped: false };
    report.cleanup[name] = result;
    if (processGroupAlive(child)) signalOwnedProcess(child, 'SIGTERM');
    const softDeadline = Date.now() + 1_500;
    while (processGroupAlive(child) && Date.now() < softDeadline) await sleep(50);
    if (processGroupAlive(child)) {
      result.forced = true;
      signalOwnedProcess(child, 'SIGKILL');
    }
    const hardDeadline = Date.now() + 1_000;
    while (processGroupAlive(child) && Date.now() < hardDeadline) await sleep(50);
    result.stopped = !processGroupAlive(child);
    if (!result.stopped) throw new Error(`Could not terminate owned ${name} process ${child.pid}.`);
  }

  const runTimer = setTimeout(() => {
    report.timedOut = true;
    abort(timeoutError(`The ${mode} run exceeded its 120-second deadline.`));
  }, RUN_TIMEOUT_MS);
  // Final backstop also covers a stalled launch/close or filesystem operation.
  const hardTimer = setTimeout(() => {
    for (const child of [browserProcess, viteProcess]) {
      try { signalOwnedProcess(child, 'SIGKILL'); } catch { /* Continue stopping other owned processes. */ }
    }
    fail('cleanup-timeout', timeoutError('Run plus cleanup exceeded 135 seconds; forced termination.'));
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    report.durationMs = elapsed();
    try { writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`); } catch { /* Output may be unavailable. */ }
    console.error(`Browser smoke failed: deadline/cleanup timeout. Report: ${relativePath(jsonPath)}`);
    process.exit(1);
  }, RUN_TIMEOUT_MS + CLEANUP_TIMEOUT_MS);
  const onInterrupt = () => abort(new Error('Interrupted by SIGINT.'));
  const onTerminate = () => abort(new Error('Interrupted by SIGTERM.'));
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  async function assertPortAvailable() {
    remaining();
    portProbe = createServer();
    await new Promise((resolve, reject) => {
      portProbe.once('error', (error) => reject(new Error(
        `Cannot reserve ${origin}; refusing to reuse or kill an existing server: ${error.message}`,
      )));
      portProbe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        portProbe.close((error) => error ? reject(error) : resolve());
      });
    });
    portProbe = undefined;
  }

  function startVite() {
    remaining();
    const env = { ...process.env, BROWSER: 'none', NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    delete env.CLICOLOR_FORCE;
    viteProcess = spawn(process.execPath, viteArgs, {
      cwd: ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    report.server.pid = viteProcess.pid;
    for (const streamName of ['stdout', 'stderr']) {
      viteProcess[streamName].setEncoding('utf8');
      viteProcess[streamName].on('data', (chunk) => {
        report.server[streamName] = (report.server[streamName] + redact(chunk)).slice(-65_536);
      });
    }
    viteProcess.on('error', (error) => {
      report.server.error = errorDetails(error);
      if (!cleaningUp) abort(new Error(`Failed to start Vite: ${error.message}`));
    });
    viteProcess.on('exit', (code, exitSignal) => {
      report.server.exit = { code, signal: exitSignal, atMs: elapsed() };
      if (!cleaningUp) abort(new Error(`Owned Vite server exited early (code=${code}, signal=${exitSignal}).`));
    });
  }

  async function waitForVite() {
    const serverDeadline = Date.now() + Math.min(SERVER_TIMEOUT_MS, remaining());
    let attempts = 0;
    let lastResult = 'No HTTP response.';
    while (Date.now() < serverDeadline) {
      remaining();
      attempts += 1;
      try {
        const response = await fetch(origin, {
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(1_000, remaining()))]),
        });
        lastResult = `HTTP ${response.status}`;
        await response.body?.cancel();
        if (response.status === 200) {
          // Vite can style just the port, and escape sequences can span chunks.
          // Normalize the accumulated child output, retaining raw logs as evidence.
          const announced = stripVTControlCharacters(`${report.server.stdout}\n${report.server.stderr}`);
          if (announced.includes(`${origin}/`)) {
            remaining();
            if (viteProcess.exitCode !== null || viteProcess.signalCode !== null) {
              throw new Error('Owned Vite server exited during the readiness check.');
            }
            report.server.readyAtMs = elapsed();
            report.server.readinessAttempts = attempts;
            report.server.readinessEvidence = 'HTTP 200 and ANSI-normalized URL from the owned Vite child';
            return;
          }
          lastResult += '; waiting for the owned Vite process to announce this URL';
        }
      } catch (error) {
        signal.throwIfAborted();
        lastResult = redact(error.message);
      }
      await sleep(100, undefined, { signal });
    }
    report.server.startupTimedOut = true;
    report.server.readinessAttempts = attempts;
    throw timeoutError(`Owned Vite server was not ready within ${SERVER_TIMEOUT_MS / 1_000}s: ${lastResult}`);
  }

  function observeContext() {
    context.on('request', recordRequest);
    context.on('response', (response) => {
      const request = response.request();
      const row = recordRequest(request);
      const headers = response.headers();
      row.status = response.status();
      row.contentType = headers['content-type'] ?? null;
      row.responseAtMs = elapsed();
      const expected = (injectedTerrainRequests.has(request) || injectedMvpRequests.has(request)) && row.status === 503 &&
        headers['x-browser-smoke-fault'] === TERRAIN_FAULT;
      const expectation = expected ? { expected: true, reason: TERRAIN_FAULT } : {};
      Object.assign(row, expectation);
      addNon200(row, row.status, { duringCleanup: cleaningUp, ...expectation });
      if (!cleaningUp && row.status >= 400 && !expected) {
        fail('http', new Error(`HTTP ${row.status}: ${row.url}`), { requestId: row.id });
      }
      if (checkTerrainFailure && report.terrainFailure.phase === 'retrying' &&
          !injectedTerrainRequests.has(request) && request.method() === 'GET' &&
          request.url() === TERRAIN_METADATA_URL && row.status === 200) {
        report.terrainFailure.recoveryRequestIds.push(row.id);
      }
    });
    context.on('requestfinished', (request) => {
      recordRequest(request).finishedAtMs = elapsed();
    });
    context.on('requestfailed', (request) => {
      const row = recordRequest(request);
      const errorText = request.failure()?.errorText ?? 'Unknown request failure';
      const policy = blockedRequests.get(request);
      // Cesium cancels superseded tile/image fetches during camera changes. Do not
      // exempt document/script/stylesheet failures, or generic ERR_FAILED errors.
      const tileAbort = errorText === 'net::ERR_ABORTED' &&
        ['fetch', 'xhr', 'image'].includes(request.resourceType());
      const reason = cleaningUp ? 'cleanup' : policy ? 'blocked-by-smoke-policy' :
        tileAbort ? 'cancelled-data-request' : null;
      const failure = {
        requestId: row.id, url: row.url, atMs: elapsed(),
        errorText: redact(errorText), expected: reason !== null, reason,
      };
      row.failedAtMs = elapsed();
      report.failedRequests.push(failure);
      if (!failure.expected) fail('requestfailed', new Error(`${errorText}: ${row.url}`), { requestId: row.id });
    });
    context.on('page', (observedPage) => {
      observedPage.on('console', (message) => {
        const location = message.location();
        const type = message.type();
        const text = message.text();
        // Only Chrome's resource-error log for the currently injected URL is
        // expected. App exceptions, other URLs/statuses, and retry failures are not.
        const expected = type === 'error' && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) &&
          ((injectTerrainFailure && report.terrainFailure.injectedRequestIds.length > 0 && location.url === TERRAIN_METADATA_URL) ||
           (injectedMvpRequests.size > 0 && location.url === mvpFaultUrl));
        report.console.push({
          atMs: elapsed(), type, text: redact(text),
          location: { ...location, url: redact(location.url) }, duringCleanup: cleaningUp,
          ...(expected ? {
            expected: true, reason: TERRAIN_FAULT,
            relatedRequestIds: checkTerrainFailure ? [...report.terrainFailure.injectedRequestIds] : [...injectedMvpRequests].map((request) => recordRequest(request).id),
          } : {}),
        });
        // Preserve normal-mode recording semantics; the opt-in fault regression
        // additionally rejects unrelated console errors instead of masking them.
        if ((checkTerrainFailure || mvpFault) && !cleaningUp && type === 'error' && !expected) {
          fail('consoleerror', new Error(text), { url: redact(location.url) });
        }
      });
      observedPage.on('pageerror', (error) => {
        report.pageerrors.push({ atMs: elapsed(), ...errorDetails(error), duringCleanup: cleaningUp });
        if (!cleaningUp) fail('pageerror', error);
      });
      observedPage.on('crash', () => {
        if (!cleaningUp) abort(new Error('Chrome page crashed.'));
      });
    });
  }

  async function launchChrome(chromium) {
    remaining();
    // launchServer creates a fresh temporary userDataDir and exposes its owned
    // ChildProcess for bounded force-kill cleanup, unlike launchPersistentContext.
    launchPromise = chromium.launchServer({
      executablePath,
      headless: true,
      chromiumSandbox: true,
      args: CHROME_ARGS,
      host: '127.0.0.1',
      timeout: remaining(25_000),
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    }).then(async (server) => {
      browserServer = server;
      browserProcess = server.process();
      if (cleaningUp) {
        await server.kill();
        signal.throwIfAborted();
      }
      return server;
    });
    await launchPromise;
    remaining();
    const profileArgument = browserProcess.spawnargs.find((argument) => argument.startsWith('--user-data-dir='));
    const profileDirectory = profileArgument?.slice('--user-data-dir='.length);
    if (!profileDirectory || !withinDirectory(os.tmpdir(), profileDirectory)) {
      throw new Error('Chrome did not expose a dedicated profile beneath the temporary directory.');
    }
    ownedProfileDirectory = profileDirectory;
    report.environment.userDataDir = profileDirectory;
    report.environment.profileManagement = 'Playwright-created per-run temporary profile; never the default Chrome profile.';
    report.environment.chromePid = browserProcess.pid;
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: remaining(15_000) });
    remaining();
    report.environment.chromeVersion = browser.version();
    browser.on('disconnected', () => {
      if (!cleaningUp) abort(new Error('Chrome disconnected before observation completed.'));
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
    });
    remaining();
    observeContext();
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        const isIon = ION_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
        const externalInBase = stage === 'base' && ['http:', 'https:'].includes(url.protocol) && url.origin !== origin;
        if (isIon || externalInBase) {
          const reason = isIon ? 'cesium-ion-forbidden' : 'external-request-forbidden-in-base';
          const row = recordRequest(request);
          blockedRequests.set(request, reason);
          report.policyViolations.push({ requestId: row.id, url: row.url, reason, atMs: elapsed() });
          fail('request-policy', new Error(`${reason}: ${row.url}`), { requestId: row.id });
          await route.abort('blockedbyclient');
        } else if (injectMvpFault && request.method() === 'GET' && url.href === mvpFaultUrl) {
                  injectedMvpRequests.add(request);
                  recordRequest(request);
                  await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'cache-control': 'no-store', 'x-browser-smoke-fault': TERRAIN_FAULT }, body: JSON.stringify({ error: `Intentional ${mvpFault} failure` }) });
                } else if (injectTerrainFailure && request.method() === 'GET' && url.href === TERRAIN_METADATA_URL) {
          const row = recordRequest(request);
          injectedTerrainRequests.add(request);
          report.terrainFailure.injectedRequestIds.push(row.id);
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            headers: {
              'access-control-allow-origin': origin,
              'cache-control': 'no-store',
              'x-browser-smoke-fault': TERRAIN_FAULT,
            },
            body: JSON.stringify({ error: 'Intentional terrain metadata failure for browser smoke regression.' }),
          });
        } else {
          await route.continue();
        }
      } catch (error) {
        if (!cleaningUp) abort(new Error(`Request routing failed: ${error.message}`));
      }
    });
    remaining();
    page = await context.newPage();
  }

  async function checkMvpFailureAndRetry() {
      const key = mvpFault === 'population' ? 'data' : mvpFault;
      await page.locator(`[data-testid="${key}-status"][data-state="error"]`).waitFor({ timeout: remaining() });
      await page.locator('[data-testid="map-viewport"][data-viewer-ready="true"]').waitFor({ timeout: remaining() });
      const unaffected = ['data', 'buildings', 'terrain', 'border', 'population'].filter((item) => item !== key && !(['population', 'terrain'].includes(mvpFault) && item === 'population'));
      await Promise.all(unaffected.map((item) => page.locator(`[data-testid="${item}-status"][data-state="ready"]`).waitFor({ state: 'attached', timeout: remaining() })));
      await page.evaluate(() => { window.__faultViewer = window.__mvpViewer; });
      const source = JSON.parse(await readFile(path.join(ROOT, 'public/data/miyako-population.geojson'), 'utf8'));
      if (mvpFault !== 'population') {
        const zero = source.features.find((f) => f.properties.population[2070] === 0);
        await page.locator('#population-year').fill('2070');
        await page.locator('#mesh-select').selectOption(zero.id);
        if (await page.locator('[data-testid="mesh-details"]').getAttribute('data-population') !== '0') throw new Error('Fault lost real zero numeric access');
        await page.locator('#mesh-select').selectOption('594137654');
        await page.locator('#population-year').fill('2050');
        if (await page.locator('[data-testid="mesh-details"]').getAttribute('data-population') !== '377.5496') throw new Error('Fault lost station numeric access');
      } else if (!(await page.locator('[data-testid="data-status"]').innerText()).includes('人口の取得・検査失敗')) throw new Error('Missing named population error');
      const failurePath = path.join(artifactDirectory, `${stem}-before-retry.png`);
      await page.screenshot({ path: failurePath, timeout: remaining(30000) });
      const before = report.requests.length;
      const label = { population: '人口', terrain: '地形', buildings: '建物', border: '市境' }[mvpFault];
      injectMvpFault = false;
      await page.getByRole('button', { name: `${label}を再試行`, exact: true }).evaluate((button) => button.click(), undefined, { timeout: remaining() });
      await waitForStage();
      const identities = await page.evaluate(() => window.__faultViewer === window.__mvpViewer && window.__mvp.layer.source.entities.values.length === 692);
      if (!identities) throw new Error('Retry recreated viewer or lost cell geometry');
      const retryRequests = report.requests.slice(before).filter((r) => /miyako-.*geojson|data-meta\.json|layer\.json|tileset\.json/.test(r.url));
      const unrelated = retryRequests.filter((r) => mvpFault === 'population' ? !/miyako-population\.geojson|data-meta\.json/.test(r.url) : r.url !== mvpFaultUrl);
      if (unrelated.length) throw new Error(`Retry fetched unrelated fixed resources: ${JSON.stringify(unrelated)}`);
      if (!retryRequests.some((r) => r.url === mvpFaultUrl && r.status === 200)) throw new Error('No real HTTP 200 recovery');
      report.mvpFault = { target: mvpFault, unaffectedReady: unaffected, numericAccess: mvpFault !== 'population', failureScreenshot: relativePath(failurePath), injectedRequests: injectedMvpRequests.size, retryRequests, viewerRetained: true, cellsAfterRetry: 692 };
      report.checks.push({ name: `independent-${mvpFault}-failure-named-error-real-retry`, passed: true });
    }

    async function waitForStage() {
    const viewport = page.locator('[data-testid="map-viewport"][data-viewer-ready="true"]');
    await viewport.waitFor({ state: 'visible', timeout: remaining() });
    await viewport.locator('canvas').waitFor({ state: 'visible', timeout: remaining() });
    const canvasCount = await viewport.locator('canvas').count();
    if (canvasCount !== 1) throw new Error(`Expected one map canvas, found ${canvasCount}.`);
    report.checks.push({ name: 'viewer-ready-and-one-canvas', passed: true, atMs: elapsed() });
    const statuses = stage === 'base' ? [] : ['buildings-status', 'terrain-status'];
    if (stage === 'cells' || stage === 'mvp') statuses.push('population-status');
        if (stage === 'mvp') statuses.push('border-status', 'data-status');
    await Promise.all(statuses.map(async (testId) => {
      await page.locator(`[data-testid="${testId}"][data-state="ready"]`)
        .waitFor({ state: 'attached', timeout: remaining() });
      report.checks.push({ name: testId, passed: true, atMs: elapsed() });
    }));
    if (stage === 'cells') {
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sample-cell"]').length === 3,
        undefined, { timeout: remaining() });
      report.checks.push({ name: 'three-sample-cells', passed: true, atMs: elapsed() });
    }
  }

  async function checkTerrainFailureAndRetry() {
    await page.locator('[data-testid="map-viewport"][data-viewer-ready="true"]')
      .waitFor({ state: 'visible', timeout: remaining() });
    await Promise.all([
      ...['terrain-status', 'population-status'].map((testId) =>
        page.locator(`[data-testid="${testId}"][data-state="error"]`)
          .waitFor({ state: 'attached', timeout: remaining() })),
      page.locator('[data-testid="buildings-status"][data-state="ready"]')
        .waitFor({ state: 'attached', timeout: remaining() }),
      page.waitForFunction(() => document.querySelectorAll('[data-testid="sample-cell"]').length === 3,
        undefined, { timeout: remaining() }),
    ]);
    if (!report.non200.some((response) => response.expected === true && response.reason === TERRAIN_FAULT)) {
      throw new Error('Terrain fault UI appeared without an observed, injected metadata 503.');
    }
    await sleep(SETTLE_MS, undefined, { signal });
    const cells = page.locator('[data-testid="sample-cell"]');
    for (let index = 0; index < 3; index += 1) {
      await cells.nth(index).waitFor({ state: 'visible', timeout: remaining() });
    }
    const measurements = await cells.evaluateAll((elements) => elements.map((element) => {
      const number = (name) => {
        const raw = element.getAttribute(name);
        return raw === null || raw.trim() === '' ? null : Number(raw);
      };
      const buttons = element.querySelectorAll('[data-testid="cell-focus"]');
      return {
        meshId: element.getAttribute('data-mesh-id'),
        population: number('data-population'),
        length: number('data-length'),
        baseHeight: element.getAttribute('data-base-height'),
        focusButtonCount: buttons.length,
        focusDisabled: buttons.length === 1 && buttons[0] instanceof HTMLButtonElement && buttons[0].disabled,
        displayed: Object.fromEntries(Array.from(element.querySelectorAll('dl > div'), (row) => [
          row.querySelector('dt')?.textContent?.trim(), row.querySelector('dd')?.innerText?.trim(),
        ])),
      };
    }));
    report.terrainFailure.cellMeasurements = measurements;
    const populationFile = JSON.parse(await readFile(path.join(ROOT, 'public/data/miyako-population.geojson'), 'utf8'));
    const populationFormatter = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (measurements.length !== 3 || new Set(measurements.map((cell) => cell.meshId)).size !== 3) {
      throw new Error('Terrain fault UI must retain three distinct real sample cells.');
    }
    for (const measurement of measurements) {
      const real = populationFile.features.find((feature) => feature.id === measurement.meshId);
      const population = real?.properties.population['2050'];
      if (!Number.isFinite(population) || !Number.isFinite(measurement.population) ||
          !Number.isFinite(measurement.length) || measurement.population !== population ||
          Math.abs(measurement.length - population * 0.5) > 1e-10 ||
          measurement.baseHeight !== null || measurement.focusButtonCount !== 1 || !measurement.focusDisabled) {
        throw new Error(`Invalid terrain-fault population/L or unavailable B/focus: ${JSON.stringify(measurement)}`);
      }
      const populationText = population === 0 ? '0人' : population < 0.1 ? '0.1人未満' : `${populationFormatter.format(population)}人`;
      if (measurement.displayed['2050 推計人口'] !== populationText ||
          measurement.displayed['人口の柱長 L'] !== `${(population * 0.5).toFixed(4)} m`) {
        throw new Error(`Terrain fault UI does not display the real 2050 population and L: ${JSON.stringify(measurement)}`);
      }
    }
    const states = Object.fromEntries(await Promise.all(
      ['terrain-status', 'population-status', 'buildings-status'].map(async (testId) =>
        [testId, await page.getByTestId(testId).getAttribute('data-state', { timeout: remaining() })]),
    ));
    report.terrainFailure.states = states;
    if (states['terrain-status'] !== 'error' || states['population-status'] !== 'error' || states['buildings-status'] !== 'ready') {
      throw new Error(`Terrain fault states changed before capture: ${JSON.stringify(states)}`);
    }
    report.checks.push({ name: 'terrain-failure-retains-real-population-and-L-without-B-or-focus', passed: true, atMs: elapsed() });
    await page.screenshot({ path: terrainFailureScreenshotPath, fullPage: false, animations: 'disabled', timeout: remaining(8_000) });
    report.screenshots.terrainFailure = relativePath(terrainFailureScreenshotPath);
    report.terrainFailure.faultVerifiedAtMs = elapsed();

    const retry = page.getByTestId('terrain-status').getByRole('button', { name: '地形を再試行', exact: true });
    await retry.waitFor({ state: 'visible', timeout: remaining() });
    // Keep the existing route; only this flag changes, so buildings/population
    // remain real and the retry cannot accidentally inherit another mock route.
    injectTerrainFailure = false;
    report.terrainFailure.phase = 'retrying';
    report.terrainFailure.retryAtMs = elapsed();
    await retry.click({ timeout: remaining() });
  }

  async function recordWebGL(label) {
    remaining();
    const measurement = await page.locator('[data-testid="map-viewport"] canvas').evaluate((canvas) => {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const bounds = canvas.getBoundingClientRect();
      if (!gl) return { available: false, width: canvas.width, height: canvas.height };
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        available: true,
        contextLost: gl.isContextLost(),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        contextAttributes: gl.getContextAttributes(),
        drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
        bounds: { width: bounds.width, height: bounds.height },
      };
    }, undefined, { timeout: remaining() });
    report.webgl.push({ label, atMs: elapsed(), ...measurement });
    if (!measurement.available || measurement.contextLost ||
        !measurement.drawingBuffer?.width || !measurement.drawingBuffer?.height ||
        !measurement.bounds?.width || !measurement.bounds?.height) {
      throw new Error(`No usable, non-lost WebGL canvas at ${label}.`);
    }
  }

  async function chooseStaticFile(directory) {
    remaining();
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isFile() && /\.(?:js|json|css|wasm|png|jpg|jpeg|svg|gif|ktx2?|webp)$/i.test(entry.name)) {
        const filename = path.join(directory, entry.name);
        if ((await stat(filename)).size > 0) return filename;
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await chooseStaticFile(path.join(directory, entry.name));
        if (found) return found;
      }
    }
    return null;
  }

  async function checkStaticAssets() {
    let sourceRoot;
    for (const build of ['Cesium', 'CesiumUnminified']) {
      const candidate = path.join(ROOT, 'node_modules/cesium/Build', build);
      try {
        await Promise.all(STATIC_DIRECTORIES.map((directory) => access(path.join(candidate, directory), constants.R_OK)));
        sourceRoot = candidate;
        break;
      } catch { /* Try the other installed distribution, not an invented filename. */ }
    }
    if (!sourceRoot) throw new Error('No installed Cesium build contains Workers/Assets/ThirdParty/Widgets.');
    const windowBase = await page.evaluate(() =>
      typeof globalThis.CESIUM_BASE_URL === 'string' ? globalThis.CESIUM_BASE_URL : null);
    const configuredBase = process.env.CESIUM_BASE_URL || windowBase || '/cesium/';
    const staticBase = new URL(configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`, origin);
    if (staticBase.origin !== origin || staticBase.search || staticBase.hash) {
      throw new Error('CESIUM_BASE_URL must identify a local static directory without a query or fragment.');
    }
    report.environment.cesiumStaticBaseUrl = staticBase.href;
    report.environment.cesiumStaticSource = relativePath(sourceRoot);
    for (const directory of STATIC_DIRECTORIES) {
      remaining();
      const filename = await chooseStaticFile(path.join(sourceRoot, directory));
      if (!filename) throw new Error(`No real static asset found in ${directory}.`);
      const relative = path.relative(sourceRoot, filename).split(path.sep).map(encodeURIComponent).join('/');
      const url = new URL(relative, staticBase).href;
      const expected = await readFile(filename);
      const row = {
        id: report.requests.length + 1, source: 'static-probe', atMs: elapsed(),
        url: redact(url), method: 'GET', resourceType: 'static-asset',
      };
      report.requests.push(row);
      const check = { directory, source: relativePath(filename), url: redact(url), passed: false };
      report.staticAssets.push(check);
      try {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(remaining(10_000))]),
        });
        row.status = response.status;
        row.contentType = response.headers.get('content-type');
        row.responseAtMs = elapsed();
        addNon200(row, response.status);
        const actual = Buffer.from(await response.arrayBuffer());
        row.finishedAtMs = elapsed();
        const htmlFallback = /\btext\/html\b/i.test(row.contentType ?? '') ||
          /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(actual.subarray(0, 512).toString('utf8'));
        const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
        Object.assign(check, {
          status: response.status,
          contentType: row.contentType,
          htmlFallback,
          expectedBytes: expected.length,
          actualBytes: actual.length,
          expectedSha256: hash(expected),
          actualSha256: hash(actual),
          passed: response.status === 200 && !htmlFallback && expected.equals(actual),
        });
        if (!check.passed) fail('static-asset', new Error(`Static asset is not an exact HTTP 200 copy (HTML fallback=${htmlFallback}): ${url}`));
      } catch (error) {
        row.failedAtMs = elapsed();
        check.error = errorDetails(error);
        report.failedRequests.push({
          requestId: row.id, url: row.url, atMs: elapsed(),
          errorText: redact(error.message), expected: false, reason: null,
        });
        fail('static-asset', error, { requestId: row.id });
        signal.throwIfAborted();
      }
    }
  }

  async function run() {
    await mkdir(artifactDirectory, { recursive: true });
    remaining();
    // Do not leave an old successful screenshot beside a failed current report.
    await Promise.all([screenshotPath, ...(stage === 'cells' ? cellPaths : []),
      ...(checkTerrainFailure ? [terrainFailureScreenshotPath] : [])]
      .map((filename) => rm(filename, { force: true })));
    await access(executablePath, constants.X_OK);
    await access(vitePath, constants.R_OK);
    const { chromium } = await import('@playwright/test');
    report.environment.playwright = require('@playwright/test/package.json').version;
    await assertPortAvailable();
    startVite();
    await waitForVite();
    await launchChrome(chromium);
    remaining();
    await page.goto(stage === 'mvp' ? `${origin}/?acceptance=1` : origin, { waitUntil: 'domcontentloaded', timeout: remaining(30_000) });
    if (mvpFault) await checkMvpFailureAndRetry();
    if (checkTerrainFailure) await checkTerrainFailureAndRetry();
    await waitForStage();
    if (checkTerrainFailure) {
      if (report.terrainFailure.recoveryRequestIds.length === 0) {
        throw new Error('Terrain retry reached ready without an observed real metadata HTTP 200.');
      }
      report.terrainFailure.phase = 'recovered';
      report.terrainFailure.recoveredAtMs = elapsed();
      report.checks.push({ name: 'terrain-retry-real-metadata-and-ready-layers', passed: true, atMs: elapsed() });
    }
    report.environment.page = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: devicePixelRatio,
      innerWidth: innerWidth,
      innerHeight: innerHeight,
    }));
    await sleep(SETTLE_MS, undefined, { signal });
    if (stage === 'mvp' && acceptance) {
      report.visibility = await page.evaluate(() => ({
        sources: Array.from({ length: window.__mvp.viewer.dataSources.length }, (_, i) => {
          const source = window.__mvp.viewer.dataSources.get(i);
          return { name: source.name, show: source.show, total: source.entities.values.length, visible: source.entities.values.filter((entity) => entity.show).length };
        }),
        rectangle: window.__mvp.viewer.camera.computeViewRectangle(),
        primitives: window.__mvp.viewer.scene.primitives.length,
      }));
      console.log('MVP visibility', JSON.stringify(report.visibility));
      await waitMvpRendered(page, remaining);
    }
    await recordWebGL('initial-ready');
    await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', timeout: remaining(30_000) });
    report.screenshots.main = relativePath(screenshotPath);
    await checkStaticAssets();
    if (stage === 'mvp' && !mvpFault) {
      if (acceptance) {
        await checkMvp({ page, report, root: ROOT, artifactDirectory, remaining, requests: report.requests });
        await checkRenderError(page, report, remaining);
      } else {
        await checkPublicUi({ page, report, root: ROOT, remaining });
        await checkInitError(page, report, remaining);
      }
    }
    if (stage === 'cells') {
      const cells = page.locator('[data-testid="sample-cell"]');
      const measurements = await cells.evaluateAll((elements) => elements.map((element) => ({
        meshId: element.dataset.meshId,
        population: Number(element.dataset.population),
        baseHeight: Number(element.dataset.baseHeight),
        length: Number(element.dataset.length),
        minHeight: Number(element.dataset.sampleMin),
        maxHeight: Number(element.dataset.sampleMax),
      })));
      const populationFile = JSON.parse(await readFile(path.join(ROOT, 'public/data/miyako-population.geojson'), 'utf8'));
      for (const measurement of measurements) {
        const real = populationFile.features.find((feature) => feature.id === measurement.meshId);
        if (!real || !Object.values(measurement).filter((value) => typeof value !== 'string').every(Number.isFinite) ||
            measurement.population !== real.properties.population['2050'] ||
            Math.abs(measurement.length - measurement.population * 0.5) > 1e-10 ||
            Math.abs(measurement.baseHeight - measurement.maxHeight - 2) > 1e-10 ||
            measurement.minHeight > measurement.maxHeight) {
          throw new Error(`Invalid real-cell B/L measurement: ${JSON.stringify(measurement)}`);
        }
      }
      report.cellMeasurements = measurements;
      if (checkTerrainFailure) {
        const before = report.terrainFailure.cellMeasurements;
        if (measurements.length !== before.length || new Set(measurements.map((cell) => cell.meshId)).size !== 3 ||
            measurements.some((cell) => !before.some((faultCell) => faultCell.meshId === cell.meshId &&
              faultCell.population === cell.population && faultCell.length === cell.length))) {
          throw new Error('Terrain retry changed the original three population/L measurements.');
        }
      }
      report.checks.push({ name: 'real-population-and-terrain-B-plus-L', passed: true, atMs: elapsed() });
      for (let index = 0; index < 3; index += 1) {
        remaining();
        const cell = cells.nth(index);
        const label = redact((await cell.innerText({ timeout: remaining() })).slice(0, 500));
        await cell.locator('[data-testid="cell-focus"]').click({ timeout: remaining() });
        await sleep(SETTLE_MS, undefined, { signal });
        await recordWebGL(`cell-${index + 1}`);
        await page.screenshot({ path: cellPaths[index], fullPage: false, animations: 'disabled', timeout: remaining(8_000) });
        report.screenshots.cells.push({ index: index + 1, label, path: relativePath(cellPaths[index]), atMs: elapsed() });
      }
    }
    remaining();
  }

  async function cleanupBrowser() {
    if (!browserServer && launchPromise) {
      try { await bounded(launchPromise, 1_500, 'Chrome launch did not settle during cleanup.'); }
      catch (error) { if (error.name === 'TimeoutError') fail('cleanup', error); }
    }
    try {
      if (browserServer) {
        try { await bounded(browserServer.close(), 8_000, 'Graceful Chrome close timed out.'); }
        catch (error) {
          fail('cleanup', error);
          await bounded(browserServer.kill(), 1_500, 'Forced Chrome close timed out.');
        }
      }
    } finally {
      await stopOwnedProcess(browserProcess, 'chrome');
      if (browser?.isConnected()) await bounded(browser.close(), 1_000, 'Playwright disconnect timed out.');
      if (ownedProfileDirectory && !processGroupAlive(browserProcess)) {
        await bounded(rm(ownedProfileDirectory, { recursive: true, force: true }), 1_500, 'Temporary profile removal timed out.');
        report.cleanup.profileRemoved = true;
      }
    }
  }

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ]);
  } catch (error) {
    fail('run', error);
  } finally {
    runFinished = Date.now();
    clearTimeout(runTimer);
    report.runDurationMs = runFinished - started;
    report.observationFinishedAt = new Date(runFinished).toISOString();
    report.pendingAtObservationEnd = report.requests
      .filter((request) => request.finishedAtMs === undefined && request.failedAtMs === undefined)
      .map((request) => request.id);
    cleaningUp = true;
    abort(new Error('Observation complete; shutting down owned resources.'));
    const cleanupTimer = setTimeout(() => {
      for (const child of [browserProcess, viteProcess]) {
        try { signalOwnedProcess(child, 'SIGKILL'); } catch { /* The hard deadline will report failure. */ }
      }
      fail('cleanup-timeout', timeoutError('Cleanup exceeded its 15-second deadline.'));
      report.status = 'failed';
      report.finishedAt = new Date().toISOString();
      report.durationMs = elapsed();
      try { writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`); } catch { /* Best effort on forced exit. */ }
      process.exit(1);
    }, CLEANUP_TIMEOUT_MS);
    try {
      if (!report.screenshots.main && page && !page.isClosed()) {
        try {
          await bounded(page.screenshot({ path: screenshotPath, fullPage: false, timeout: 2_000 }),
            2_500, 'Failure screenshot timed out.');
          report.screenshots.main = relativePath(screenshotPath);
          report.screenshots.failureCapture = true;
        } catch (error) { report.screenshots.failureCaptureError = errorDetails(error); }
      }
      if (portProbe?.listening) portProbe.close();
      const results = await Promise.allSettled([
        cleanupBrowser(),
        stopOwnedProcess(viteProcess, 'vite'),
      ]);
      for (const result of results) if (result.status === 'rejected') fail('cleanup', result.reason);
      report.cleanup.durationMs = Date.now() - runFinished;
      report.status = report.failures.length === 0 ? 'passed' : 'failed';
      report.finishedAt = new Date().toISOString();
      report.durationMs = elapsed();
      report.requestSummary = {
        total: report.requests.length,
        failed: report.failedRequests.length,
        unexpectedFailed: report.failedRequests.filter((request) => !request.expected).length,
        non200: report.non200.length,
        pendingAtObservationEnd: report.pendingAtObservationEnd.length,
      };
      await mkdir(artifactDirectory, { recursive: true });
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    } finally {
      clearTimeout(cleanupTimer);
      clearTimeout(hardTimer);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  }
  console.log(`Browser smoke ${report.status}: stage=${stage}, mode=${mode}, ${report.runDurationMs}ms + cleanup ${report.cleanup.durationMs}ms`);
  console.log(`Report: ${relativePath(jsonPath)}`);
  if (report.screenshots.main) console.log(`Screenshot: ${report.screenshots.main}`);
  for (const failure of report.failures) console.error(`[${failure.kind}] ${failure.message}`);
  return report.status === 'passed' ? 0 : 1;
}

let exitCode = 1;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options === null) {
    console.log(USAGE);
    exitCode = 0;
  } else {
    exitCode = await main(options);
  }
} catch (error) {
  console.error(redact(error?.stack ?? error));
  if (error?.message?.includes('Mode must') || error?.message?.includes('option:') ||
      error?.message?.includes('Specify stage')) console.error(USAGE);
}
// Explicit exit bounds any remaining Playwright transport handles after cleanup.
process.exit(exitCode);
