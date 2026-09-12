import { changeCategory, CHANGE_STYLES, changeRate, formatChangeRate, formatPopulation, populationDifference } from '../domain/population';
import type { MeshFeature, Year } from '../domain/types';
import { PopulationTrendChart } from './PopulationTrendChart';
import { ShareLink } from './ShareLink';
export function MeshDetails({ features, selectedId, year, onSelect }: {
  features: readonly MeshFeature[]; selectedId: string; year: Year; onSelect: (id: string) => void;
}) {
  const feature = features.find((item) => item.id === selectedId);
  const baseline = feature?.properties.population[2020] ?? null;
  const value = feature?.properties.population[year] ?? null;
  const difference = populationDifference(baseline, value);
  const rate = changeRate(baseline, value);
  return <section className="mesh-details" aria-labelledby="mesh-heading" data-testid="mesh-details" data-mesh-id={selectedId} data-year={year} data-population={value ?? 'null'} data-baseline={baseline ?? 'null'} data-rate={rate ?? 'null'}>
    <h2 id="mesh-heading">選択メッシュ</h2>
    <label htmlFor="mesh-select">メッシュID（人口非表示・0人でも選択可）</label>
    <select id="mesh-select" value={selectedId} disabled={!features.length} onChange={(event) => onSelect(event.target.value)}>
      {!features.length && <option value={selectedId}>{selectedId} · 読込待機中</option>}
      {features.map((item) => <option key={item.id} value={item.id}>{item.id}{item.id === '594137654' ? '（宮古駅を含む）' : ''}</option>)}
    </select>
    {feature ? <><dl>
      <div><dt>2020年 基準人口</dt><dd>{formatPopulation(baseline)}</dd></div>
      <div><dt>{year}年 人口</dt><dd>{formatPopulation(value)}</dd></div>
      <div><dt>増減人数</dt><dd>{difference === null ? '算出不可' : `${difference > 0 ? '+' : ''}${difference.toFixed(1)}人`}</dd></div>
      <div><dt>2020年比</dt><dd>{baseline === 0 ? '算出不可（基準人口0）' : formatChangeRate(rate)}</dd></div>
    </dl><p className="change-state" aria-live="polite">{value === null ? 'データなし' : CHANGE_STYLES[changeCategory(rate)].label}{value === 0 ? ' · 0人（平面）' : ''}</p>
      <PopulationTrendChart population={feature.properties.population} year={year} />
    </> : <p>人口データの読込後に数値を表示します。</p>}
    <p className="note">駅自体や建物別の人口ではなく、500mセル全体の人口です。正の0.1人未満は「0.1人未満」と表示し、計算には丸め前の値を使います。</p>
    <ShareLink key={`${year}:${selectedId}`} disabled={!feature} />
  </section>;
}
