export const YEARS = [2020, 2025, 2030, 2035, 2040, 2045, 2050, 2055, 2060, 2065, 2070] as const;
export type Year = (typeof YEARS)[number];
export type Population = number | null;
export type Position = readonly [longitude: number, latitude: number];
export type Bbox = readonly [west: number, south: number, east: number, north: number];
export type MeshProperties = {
  meshId: string;
  cityCode: '03202';
  population: Record<Year, Population>;
};
export type MeshFeature = {
  type: 'Feature';
  id: string;
  properties: MeshProperties;
  geometry: { type: 'Polygon'; coordinates: readonly [readonly Position[]] };
};
export type PopulationCollection = { type: 'FeatureCollection'; features: MeshFeature[] };
export type PopulationMetadata = {
  schemaVersion: 1;
  cityCode: '03202';
  series: 'PTN';
  years: readonly Year[];
  meshCount: number;
  populationDatasetYear: 2024;
  buildingDatasetYear: 2025;
  sourceSha256: { population: string; related: string; buildings: string };
  totals: Record<Year, Population>;
  nullCounts: Record<Year, number>;
  zeroCounts: Record<Year, number>;
  bbox: Bbox;
};
export type PopulationDataset = {
  collection: PopulationCollection;
  metadata: PopulationMetadata;
  byId: ReadonlyMap<string, MeshFeature>;
};
