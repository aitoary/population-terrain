import { FEATURED_LOCATIONS } from '../config/featuredLocations';
import type { PopulationDataset } from '../domain/types';

export function FeaturedLocations({ data, selectedId, onSelect }: {
  data: PopulationDataset | null; selectedId: string; onSelect: (meshId: string) => void;
}) {
  return <section className="featured-locations" aria-labelledby="featured-heading">
    <h2 id="featured-heading">場所を選ぶ</h2>
    <ul className="featured-list">
      {FEATURED_LOCATIONS.map(({ meshId, name }) => {
        const feature = data?.byId.get(meshId);
        return <li key={meshId} className="featured-location" data-testid="featured-location" data-mesh-id={meshId}>
          <button type="button" className="featured-select" disabled={!feature}
            aria-label={`${name}を2070年で見る`} aria-pressed={selectedId === meshId}
            onClick={() => onSelect(meshId)}>
            <span className="featured-check" aria-hidden="true">{selectedId === meshId ? '✓' : ''}</span>
            <span>{name}</span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
