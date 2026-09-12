import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { waitMvpRendered } from './browser_mvp_checks.mjs';

const source = JSON.parse(readFileSync(new URL('../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const acceptance = process.env.UI_ACCEPTANCE === '1';
const query = acceptance ? '&acceptance=1' : '';
const station = '594137654';
const featured = '594137744';
const years = Array.from({ length: 11 }, (_, index) => 2020 + index * 5);
const legend = (page) => page.getByRole('region', { name: '人口地図の凡例' });
const panel = (page) => page.getByRole('complementary', { name: '人口の詳細と表示設定' });
const play = (page) => page.getByTestId('playback-toggle');
const choice = (page, id = featured) => page.locator(`[data-testid="featured-location"][data-mesh-id="${id}"] button`);

async function ready(page, year = 2050) {
  await page.goto(`/?year=${year}&mesh=${station}&source=ui-flow${query}#view`);
  await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('map-viewport')).toHaveAttribute('data-viewer-ready', 'true');
}

async function expectView(page, year, id = station) {
  await expect(page.locator('#population-year')).toHaveValue(String(year));
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-mesh-id', id);
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-population', String(source.features.find((feature) => feature.id === id).properties.population[year]));
  await expect(page.getByTestId('population-trend')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('population-trend').locator('circle[data-current="true"]')).toHaveAttribute('data-year', String(year));
  await expect(page).toHaveURL((url) => url.searchParams.get('year') === String(year) && url.searchParams.get('mesh') === id);
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    return {
      map: box('.map-viewport'), legend: box('.legend'), tools: box('.map-tools'),
      credits: box('.cesium-viewer-bottom'), panel: box('.inspection-panel'), footer: box('.app-footer'),
      heading: box('#mesh-heading'), chart: box('.population-trend svg'),
      overflow: document.documentElement.scrollWidth - innerWidth,
      legendOverflow: document.querySelector('.legend').scrollWidth - document.querySelector('.legend').clientWidth,
      windowY: scrollY, panelY: document.querySelector('.inspection-panel').scrollTop,
    };
  });
}

function expectOverlayBounds(bounds) {
  expect(bounds.overflow).toBe(0);
  expect(bounds.legendOverflow).toBe(0);
  expect(bounds.legend.left).toBeGreaterThanOrEqual(bounds.map.left);
  expect(bounds.legend.right).toBeLessThanOrEqual(bounds.map.right);
  expect(bounds.legend.bottom).toBeLessThanOrEqual(bounds.credits.top - 4);
  expect(bounds.legend.top).toBeGreaterThanOrEqual(bounds.tools.bottom + 4);
  expect(bounds.legend.bottom).toBeLessThan(bounds.footer.top);
}

for (const [width, height] of [[1440, 1000], [1024, 768], [601, 680], [390, 844], [320, 740]]) {
  test(`legend layout and featured selection at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    await expect(panel(page).locator('.legend')).toHaveCount(0);
    const initial = await layout(page);
    const panelScrolls = await panel(page).evaluate((element) => getComputedStyle(element).overflowY === 'auto');
    expectOverlayBounds(initial);
    await expect(legend(page).getByRole('listitem')).toHaveCount(7);
    expect(await legend(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`) });
    await page.locator('.map-stage').screenshot({ path: testInfo.outputPath(`map-${width}.png`) });
    if (!panelScrolls) {
      await expect(page.locator('.map-status')).not.toHaveAttribute('open', '');
      await page.locator('.map-status summary').click();
      expectOverlayBounds(await layout(page));
      await page.locator('.map-status summary').click();
    }

    await legend(page).locator('summary').click();
    await expect(legend(page).locator('details')).toHaveAttribute('open', '');
    await expect(legend(page)).toContainText('0.5m/人');
    expectOverlayBounds(await layout(page));
    await page.screenshot({ path: testInfo.outputPath(`reading-${width}.png`) });
    await page.locator('.map-stage').screenshot({ path: testInfo.outputPath(`map-reading-${width}.png`) });
    await legend(page).locator('details').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(legend(page).locator('summary')).toBeInViewport();
    await expect(legend(page).locator('.legend-explanation p').last()).toBeInViewport();
    await legend(page).locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(legend(page).locator('details')).not.toHaveAttribute('open', '');

    await page.getByRole('checkbox', { name: '人口', exact: true }).uncheck();
    await expect(legend(page).getByRole('status')).toHaveText('人口レイヤーは非表示です');
    if (panelScrolls) {
      const scrolled = await layout(page);
      expect(scrolled.panelY).toBeGreaterThan(0);
      expect(scrolled.legend.bottom).toBe(initial.legend.bottom);
      expect(scrolled.legend.left).toBe(initial.legend.left);
      // The hidden state adds a line but keeps the lower edge fixed.
    }
    await page.getByRole('checkbox', { name: '人口', exact: true }).check();
    await expect(legend(page).locator('[role="status"]')).toBeEmpty();

    await choice(page).focus();
    const beforeChoice = await layout(page);
    await page.keyboard.press('Enter');
    await expectView(page, 2070, featured);
    await expect(page.locator('#mesh-heading')).toBeFocused();
    await expect(play(page)).toHaveAccessibleName('2020年から再生');
    const selected = await layout(page);
    if (panelScrolls) {
      expect(selected.windowY).toBe(beforeChoice.windowY);
      expect(selected.panelY).toBeLessThanOrEqual(22);
      expect(selected.heading.top).toBeGreaterThanOrEqual(selected.panel.top);
      expect(selected.chart.bottom).toBeLessThanOrEqual(selected.panel.bottom);
    } else {
      expect(selected.heading.top).toBeCloseTo(16, 0);
      expect(selected.chart.bottom).toBeLessThan(height);
    }
    await page.screenshot({ path: testInfo.outputPath(`selected-${width}.png`) });
    await page.keyboard.press('Tab');
    await expect(page.locator('#mesh-select')).toBeFocused();
    if (width === 320) {
      // Trigger playback without moving the viewport to the header to isolate app scrolling.
      const windowY = await page.evaluate(() => scrollY);
      await play(page).evaluate((button) => button.click());
      await expectView(page, 2020, featured);
      await expect(page.locator('#population-year')).toHaveValue('2025');
      await play(page).evaluate((button) => button.click());
      expect(await page.evaluate(() => scrollY)).toBe(windowY);
      await expect(page.locator('#mesh-select')).toBeFocused();
    }
    await testInfo.attach('layout', { body: JSON.stringify({ initial, selected }), contentType: 'application/json' });
  });
}

