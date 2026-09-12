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
  // Read one coherent frame: separate browser round trips can span a 900ms playback tick.
  await expect.poll(() => page.evaluate(() => {
    const details = document.querySelector('[data-testid="mesh-details"]');
    const chart = document.querySelector('[data-testid="population-trend"]');
    const url = new URL(location.href);
    return {
      slider: document.querySelector('#population-year')?.value,
      mesh: details?.dataset.meshId, year: details?.dataset.year, population: details?.dataset.population,
      chart: chart?.dataset.year, marker: chart?.querySelector('circle[data-current="true"]')?.dataset.year,
      urlYear: url.searchParams.get('year'), urlMesh: url.searchParams.get('mesh'),
    };
  })).toEqual({
    slider: String(year), mesh: id, year: String(year),
    population: String(source.features.find((feature) => feature.id === id).properties.population[year]),
    chart: String(year), marker: String(year), urlYear: String(year), urlMesh: id,
  });
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
      heading: box('#mesh-heading'), summary: box('.mesh-summary'),
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

async function expectCenteredPlaceNames(page) {
  const offsets = await page.locator('.featured-select').evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button.lastElementChild);
    const label = range.getBoundingClientRect();
    return Math.abs((label.left + label.right) / 2 - (bounds.left + bounds.right) / 2);
  }));
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(0.5);
}

for (const [width, height] of [[1366, 768], [1024, 768], [390, 844], [320, 740]]) {
  test(`compact layout, disclosure persistence and featured selection at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    await expect(panel(page).locator('.legend')).toHaveCount(0);
    await expect(page.getByTestId('totals')).toHaveCount(0);
    await expect(page.locator('details > summary')).toHaveText(['詳しく見る', '表示設定', 'データについて']);
    await expect(page.locator('details[open]')).toHaveCount(0);
    await expect(page.getByTestId('population-trend')).not.toBeVisible();
    await expect(page.locator('#mesh-select')).not.toBeVisible();
    await expect(page.locator('.layer-controls')).not.toBeVisible();
    await expect(page.locator('.mesh-summary dt')).toHaveText(['2050年 人口', '2020年比']);
    await expect(page.locator('#mesh-heading')).toHaveText('選択地点');
    await expect(page.locator('.featured-select')).toHaveText(['中心部周辺', '市内北側', '内陸西部']);
    await expectCenteredPlaceNames(page);
    await expect(page.getByRole('button', { name: /コピー/ })).toHaveCount(1);
    const initial = await layout(page);
    const panelScrolls = await panel(page).evaluate((element) => getComputedStyle(element).overflowY === 'auto');
    expectOverlayBounds(initial);
    await expect(legend(page).getByRole('listitem')).toHaveCount(7);
    expect(await legend(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    if (panelScrolls) {
      expect(await panel(page).evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
      expect(initial.windowY).toBe(0);
      await expect(page.locator('.mesh-summary .share-link button')).toBeInViewport();
      await expect(page.locator('.featured-locations')).toBeInViewport();
    } else {
      // The map and year control are usable before scrolling down to the compact inspector.
      expect(initial.map.bottom).toBeLessThanOrEqual(height);
      expect(await panel(page).evaluate((element) => element.clientHeight)).toBeLessThan(500);
    }
    await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`) });
    await page.locator('.map-stage').screenshot({ path: testInfo.outputPath(`map-${width}.png`) });
    await page.locator('#population-year').fill('2060');
    await expectView(page, 2060);
    await expect(page.locator('details[open]')).toHaveCount(0);
    expect((await layout(page)).windowY).toBe(0);
    await page.locator('.display-settings > summary').click();
    await page.getByRole('checkbox', { name: '人口', exact: true }).uncheck();
    await expect(legend(page).getByRole('status')).toHaveText('人口レイヤーは非表示です');
    if (panelScrolls) {
      const scrolled = await layout(page);
      expect(scrolled.legend.bottom).toBe(initial.legend.bottom);
      expect(scrolled.legend.left).toBe(initial.legend.left);
      // The hidden state adds a line but keeps the lower edge fixed.
    }
    await page.getByRole('checkbox', { name: '人口', exact: true }).check();
    await expect(legend(page).locator('[role="status"]')).toBeEmpty();
    await page.locator('.display-settings > summary').click();

    await choice(page).focus();
    const beforeChoice = await layout(page);
    await page.keyboard.press('Enter');
    await expectView(page, 2070, featured);
    await expect(page.locator('#mesh-heading')).toHaveText('中心部周辺');
    await expect(choice(page)).toContainText('✓');
    await expectCenteredPlaceNames(page);
    await expect(page.locator('.mesh-more')).not.toHaveAttribute('open', '');
    await expect(page.locator('#mesh-heading')).toBeFocused();
    await expect(play(page)).toHaveAccessibleName('2020年から再生');
    const selected = await layout(page);
    if (panelScrolls) {
      expect(selected.windowY).toBe(beforeChoice.windowY);
      expect(selected.heading.top).toBeGreaterThanOrEqual(selected.panel.top);
      expect(selected.summary.bottom).toBeLessThanOrEqual(selected.panel.bottom);
    } else {
      expect(selected.heading.top).toBeGreaterThanOrEqual(0);
      expect(selected.summary.bottom).toBeLessThan(height);
    }
    await page.screenshot({ path: testInfo.outputPath(`selected-${width}.png`) });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'この表示をコピー', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.mesh-more > summary')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.mesh-more')).toHaveAttribute('open', '');
    await expect(page.locator('#mesh-select')).toBeVisible();
    await expect(page.getByTestId('population-trend')).toBeVisible();
    await expect(page.locator('.population-trend table')).toBeVisible();
    await expect(page.locator('.population-trend tbody tr')).toHaveCount(11);
    await choice(page, '594132791').click();
    await expectView(page, 2070, '594132791');
    await expect(page.locator('.mesh-more')).toHaveAttribute('open', '');
    await page.locator('.mesh-more > summary').focus();
    const scroll = await layout(page);
    // Use an explicit click without Playwright scrolling to the header, to isolate app scrolling.
    await play(page).evaluate((button) => button.click());
    await expectView(page, 2020, '594132791');
    await expect(page.locator('#population-year')).toHaveValue('2025');
    await play(page).evaluate((button) => button.click());
    const after = await layout(page);
    expect([after.windowY, after.panelY]).toEqual([scroll.windowY, scroll.panelY]);
    await expect(page.locator('.mesh-more > summary')).toBeFocused();
    await expect(page.locator('.mesh-more')).toHaveAttribute('open', '');
    await page.screenshot({ path: testInfo.outputPath(`expanded-${width}.png`), fullPage: !panelScrolls });
    await page.locator('.mesh-more > summary').click();
    await choice(page).click();
    await expect(page.locator('.mesh-more')).not.toHaveAttribute('open', '');
    await page.getByRole('link', { name: 'データについて', exact: true }).click();
    await expect(page.locator('#data-notes')).toHaveAttribute('open', '');
    await expect(page.locator('#data-notes')).toContainText('0.5m/人');
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
  await page.locator('.mesh-more > summary').click();
  await page.locator('.display-settings > summary').click();
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
  await expect(page.locator('.mesh-summary .share-link button')).toBeInViewport();
  await expect(page.locator('.mesh-more')).toHaveAttribute('open', '');
  await expect(page.locator('.display-settings')).toHaveAttribute('open', '');
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
  await expect(page.locator('details[open]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('shared-restored.png') });
});

