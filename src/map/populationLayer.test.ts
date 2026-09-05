import { readFileSync } from 'node:fs';
import { Cartesian3, Cartographic, HeightReference, JulianDate, Math as CesiumMath } from 'cesium';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CELLS } from '../config/sampleCells';
import { parsePopulation } from '../data/loadPopulation';
import type { MeshFeature } from '../domain/types';
import { buildPopulationLayer } from './populationLayer';
import type { TerrainBaseResult } from './terrainSampling';

const collection = parsePopulation(JSON.parse(readFileSync(new URL('../../public/data/miyako-population.geojson', import.meta.url), 'utf8')));
const features = SAMPLE_CELLS.map(({ meshId }) => collection.features.find((feature) => feature.id === meshId)!);
const at = JulianDate.fromIso8601('2026-09-05T00:00:00Z');
function base(feature: MeshFeature, height = 102): TerrainBaseResult {
  return { status: 'ready', meshId: feature.id, baseHeight: height, minHeight: height - 12, maxHeight: height - 2, heights: Array.from({ length: 9 }, () => height - 2) };
}
const bases = new Map(features.map((feature) => [feature.id, base(feature)]));
const withPopulation = (population: number | null): MeshFeature => ({
  ...features[0]!, properties: { ...features[0]!.properties, population: { ...features[0]!.properties.population, 2050: population } },
});

describe('T06 real-cell extrusion', () => {
  it('creates exactly three cell entities and separates B from L', () => {
    const { source, rows } = buildPopulationLayer(features, bases, 2050);
    expect(source.entities.values).toHaveLength(3);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const polygon = source.entities.getById(`mesh:${row.feature.id}`)!.polygon!;
      const raw = row.feature.properties.population[2050]!;
      expect(polygon.height!.getValue(at)).toBe(102);
      expect(polygon.extrudedHeight!.getValue(at)).toBe(102 + raw * 0.5);
      expect(row.length).toBe(raw * 0.5);
      expect(polygon.perPositionHeight!.getValue(at)).toBe(false);
      expect(polygon.heightReference!.getValue(at)).toBe(HeightReference.NONE);
      expect(polygon.extrudedHeightReference!.getValue(at)).toBe(HeightReference.NONE);
    }
  });

  it('uses source polygon coordinates, never mesh-code-generated squares', () => {
    const { source } = buildPopulationLayer(features, bases, 2050);
    for (const feature of features) {
      const positions: Cartesian3[] = source.entities.getById(`mesh:${feature.id}`)!.polygon!.hierarchy!.getValue(at).positions;
      expect(positions).toHaveLength(4);
      positions.forEach((point, index) => {
        const coordinates = Cartographic.fromCartesian(point);
        const original = feature.geometry.coordinates[0][index]!;
        expect(CesiumMath.toDegrees(coordinates.longitude)).toBeCloseTo(original[0], 10);
        expect(CesiumMath.toDegrees(coordinates.latitude)).toBeCloseTo(original[1], 10);
      });
    }
  });

  it('does not invent a minimum height for a real small positive population', () => {
    const { source, rows } = buildPopulationLayer(features, bases, 2050);
    const row = rows.find((item) => item.feature.id === '594137563')!;
    expect(row.feature.properties.population[2050]).toBe(1.6294);
    expect(row.length).toBe(0.8147);
    const polygon = source.entities.getById('mesh:594137563')!.polygon!;
    expect(polygon.extrudedHeight!.getValue(at) - polygon.height!.getValue(at)).toBeCloseTo(0.8147, 12);
  });

  it('leaves a zero-population footprint with its mesh ID and boundary', () => {
    const feature = withPopulation(0);
    const { source, rows } = buildPopulationLayer([feature], bases, 2050);
    const entity = source.entities.getById(`mesh:${feature.id}`)!;
    expect(entity.polygon!.extrudedHeight!.getValue(at)).toBe(entity.polygon!.height!.getValue(at));
    expect(entity.polyline!.positions!.getValue(at)).toHaveLength(5);
    expect(rows[0]!.length).toBe(0);
    expect(entity.properties!.population!.getValue(at)).toBe(0);
  });

  it('retains missing population as null rather than a zero-length column', () => {
    const feature = withPopulation(null);
    const { source, rows } = buildPopulationLayer([feature], bases, 2050);
    expect(rows[0]!.length).toBeNull();
    expect(source.entities.getById(`mesh:${feature.id}`)!.polygon!.extrudedHeight).toBeUndefined();
  });

  it('omits only geometry when terrain failed and preserves the numeric row', () => {
    const feature = features[0]!;
    const failure: TerrainBaseResult = { status: 'error', meshId: feature.id, message: 'test: terrain unavailable' };
    for (const heights of [new Map<string, TerrainBaseResult>(), new Map([[feature.id, failure]])]) {
      const { source, rows } = buildPopulationLayer([feature], heights, 2050);
      expect(source.entities.values).toHaveLength(0);
      expect(rows[0]!.feature.properties.population[2050]).toBe(377.5496);
      expect(rows[0]!.length).toBe(188.7748);
    }
  });

  it.each([-20, 0, 123.5, 2500])('100→50 halves actual PolygonGraphics length for B=%s (test-only population)', (height) => {
    const feature100 = withPopulation(100);
    const feature50 = withPopulation(50);
    const heights = new Map([[feature100.id, base(feature100, height)]]);
    const a = buildPopulationLayer([feature100], heights, 2050).source.entities.values[0]!.polygon!;
    const b = buildPopulationLayer([feature50], heights, 2050).source.entities.values[0]!.polygon!;
    expect(a.extrudedHeight!.getValue(at) - a.height!.getValue(at)).toBe(50);
    expect(b.extrudedHeight!.getValue(at) - b.height!.getValue(at)).toBe(25);
  });
});
