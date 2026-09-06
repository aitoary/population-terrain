import { readFileSync } from 'node:fs';
import { Cartesian3, Cartographic, Color, ConstantProperty, HeightReference, JulianDate, Math as CesiumMath } from 'cesium';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CELLS } from '../config/sampleCells';
import { parsePopulation } from '../data/loadPopulation';
import { YEARS, type MeshFeature } from '../domain/types';
import { CHANGE_STYLES, changeCategory, changeRate } from '../domain/population';
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

describe('T07 full-city updates', () => {
  it('keeps all 692 entities, bases, properties and original corners through all 11 years', () => {
    const all = collection.features;
    const heights = new Map(all.map((feature, index) => [feature.id, base(feature, index + 2)]));
    const layer = buildPopulationLayer(all, heights, 2050);
    const originals = layer.source.entities.values.map((entity) => ({ entity, height: entity.polygon!.height, hierarchy: entity.polygon!.hierarchy, extrusion: entity.polygon!.extrudedHeight, material: entity.polygon!.material, properties: entity.properties }));
    for (const year of YEARS) {
      layer.setYear(year);
      expect(layer.source.entities.values).toHaveLength(692);
      for (const [index, feature] of all.entries()) {
        const original = originals[index]!;
        const entity = layer.source.entities.getById(`mesh:${feature.id}`)!;
        const polygon = entity.polygon!;
        const value = feature.properties.population[year]!;
        expect(entity).toBe(original.entity);
        expect(entity.properties).toBe(original.properties);
        expect(polygon.height).toBe(original.height);
        expect(polygon.hierarchy).toBe(original.hierarchy);
        expect(polygon.extrudedHeight).toBe(original.extrusion);
        expect(polygon.material).toBe(original.material);
        expect(polygon.extrudedHeight).toBeInstanceOf(ConstantProperty);
        expect(polygon.extrudedHeight!.getValue(at) - polygon.height!.getValue(at)).toBeCloseTo(value * 0.5, 10);
        expect(entity.properties!.population!.getValue(at)).toBe(value);
        expect(entity.properties!.year!.getValue(at)).toBe(year);
        const color = Color.fromCssColorString(CHANGE_STYLES[changeCategory(changeRate(feature.properties.population[2020], value))].color).withAlpha(value === 0 ? 0.1 : 0.25);
        expect(polygon.material!.getValue(at).color).toEqual(color);
        const positions: Cartesian3[] = polygon.hierarchy!.getValue(at).positions;
        positions.forEach((point, vertex) => {
          const cartographic = Cartographic.fromCartesian(point);
          expect(CesiumMath.toDegrees(cartographic.longitude)).toBeCloseTo(feature.geometry.coordinates[0][vertex]![0], 10);
          expect(CesiumMath.toDegrees(cartographic.latitude)).toBeCloseTo(feature.geometry.coordinates[0][vertex]![1], 10);
        });
      }
    }
    layer.destroy(); layer.destroy(); expect(layer.source.entities.values).toHaveLength(0);
    layer.setYear(2050); expect(layer.source.entities.values).toHaveLength(0);
  });
  it('updates opacity, selection and visibility without changing geometry', () => {
    const layer = buildPopulationLayer(features, bases, 2050);
    const entity = layer.source.entities.values[0]!;
    const hierarchy = entity.polygon!.hierarchy;
    layer.setOpacity(0.8); layer.setSelectedMesh(features[0]!.id);
    expect(entity.polygon!.material!.getValue(at).color.alpha).toBe(0.8);
    expect(entity.polyline!.width!.getValue(at)).toBe(5);
    const selectedPoint = Cartographic.fromCartesian(entity.polyline!.positions!.getValue(at)[0]);
    expect(selectedPoint.height).toBeCloseTo(entity.polygon!.extrudedHeight!.getValue(at), 6);
    layer.setYear(2070);
    expect(entity.polyline!.material!.getValue(at).color).toEqual(Color.WHITE);
    layer.setSelectedMesh(null); expect(entity.polyline!.width!.getValue(at)).toBe(2);
    layer.setVisible(false); expect(layer.source.show).toBe(false);
    layer.setVisible(true); expect(layer.source.show).toBe(true);
    expect(entity.polygon!.hierarchy).toBe(hierarchy);
    expect(() => layer.setOpacity(Number.NaN)).toThrow();
    expect(() => layer.setOpacity(0)).toThrow();
    expect(() => layer.setYear(2021 as 2020)).toThrow();
  });
  it('transitions null to real values and back without treating null as zero', () => {
    const feature = withPopulation(null);
    const layer = buildPopulationLayer([feature], bases, 2050);
    layer.setYear(2020); expect(layer.rows[0]!.length).toBe(653.5813 * 0.5);
    layer.setYear(2050); expect(layer.rows[0]!.length).toBeNull();
    expect(layer.source.entities.values[0]!.polygon!.extrudedHeight).toBeUndefined();
  });
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
