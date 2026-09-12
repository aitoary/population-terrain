import { FEATURED_LOCATIONS, FEATURED_YEAR } from '../config/featuredLocations';
import { changeRate, formatChangeRate } from '../domain/population';
import type { PopulationDataset } from '../domain/types';

export function FeaturedLocations({ data, selectedId, onSelect }: {
  data: PopulationDataset | null; selectedId: string; onSelect: (meshId: string) => void;
}) {
  return <section className="featured-locations" aria-labelledby="featured-heading">
    <div className="featured-title"><h2 id="featured-heading">注目地点</h2><span>2070年・2020年比</span></div>
    <p className="note">見る場所に迷ったら、この3地点から。選ぶと2070年へ移動します。</p>
    <ul className="featured-list">
      {FEATURED_LOCATIONS.map(({ meshId, name, description }) => {
        const feature = data?.byId.get(meshId);
        const baseline = feature?.properties.population[2020] ?? null;
        const future = feature?.properties.population[FEATURED_YEAR] ?? null;
        const rate = changeRate(baseline, future);
        return <li key={meshId} className="featured-location" data-testid="featured-location" data-mesh-id={meshId}
          data-baseline={baseline ?? 'null'} data-population={future ?? 'null'} data-rate={rate ?? 'null'}>
          <button type="button" className="featured-select" disabled={!feature}
            aria-label={`${name}を2070年で見る`} aria-pressed={selectedId === meshId}
            aria-describedby={`featured-description-${meshId} featured-rate-${meshId}`}
            onClick={() => onSelect(meshId)}>
            <span className="featured-heading"><strong className="featured-name">{name}</strong><span className="featured-rate" id={`featured-rate-${meshId}`}><span className="visually-hidden">2070年の2020年比 </span>{formatChangeRate(rate)}</span></span>
            <span className="featured-description" id={`featured-description-${meshId}`}>{description}</span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
