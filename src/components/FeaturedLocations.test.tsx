import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FEATURED_LOCATIONS } from '../config/featuredLocations';
import { parseMetadata, parsePopulation, validateDataset } from '../data/loadPopulation';
import { changeRate, formatChangeRate, formatPopulation } from '../domain/population';
import { FeaturedLocations } from './FeaturedLocations';
import { MeshDetails } from './MeshDetails';

const data = validateDataset(
  parsePopulation(JSON.parse(readFileSync(new URL('../../public/data/miyako-population.geojson', import.meta.url), 'utf8'))),
  parseMetadata(JSON.parse(readFileSync(new URL('../../public/data/data-meta.json', import.meta.url), 'utf8'))),
);

describe('featured locations from the pinned PTN dataset', () => {
  it.each([
    ['594137744', 1388.8053, 414.4128],
    ['594147883', 414.7807, 116.7621],
    ['594132791', 39.3616, 8.4915],
  ] as const)('uses the actual 2020/2070 values for %s and rounds only the display', (meshId, baseline, future) => {
    expect(data.byId.size).toBe(692);
    expect(FEATURED_LOCATIONS.some((point) => point.meshId === meshId)).toBe(true);
    const population = data.byId.get(meshId)!.properties.population;
    expect(population[2020]).toBe(baseline);
    expect(population[2070]).toBe(future);
    const rate = changeRate(baseline, future);
    const html = renderToStaticMarkup(<FeaturedLocations data={data} selectedId={meshId} onSelect={() => {}} />);
    expect(html).not.toContain('data-population');
    expect(html).not.toContain(formatChangeRate(rate));
    expect(html).toContain('>✓</span>');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    const details = renderToStaticMarkup(<MeshDetails features={data.collection.features} selectedId={meshId} year={2070} onSelect={() => {}} />);
    expect(details).toContain(`>${FEATURED_LOCATIONS.find((point) => point.meshId === meshId)!.name}</h2>`);
    expect(details).toContain(`data-population="${future}" data-baseline="${baseline}" data-rate="${rate}"`);
    expect(details).toContain(formatChangeRate(rate));
    expect(details).toContain(formatPopulation(future));
  });

  it('offers only three place names without descriptions, numbers or duplicate sharing', () => {
    expect(new Set(FEATURED_LOCATIONS.map((point) => point.meshId)).size).toBe(3);
    const html = renderToStaticMarkup(<FeaturedLocations data={data} selectedId="594137654" onSelect={() => {}} />);
    expect(html.match(/data-testid="featured-location"/g)).toHaveLength(3);
    expect(html.match(/type="button"/g)).toHaveLength(3);
    expect(html).toContain('場所を選ぶ');
    expect(html).not.toContain('見る場所に迷ったら');
    for (const { name, description } of FEATURED_LOCATIONS) {
      expect(html).toContain(`aria-label="${name}を2070年で見る"`);
      expect(html).toContain(`>${name}</span>`);
      expect(html).not.toContain(description);
    }
    expect(html).not.toContain('%');
    expect(html).not.toContain('コピー');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('disabled=""');
  });

  it('keeps the three choices disabled while population is unavailable', () => {
    const html = renderToStaticMarkup(<FeaturedLocations data={null} selectedId="594137654" onSelect={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain('data-baseline');
    expect(html).not.toContain('>0人');
  });
});
