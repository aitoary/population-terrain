import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MESH_ID, DEFAULT_YEAR, readSharedView, resolveSharedMesh, sharedViewUrl } from './shareLink';
import { YEARS, type PopulationCollection } from './types';

const collection: PopulationCollection = JSON.parse(readFileSync(new URL('../../public/data/miyako-population.geojson', import.meta.url), 'utf8'));
const byId = new Map(collection.features.map((feature) => [feature.id, feature]));

describe('shared view query validation', () => {
  it.each(YEARS)('accepts the supported year %s exactly', (year) => {
    expect(readSharedView(`?year=${year}&mesh=594137753`)).toEqual({ year, meshId: '594137753' });
  });

  it.each(['', '?year', '?year=', '?year=2015', '?year=2075', '?year=2021', '?year=2070.0', '?year=2.07e3', '?year=02070', '?year=%202070', '?year=2070%20', '?year=NaN', '?year=Infinity', '?year=2070oops', '?year=2070&year=2020', '?year=2070&year=2070', '?year=%E0%A4%A'])('falls back on a missing, invalid or ambiguous year: %s', (search) => {
    expect(readSharedView(search).year).toBe(DEFAULT_YEAR);
  });

  it.each(['', '?mesh', '?mesh=', '?mesh=594137753&mesh=594115541'])('uses the existing default for missing or ambiguous mesh: %s', (search) => {
    expect(readSharedView(search).meshId).toBe(DEFAULT_MESH_ID);
  });

  it.each(['unknown', '999999999', '594137654.0', '594137654 ', '<script>', '%E0%A4%A'])('rejects a mesh absent from the loaded data: %s', (mesh) => {
    const view = readSharedView(`?year=2070&mesh=${encodeURIComponent(mesh)}`);
    expect(resolveSharedMesh(view.meshId, byId)).toBe(DEFAULT_MESH_ID);
    expect(view.year).toBe(2070);
  });

  it('validates each field independently', () => {
    const view = readSharedView('?year=2021&mesh=594137753');
    expect(view.year).toBe(DEFAULT_YEAR);
    expect(resolveSharedMesh(view.meshId, byId)).toBe('594137753');
  });

  it('defers the requested mesh until its actual dataset has loaded', () => {
    const view = readSharedView('?year=2070&mesh=594137753');
    expect(resolveSharedMesh(view.meshId)).toBe(DEFAULT_MESH_ID);
    expect(resolveSharedMesh(view.meshId, new Map())).toBe(DEFAULT_MESH_ID);
    expect(resolveSharedMesh(view.meshId, byId)).toBe('594137753');
  });

  it('accepts all 692 loaded meshes, including zero-population cells', () => {
    expect(byId.get('594115541')!.properties.population[2070]).toBe(0);
    for (const id of byId.keys()) expect(resolveSharedMesh(id, byId)).toBe(id);
  });
});

describe('shared URL serialization', () => {
  it('preserves the origin, path, unrelated parameters and hash', () => {
    const url = new URL(sharedViewUrl('https://example.com/terrain/?acceptance=1&tag=a&tag=b#details', { year: 2070, meshId: '594115541' }));
    expect(url.origin).toBe('https://example.com');
    expect(url.pathname).toBe('/terrain/');
    expect(url.hash).toBe('#details');
    expect([...url.searchParams]).toEqual([['acceptance', '1'], ['tag', 'a'], ['tag', 'b'], ['year', '2070'], ['mesh', '594115541']]);
  });

  it('replaces duplicate state fields and round-trips only year and mesh', () => {
    const view = { year: 2020, meshId: '594137753' } as const;
    const url = sharedViewUrl('https://example.com/?year=bad&year=2050&mesh=x&mesh=y', view);
    expect(url).toBe('https://example.com/?year=2020&mesh=594137753');
    expect(readSharedView(new URL(url).search)).toEqual(view);
    expect(sharedViewUrl(url, view)).toBe(url);
  });
});
