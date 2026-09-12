import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkPublicUi({ page, report, root, remaining }) {
  const ensure = (ok, message) => { if (!ok) throw new Error(message); };
  ensure(await page.evaluate(() => !('__mvp' in window) && !('__mvpViewer' in window)), 'Production exposes acceptance hooks with ?acceptance=1');
  const source = JSON.parse(await readFile(path.join(root, 'public/data/miyako-population.geojson'), 'utf8'));
  ensure(await page.getByTestId('population-status').getAttribute('data-state') === 'ready', 'Real map population not ready');
  ensure(await page.locator('#population-year').inputValue() === '2050', 'Initial year');
  await page.locator('.mesh-more > summary').click({ timeout: remaining() });
  const results = [];
  for (const year of [2020, 2070]) {
    await page.locator('#population-year').fill(String(year), { timeout: remaining() });
    for (const id of ['594137654', '594115541']) {
      await page.locator('#mesh-select').selectOption(id, { timeout: remaining() });
      const value = source.features.find((f) => f.id === id).properties.population[year];
      const formatted = value === 0 ? '0人' : value < 0.1 ? '0.1人未満' : `${new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}人`;
      const row = page.getByTestId('mesh-details').locator('dl > div').filter({ has: page.getByText(`${year}年 人口`, { exact: true }) });
      await row.getByText(formatted, { exact: true }).waitFor({ timeout: remaining() });
      results.push({ year, id, population: value });
    }
  }
  await page.getByRole('button', { name: '選択メッシュへ', exact: true }).click({ timeout: remaining() });
  await page.waitForTimeout(1500);
  ensure(await page.evaluate(() => !('__mvp' in window) && !('__mvpViewer' in window)), 'Production hooks appeared after interaction');
  const excluded = JSON.parse(await readFile(path.join(root, 'scripts/cesium-excluded-assets.json'), 'utf8'));
    const excludedRequests = report.requests.filter(({ url }) => excluded.some((file) => new URL(url).pathname === `/cesium/${file}`));
    ensure(excludedRequests.length === 0, 'App requested an excluded Cesium image');
    ensure(!report.console.some(({ type }) => type === 'error') && report.pageerrors.length === 0, 'Errors during production map interaction');
    ensure(await page.getByRole('alert').count() === 0, 'Map displays an error alert');
    report.checks.push({ name: '31-excluded-images-not-requested-no-console-page-or-ui-errors', passed: true });
    report.publicUi = results;
  report.checks.push({ name: 'production-query-cannot-enable-hooks-real-map-year-and-mesh-selection', passed: true });
}

export async function checkInitError(page, report, remaining) {
  const message = '<img src=x onerror="window.__securityExecuted=1">';
  await page.addInitScript((message) => {
    HTMLCanvasElement.prototype.getContext = () => { throw new Error(message); };
  }, message);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: remaining() });
  const alert = page.getByRole('alert').filter({ hasText: 'Viewerの初期化失敗:' });
  await alert.waitFor({ timeout: remaining() });
  if (!(await alert.textContent()).includes(message) || !(await alert.innerHTML()).includes('&lt;img') || await alert.locator('img').count() || await page.locator('.cesium-widget-errorPanel').count() || await page.evaluate(() => window.__securityExecuted || '__mvp' in window || '__mvpViewer' in window)) throw new Error('Production initialization error did not remain safe text');
  report.checks.push({ name: 'production-real-initialization-failure-escaped-no-panel-no-hooks', passed: true });
}

