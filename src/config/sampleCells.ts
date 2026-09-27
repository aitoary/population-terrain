// 固定済みの宮古市GeoJSONから選んだ実在メッシュ。IDや人口の架空値は使わない。
export const INSPECTION_YEAR = 2050;
export const SAMPLE_CELLS = [
  { meshId: '594137654', label: '宮古駅を含むセル' },
  { meshId: '594137753', label: '駅北西・斜面のセル' },
  { meshId: '594137563', label: '駅南東・低人口セル' },
] as const;
