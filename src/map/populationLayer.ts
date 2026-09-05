import {
  Cartesian3, Color, ColorMaterialProperty, ConstantProperty, CustomDataSource,
  HeightReference, PolygonHierarchy,
} from 'cesium';
import { CHANGE_STYLES, changeCategory, changeRate, columnDimensions, populationHeight } from '../domain/population';
import type { MeshFeature, Year } from '../domain/types';
import type { TerrainBaseResult } from './terrainSampling';

export type InspectionRow = {
  feature: MeshFeature;
  terrain: TerrainBaseResult | undefined;
  length: number | null;
};

/** T06 diagnostic layer only: supplied cells and one fixed year, not the full-city update API. */
export function buildPopulationLayer(
  features: readonly MeshFeature[],
  bases: ReadonlyMap<string, TerrainBaseResult>,
  year: Year,
): { source: CustomDataSource; rows: InspectionRow[] } {
  const source = new CustomDataSource(`population-inspection-${year}`);
  const rows: InspectionRow[] = [];
  for (const feature of features) {
    const terrain = bases.get(feature.id);
    const population = feature.properties.population[year];
    rows.push({ feature, terrain, length: populationHeight(population) });
    // No ellipsoid-zero fallback. Values remain in the inspector even when geometry cannot be placed.
    if (!terrain || terrain.status === 'error') continue;
    const dimensions = columnDimensions(terrain.baseHeight, population);
    const category = changeCategory(changeRate(feature.properties.population[2020], population));
    const color = Color.fromCssColorString(CHANGE_STYLES[category].color);
    const ring = feature.geometry.coordinates[0];
    const perimeter = ring.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude, terrain.baseHeight));
    const vertices = ring.slice(0, -1).map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude));
    const flat = population === 0 || population === null;
    source.entities.add({
      id: `mesh:${feature.id}`,
      name: `500mメッシュ ${feature.id}`,
      properties: { meshId: feature.id, year, population, baseHeight: terrain.baseHeight, length: dimensions?.length ?? null },
      polygon: {
        hierarchy: new ConstantProperty(new PolygonHierarchy(vertices)),
        height: new ConstantProperty(terrain.baseHeight),
        extrudedHeight: dimensions ? new ConstantProperty(dimensions.extrudedHeight) : undefined,
        perPositionHeight: new ConstantProperty(false),
        heightReference: new ConstantProperty(HeightReference.NONE),
        extrudedHeightReference: new ConstantProperty(HeightReference.NONE),
        material: new ColorMaterialProperty(color.withAlpha(flat ? 0.10 : 0.25)),
        closeTop: true,
        closeBottom: true,
      },
      // A real zero still has a pickable footprint. Missing population is separately labelled.
      polyline: { positions: perimeter, width: 2, material: color.withAlpha(0.9), clampToGround: false },
    });
  }
  return { source, rows };
}