export async function checkRenderError(page, report, remaining) {
  const message = '<img src=x onerror="window.__securityExecuted=1"><svg onload="window.__securityExecuted=1">';
  await page.evaluate((message) => {
    const viewer = window.__mvpViewer;
    if (viewer.cesiumWidget._showRenderLoopErrors !== false) throw new Error('Unsafe Cesium panel enabled');
    viewer.scene.renderError.raiseEvent(viewer.scene, new Error(message));
  }, message);
  const alert = page.getByRole('alert').filter({ hasText: '描画エラー:' });
  await alert.waitFor({ timeout: remaining() });
  if (!(await alert.textContent()).includes(message) || await alert.locator('img,svg').count() || await page.locator('.cesium-widget-errorPanel').count() || await page.evaluate(() => window.__securityExecuted)) throw new Error('Render error was not retained as harmless text');
  if (!(await alert.innerHTML()).includes('&lt;img')) throw new Error('Error markup was not escaped');
  report.checks.push({ name: 'real-scene-renderError-malicious-markup-escaped-no-panel-no-execution', passed: true });
}

export async function waitMvpRendered(page, remaining) {
  // First submit the new camera/property state: pre-frame tilesLoaded can describe the OLD view.
  await page.evaluate(() => new Promise((resolve) => {
    delete window.__mvpStableSince;
    const scene = window.__mvp.viewer.scene;
    const remove = scene.postRender.addEventListener(() => { remove(); resolve(); });
    scene.requestRender();
  }));
  await page.waitForFunction(() => {
    const viewer = window.__mvp.viewer;
    if (!viewer.dataSourceDisplay.ready || !viewer.scene.globe.tilesLoaded) {
      delete window.__mvpStableSince;
      viewer.scene.requestRender();
      return false;
    }
    window.__mvpStableSince ??= performance.now();
    return performance.now() - window.__mvpStableSince >= 1000;
  }, undefined, { polling: 200, timeout: remaining() });
}

