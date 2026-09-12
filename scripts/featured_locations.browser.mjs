import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { waitMvpRendered } from './browser_mvp_checks.mjs';

const source = JSON.parse(readFileSync(new URL('../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const ids = ['594137744', '594147883', '594132791'];
const acceptance = process.env.GUIDE_ACCEPTANCE === '1' && process.env.SHARE_DEV !== '1';
const query = acceptance ? '&acceptance=1' : '';
const location = (page, id) => page.locator(`[data-testid="featured-location"][data-mesh-id="${id}"]`);
const selectLocation = (page, id) => location(page, id).getByRole('button', { name: /を2070年で見る$/ });
const copySelection = (page) => page.getByTestId('mesh-details').getByRole('button', { name: 'この表示をコピー', exact: true });

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
  await expect(page.getByTestId('featured-location')).toHaveCount(3);
  await expect(page.getByRole('region', { name: '場所を選ぶ', exact: true }).getByRole('button')).toHaveCount(3);
  await expect(page.locator('#data-notes')).toContainText('建物なし・読込失敗は無人口を意味しません');
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
    await expect(location(page, id)).not.toContainText('%');
    await page.locator('#population-year').fill('2020');

    await page.getByTestId('playback-toggle').click();
    await expect(page.getByTestId('playback-toggle')).toHaveAttribute('aria-pressed', 'true');
    await selectLocation(page, id).click();
    await expectView(page, 2070, id);
    await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-rate', String(rate));
    await expect(page.locator('.mesh-summary')).toContainText(`${rate.toFixed(1)}%`);
    await expect(page.locator('.mesh-more')).not.toHaveAttribute('open', '');
    await expect(selectLocation(page, id)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('playback-status')).toHaveText('停止中（最終年）');
    await expect(page.getByTestId('playback-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(1100);
    await expectView(page, 2070, id);
    await expectCameraAndSelection(page, id);

    const currentUrl = page.url();
    await expect(page.getByRole('button', { name: /コピー/ })).toHaveCount(1);
    await copySelection(page).click();
    await expect(page.getByTestId('share-status')).toHaveText('共有リンクをコピーしました。');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(currentUrl);
    expect(page.url()).toBe(currentUrl);
    copiedUrls.push(copied);

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
      await selectLocation(page, id).click();
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
    await expect(selectLocation(page, guideId)).toHaveAttribute('aria-pressed', 'true');
  }
});
}

for (const width of [1440, 390, 320]) {
  test(`puts three compact choices before the summary and one share action at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(`/?year=2050&mesh=594137654${query}`);
    await expectView(page, 2050, '594137654');
    const panel = page.getByRole('complementary', { name: '人口の詳細と表示設定' });
    const featured = page.getByRole('region', { name: '場所を選ぶ', exact: true });
    await expect(panel.locator('section').first()).toHaveAttribute('aria-labelledby', 'featured-heading');
    await expect(featured.getByRole('button')).toHaveCount(3);
    await expect(featured.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /コピー/ })).toHaveCount(1);
    await expect(copySelection(page)).toBeEnabled();
    await expect(featured.locator('.featured-values, .share-link')).toHaveCount(0);
    const layout = await panel.evaluate((element) => {
      const box = (selector) => {
        const { top, bottom, left, right, height } = element.querySelector(selector).getBoundingClientRect();
        return { top, bottom, left, right, height };
      };
      return {
        details: box('.mesh-details'), share: box('.share-link'),
        featured: box('.featured-locations'), choices: box('.featured-list'), layers: box('.display-settings'),
        panelTop: element.getBoundingClientRect().top, panelBottom: element.getBoundingClientRect().bottom,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(layout.featured.top - layout.panelTop).toBeLessThanOrEqual(22);
    expect(layout.featured.bottom).toBeLessThanOrEqual(layout.details.top);
    expect(layout.details.bottom).toBeLessThanOrEqual(layout.layers.top);
    expect(layout.choices.height).toBe(44);
    expect(layout.featured.height).toBeLessThan(80);
    expect(layout.pageOverflow).toBe(0);
    expect(layout.details.left).toBeGreaterThanOrEqual(0);
    expect(layout.details.right).toBeLessThanOrEqual(width);
    if (width === 1440) expect(layout.share.bottom).toBeLessThan(layout.panelBottom);
    for (const id of ids) {
      const choice = selectLocation(page, id);
      await expect(choice).toHaveAccessibleName(/を2070年で見る$/);
      await expect(choice).not.toContainText('%');
      expect((await choice.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await testInfo.attach('panel-layout', { body: JSON.stringify(layout), contentType: 'application/json' });
    if (width === 1440) await panel.screenshot({ path: testInfo.outputPath('panel-top.png') });
    else await page.screenshot({ path: testInfo.outputPath(`panel-mobile-${width}.png`), fullPage: true });
    await featured.screenshot({ path: testInfo.outputPath(`compact-choices-${width}.png`) });

    await selectLocation(page, ids[2]).focus();
    await page.keyboard.press('Enter');
    await expectView(page, 2070, ids[2]);
    await expect(featured.getByRole('button', { pressed: true })).toHaveCount(1);
    await expect(page.locator('.mesh-more')).not.toHaveAttribute('open', '');
    await page.locator('.mesh-more > summary').click();
    await page.locator('#mesh-select').selectOption('594137654');
    await expectView(page, 2070, '594137654');
    await expect(featured.getByRole('button', { pressed: true })).toHaveCount(0);
  });
}

test('retains an early location choice until the lazy map is ready', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(/\/MapViewport(?:-[^/?]+\.js|\.tsx)(?:\?|$)/, async (route) => { await gate; await route.continue(); });
  await page.goto(`/?year=2020&mesh=594137654${query}`, { waitUntil: 'domcontentloaded' });
  const id = ids[2];
  try {
    await expectView(page, 2020, '594137654');
    await selectLocation(page, id).click();
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
