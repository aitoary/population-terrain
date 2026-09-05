// @vitest-environment node

import { readFileSync } from 'node:fs';
import { Cartographic, EllipsoidTerrainProvider, GeographicTilingScheme, WebMercatorTilingScheme } from 'cesium';
import type { sampleTerrain, TerrainProvider } from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meshBbox, parsePopulation } from '../data/loadPopulation';
import type { MeshFeature } from '../domain/types';
import { BASE_CLEARANCE, TERRAIN_LEVEL, TerrainSampler } from './terrainSampling';
import type { TerrainBaseResult } from './terrainSampling';

const source = parsePopulation(JSON.parse(readFileSync(new URL('../../public/data/miyako-population.geojson', import.meta.url), 'utf8')));
function sourceCell(id: string): MeshFeature {
  const feature = source.features.find((entry) => entry.id === id);
  if (!feature) throw new Error(`Missing real-data fixture: ${id}`);
  return feature;
}
const first = sourceCell('594137654');
const second = sourceCell('594137753');
const third = sourceCell('594137563');
const cells = Object.freeze([first, second, third]);
for (const feature of cells) {
  for (const point of feature.geometry.coordinates[0]) Object.freeze(point);
  Object.freeze(feature.geometry.coordinates[0]);
  Object.freeze(feature.geometry.coordinates);
  Object.freeze(feature.geometry);
  Object.freeze(feature);
}

function grid(feature: MeshFeature): Cartographic[] {
  const [west, south, east, north] = meshBbox(feature);
  return [south, (south + north) / 2, north].flatMap((latitude) =>
    [west, (west + east) / 2, east].map((longitude) => Cartographic.fromDegrees(longitude, latitude, Number.NaN)));
}

function pointKey(position: Cartographic): string {
  return `${position.longitude},${position.latitude}`;
}

function tileKey(provider: TerrainProvider, position: Cartographic): string {
  const tile = provider.tilingScheme.positionToTileXY(position, TERRAIN_LEVEL);
  if (!tile) throw new Error('Fixture must be inside the tiling scheme');
  return `${tile.x},${tile.y}`;
}

function heightAt(position: Cartographic): number {
  return position.longitude * 100 + position.latitude * 10;
}

function fill(positions: Cartographic[], height = heightAt): Cartographic[] {
  for (const position of positions) position.height = height(position);
  return positions;
}

function ready(results: ReadonlyMap<string, TerrainBaseResult>, meshId: string) {
  const result = results.get(meshId);
  expect(result?.status).toBe('ready');
  if (!result || result.status !== 'ready') throw new Error(`${meshId}: expected a ready base`);
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controlledSample() {
  let active = 0;
  let peak = 0;
  const requests: { positions: Cartographic[]; resolve: () => void; reject: (reason: unknown) => void }[] = [];
  const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => {
    const completion = deferred<void>();
    active += 1;
    peak = Math.max(peak, active);
    requests.push({ positions, resolve: () => completion.resolve(undefined), reject: completion.reject });
    try {
      await completion.promise;
      return fill(positions);
    } finally {
      active -= 1;
    }
  });
  return { sample, requests, get active() { return active; }, get peak() { return peak; } };
}

let samplers: TerrainSampler[];
const network = vi.fn(() => { throw new Error('Unexpected network request in a terrain unit test'); });
function createSampler(sample: typeof sampleTerrain, provider: TerrainProvider = new EllipsoidTerrainProvider()) {
  const sampler = new TerrainSampler(provider, sample);
  samplers.push(sampler);
  return { sampler, provider };
}