test('restarts explicitly, uses one timer, preserves scroll, and copies/restores the linked chart', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    history.replaceState({ retained: 'ui-flow' }, '');
    // Observe the real playback timers; do not replace the browser clock or map timers.
    const schedule = window.setTimeout;
    const cancel = window.clearTimeout;
    const active = new Set();
    window.__playbackCheck = { active, max: 0 };
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 900) return schedule(callback, delay, ...args);
      const id = schedule(() => { active.delete(id); callback(...args); }, delay);
      active.add(id);
      window.__playbackCheck.max = Math.max(window.__playbackCheck.max, active.size);
      return id;
    };
    window.clearTimeout = (id) => { active.delete(id); cancel(id); };
  });
  await ready(page, 2070);
  await expectView(page, 2070);
  await expect(play(page)).toBeEnabled();
  await expect(play(page)).toHaveText('2020年から再生');
  await expect(play(page)).toHaveAccessibleName('2020年から再生');
  await page.waitForTimeout(1100);
  await expectView(page, 2070);
  const historyLength = await page.evaluate(() => history.length);
  await page.locator('#population-opacity').fill('0.6');
  await page.getByRole('checkbox', { name: '市境', exact: true }).uncheck();
  await panel(page).evaluate((element) => { element.scrollTop = 130; });
  const before = await layout(page);
  await page.evaluate(() => {
    const details = document.querySelector('[data-testid="mesh-details"]');
    window.__uiYears = [];
    window.__uiScrolls = [];
    window.__uiObserver = new MutationObserver(() => {
      window.__uiYears.push(Number(details.dataset.year));
      window.__uiScrolls.push([scrollY, document.querySelector('.inspection-panel').scrollTop]);
    });
    window.__uiObserver.observe(details, { attributes: true, attributeFilter: ['data-year'] });
  });
  await play(page).click();
  await expectView(page, 2020);
  await expect(play(page)).toHaveText('一時停止');
  await expect(play(page)).toHaveAccessibleName('一時停止');
  await expect(page.getByTestId('playback-status')).toHaveText('停止中（最終年）', { timeout: 20_000 });
  await expectView(page, 2070);
  await page.waitForTimeout(1100);
  const playback = await page.evaluate(() => {
    window.__uiObserver.disconnect();
    return { years: window.__uiYears, scrolls: window.__uiScrolls, max: window.__playbackCheck.max, active: window.__playbackCheck.active.size };
  });
  expect(playback.years).toEqual(years);
  expect(playback.scrolls.every(([windowY, panelY]) => windowY === before.windowY && panelY === before.panelY)).toBe(true);
  expect(playback.max).toBe(1);
  expect(playback.active).toBe(0);
  await expect(page.locator('#population-opacity')).toHaveValue('0.6');
  await expect(page.getByRole('checkbox', { name: '市境', exact: true })).not.toBeChecked();

  // The ref guard must also handle multiple clicks before React commits a render.
  await play(page).evaluate((button) => { button.click(); button.click(); button.click(); button.click(); });
  await expectView(page, 2020);
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1100);
  await expectView(page, 2020);
  await play(page).click();
  await play(page).evaluate((button) => { button.click(); button.click(); });
  await expect(play(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#population-year')).toHaveValue('2025');
  await page.locator('#population-year').fill('2040');
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1100);
  await expectView(page, 2040);
  expect((await layout(page)).panelY).toBe(before.panelY);
  await play(page).click();
  await choice(page).click();
  await expectView(page, 2070, featured);
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1100);
  await expectView(page, 2070, featured);
  // Re-selecting the same featured mesh still reveals its details.
  await choice(page).click();
  await expect(page.locator('#mesh-heading')).toBeFocused();
  expect((await layout(page)).panelY).toBe(0);
  expect(await page.evaluate(() => window.__playbackCheck.active.size)).toBe(0);
  expect(await page.evaluate(() => window.__playbackCheck.max)).toBe(1);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate(() => history.state)).toEqual({ retained: 'ui-flow' });

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'この表示をコピー', exact: true }).click();
  await expect(page.getByTestId('share-status')).toHaveText('共有リンクをコピーしました。');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  expect(new URL(copied).searchParams.get('source')).toBe('ui-flow');
  expect(new URL(copied).hash).toBe('#view');
  await page.goto('about:blank');
  await page.goto(copied);
  await expectView(page, 2070, featured);
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('shared-restored.png') });
});

