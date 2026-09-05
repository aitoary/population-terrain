import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_SOURCES } from '../config/dataSources';
import type { PopulationCollection, PopulationMetadata } from '../domain/types';
import { loadPopulation, parseMetadata, parsePopulation, validateDataset } from './loadPopulation';

const raw: PopulationCollection = JSON.parse(readFileSync(new URL('../../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const meta: PopulationMetadata = JSON.parse(readFileSync(new URL('../../public/data/data-meta.json', import.meta.url), 'utf8'));
const first = raw.features[0]!;
const variant = (patch: Record<string, unknown>) => ({ ...raw, features: [{ ...first, ...patch }] });
afterEach(() => vi.unstubAllGlobals());

describe('population delivery contract (real preprocessed data)', () => {
  it('loads 692 unique IDs, all 11 PTN years, and checked totals', () => {
    const data = validateDataset(parsePopulation(raw), parseMetadata(meta));
    expect(data.byId.size).toBe(692);
    expect(data.metadata.totals[2020]).toBe(50369);
    expect(data.metadata.totals[2050]).toBe(26633.0007);
    expect(data.metadata.totals[2070]).toBe(15526.9996);
    expect(data.byId.get('594115541')!.properties.population[2030]).toBe(2.767);
  });

  it.each([null, [], {}, { type: 'FeatureCollection', features: [] }])('rejects empty/wrong data: %j', (input) => {
    expect(() => parsePopulation(input)).toThrow();
  });

  it('rejects duplicate IDs, numeric IDs, city mismatch and legacy CRS', () => {
    expect(() => parsePopulation({ ...raw, features: [first, first] })).toThrow(/重複/);
    expect(() => parsePopulation(variant({ id: Number(first.id) }))).toThrow(/9桁/);
    expect(() => parsePopulation(variant({ properties: { ...first.properties, cityCode: '03201' } }))).toThrow(/不一致/);
    expect(() => parsePopulation({ ...raw, crs: null })).toThrow(/CRS/);
  });

  it('requires exactly 11 named years, with no PT00 fallback', () => {
    const { 2050: _omitted, ...missingYear } = first.properties.population;
    expect(() => parsePopulation(variant({ properties: { ...first.properties, population: missingYear, PT00_2050: 0 } }))).toThrow(/11年/);
    expect(() => parsePopulation(variant({ properties: { ...first.properties, population: { ...first.properties.population, 2021: 1 } } }))).toThrow(/11年/);
  });

  it.each([undefined, '2.767', false, -1, NaN, Infinity])('rejects an invalid population: %s', (value) => {
    expect(() => parsePopulation(variant({ properties: { ...first.properties, population: { ...first.properties.population, 2050: value } } }))).toThrow();
  });

  it('preserves null and very small positive populations without rounding', () => {
    const result = parsePopulation(variant({ properties: { ...first.properties, population: { ...first.properties.population, 2050: null, 2055: 0.0001 } } }));
    expect(result.features[0]!.properties.population[2050]).toBeNull();
    expect(result.features[0]!.properties.population[2055]).toBe(0.0001);
  });

  it('rejects broken/crossed rings, holes, swapped axes and non-polygons', () => {
    const ring = first.geometry.coordinates[0];
    const geometries = [
      { type: 'LineString', coordinates: ring },
      { type: 'Polygon', coordinates: [ring, ring] },
      { type: 'Polygon', coordinates: [ring.slice(0, 4)] },
      { type: 'Polygon', coordinates: [[ring[0], ring[2], ring[1], ring[3], ring[0]]] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lat, lon])] },
    ];
    for (const geometry of geometries) expect(() => parsePopulation(variant({ geometry }))).toThrow();
  });

  it('rejects unreviewed sources, wrong years and malformed metadata', () => {
    expect(() => parseMetadata({ ...meta, series: 'PT00' })).toThrow();
    expect(() => parseMetadata({ ...meta, buildingDatasetYear: 2024 })).toThrow();
    expect(() => parseMetadata({ ...meta, years: [2020, 2050] })).toThrow();
    expect(() => parseMetadata({ ...meta, sourceSha256: { ...meta.sourceSha256, population: '0'.repeat(64) } })).toThrow();
    expect(() => parseMetadata({ ...meta, meshCount: 0 })).toThrow();
  });

  it('rejects count, sums, null/zero counts and bbox inconsistent with the file', () => {
    const collection = parsePopulation(raw);
    for (const broken of [
      { ...meta, meshCount: 691 },
      { ...meta, totals: { ...meta.totals, 2050: 0 } },
      { ...meta, nullCounts: { ...meta.nullCounts, 2050: 1 } },
      { ...meta, zeroCounts: { ...meta.zeroCounts, 2070: 226 } },
      { ...meta, bbox: [141, 39, 143, 40] },
    ]) expect(() => validateDataset(collection, parseMetadata(broken))).toThrow();
  });

  it('config matches the pinned catalog and source manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../data/source-manifest.json', import.meta.url), 'utf8'));
    const selected = JSON.parse(readFileSync(new URL('../../data/plateau-2025-lod1-entry.json', import.meta.url), 'utf8'));
    expect(DATA_SOURCES.buildings.url).toBe(selected.entry.url);
    expect(DATA_SOURCES.buildings.sha256).toBe(manifest.sources.buildings.sha256);
    expect(DATA_SOURCES.population.sha256).toBe(manifest.sources.population.sha256);
    expect(DATA_SOURCES.terrain.metadataUrl).toBe(manifest.sources.terrain.url);
    expect(selected.entry.year).toBe(2025);
    expect(selected.entry.lod).toBe('1');
  });
});

describe('loadPopulation transport', () => {
  it('fetches geometry and metadata in parallel, validates them and builds the index', async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === DATA_SOURCES.population.url ? raw : meta))));
    vi.stubGlobal('fetch', fetcher);
    const pending = loadPopulation();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await pending).byId.size).toBe(692);
  });

  it('does not interpret HTTP errors as an empty population layer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    await expect(loadPopulation()).rejects.toThrow(/人口GeoJSON.*HTTP 404/);
  });

  it('rejects a 200 HTML fallback rather than accepting it as data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>index.html</html>')));
    await expect(loadPopulation()).rejects.toThrow(/JSON/);
  });

  it('retains cancellation/failure instead of replacing it with zeros', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(loadPopulation()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