beforeEach(() => {
  samplers = [];
  network.mockClear();
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  for (const sampler of samplers) sampler.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

describe('TerrainSampler (real Miyako rectangles, injected sampleTerrain)', () => {
  it('samples exactly nine bbox positions per cell, starts at NaN, and computes max + 2 without changing geometry', async () => {
    const geometryBefore = JSON.stringify(cells.map((cell) => cell.geometry));
    const initialHeights: number[] = [];
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => {
      initialHeights.push(...positions.map((position) => position.height));
      return fill(positions);
    });
    const { sampler, provider } = createSampler(sample);
    const results = await sampler.sampleCells(cells);

    expect(TERRAIN_LEVEL).toBe(12);
    expect(BASE_CLEARANCE).toBe(2);
    expect(results.size).toBe(3);
    expect(initialHeights).toHaveLength(27);
    expect(initialHeights.every(Number.isNaN)).toBe(true);
    const positions = sample.mock.calls.flatMap((call) => call[2]);
    expect(positions).toHaveLength(27);
    expect(new Set(positions.map(pointKey))).toEqual(new Set(cells.flatMap(grid).map(pointKey)));
    for (const [actualProvider, level, _positions, rejectOnTileFail] of sample.mock.calls) {
      expect(actualProvider).toBe(provider);
      expect(level).toBe(12);
      expect(rejectOnTileFail).toBe(true);
    }
    for (const cell of cells) {
      const heights = grid(cell).map(heightAt);
      expect(ready(results, cell.id)).toEqual({
        status: 'ready', meshId: cell.id, heights,
        minHeight: Math.min(...heights), maxHeight: Math.max(...heights), baseHeight: Math.max(...heights) + 2,
      });
    }
    expect(JSON.stringify(cells.map((cell) => cell.geometry))).toBe(geometryBefore);
  });

  it.each([
    ['geographic', () => new GeographicTilingScheme()],
    ['Web Mercator', () => new WebMercatorTilingScheme()],
  ] as const)('groups every unique point by the provider\'s %s tiling scheme', async (_label, makeScheme) => {
    const provider = new EllipsoidTerrainProvider({ tilingScheme: makeScheme() });
    const locate = vi.spyOn(provider.tilingScheme, 'positionToTileXY');
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions));
    const { sampler } = createSampler(sample, provider);
    await sampler.sampleCells(cells);

    expect(locate).toHaveBeenCalledTimes(27);
    expect(locate.mock.calls.every((call) => call[1] === 12)).toBe(true);
    const expected = new Map<string, Set<string>>();
    for (const position of cells.flatMap(grid)) {
      const key = tileKey(provider, position);
      if (!expected.has(key)) expected.set(key, new Set());
      expected.get(key)!.add(pointKey(position));
    }
    expect(expected.size).toBe(3);
    expect(sample).toHaveBeenCalledTimes(expected.size);
    const actual = new Map<string, Set<string>>();
    for (const [, , positions] of sample.mock.calls) {
      const keys = new Set(positions.map((position) => tileKey(provider, position)));
      expect(keys.size).toBe(1);
      const key = tileKey(provider, positions[0]!);
      expect(actual.has(key)).toBe(false);
      actual.set(key, new Set(positions.map(pointKey)));
    }
    expect(actual).toEqual(expected);
  });

  it.each(['one batch', 'successive calls'] as const)('deduplicates shared edge points in %s, independently of mesh codes', async (mode) => {
    // The three source rectangles are disjoint; derive a northern neighbor without mutating any source geometry.
    const [west, south, east, north] = meshBbox(first);
    const top = north + (north - south);
    const neighbor: MeshFeature = {
      ...second,
      geometry: { type: 'Polygon', coordinates: [[[west, north], [west, top], [east, top], [east, north], [west, north]]] },
    };
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions));
    const { sampler } = createSampler(sample);
    if (mode === 'successive calls') await sampler.sampleCells([first]);
    const results = await sampler.sampleCells([first, neighbor, first]);

    expect(results.size).toBe(2);
    const positions = sample.mock.calls.flatMap((call) => call[2]);
    expect(positions).toHaveLength(15);
    expect(new Set(positions.map(pointKey)).size).toBe(15);
    expect(new Set(positions.map(pointKey))).toEqual(new Set([first, neighbor].flatMap(grid).map(pointKey)));
    expect(ready(results, first.id).heights).toEqual(grid(first).map(heightAt));
    expect(ready(results, neighbor.id).heights).toEqual(grid(neighbor).map(heightAt));
    expect(second.geometry).not.toBe(neighbor.geometry);
  });

  it('caches successful bases across calls, returns only requested cells, and keeps caches instance-local', async () => {
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions));
    const { sampler, provider } = createSampler(sample);
    const locate = vi.spyOn(provider.tilingScheme, 'positionToTileXY');
    const initial = await sampler.sampleCells(cells);
    for (const position of sample.mock.calls.flatMap((call) => call[2])) position.height = 99999;
    sample.mockClear();
    locate.mockClear();

    const cached = await sampler.sampleCells([...cells].reverse());
    for (const cell of cells) {
      expect(cached.get(cell.id)).toBe(initial.get(cell.id));
      expect(ready(cached, cell.id).heights).toEqual(grid(cell).map(heightAt));
    }
    expect((await sampler.sampleCells([first])).size).toBe(1);
    expect((await sampler.sampleCells([])).size).toBe(0);
    expect(sample).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();

    const independent = createSampler(sample, provider).sampler;
    const other = await independent.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(3);
    expect(other).toEqual(initial);
    expect(other.get(first.id)).not.toBe(initial.get(first.id));
  });

  it('keeps at most two tile requests active globally across duplicate and overlapping calls', async () => {
    const controlled = controlledSample();
    const { sampler } = createSampler(controlled.sample);
    const initial = sampler.sampleCells([first, second]);
    const duplicate = sampler.sampleCells([first, second, first]);
    const additional = sampler.sampleCells([second, third]);
    await vi.waitFor(() => expect(controlled.requests).toHaveLength(2));
    expect(controlled.active).toBe(2);

    controlled.requests[0]!.resolve();
    await vi.waitFor(() => expect(controlled.requests).toHaveLength(3));
    expect(controlled.active).toBe(2);
    controlled.requests[1]!.resolve();
    await vi.waitFor(() => expect(controlled.active).toBe(1));
    expect(controlled.requests).toHaveLength(3);
    controlled.requests[2]!.resolve();
    await vi.waitFor(() => expect(controlled.requests).toHaveLength(4));
    controlled.requests[3]!.resolve();

    const [a, b, c] = await Promise.all([initial, duplicate, additional]);
    expect(a.size).toBe(2);
    expect(b).toEqual(a);
    expect(b.get(first.id)).toBe(a.get(first.id));
    expect(c.get(second.id)).toBe(a.get(second.id));
    expect(ready(c, third.id).heights).toHaveLength(9);
    expect(controlled.peak).toBe(2);
    expect(controlled.active).toBe(0);
    const positions = controlled.requests.flatMap((request) => request.positions);
    expect(positions).toHaveLength(27);
    expect(new Set(positions.map(pointKey)).size).toBe(27);
  });

  it.each([
    { label: 'undefined', value: undefined },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Infinity },
    { label: '-Infinity', value: -Infinity },
    { label: 'an untouched initial height', value: 'untouched' },
  ])('does not treat $label as zero and retries only the missing point of the failed cell', async ({ value }) => {
    const missingKey = pointKey(grid(second)[0]!);
    let failing = true;
    const initialHeights: number[] = [];
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => {
      initialHeights.push(...positions.map((position) => position.height));
      for (const position of positions) {
        if (failing && pointKey(position) === missingKey) {
          // Cesium's runtime failure value can be undefined despite Cartographic.height's number type.
          if (value !== 'untouched') Object.assign(position, { height: value });
        } else position.height = failing ? 50 : 80;
      }
      return positions;
    });
    const { sampler } = createSampler(sample);
    const initial = await sampler.sampleCells(cells);
    ready(initial, first.id);
    ready(initial, third.id);
    expect(initial.get(second.id)).toEqual({ status: 'error', meshId: second.id, message: expect.stringContaining('8/9') });
    expect(sample).toHaveBeenCalledTimes(3);

    failing = false;
    const recovered = await sampler.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(4);
    expect(sample.mock.calls[3]![2].map(pointKey)).toEqual([missingKey]);
    expect(initialHeights).toHaveLength(28);
    expect(initialHeights.every(Number.isNaN)).toBe(true);
    expect(recovered.get(first.id)).toBe(initial.get(first.id));
    expect(recovered.get(third.id)).toBe(initial.get(third.id));
    const base = ready(recovered, second.id);
    expect(base.heights).toHaveLength(9);
    expect(base.heights.filter((height) => height === 50)).toHaveLength(8);
    expect(base).toMatchObject({ minHeight: 50, maxHeight: 80, baseHeight: 82 });
    await sampler.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(4);
  });

  it.each(['rejection', 'synchronous throw'] as const)('isolates a tile %s, discards its mutated heights, and retries only its failed cells', async (mode) => {
    const provider = new EllipsoidTerrainProvider();
    const failedTile = tileKey(provider, grid(third)[0]!);
    let failing = true;
    const sample = vi.fn<typeof sampleTerrain>((_provider, _level, positions) => {
      fill(positions, () => failing ? 70 : 80);
      if (failing && tileKey(provider, positions[0]!) === failedTile) {
        fill(positions, () => 99999);
        const error = new Error('HTTP 503 terrain tile');
        if (mode === 'synchronous throw') throw error;
        return Promise.reject(error);
      }
      return Promise.resolve(positions);
    });
    const { sampler } = createSampler(sample, provider);
    const initial = await sampler.sampleCells(cells);
    for (const cell of [first, third]) {
      expect(initial.get(cell.id)).toEqual({ status: 'error', meshId: cell.id, message: expect.stringContaining('HTTP 503') });
    }
    ready(initial, second.id);
    expect(sample).toHaveBeenCalledTimes(3);

    failing = false;
    const recovered = await sampler.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(4);
    const retried = sample.mock.calls[3]![2];
    expect(retried).toHaveLength(12);
    expect(new Set(retried.map(pointKey))).toEqual(new Set(cells.flatMap(grid)
      .filter((position) => tileKey(provider, position) === failedTile).map(pointKey)));
    expect(recovered.get(second.id)).toBe(initial.get(second.id));
    expect(ready(recovered, first.id)).toMatchObject({ minHeight: 70, maxHeight: 80, baseHeight: 82 });
    expect(ready(recovered, third.id)).toMatchObject({ minHeight: 80, maxHeight: 80, baseHeight: 82 });
    await sampler.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(4);
  });

  it.each([0, -10])('accepts an explicitly sampled finite ellipsoid height of %s without clamping the base', async (height) => {
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions, () => height));
    const { sampler } = createSampler(sample);
    const results = await sampler.sampleCells(cells);
    for (const cell of cells) {
      expect(ready(results, cell.id)).toEqual({
        status: 'ready', meshId: cell.id, heights: Array<number>(9).fill(height),
        minHeight: height, maxHeight: height, baseHeight: height + 2,
      });
    }
  });

  it('aborts a queued call before it starts and makes no requests after destroy, including empty input', async () => {
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions));
    const { sampler, provider } = createSampler(sample);
    const locate = vi.spyOn(provider.tilingScheme, 'positionToTileXY');
    const pending = sampler.sampleCells(cells);
    sampler.destroy();
    sampler.destroy();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sampler.sampleCells(cells)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sampler.sampleCells([])).rejects.toMatchObject({ name: 'AbortError' });
    expect(sample).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('aborts active and waiting calls immediately and ignores late tile %s', async (outcome) => {
    const controlled = controlledSample();
    const { sampler } = createSampler(controlled.sample);
    const active = sampler.sampleCells(cells);
    const queued = sampler.sampleCells(cells);
    const activeAborted = expect(active).rejects.toMatchObject({ name: 'AbortError' });
    const queuedAborted = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(controlled.requests).toHaveLength(2));
    sampler.destroy();
    sampler.destroy();
    // These promises must reject even while Cesium's non-cancellable tile requests are still pending.
    await Promise.all([activeAborted, queuedAborted]);
    expect(controlled.active).toBe(2);

    for (const request of controlled.requests) {
      if (outcome === 'resolve') request.resolve();
      else request.reject(new Error('late tile failure'));
    }
    await Promise.allSettled(controlled.sample.mock.results.map((result) => result.value));
    await expect(sampler.sampleCells(cells)).rejects.toMatchObject({ name: 'AbortError' });
    expect(controlled.active).toBe(0);
    expect(controlled.sample).toHaveBeenCalledTimes(2);
  });

  it('does not return a cached ready result when destroyed before its queued delivery', async () => {
    const sample = vi.fn<typeof sampleTerrain>(async (_provider, _level, positions) => fill(positions));
    const { sampler } = createSampler(sample);
    await sampler.sampleCells(cells);
    expect(sample).toHaveBeenCalledTimes(3);
    const cached = sampler.sampleCells(cells);
    sampler.destroy();

    await expect(cached).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sampler.sampleCells([first])).rejects.toMatchObject({ name: 'AbortError' });
    expect(sample).toHaveBeenCalledTimes(3);
  });
});
