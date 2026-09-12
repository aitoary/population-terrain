import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { waitMvpRendered } from './browser_mvp_checks.mjs';

const source = JSON.parse(readFileSync(new URL('../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('../public/data/data-meta.json', import.meta.url), 'utf8'));
const ids = ['594137744', '594147883', '594132791'];
const acceptance = process.env.GUIDE_ACCEPTANCE === '1' && process.env.SHARE_DEV !== '1';
const query = acceptance ? '&acceptance=1' : '';
const card = (page, id) => page.locator(`[data-testid="featured-card"][data-mesh-id="${id}"]`);
const selectCard = (page, id) => card(page, id).getByRole('button', { name: /を2070年で見る$/ });
const copyCard = (page, id) => card(page, id).getByRole('button', { name: /のリンクをコピー$/ });

async function expectView(page, year, id) {
  const values = source.features.find((feature) => feature.id === id).properties.population;
  await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#population-year')).toHaveValue(String(year));
  await expect(page.locator('#mesh-select')).toHaveValue(id);
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-mesh-id', id);
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-population', String(values[year]));
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-baseline', String(values[2020]));
  await expect(page.getByTestId('population-trend')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('population-trend').locator('circle[data-current="true"]')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('totals')).toHaveAttribute('data-total', String(metadata.totals[year]));
  await expect(page).toHaveURL((url) => url.searchParams.get('year') === String(year) && url.searchParams.get('mesh') === id);
}

async function expectRealMap(page, includeBuildings = true) {
  for (const layer of includeBuildings ? ['terrain', 'buildings', 'population', 'border'] : ['terrain', 'population', 'border']) {
    await expect(page.getByTestId(`${layer}-status`)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  }
}

async function expectCameraAndSelection(page, id) {
  if (!acceptance) return;
  const result = await page.evaluate((id) => {
    const { viewer, layer } = window.__mvp;
    const row = layer.rows.find((row) => row.feature.id === id);
    const ring = row.feature.geometry.coordinates[0];
    const longitude = (ring[0][0] + ring[2][0]) / 2;
    const latitude = (ring[0][1] + ring[2][1]) / 2;
    const Cartesian3 = viewer.camera.position.constructor;
    const target = Cartesian3.fromDegrees(longitude, latitude, row.terrain.baseHeight);
    const offset = Cartesian3.subtract(target, viewer.camera.positionWC, new Cartesian3());
    return {
      distance: Cartesian3.magnitude(offset),
      alignment: Cartesian3.dot(Cartesian3.normalize(offset, new Cartesian3()), viewer.camera.directionWC),
      selected: layer.source.entities.values.filter((entity) => entity.properties.selected.getValue()).map((entity) => entity.properties.meshId.getValue()),
      population: layer.source.entities.getById(`mesh:${id}`).properties.population.getValue(),
      year: layer.source.entities.getById(`mesh:${id}`).properties.year.getValue(),
      sameViewer: viewer === window.__guideViewer,
      sameLayer: layer === window.__guideLayer,
    };
  }, id);
  expect(result.distance).toBeCloseTo(1800, 3);
  expect(result.alignment).toBeCloseTo(1, 8);
  expect(result.selected).toEqual([id]);
  expect(result.population).toBe(source.features.find((feature) => feature.id === id).properties.population[2070]);
  expect(result.year).toBe(2070);
  expect(result.sameViewer).toBe(true);
  expect(result.sameLayer).toBe(true);
}

for (const guideId of ids) {
test(`guides real mesh ${guideId}, stops playback and shares the destination`, async ({ page, context }, testInfo) => {
  const errors = [];
  const dataRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/data\/(miyako-population\.geojson|data-meta\.json)$/.test(request.url())) dataRequests.push(request.url());
  });
  await page.addInitScript(() => history.replaceState({ retained: 'featured-test' }, ''));
  await page.goto(`/?year=2020&mesh=594115541&source=featured${query}#guide`);
  await expectView(page, 2020, '594115541');
  await expect(page.getByTestId('featured-card')).toHaveCount(3);
  await expect(page.getByRole('region', { name: '注目地点', exact: true })).toContainText('無人・非居住を意味しません');
  await expectRealMap(page);
  const graphics = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="map-viewport"] canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      drawingBuffer: [canvas.width, canvas.height] };
  });
  await testInfo.attach('graphics', { body: JSON.stringify(graphics), contentType: 'application/json' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const historyLength = await page.evaluate(() => {
    window.__guideCanvas = document.querySelector('[data-testid="map-viewport"] canvas');
    if (window.__mvp) {
      window.__guideViewer = window.__mvp.viewer;
      window.__guideLayer = window.__mvp.layer;
    }
    return history.length;
  });
  const originalRequests = [...dataRequests];
  const copiedUrls = [];
  for (const id of [guideId]) {
    const values = source.features.find((feature) => feature.id === id).properties.population;
    const rate = (values[2070] - values[2020]) / values[2020] * 100;
    await expect(card(page, id)).toHaveAttribute('data-baseline', String(values[2020]));
    await expect(card(page, id)).toHaveAttribute('data-population', String(values[2070]));
    await expect(card(page, id)).toHaveAttribute('data-rate', String(rate));
    await expect(card(page, id)).toContainText(`${rate.toFixed(1)}%`);
    await page.locator('#population-year').fill('2020');
    const currentUrl = page.url();
    await copyCard(page, id).click();
    await expect(page.getByTestId(`featured-share-${id}`)).toHaveText('共有リンクをコピーしました。');
    expect(page.url()).toBe(currentUrl);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const destination = new URL(currentUrl);
    destination.searchParams.set('year', '2070');
    destination.searchParams.set('mesh', id);
    expect(copied).toBe(destination.href);
    copiedUrls.push(copied);

    await page.getByTestId('playback-toggle').click();
    await expect(page.getByTestId('playback-toggle')).toHaveAttribute('aria-pressed', 'true');
    await selectCard(page, id).click();
    await expectView(page, 2070, id);
    await expect(selectCard(page, id)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('playback-status')).toHaveText('停止中（最終年）');
    await expect(page.getByTestId('playback-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(1100);
    await expectView(page, 2070, id);
    await expectCameraAndSelection(page, id);

    if (acceptance) {
      try { await waitMvpRendered(page, () => 30_000); }
      catch (error) {
        const state = await page.evaluate((id) => {
          const { viewer, layer } = window.__mvp;
          const entity = layer.source.entities.getById(`mesh:${id}`);
          return { terrainReady: viewer.scene.globe.tilesLoaded, geometryReady: viewer.dataSourceDisplay.ready,
            selectedShown: entity.show, camera: viewer.camera.positionCartographic,
            sources: Array.from({ length: viewer.dataSources.length }, (_, i) => {
              const source = viewer.dataSources.get(i);
              return { name: source.name, visible: source.entities.values.filter((entity) => entity.show).length };
            }) };
        }, id);
        console.log('Render state:', JSON.stringify(state));
        await testInfo.attach('render-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
        throw error;
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`featured-${id}.png`) });
    // Exercise the shared re-selection path once, after capturing the settled view.
    if (id === ids[0]) {
      await page.getByRole('button', { name: '宮古駅周辺', exact: true }).click();
      await selectCard(page, id).click();
      await expectCameraAndSelection(page, id);
    }
  }
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate(() => history.state)).toEqual({ retained: 'featured-test' });
  expect(await page.evaluate(() => window.__guideCanvas === document.querySelector('[data-testid="map-viewport"] canvas'))).toBe(true);
  expect(dataRequests).toEqual(originalRequests);
  if (!acceptance) expect(await page.evaluate(() => '__mvp' in window || '__mvpViewer' in window)).toBe(false);
  expect(errors).toEqual([]);

  for (const url of copiedUrls) {
    await page.goto('about:blank');
    await page.goto(url);
    await expectView(page, 2070, guideId);
    await expect(selectCard(page, guideId)).toHaveAttribute('aria-pressed', 'true');
  }
});
}

