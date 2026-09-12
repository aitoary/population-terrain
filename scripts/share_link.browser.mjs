import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const source = JSON.parse(readFileSync(new URL('../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('../public/data/data-meta.json', import.meta.url), 'utf8'));
const station = '594137654';
const slope = '594137753';
const zero = '594115541';
const copyButton = (page) => page.getByRole('button', { name: 'この表示をコピー', exact: true });
const playbackButton = (page) => page.getByTestId('playback-toggle');

async function expectView(page, year, meshId) {
  await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#population-year')).toHaveValue(String(year));
  await expect(page.locator('#mesh-select')).toHaveValue(meshId);
  const details = page.getByTestId('mesh-details');
  await expect(details).toHaveAttribute('data-year', String(year));
  await expect(details).toHaveAttribute('data-population', String(source.features.find((feature) => feature.id === meshId).properties.population[year]));
  await expect(page.getByTestId('population-trend')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('population-trend').locator('circle[data-current="true"]')).toHaveAttribute('data-year', String(year));
  await expect(page.getByTestId('totals')).toHaveAttribute('data-total', String(metadata.totals[year]));
  await expect(page).toHaveURL((url) => url.searchParams.get('year') === String(year) && url.searchParams.get('mesh') === meshId);
  await expect(copyButton(page)).toBeEnabled();
}

async function expectRealMap(page) {
  for (const key of ['terrain', 'buildings', 'population', 'border']) {
    await expect(page.getByTestId(`${key}-status`)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  }
  await expect(page.getByTestId('population-status')).toContainText('692セルを表示');
  await expect(page.getByTestId('map-viewport').locator('canvas')).toHaveCount(1);
}

test('restores a zero mesh, updates without history growth, and copies a reusable real URL', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => history.replaceState({ retained: 'share-link-test' }, ''));
  await page.goto(`/?year=2070&mesh=${zero}&source=share-test#view`);
  await expectView(page, 2070, zero);
  await expect(page.getByTestId('mesh-details')).toContainText('0人（平面）');
  await expectRealMap(page);
  await page.waitForTimeout(1500); // Let the real map submit its initial render for the screenshot.
  await page.screenshot({ path: testInfo.outputPath('restored-2070-zero.png') });
  const historyLength = await page.evaluate(() => {
    window.__shareCanvas = document.querySelector('[data-testid="map-viewport"] canvas');
    return history.length;
  });
  for (const year of metadata.years) {
    await page.locator('#population-year').fill(String(year));
    await expectView(page, year, zero);
  }
  await page.locator('#population-year').focus();
  await page.keyboard.press('ArrowLeft');
  await expectView(page, 2065, zero);
  await page.locator('#mesh-select').selectOption(slope);
  await expectView(page, 2065, slope);
  const url = page.url();
  await page.locator('#population-opacity').fill('0.8');
  for (const label of ['人口', '建物（2025年度 LOD1）', '市境']) {
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  }
  await page.getByRole('button', { name: '宮古駅周辺', exact: true }).click();
  expect(page.url()).toBe(url);
  await page.locator('#mesh-select').selectOption(zero); // Selection still works with population hidden.
  await expectView(page, 2065, zero);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate(() => history.state)).toEqual({ retained: 'share-link-test' });
  expect(await page.evaluate(() => window.__shareCanvas === document.querySelector('[data-testid="map-viewport"] canvas'))).toBe(true);
  expect(await page.evaluate(() => '__mvp' in window || '__mvpViewer' in window)).toBe(false);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyButton(page).click();
  await expect(page.getByTestId('share-status')).toHaveText('共有リンクをコピーしました。');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  expect([...new URL(copied).searchParams.keys()].sort()).toEqual(['mesh', 'source', 'year']);
  expect(new URL(copied).hash).toBe('#view');
  // Navigating to the same hash URL can be a same-document navigation in Chromium.
  await page.goto('about:blank');
  await page.goto(copied);
  await expectView(page, 2065, zero);
  await expect(page.locator('#population-opacity')).toHaveValue('0.25');
  for (const label of ['人口', '建物（2025年度 LOD1）', '市境']) {
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  }
});

test('plays from the current year, stops for manual input and at 2070, and preserves the view', async ({ page }) => {
  const populationRequests = [];
  page.on('request', (request) => {
    if (/\/data\/(miyako-population\.geojson|data-meta\.json)$/.test(request.url())) populationRequests.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => history.replaceState({ retained: 'playback-test' }, ''));
  await page.goto(`/?year=2020&mesh=${slope}`);
  await expectView(page, 2020, slope);
  await expect(playbackButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(playbackButton(page)).toHaveAccessibleName('人口推移を再生（停止中）');
  await expect(page.getByTestId('playback-status')).toHaveText('停止中');
  await page.waitForTimeout(1100);
  await expect(page.locator('#population-year')).toHaveValue('2020');

  await expect(page.getByTestId('map-viewport')).toHaveAttribute('data-viewer-ready', 'true');
  const historyLength = await page.evaluate(() => {
    window.__playbackCanvas = document.querySelector('[data-testid="map-viewport"] canvas');
    return history.length;
  });

  await playbackButton(page).click();
  await expect(playbackButton(page)).toHaveAccessibleName('人口推移を一時停止（再生中）');
  await expect(page.getByTestId('playback-status')).toHaveText('再生中');
  await expect(page.locator('#population-year')).toHaveValue('2025', { timeout: 2_000 });
  await playbackButton(page).click();
  // Real Chrome actionability checks can span another 900ms playback tick.
  // Assert the actual paused year stays fixed rather than racing the click.
  const pausedYear = Number(await page.locator('#population-year').inputValue());
  expect(metadata.years).toContain(pausedYear);
  expect(pausedYear).toBeGreaterThanOrEqual(2025);
  expect(pausedYear).toBeLessThan(2070);
  await expectView(page, pausedYear, slope);
  await expect(page.getByTestId('playback-status')).toHaveText('停止中');
  await page.waitForTimeout(1100);
  await expectView(page, pausedYear, slope);

  await playbackButton(page).click();
  await page.locator('#population-year').fill('2040');
  await expectView(page, 2040, slope);
  await expect(page.getByTestId('playback-status')).toHaveText('停止中');
  await page.waitForTimeout(1100);
  await expect(page.locator('#population-year')).toHaveValue('2040');

  await playbackButton(page).click();
  await expect(page.locator('#population-year')).toHaveValue('2045', { timeout: 2_000 });
  await page.locator('#population-year').focus();
  await page.keyboard.press('Home');
  await expectView(page, 2020, slope);
  await expect(page.getByTestId('playback-status')).toHaveText('停止中');
  await page.waitForTimeout(1100);
  await expect(page.locator('#population-year')).toHaveValue('2020');

  await page.locator('#mesh-select').selectOption(zero);
  await page.getByRole('checkbox', { name: '市境', exact: true }).uncheck();
  await page.locator('#population-year').fill('2065');
  await playbackButton(page).click();
  await expectView(page, 2070, zero);
  await expect(page.getByTestId('playback-status')).toHaveText('停止中（最終年）');
  await expect(playbackButton(page)).toBeDisabled();
  await expect(playbackButton(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1100);
  await expect(page.locator('#population-year')).toHaveValue('2070');
  await expect(page.locator('#mesh-select')).toHaveValue(zero);
  await expect(page.getByRole('checkbox', { name: '市境', exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate(() => history.state)).toEqual({ retained: 'playback-test' });
  expect(await page.evaluate(() => window.__playbackCanvas === document.querySelector('[data-testid="map-viewport"] canvas'))).toBe(true);
  expect(populationRequests.filter((url) => url.endsWith('/miyako-population.geojson'))).toHaveLength(1);
  expect(populationRequests.filter((url) => url.endsWith('/data-meta.json'))).toHaveLength(1);
});

test('falls back independently for missing, invalid and repeated parameters', async ({ page }) => {
  for (const [query, year, mesh] of [
    ['', 2050, station],
    ['year=2070', 2070, station],
    [`mesh=${slope}`, 2050, slope],
    [`year=2021&mesh=${slope}`, 2050, slope],
    ['year=2020&mesh=999999999', 2020, station],
    ['year=&mesh=', 2050, station],
    ['year=2070&year=2020&mesh=%3Cscript%3E', 2050, station],
  ]) {
    await page.goto(`/?${query}`);
    await expectView(page, year, mesh);
    expect(new URL(page.url()).searchParams.getAll('year')).toHaveLength(1);
    expect(new URL(page.url()).searchParams.getAll('mesh')).toHaveLength(1);
  }
});

for (const delayed of ['miyako-population.geojson', 'data-meta.json']) {
  test(`preserves pending URL and early year changes while ${delayed} loads`, async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(`**/data/${delayed}`, async (route) => { await gate; await route.continue(); });
    await page.goto(`/?year=2070&mesh=${zero}`);
    try {
      await expect(page.locator('#population-year')).toHaveValue('2070');
      await expect(page.locator('#mesh-select')).toBeDisabled();
      await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-mesh-id', station);
      await expect(copyButton(page)).toBeDisabled();
      await expect(page.getByTestId('featured-card')).toHaveCount(3);
      for (const button of await page.getByTestId('featured-card').getByRole('button').all()) await expect(button).toBeDisabled();
      const originalUrl = page.url();
      await page.locator('#population-year').fill('2025');
      await expect(page.locator('#population-year')).toHaveValue('2025');
      expect(page.url()).toBe(originalUrl);
    } finally {
      release();
    }
    await expectView(page, 2025, zero);
  });
}

test('retains the shared mesh through population failure and retry', async ({ page }) => {
  let failPopulation = true;
  await page.route('**/data/miyako-population.geojson', (route) => failPopulation
    ? route.fulfill({ status: 503, body: 'Intentional shared-link retry test' })
    : route.continue());
  await page.goto(`/?year=2070&mesh=${zero}`);
  await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'error');
  await expect(copyButton(page)).toBeDisabled();
  expect(new URL(page.url()).searchParams.get('mesh')).toBe(zero);
  await page.locator('#population-year').fill('2060');
  failPopulation = false;
  await page.getByRole('button', { name: '人口を再試行', exact: true }).click();
  await expectView(page, 2060, zero);
});

test('announces clipboard denial and unavailable API, then allows retry', async ({ page, context }) => {
  await page.goto(`/?year=2070&mesh=${slope}`);
  await expectView(page, 2070, slope);
  const url = page.url();
  for (const unavailable of [false, true]) {
    await page.evaluate((unavailable) => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: unavailable ? undefined : {
        writeText: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      } });
    }, unavailable);
    await copyButton(page).click();
    await expect(page.getByTestId('share-status')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('share-status')).toContainText('ブラウザーのアドレス欄からURLをコピーしてください。');
    await expect(copyButton(page)).toBeEnabled();
    expect(page.url()).toBe(url);
  }
  await page.evaluate(() => { delete navigator.clipboard; });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyButton(page).click();
  await expect(page.getByTestId('share-status')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('share-status')).toHaveText('共有リンクをコピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.locator('#mesh-select').selectOption(station);
  await expect(page.getByTestId('share-status')).toHaveText('');
});

test('does not announce an old pending copy as the newly selected view', async ({ page }) => {
  await page.goto(`/?year=2070&mesh=${slope}`);
  await expectView(page, 2070, slope);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => new Promise((resolve) => { window.__finishSharedCopy = resolve; }),
    } });
  });
  await copyButton(page).click();
  await expect(copyButton(page)).toBeDisabled();
  await expect(page.getByTestId('share-status')).toHaveText('コピー中…');
  await page.locator('#population-year').fill('2020');
  await expectView(page, 2020, slope);
  await page.evaluate(() => window.__finishSharedCopy());
  await expect(page.getByTestId('share-status')).toHaveText('');
});

test('restores the current year and mesh after real map initialization retry', async ({ page }) => {
  const populationRequests = [];
  page.on('request', (request) => { if (/\/data\/(miyako-population\.geojson|data-meta\.json)$/.test(request.url())) populationRequests.push(request.url()); });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => { throw new Error('Shared-link map initialization retry test'); };
    window.__restoreSharedContext = () => { HTMLCanvasElement.prototype.getContext = getContext; };
  });
  await page.goto(`/?year=2070&mesh=${zero}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Viewerの初期化失敗:' })).toBeVisible();
  await expectView(page, 2070, zero);
  await page.locator('#population-year').fill('2020');
  await page.locator('#mesh-select').selectOption(slope);
  await expectView(page, 2020, slope);
  const url = page.url();
  const requestCount = populationRequests.length;
  await page.evaluate(() => window.__restoreSharedContext());
  await page.getByRole('button', { name: '地図を再初期化', exact: true }).click();
  await expectRealMap(page);
  await expectView(page, 2020, slope);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(populationRequests).toHaveLength(requestCount);
});
