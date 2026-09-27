// 注目地点の選定根拠・座標・全11時点の値は docs/featured-locations.md に記録する。
// ここには、読み込み済みデータから表示する地点IDとUI文言だけを持たせる。
export const FEATURED_YEAR = 2070;
export const FEATURED_LOCATIONS = [
  {
    meshId: '594137744',
    name: '中心部周辺',
    description: '基準人口・減少人数が最大のメッシュ。',
  },
  {
    meshId: '594147883',
    name: '市内北側',
    description: '北側の数百人規模を、中心部と比較。',
  },
  {
    meshId: '594132791',
    name: '内陸西部',
    description: '数十人規模で、減少率と減少人数を比較。',
  },
] as const;
