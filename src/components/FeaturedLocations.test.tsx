import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FEATURED_LOCATIONS } from '../config/featuredLocations';
import { parseMetadata, parsePopulation, validateDataset } from '../data/loadPopulation';
import { changeRate, formatChangeRate, formatPopulation } from '../domain/population';
import { FeaturedLocations } from './FeaturedLocations';

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
    expect(html).toContain(`data-baseline="${baseline}" data-population="${future}" data-rate="${rate}"`);
    expect(html).toContain(`${formatPopulation(baseline)} → ${formatPopulation(future)}`);
    expect(html).toContain(`増減率 ${formatChangeRate(rate)}`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('offers three distinct accessible cards and explains the building coverage limit', () => {
    expect(new Set(FEATURED_LOCATIONS.map((point) => point.meshId)).size).toBe(3);
    const html = renderToStaticMarkup(<FeaturedLocations data={data} selectedId="594137654" onSelect={() => {}} />);
    expect(html.match(/data-testid="featured-card"/g)).toHaveLength(3);
    expect(html.match(/type="button"/g)).toHaveLength(6);
    expect(html).toContain('2020年に戻して再生');
    expect(html).toContain('500mメッシュ全体');
    expect(html).toContain('整備範囲外にも人口');
    expect(html).toContain('無人・非居住を意味しません');
    expect(html).not.toContain('disabled=""');
  });

  it('keeps all navigation and copying disabled while population is unavailable', () => {
    const html = renderToStaticMarkup(<FeaturedLocations data={null} selectedId="594137654" onSelect={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(6);
    expect(html.match(/data-baseline="null"/g)).toHaveLength(3);
    expect(html).not.toContain('>0人');
  });
});