test('offers the correct manual destination on clipboard failure and retries independently', async ({ page, context }) => {
  await page.goto(`/?year=2020&mesh=594137654${query}#guide`);
  await expectView(page, 2020, '594137654');
  const currentUrl = page.url();
  const id = ids[2];
  const destination = new URL(currentUrl);
  destination.searchParams.set('year', '2070');
  destination.searchParams.set('mesh', id);
  for (const unavailable of [false, true]) {
    await page.evaluate((unavailable) => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: unavailable ? undefined : {
        writeText: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      } });
    }, unavailable);
    await copyCard(page, id).click();
    await expect(page.getByTestId(`featured-share-${id}`)).toHaveAttribute('role', 'alert');
    await expect(card(page, id).getByRole('textbox')).toHaveValue(destination.href);
    await expect(card(page, id).getByRole('textbox')).toHaveAttribute('readonly', '');
    await expect(copyCard(page, id)).toBeEnabled();
    await expect(page.getByTestId(`featured-share-${ids[0]}`)).toHaveText('');
    expect(page.url()).toBe(currentUrl);
  }
  await page.evaluate(() => { delete navigator.clipboard; });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyCard(page, id).click();
  await expect(page.getByTestId(`featured-share-${id}`)).toHaveText('共有リンクをコピーしました。');
  await expect(card(page, id).getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(destination.href);
  await expectView(page, 2020, '594137654');
});

test('retains an early card navigation until the lazy map is ready', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(/\/MapViewport(?:-[^/?]+\.js|\.tsx)(?:\?|$)/, async (route) => { await gate; await route.continue(); });
  await page.goto(`/?year=2020&mesh=594137654${query}`, { waitUntil: 'domcontentloaded' });
  const id = ids[2];
  try {
    await expectView(page, 2020, '594137654');
    await selectCard(page, id).click();
    await expectView(page, 2070, id);
    await expect(page.getByText('3Dエンジンを読み込み中…')).toBeVisible();
  } finally { release(); }
  // The western location may have no visible PLATEAU tiles; that is not a failure.
  await expectRealMap(page, false);
  await expectView(page, 2070, id);
  if (acceptance) {
    await page.evaluate(() => {
      window.__guideViewer = window.__mvp.viewer;
      window.__guideLayer = window.__mvp.layer;
    });
    await expectCameraAndSelection(page, id);
  }
});
