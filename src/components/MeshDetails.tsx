import type { Ref } from 'react';
import { changeRate, formatChangeRate, formatPopulation, populationDifference } from '../domain/population';
import { FEATURED_LOCATIONS } from '../config/featuredLocations';
import type { MeshFeature, Year } from '../domain/types';
import { PopulationTrendChart } from './PopulationTrendChart';
import { ShareLink } from './ShareLink';
export function MeshDetails({ features, selectedId, year, onSelect, headingRef }: {
  features: readonly MeshFeature[]; selectedId: string; year: Year; onSelect: (id: string) => void; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const feature = features.find((item) => item.id === selectedId);
  const baseline = feature?.properties.population[2020] ?? null;
  const value = feature?.properties.population[year] ?? null;
  const difference = populationDifference(baseline, value);
  const rate = changeRate(baseline, value);
  const name = FEATURED_LOCATIONS.find((location) => location.meshId === selectedId)?.name ?? '選択地点';
  return <section className="mesh-details" aria-labelledby="mesh-heading" data-testid="mesh-details" data-mesh-id={selectedId} data-year={year} data-population={value ?? 'null'} data-baseline={baseline ?? 'null'} data-rate={rate ?? 'null'}>
    <div className="mesh-summary">
      <h2 id="mesh-heading" ref={headingRef} tabIndex={-1}>{name}</h2>
      {feature ? <dl>
        <div><dt>{year}年 人口</dt><dd className="current-population">{formatPopulation(value)}</dd></div>
        <div><dt>2020年比</dt><dd>{baseline === 0 ? '算出不可（基準人口0）' : formatChangeRate(rate)}</dd></div>
      </dl> : <p>人口データの読込後に数値を表示します。</p>}
      <p className="note">500mメッシュ全体の人口。将来値は推計です。</p>
      <ShareLink key={`${year}:${selectedId}`} disabled={!feature} />
    </div>
    <details className="mesh-more">
      <summary>詳しく見る</summary>
      <label htmlFor="mesh-select">メッシュID（人口非表示・0人でも選択可）</label>
      <select id="mesh-select" value={selectedId} disabled={!features.length} onChange={(event) => onSelect(event.target.value)}>
        {!features.length && <option value={selectedId}>{selectedId} · 読込待機中</option>}
        {features.map((item) => <option key={item.id} value={item.id}>{item.id}{item.id === '594137654' ? '（宮古駅を含む）' : ''}</option>)}
      </select>
      {feature && <>
        <dl>
          <div><dt>2020年 基準人口</dt><dd>{formatPopulation(baseline)}</dd></div>
          <div><dt>増減人数</dt><dd>{difference === null ? '算出不可' : `${difference > 0 ? '+' : ''}${difference.toFixed(1)}人`}</dd></div>
        </dl>
        <PopulationTrendChart population={feature.properties.population} year={year} />
      </>}
    </details>
  </section>;
}
