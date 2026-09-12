import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const source = JSON.parse(readFileSync(new URL('../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const years = Array.from({ length: 11 }, (_, index) => 2020 + index * 5);
const station = '594137654';
const zero = '594115541';
const acceptance = process.env.TREND_ACCEPTANCE === '1';
const query = acceptance ? '&acceptance=1' : '';
const population = (id) => source.features.find((feature) => feature.id === id).properties.population;
const format = (value) => value === null ? 'データなし' : value === 0 ? '0人' : value < 0.1 ? '0.1人未満'
  : `${new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}人`;

async function expectCurrent(page, year, meshId) {
  const chart = page.getByTestId('population-trend');
  await expect(chart).toHaveAttribute('data-year', String(year));
  await expect(chart.locator('circle[data-current="true"]')).toHaveAttribute('data-year', String(year));
  await expect(chart.getByRole('img')).toHaveAccessibleDescription(new RegExp(`現在表示は${year}年、${format(population(meshId)[year])}`));
  await expect(chart.locator('tr[aria-current="true"]')).toContainText(`${year}年（表示中）`);
  await expect(page.getByTestId('mesh-details')).toHaveAttribute('data-mesh-id', meshId);
  await expect(page).toHaveURL((url) => url.searchParams.get('year') === String(year) && url.searchParams.get('mesh') === meshId);
}

test('keeps the series stable, follows all playback years, and exposes all values without refetching', async ({ page }, testInfo) => {
  const errors = [];
  const dataRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/data\/(miyako-population\.geojson|data-meta\.json)$/.test(request.url())) dataRequests.push(request.url());
  });
  await page.goto(`/?year=2050&mesh=${station}${query}`);
  await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'ready');
  await expectCurrent(page, 2050, station);
  const chart = page.getByTestId('population-trend');
  await expect(chart.getByRole('img')).toHaveAccessibleName('2020〜2070年の人口推移（5年刻み）');
  const initialPath = await chart.locator('.population-trend-line').getAttribute('d');
  const initialPoints = await chart.locator('circle').evaluateAll((points) => points.map((point) => [point.getAttribute('cx'), point.getAttribute('cy')]));
  await page.getByTestId('mesh-details').screenshot({ path: testInfo.outputPath('trend-desktop.png') });

  await chart.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(chart.getByRole('table')).toBeVisible();
  await expect(chart.locator('tbody tr')).toHaveCount(11);
  for (const [index, year] of years.entries()) {
    await expect(chart.locator('tbody tr').nth(index).locator('td')).toHaveText(format(population(station)[year]));
    await page.locator('#population-year').fill(String(year));
    await expectCurrent(page, year, station);
    await expect(chart.locator('.population-trend-line')).toHaveAttribute('d', initialPath);
  }
  await chart.locator('summary').click();

  let cameraBefore;
  if (acceptance) {
    await expect(page.getByTestId('population-status')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    cameraBefore = await page.evaluate(() => {
      window.__trendViewer = window.__mvp.viewer;
      return Array.from(window.__mvp.viewer.camera.viewMatrix);
    });
  }
  await page.locator('#population-year').fill('2020');
  await page.evaluate(() => {
    const details = document.querySelector('[data-testid="mesh-details"]');
    window.__trendFrames = [];
    const record = () => window.__trendFrames.push({
      year: Number(details.dataset.year),
      chart: Number(details.querySelector('[data-testid="population-trend"]').dataset.year),
      marker: Number(details.querySelector('circle[data-current="true"]').dataset.year),
    });
    record();
    window.__trendObserver = new MutationObserver(record);
    window.__trendObserver.observe(details, { subtree: true, attributes: true });
  });
  await page.getByTestId('playback-toggle').click();
  await expect(page.getByTestId('playback-status')).toHaveText('停止中（最終年）', { timeout: 25_000 });
  await expectCurrent(page, 2070, station);
  const frames = await page.evaluate(() => { window.__trendObserver.disconnect(); return window.__trendFrames; });
  expect([...new Set(frames.map((frame) => frame.year))]).toEqual(years);
  expect(frames.every((frame) => frame.year === frame.chart && frame.year === frame.marker)).toBe(true);
  await expect(chart.locator('.population-trend-line')).toHaveAttribute('d', initialPath);
  expect(await chart.locator('circle').evaluateAll((points) => points.map((point) => [point.getAttribute('cx'), point.getAttribute('cy')]))).toEqual(initialPoints);

  if (acceptance) {
    expect(await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).toEqual(cameraBefore);
    await page.getByRole('button', { name: '選択メッシュへ', exact: true }).click();
    const focused = await page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix));
    expect(focused).not.toEqual(cameraBefore);
    await page.mouse.move(550, 550);
    await page.mouse.wheel(0, -250);
    await expect.poll(() => page.evaluate(() => Array.from(window.__mvp.viewer.camera.viewMatrix))).not.toEqual(focused);
    await page.getByRole('button', { name: '宮古駅周辺', exact: true }).click();
    expect(await page.evaluate(() => window.__mvp.viewer === window.__trendViewer)).toBe(true);
    await expectCurrent(page, 2070, station);
  }

  await page.locator('#mesh-select').selectOption(zero);
  await expectCurrent(page, 2070, zero);
  await expect(chart.locator('.population-trend-line')).not.toHaveAttribute('d', initialPath);
  const current = chart.locator('circle[data-current="true"]');
  expect(await current.getAttribute('cy')).toBe(await chart.locator('.population-trend-grid').first().getAttribute('y1'));
  await page.getByTestId('mesh-details').screenshot({ path: testInfo.outputPath('trend-zero.png') });
  expect(dataRequests.filter((url) => url.endsWith('/miyako-population.geojson'))).toHaveLength(1);
  expect(dataRequests.filter((url) => url.endsWith('/data-meta.json'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const width of [390, 320]) {
  test(`keeps the chart and text alternative inside the card at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?year=2070&mesh=${zero}${query}`);
    await expect(page.getByTestId('data-status')).toHaveAttribute('data-state', 'ready');
    await expectCurrent(page, 2070, zero);
    const chart = page.getByTestId('population-trend');
    const card = page.getByTestId('mesh-details');
    await chart.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(chart.getByRole('table')).toBeVisible();
    const bounds = await card.evaluate((element) => {
      const box = (node) => { const { x, width, right } = node.getBoundingClientRect(); return { x, width, right }; };
      return {
        card: box(element),
        svg: box(element.querySelector('svg')),
        table: box(element.querySelector('table')),
        cardOverflow: element.scrollWidth - element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(bounds.svg.x).toBeGreaterThanOrEqual(bounds.card.x);
    expect(bounds.svg.right).toBeLessThanOrEqual(bounds.card.right);
    expect(bounds.table.right).toBeLessThanOrEqual(bounds.card.right);
    expect(bounds.card.x).toBeGreaterThanOrEqual(0);
    expect(bounds.card.right).toBeLessThanOrEqual(width);
    expect(bounds.cardOverflow).toBe(0);
    expect(bounds.pageOverflow).toBe(0);
    await expect(page.getByTestId('map-viewport')).toHaveAttribute('data-viewer-ready', 'true');
    const mapBounds = await page.getByTestId('map-viewport').boundingBox();
    expect(mapBounds.width).toBe(width);
    expect(mapBounds.height).toBeGreaterThanOrEqual(300);
    await chart.locator('summary').click();
    await card.screenshot({ path: testInfo.outputPath(`trend-mobile-${width}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`trend-mobile-page-${width}.png`), fullPage: true });
    await testInfo.attach('layout', { body: JSON.stringify(bounds), contentType: 'application/json' });
  });
}
