import { FEATURED_LOCATIONS, FEATURED_YEAR } from '../config/featuredLocations';
import { changeRate, formatChangeRate, formatPopulation } from '../domain/population';
import type { PopulationDataset } from '../domain/types';
import { ShareLink } from './ShareLink';

export function FeaturedLocations({ data, selectedId, onSelect }: {
  data: PopulationDataset | null; selectedId: string; onSelect: (meshId: string) => void;
}) {
  return <section className="featured-locations" aria-labelledby="featured-heading">
    <h2 id="featured-heading">注目地点</h2>
    <p className="note">選ぶと2070年へ移動します。2020年に戻して再生すると、推移をたどれます。地形の読込中は準備後に移動します。</p>
    <ul className="featured-list">
      {FEATURED_LOCATIONS.map(({ meshId, name, description }) => {
        const feature = data?.byId.get(meshId);
        const baseline = feature?.properties.population[2020] ?? null;
        const future = feature?.properties.population[FEATURED_YEAR] ?? null;
        const rate = changeRate(baseline, future);
        return <li key={meshId} className="featured-card" data-testid="featured-card" data-mesh-id={meshId}
          data-baseline={baseline ?? 'null'} data-population={future ?? 'null'} data-rate={rate ?? 'null'}>
          <button type="button" className="featured-select" disabled={!feature}
            aria-label={`${name}を2070年で見る`} aria-pressed={selectedId === meshId}
            onClick={() => onSelect(meshId)}>
            <span className="featured-heading"><strong className="featured-name">{name}</strong><span className="featured-rate">増減率 {formatChangeRate(rate)}</span></span>
            <span className="featured-years">2020年 → 2070年（推計）</span>
            <span className="featured-values">{formatPopulation(baseline)} → {formatPopulation(future)}</span>
            <span className="note">{description}</span>
          </button>
          <ShareLink disabled={!feature} view={{ year: FEATURED_YEAR, meshId }}
            label={`${name}のリンクをコピー`} statusTestId={`featured-share-${meshId}`} />
        </li>;
      })}
    </ul>
    <p className="note">数値は500mメッシュ全体の人口です。PLATEAU建物の整備範囲外にも人口があり、建物が見えないことは無人・非居住を意味しません。</p>
  </section>;
}