test('real map keeps its objects and isolates legend interactions', async ({ page }, testInfo) => {
  test.skip(!acceptance, 'Uses the existing acceptance-only viewer reference to inspect actual drawing.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  for (const layer of ['terrain', 'buildings', 'population', 'border']) {
    await expect(page.getByTestId(`${layer}-status`)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  }
  await waitMvpRendered(page, () => 30_000);
  await page.evaluate(() => {
    const { viewer, layer, bases } = window.__mvp;
    window.__uiMap = {
      viewer, layer, bases, terrain: viewer.terrainProvider,
      building: Array.from({ length: viewer.scene.primitives.length }, (_, i) => viewer.scene.primitives.get(i)).find((item) => item.tileVisible),
      entity: layer.source.entities.getById('mesh:594137654'), camera: Array.from(viewer.camera.viewMatrix),
    };
  });
  const before = await layout(page);
  await legend(page).locator('summary').click();
  await legend(page).dblclick({ position: { x: 30, y: 30 } });
  await legend(page).hover();
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).toEqual(await page.evaluate(() => window.__uiMap.camera));
  await expectView(page, 2050);
  await legend(page).locator('summary').click();
  await page.mouse.move(before.legend.right + 45, before.legend.top + 40);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).not.toEqual(await page.evaluate(() => window.__uiMap.camera));

  await choice(page).click();
  await expectView(page, 2070, featured);
  await waitMvpRendered(page, () => 30_000);
  const futureColor = await page.evaluate(() => {
    const color = window.__mvp.layer.source.entities.getById('mesh:594137744').polygon.material.getValue().color;
    return {
      rgb: [color.red, color.green, color.blue].map((channel) => Math.round(channel * 255)),
      swatch: getComputedStyle(document.querySelector('[data-category="decrease"] .swatch')).backgroundColor,
    };
  });
  expect(futureColor.swatch).toBe(`rgb(${futureColor.rgb.join(', ')})`);
  await page.screenshot({ path: testInfo.outputPath('real-map-featured.png') });
  const camera = await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix));
  await play(page).click();
  await expectView(page, 2020, featured);
  await play(page).click();
  await expectView(page, 2020, featured);
  expect(await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).toEqual(camera);
  await page.getByRole('checkbox', { name: '人口', exact: true }).uncheck();
  expect(await page.evaluate(() => window.__mvp.layer.source.show)).toBe(false);
  await page.getByRole('checkbox', { name: '人口', exact: true }).check();
  expect(await page.evaluate(() => window.__mvp.layer.source.show)).toBe(true);
  const stable = await page.evaluate(() => {
    const { viewer, layer, bases } = window.__mvp;
    const original = window.__uiMap;
    const entity = layer.source.entities.getById('mesh:594137744');
    const color = entity.polygon.material.getValue().color;
    const swatch = document.querySelector('[data-category="unchanged"] .swatch');
    const gl = viewer.canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      same: viewer === original.viewer && layer === original.layer && bases === original.bases && viewer.terrainProvider === original.terrain
        && viewer.scene.primitives.contains(original.building) && layer.source.entities.getById('mesh:594137654') === original.entity,
      rgb: [color.red, color.green, color.blue].map((channel) => Math.round(channel * 255)),
      swatch: getComputedStyle(swatch).backgroundColor,
      selected: entity.properties.selected.getValue(), outline: entity.polyline.material.getValue().color.toCssColorString(),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  expect(stable.same).toBe(true);
  expect(stable.swatch).toBe(`rgb(${stable.rgb.join(', ')})`);
  expect(stable.selected).toBe(true);
  expect(stable.outline).toBe('rgb(255,255,255)');
  await testInfo.attach('real-map', { body: JSON.stringify(stable), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('real-map-restarted.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.map-status summary').click();
  await waitMvpRendered(page, () => 30_000);
  expectOverlayBounds(await layout(page));
  await page.locator('.map-stage').screenshot({ path: testInfo.outputPath('real-map-mobile.png') });
  expect(await page.evaluate(() => window.__mvp.viewer === window.__uiMap.viewer && window.__mvp.layer === window.__uiMap.layer)).toBe(true);
  expect(errors).toEqual([]);
});
