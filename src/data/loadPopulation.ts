import { DATA_SOURCES } from '../config/dataSources';
import { YEARS } from '../domain/types';
import type {
  Bbox, MeshFeature, Population, PopulationCollection, PopulationDataset, PopulationMetadata, Position, Year,
} from '../domain/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`人口データ契約違反: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), `${label} はオブジェクトではありません`);
  return value as Record<string, unknown>;
}

function population(value: unknown, label: string): Population {
  if (value === null) return null;
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${label} は人口の数値またはnullではありません`);
  return value;
}

function count(value: unknown, label: string): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `${label} は非負の整数ではありません`);
  return value;
}

function position(value: unknown, label: string): Position {
  check(Array.isArray(value) && value.length === 2, `${label} は[経度, 緯度]ではありません`);
  const [longitude, latitude] = value;
  check(typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180, `${label}: 経度不正`);
  check(typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90, `${label}: 緯度不正`);
  return [longitude, latitude];
}

function yearRecord<T>(value: unknown, label: string, parse: (entry: unknown, label: string) => T): Record<Year, T> {
  const values = object(value, label);
  check(Object.keys(values).length === YEARS.length && YEARS.every((year) => Object.hasOwn(values, year)), `${label}: 2020〜2070の11年が必要です`);
  return Object.fromEntries(YEARS.map((year) => [year, parse(values[year], `${label}.${year}`)])) as Record<Year, T>;
}

export function parsePopulation(value: unknown): PopulationCollection {
  const source = object(value, 'GeoJSON');
  check(source.type === 'FeatureCollection', 'FeatureCollectionではありません');
  check(!Object.hasOwn(source, 'crs'), '旧式のCRS宣言があります。前処理を確認してください');
  check(Array.isArray(source.features) && source.features.length > 0, 'セルがありません。0人口とは扱いません');
  const ids = new Set<string>();
  const features: MeshFeature[] = source.features.map((raw, index) => {
    const feature = object(raw, `features[${index}]`);
    check(feature.type === 'Feature', `features[${index}]の型が不正です`);
    const id = feature.id;
    check(typeof id === 'string' && /^[0-9]{9}$/.test(id), 'Feature.idは9桁の文字列が必要です');
    check(!ids.has(id), `${id}: IDが重複しています`);
    ids.add(id);
    const properties = object(feature.properties, `${id}.properties`);
    check(properties.meshId === id && properties.cityCode === '03202', `${id}: ID/自治体コードが不一致です`);
    const values = yearRecord(properties.population, `${id}.population`, population);
    const geometry = object(feature.geometry, `${id}.geometry`);
    check(geometry.type === 'Polygon', `${id}: Polygonが必要です`);
    const rings = geometry.coordinates;
    check(Array.isArray(rings) && rings.length === 1 && Array.isArray(rings[0]) && rings[0].length === 5, `${id}: 単一の矩形リングが必要です`);
    const ring = rings[0].map((point, i) => position(point, `${id}.coordinates[${i}]`));
    const first = ring[0]!;
    const last = ring[4]!;
    check(first[0] === last[0] && first[1] === last[1], `${id}: リングが閉じていません`);
    const corners = ring.slice(0, 4);
    check(new Set(corners.map((point) => point[0])).size === 2 && new Set(corners.map((point) => point[1])).size === 2
      && new Set(corners.map((point) => point.join(','))).size === 4, `${id}: 原典の矩形ではありません`);
    for (let i = 0; i < 4; i += 1) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      check((a[0] === b[0]) !== (a[1] === b[1]), `${id}: 自己交差または対角線の辺です`);
    }
    return { type: 'Feature', id, properties: { meshId: id, cityCode: '03202', population: values },
      geometry: { type: 'Polygon', coordinates: [ring] } };
  });
  return { type: 'FeatureCollection', features };
}

export function meshBbox(feature: MeshFeature): Bbox {
  const ring = feature.geometry.coordinates[0];
  return [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])),
    Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];
}

export function parseMetadata(value: unknown): PopulationMetadata {
  const meta = object(value, 'metadata');
  check(meta.schemaVersion === 1 && meta.cityCode === '03202' && meta.series === 'PTN', 'schemaVersion/自治体/PTN系列を確認してください');
  check(meta.populationDatasetYear === 2024 && meta.buildingDatasetYear === 2025, 'データ年度が変更されています');
  check(Array.isArray(meta.years) && meta.years.length === YEARS.length && meta.years.every((year, i) => year === YEARS[i]), 'metadataの対象年が不正です');
  const meshCount = count(meta.meshCount, 'meshCount');
  check(meshCount > 0, 'metadataのメッシュ数が0です');
  const hashes = object(meta.sourceSha256, 'sourceSha256');
  for (const key of ['population', 'related', 'buildings']) {
    check(typeof hashes[key] === 'string' && /^[a-f0-9]{64}$/.test(hashes[key]), `sourceSha256.${key}が不正です`);
  }
  check(hashes.population === DATA_SOURCES.population.sha256 && hashes.buildings === DATA_SOURCES.buildings.sha256, '原本ハッシュが固定した出典と異なります');
  check(Array.isArray(meta.bbox) && meta.bbox.length === 4, 'bboxが不正です');
  const sw = position(meta.bbox.slice(0, 2), 'bbox southwest');
  const ne = position(meta.bbox.slice(2, 4), 'bbox northeast');
  check(sw[0] < ne[0] && sw[1] < ne[1], 'bboxの向きが不正です');
  return {
    schemaVersion: 1, cityCode: '03202', series: 'PTN', years: YEARS, meshCount,
    populationDatasetYear: 2024, buildingDatasetYear: 2025,
    sourceSha256: { population: hashes.population, related: hashes.related as string, buildings: hashes.buildings },
    totals: yearRecord(meta.totals, 'totals', population),
    nullCounts: yearRecord(meta.nullCounts, 'nullCounts', count),
    zeroCounts: yearRecord(meta.zeroCounts, 'zeroCounts', count),
    bbox: [sw[0], sw[1], ne[0], ne[1]],
  };
}

export function validateDataset(collection: PopulationCollection, metadata: PopulationMetadata): PopulationDataset {
  check(collection.features.length === metadata.meshCount, 'メタデータと実際のメッシュ数が不一致です');
  for (const year of YEARS) {
    let sum = 0;
    let missing = 0;
    let zero = 0;
    for (const feature of collection.features) {
      const value = feature.properties.population[year];
      if (value === null) missing += 1;
      else { sum += value; if (value === 0) zero += 1; }
    }
    check(missing === metadata.nullCounts[year] && zero === metadata.zeroCounts[year], `${year}: null/0件数が不一致です`);
    const expected = metadata.totals[year];
    check(missing === metadata.meshCount ? expected === null : expected !== null && Math.abs(sum - expected) <= 0.01,
      `${year}: 合計がメタデータと不一致です`);
  }
  const bounds = collection.features.map(meshBbox);
  const actual: Bbox = [Math.min(...bounds.map((b) => b[0])), Math.min(...bounds.map((b) => b[1])),
    Math.max(...bounds.map((b) => b[2])), Math.max(...bounds.map((b) => b[3]))];
  check(actual.every((value, index) => Math.abs(value - metadata.bbox[index]!) < 1e-10), 'メタデータと座標範囲が不一致です');
  return { collection, metadata, byId: new Map(collection.features.map((feature) => [feature.id, feature])) };
}

export async function loadPopulation(signal?: AbortSignal): Promise<PopulationDataset> {
  const timeout = AbortSignal.timeout(30000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  async function load(url: string, label: string): Promise<unknown> {
    const response = await fetch(url, { signal: requestSignal });
    if (!response.ok) throw new Error(`${label}の取得失敗: HTTP ${response.status} (${url})`);
    try { return await response.json(); }
    catch (error) { throw new Error(`${label}のJSONを解析できません`, { cause: error }); }
  }
  const [geojson, meta] = await Promise.all([
    load(DATA_SOURCES.population.url, '人口GeoJSON'),
    load(DATA_SOURCES.population.metadataUrl, '人口メタデータ'),
  ]);
  return validateDataset(parsePopulation(geojson), parseMetadata(meta));
}
