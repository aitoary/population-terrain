import {
  Cartesian3, Color, ColorMaterialProperty, ConstantProperty, CustomDataSource,
  HeightReference, PolygonHierarchy, Entity,
} from 'cesium';
import { CHANGE_STYLES, changeCategory, changeRate, columnDimensions, populationHeight } from '../domain/population';
import { YEARS, type MeshFeature, type Year } from '../domain/types';
import type { TerrainBaseResult } from './terrainSampling';

export type InspectionRow = {
  feature: MeshFeature;
  terrain: TerrainBaseResult | undefined;
  length: number | null;
};

export type PopulationLayer = ReturnType<typeof buildPopulationLayer>;

/** Geometry and sampled bases survive year changes; all values are constant between updates. */
export function buildPopulationLayer(
  features: readonly MeshFeature[],
  bases: ReadonlyMap<string, TerrainBaseResult>,
  year: Year,
) {
  const source = new CustomDataSource('population');
    let opacity = 0.25;
    let selected: string | null = null;
    let destroyed = false;
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
      properties: { meshId: feature.id, year, population, baseHeight: terrain.baseHeight, length: dimensions?.length ?? null, selected: false },
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
  function batch(update: () => void) {
      if (destroyed) return;
      source.entities.suspendEvents();
      try { update(); } finally { source.entities.resumeEvents(); }
    }
    function paint(entity: Entity, feature: MeshFeature) {
      const value = feature.properties.population[year];
      const color = Color.fromCssColorString(CHANGE_STYLES[changeCategory(changeRate(feature.properties.population[2020], value))].color);
      ((entity.polygon!.material as ColorMaterialProperty).color as ConstantProperty).setValue(color.withAlpha(value === 0 || value === null ? Math.min(opacity, 0.1) : opacity));
      ((entity.polyline!.material as ColorMaterialProperty).color as ConstantProperty).setValue(feature.id === selected ? Color.WHITE : color.withAlpha(0.9));
      (entity.polyline!.width as ConstantProperty).setValue(feature.id === selected ? 5 : 2);
          if (feature.id === selected || entity.properties!.selected!.getValue()) {
            const baseHeight = entity.properties!.baseHeight!.getValue() as number;
            const height = baseHeight + (feature.id === selected ? populationHeight(value) ?? 0 : 0);
            (entity.polyline!.positions as ConstantProperty).setValue(feature.geometry.coordinates[0].map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude, height)));
          }
          entity.properties!.selected!.setValue(feature.id === selected);
    }
    return {
      source, rows,
      setYear(next: Year) {
        if (!YEARS.includes(next)) throw new RangeError('Unsupported population year');
        if (next === year) return;
        batch(() => {
          year = next;
          for (const row of rows) {
            const value = row.feature.properties.population[year];
            row.length = populationHeight(value);
            const entity = source.entities.getById(`mesh:${row.feature.id}`);
            if (!entity || row.terrain?.status !== 'ready') continue;
            const polygon = entity.polygon!;
            if (value === null) polygon.extrudedHeight = undefined;
            else if (polygon.extrudedHeight) (polygon.extrudedHeight as ConstantProperty).setValue(row.terrain.baseHeight + row.length!);
            else polygon.extrudedHeight = new ConstantProperty(row.terrain.baseHeight + row.length!);
            entity.properties!.year!.setValue(year);
            entity.properties!.population!.setValue(value);
            entity.properties!.length!.setValue(row.length);
            paint(entity, row.feature);
          }
        });
      },
      setOpacity(next: number) {
        if (!Number.isFinite(next) || next < 0.1 || next > 0.8) throw new RangeError('Opacity must be 0.1–0.8');
        if (next === opacity) return;
        batch(() => { opacity = next; for (const row of rows) {
          const entity = source.entities.getById(`mesh:${row.feature.id}`);
          if (entity) paint(entity, row.feature);
        } });
      },
      setVisible(visible: boolean) { if (!destroyed) source.show = visible; },
      setSelectedMesh(meshId: string | null) {
        if (meshId === selected) return;
        batch(() => {
          const previous = selected;
          selected = meshId;
          for (const id of [previous, selected]) {
            const row = rows.find((item) => item.feature.id === id);
            const entity = id ? source.entities.getById(`mesh:${id}`) : undefined;
            if (row && entity) paint(entity, row.feature);
          }
        });
      },
      destroy() { if (!destroyed) { destroyed = true; source.entities.removeAll(); } },
    };
}