export async function checkMvp({ page, report, root, artifactDirectory, remaining, requests }) {
  const suite = process.env.MVP_SUITE ?? (process.env.MVP_FOCUS ? 'focus' : 'years');
  const source = JSON.parse(await readFile(path.join(root, 'public/data/miyako-population.geojson'), 'utf8'));
  const years = process.env.MVP_YEARS ? process.env.MVP_YEARS.split(',').map(Number) : Array.from({ length: 11 }, (_, i) => 2020 + i * 5);
  if (years.some((year) => year < 2020 || year > 2070 || year % 5 !== 0)) throw new Error('MVP_YEARS must contain supported years');
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  ensure(await page.locator('#mesh-select').inputValue() === '594137654', 'Initial station selection');
  ensure(await page.locator('#population-year').inputValue() === '2050', 'Initial year');
  ensure(await page.getByTestId('totals').count() === 0, 'Global totals should not be displayed');
  report.mvp = { years: [], screenshots: [], geometryCount: 0 };
  await page.evaluate(() => {
    const { viewer, layer, bases } = window.__mvp;
    const building = Array.from({ length: viewer.scene.primitives.length }, (_, i) => viewer.scene.primitives.get(i)).find((p) => p.tileVisible);
    window.__acceptanceOriginal = { viewer, layer, bases, provider: viewer.terrainProvider, building, modelMatrix: Array.from(building.modelMatrix), camera: Array.from(viewer.camera.viewMatrix), entities: [...layer.source.entities.values], heights: layer.source.entities.values.map((e) => e.polygon.height), longTasks: [], gaps: [], lastTick: performance.now() };
    const original = window.__acceptanceOriginal;
    original.timer = setInterval(() => { const now = performance.now(); original.gaps.push(now - original.lastTick); original.lastTick = now; }, 20);
    original.observer = new PerformanceObserver((list) => original.longTasks.push(...list.getEntries().map((e) => e.duration)));
    original.observer.observe({ type: 'longtask', buffered: false });
  });
  const requestStart = requests.length;
  for (const year of years) {
    const started = performance.now();
    await page.locator('#population-year').fill(String(year), { timeout: remaining() });
    await page.waitForFunction((year) => window.__mvp.layer.source.entities.values.every((e) => e.properties.year.getValue() === year) && document.querySelector('[data-testid="mesh-details"]').dataset.year === String(year), year, { timeout: remaining() });
    await waitMvpRendered(page, remaining);
    const snapshot = await page.evaluate(() => {
      const { viewer, layer, bases } = window.__mvp;
      const previous = window.__acceptanceOriginal;
      return {
        stable: viewer === previous.viewer && layer === previous.layer && bases === previous.bases && viewer.terrainProvider === previous.provider && viewer.scene.primitives.contains(previous.building) && Array.from(previous.building.modelMatrix).every((n, i) => n === previous.modelMatrix[i]) && Array.from(viewer.camera.viewMatrix).every((n, i) => n === previous.camera[i]),
        cells: layer.rows.map((row, i) => {
          const e = layer.source.entities.getById(`mesh:${row.feature.id}`);
          const p = e.polygon;
          const c = p.material.getValue().color;
          return { id: row.feature.id, population: e.properties.population.getValue(), year: e.properties.year.getValue(), base: p.height.getValue(), length: p.extrudedHeight.getValue() - p.height.getValue(), color: [c.red, c.green, c.blue, c.alpha], stable: e === previous.entities[i] && p.height === previous.heights[i], terrain: bases.get(row.feature.id), corners: p.hierarchy.getValue().positions.length };
        }),
      };
    });
    ensure(snapshot.stable, `Year ${year} recreated viewer/layer/bases/provider/building or changed camera/building transform`);
    ensure(snapshot.cells.length === 692, 'All 692 cell geometries required');
    for (const [i, cell] of snapshot.cells.entries()) {
      const feature = source.features[i];
      const value = feature.properties.population[year];
      const baseline = feature.properties.population[2020];
      ensure(cell.id === feature.id && cell.population === value && cell.year === year && cell.stable && cell.corners === 4, `Geometry/numeric identity ${cell.id}/${year}`);
      ensure(Math.abs(cell.length - value * 0.5) < 1e-9 && cell.terrain.status === 'ready' && Math.abs(cell.base - cell.terrain.maxHeight - 2) < 1e-9, `B/L ${cell.id}/${year}`);
      const rate = baseline === 0 || baseline === null || value === null ? null : (value - baseline) / baseline * 100;
      const hex = rate === null ? '64748b' : rate <= -75 ? 'b91c1c' : rate <= -50 ? 'ea580c' : rate <= -25 ? 'fdba74' : rate < 0 ? 'facc15' : rate === 0 ? '9ca3af' : '0d9488';
      const rgb = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
      ensure(rgb.every((n, i) => Math.abs(n - cell.color[i]) < 1e-10), `Color ${cell.id}/${year}`);
    }
    const station = source.features.find((f) => f.id === '594137654');
    ensure(Number(await page.locator('[data-testid="mesh-details"]').getAttribute('data-population')) === station.properties.population[year], `Details ${year}`);
    report.mvp.years.push({ year, cells: snapshot.cells.length, inputToGeometryReadyMs: performance.now() - started });
    report.mvp.performance = await page.evaluate(() => ({ maxTimerGapMs: Math.max(...window.__acceptanceOriginal.gaps), maxLongTaskMs: Math.max(0, ...window.__acceptanceOriginal.longTasks) }));
    report.mvp.geometryCount = snapshot.cells.length;
    if (year === 2070) report.mvp.terrainBases = snapshot.cells.map(({ id, base, terrain }) => ({ id, base, min: terrain.minHeight, max: terrain.maxHeight }));
  }
  report.mvp.performance = await page.evaluate(() => {
    const p = window.__acceptanceOriginal; clearInterval(p.timer); p.observer.disconnect();
    return { maxTimerGapMs: Math.max(...p.gaps), maxLongTaskMs: Math.max(0, ...p.longTasks), longTasks: p.longTasks };
  });
  report.mvp.yearRequests = requests.slice(requestStart).map(({ url, status }) => ({ url, status }));
  const forbidden = report.mvp.yearRequests.filter(({ url }) => /\.zip(?:\?|$)|\/data\/.*(?:geojson|data-meta\.json)|tileset\.json|\.b3dm|\/terrain\/(?:layer\.json|12\/)/.test(url));
  ensure(forbidden.length === 0, `Year changes requested fixed data: ${JSON.stringify(forbidden)}`);
  report.checks.push({ name: '692-cells-requested-years-numeric-color-length-identity-camera-no-refetch', years, passed: true });
  report.mvp.performance.provisionalUiTargetMet = report.mvp.performance.maxTimerGapMs < 1000 && report.mvp.performance.maxLongTaskMs < 1000;
  ensure(report.mvp.performance.provisionalUiTargetMet, 'Provisional UI stall threshold exceeded (see performance metrics)');
  if (suite === 'years') return;
  await page.locator('.mesh-more > summary').click({ timeout: remaining() });
  const zero = source.features.find((f) => f.properties.population[2070] === 0);
  if (!process.env.MVP_FOCUS) {
    await page.locator('#population-year').fill('2070');
    // Native range keyboard behavior; no annual interpolation.
    await page.locator('#population-year').focus(); await page.keyboard.press('ArrowLeft');
    ensure(await page.locator('#population-year').inputValue() === '2065', 'Keyboard five-year step');
    await page.keyboard.press('ArrowRight');
    await page.locator('#mesh-select').selectOption(zero.id);
    ensure(await page.locator('[data-testid="mesh-details"]').getAttribute('data-population') === '0', 'Real zero selection details');
    ensure(await page.locator('.mesh-summary .current-population').innerText() === '0人', 'Real zero label');
    report.mvp.zeroMeshId = zero.id;
    await page.locator('.display-settings > summary').click({ timeout: remaining() });
    await page.locator('#population-opacity').fill('0.8');
    const positiveAlpha = await page.evaluate(() => window.__mvp.layer.source.entities.values.find((e) => e.properties.population.getValue() > 0).polygon.material.getValue().color.alpha);
    ensure(positiveAlpha === 0.8, 'Opacity update');
    await page.locator('#population-opacity').fill('0.25');
    for (const [label, kind] of [['人口', 'population'], ['建物（2025年度 LOD1）', 'buildings'], ['市境', 'border']]) {
      const checkbox = page.getByRole('checkbox', { name: label, exact: true });
      await checkbox.evaluate((input) => { if (input.checked) input.click(); });
      const hidden = await page.evaluate((kind) => {
        const { viewer, layer } = window.__mvp;
        if (kind === 'population') return !layer.source.show;
        if (kind === 'buildings') return !window.__acceptanceOriginal.building.show;
        return !viewer.dataSources.getByName('border')[0].show;
      }, kind);
      ensure(hidden, `${kind} hidden`); await checkbox.evaluate((input) => { if (!input.checked) input.click(); });
    }
    report.checks.push({ name: 'zero-selection-keyboard-opacity-three-layer-toggles', passed: true });
  }
  if (suite === 'controls') return;
  const take = async (name) => {
    await waitMvpRendered(page, remaining);
    const filename = path.join(artifactDirectory, `browser-security-acceptance-mvp-${report.mode}-${name}.png`);
    await page.screenshot({ path: filename, timeout: remaining(30000) });
    report.mvp.screenshots.push(path.relative(root, filename));
  };
  if (!process.env.MVP_FOCUS || process.env.MVP_FOCUS === 'all') {
    await page.getByRole('button', { name: '対象メッシュ全体', exact: true }).evaluate((button) => button.click());
    await page.waitForTimeout(1200); await take('all');
    report.checks.push({ name: 'all-meshes-camera', passed: true });
    if (process.env.MVP_FOCUS === 'all') {
      const shown = await page.evaluate(() => window.__mvp.layer.source.entities.values.filter((e) => e.show).length);
      ensure(shown === 692, 'All-city view must restore all 692 geometries');
      const before = await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix));
      await page.mouse.move(600, 600); await page.mouse.wheel(0, -300); await page.waitForTimeout(800);
      const zoomed = await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix));
      ensure(zoomed.some((n, i) => n !== before[i]), 'Wheel zoom did not move the camera');
      await page.mouse.down(); await page.mouse.move(660, 630, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(800);
      const dragged = await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix));
      ensure(dragged.some((n, i) => n !== zoomed[i]), 'Globe drag did not move the camera');
      report.checks.push({ name: 'all-692-visible-wheel-zoom-and-globe-drag', passed: true });
      return;
    }
  }
  await page.getByRole('button', { name: '宮古駅周辺', exact: true }).evaluate((button) => button.click());
  await page.locator('#population-year').fill('2050');
  for (const [id, label] of [['594137654', 'station-coast'], ['594137753', 'slope'], ['594137563', 'low-population'], [zero.id, 'zero']]) {
    if (process.env.MVP_FOCUS && process.env.MVP_FOCUS !== label) continue;
    if (label === 'zero') await page.locator('#population-year').fill('2070');
    await page.locator('#mesh-select').selectOption(id);
    await page.waitForFunction((id) => window.__mvp.layer.source.entities.getById(`mesh:${id}`).properties.selected.getValue() === true, id, { timeout: remaining() });
    await page.getByRole('button', { name: '選択メッシュへ', exact: true }).evaluate((button) => button.click());
    await page.waitForTimeout(1200);
    await take(label);
    report.mvp.phase = `picking-${label}`;
    console.log('MVP focus screenshot ready, picking', label);
    // Actual drillPick at a projected face centroid, then a real pointer click.
    const point = await page.evaluate((id) => {
      const { viewer, layer } = window.__mvp;
      const entity = layer.source.entities.getById(`mesh:${id}`);
      const positions = entity.polygon.hierarchy.getValue().positions;
      const center = positions[0].clone(); center.x = center.y = center.z = 0;
      for (const p of positions) { center.x += p.x / positions.length; center.y += p.y / positions.length; center.z += p.z / positions.length; }
      const ellipsoid = viewer.scene.globe.ellipsoid;
      const cartographic = ellipsoid.cartesianToCartographic(center);
      cartographic.height = entity.polygon.extrudedHeight.getValue();
      const top = ellipsoid.cartographicToCartesian(cartographic);
      const screen = viewer.scene.cartesianToCanvasCoordinates(top);
      if (!screen) return null;
      const hits = viewer.scene.drillPick(screen, 8);
      const matching = hits.some((hit) => hit.id === entity);
      const rect = viewer.scene.canvas.getBoundingClientRect();
      return { x: screen.x + rect.left, y: screen.y + rect.top, matching, ids: hits.map((hit) => hit.id?.id ?? 'building'), camera: viewer.camera.positionCartographic, selected: layer.source.entities.values.filter((e) => e.properties.selected.getValue()).map((e) => e.id), entityShown: entity.show, base: entity.polygon.height.getValue(), globeReady: viewer.scene.globe.tilesLoaded, geometryReady: viewer.dataSourceDisplay.ready };
    }, id);
    report.mvp.picks ??= [];
    report.mvp.picks.push({ label, ...point });
    console.log('MVP pick', JSON.stringify(point));
    ensure(point?.matching, `Actual drillPick failed ${label}: ${JSON.stringify(point)}`);
    await page.locator('#mesh-select').selectOption(id === '594137654' ? '594137753' : '594137654');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => document.querySelector('#mesh-select').value === id, id, { timeout: remaining(5000) });
    await page.waitForURL((url) => url.searchParams.get('mesh') === id && url.searchParams.get('year') === (label === 'zero' ? '2070' : '2050'), { timeout: remaining(5000) });
  }
  report.checks.push({ name: 'selected-camera-real-drillPick-and-pointer-selection-and-shared-url', focus: process.env.MVP_FOCUS ?? 'all-four', passed: true });
  await page.getByText('データについて・利用条件', { exact: true }).evaluate((summary) => summary.click());
  ensure((await page.locator('#data-notes').innerText()).includes('無居住化'), 'Data notes readable');
  report.checks.push({ name: 'source-license-coverage-notes-readable', passed: true });
}
