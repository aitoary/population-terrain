// Curated from all 692 pinned PTN meshes. Values come from the loaded dataset;
// selection rationale, coordinates and all 11 source values: docs/featured-locations.md.
export const FEATURED_YEAR = 2070;
export const FEATURED_LOCATIONS = [
  {
    meshId: '594137744',
    name: '中心部周辺',
    description: '基準人口と減少人数が最大のメッシュで、柱の変化を見比べられます。',
  },
  {
    meshId: '594147883',
    name: '市内北側',
    description: '北側の数百人規模のメッシュで、中心部との違いを見比べられます。',
  },
  {
    meshId: '594132791',
    name: '内陸西部',
    description: '数十人規模のメッシュで、減少率と減少人数の違いを見比べられます。',
  },
] as const;