test('keeps loading and retry feedback visible without a status disclosure', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/data/miyako-border.geojson', async (route) => {
    if (fail) return route.fulfill({ status: 503, body: 'Intentional UI retry test' });
    await gate;
    await route.continue();
  });
  await ready(page);
  const status = page.getByTestId('border-status');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toBeVisible();
  await expect(status.getByRole('button', { name: '市境を再試行' })).toBeInViewport();
  await expect(page.locator('details[open]')).toHaveCount(0);
  expectOverlayBounds(await layout(page));
  await page.screenshot({ path: testInfo.outputPath('mobile-error-feedback.png') });
  fail = false;
  try {
    await status.getByRole('button', { name: '市境を再試行' }).click();
    await expect(status).toHaveAttribute('data-state', 'loading');
    await expect(status).toBeVisible();
  } finally { release(); }
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(status).not.toBeVisible();
  await expect(status).toBeEmpty();
  await expectView(page, 2050);
  await expect(page.locator('details[open]')).toHaveCount(0);
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
  await expect(page.locator('.map-status')).not.toBeVisible();
  for (const layer of ['terrain', 'buildings', 'population', 'border']) await expect(page.getByTestId(`${layer}-status`)).toBeEmpty();
  await page.setViewportSize({ width: 1366, height: 768 });
  await waitMvpRendered(page, () => 30_000);
  await page.screenshot({ path: testInfo.outputPath('real-map-desktop-default.png') });
  await page.evaluate(() => {
    const { viewer, layer, bases } = window.__mvp;
    window.__uiMap = {
      viewer, layer, bases, terrain: viewer.terrainProvider,
      building: Array.from({ length: viewer.scene.primitives.length }, (_, i) => viewer.scene.primitives.get(i)).find((item) => item.tileVisible),
      entity: layer.source.entities.getById('mesh:594137654'), camera: Array.from(viewer.camera.viewMatrix),
    };
  });
  const before = await layout(page);
  await legend(page).dblclick({ position: { x: 30, y: 30 } });
  await legend(page).hover();
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).toEqual(await page.evaluate(() => window.__uiMap.camera));
  await expectView(page, 2050);
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
  await page.locator('.mesh-more > summary').click();
  await page.locator('.mesh-more > summary').click();
  await page.locator('.source-notes > summary').click();
  await page.locator('.source-notes > summary').click();
  await page.locator('.display-settings > summary').click();
  await page.getByRole('checkbox', { name: '人口', exact: true }).uncheck();
  expect(await page.evaluate(() => window.__mvp.layer.source.show)).toBe(false);
  await page.getByRole('checkbox', { name: '人口', exact: true }).check();
  expect(await page.evaluate(() => window.__mvp.layer.source.show)).toBe(true);
  await page.locator('.display-settings > summary').click();
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
  await waitMvpRendered(page, () => 30_000);
  expectOverlayBounds(await layout(page));
  await page.locator('.map-stage').screenshot({ path: testInfo.outputPath('real-map-mobile.png') });
  await page.screenshot({ path: testInfo.outputPath('real-map-mobile-page.png'), fullPage: true });
  expect(await page.evaluate(() => window.__mvp.viewer === window.__uiMap.viewer && window.__mvp.layer === window.__uiMap.layer)).toBe(true);
  expect(errors).toEqual([]);
});
