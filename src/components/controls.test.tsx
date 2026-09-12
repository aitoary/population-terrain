import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { nextPopulationYear, PLAYBACK_INTERVAL_MS, YearControl } from './YearControl';
import { LayerControls } from './LayerControls';
import { MeshDetails } from './MeshDetails';
import { Legend } from './Legend';
import { DataNotes } from './DataNotes';
import { Attribution } from './Attribution';
import { ShareLink } from './ShareLink';
import type { MeshFeature } from '../domain/types';
import { YEARS } from '../domain/types';
const feature = (baseline: number | null, value: number | null): MeshFeature => ({ type: 'Feature', id: 'test', geometry: { type: 'Polygon', coordinates: [[]] }, properties: { meshId: 'test', cityCode: '03202', population: { ...Object.fromEntries(YEARS.map((year) => [year, value])), 2020: baseline } as MeshFeature['properties']['population'] } });
describe('T09/T10 props-only accessible UI', () => {
  it.each(YEARS)('renders only the five-year range at %s', (year) => {
    const html = renderToStaticMarkup(<YearControl year={year} onChange={() => {}} />);
    expect(html).toContain('min="2020"'); expect(html).toContain('max="2070"'); expect(html).toContain('step="5"'); expect(html).toContain(`value="${year}"`);
  });
  it('renders playback stopped with an accessible label and no automatic start', () => {
    const html = renderToStaticMarkup(<YearControl year={2050} onChange={() => {}} />);
    expect(html).toContain('aria-label="人口推移を再生（停止中）"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('role="status"');
    expect(html).toContain('>停止中</span>');
  });
  it('advances every 900ms through the fixed years and stops at 2070', () => {
    expect(PLAYBACK_INTERVAL_MS).toBe(900);
    expect(YEARS.map(nextPopulationYear)).toEqual([...YEARS.slice(1), null]);
    const html = renderToStaticMarkup(<YearControl year={2070} onChange={() => {}} />);
    expect(html).toContain('aria-label="人口推移を再生（2070年で停止中）"');
    expect(html).toContain('disabled=""');
  });
  it.each([[100, 0, '0人（平面）'], [0, 50, '算出不可（基準人口0）'], [100, null, 'データなし'], [100, 0.01, '0.1人未満']] as const)('labels baseline %s / future %s honestly', (baseline, value, text) => {
    expect(renderToStaticMarkup(<MeshDetails features={[feature(baseline, value)]} selectedId="test" year={2050} onSelect={() => {}} />)).toContain(text);
  });
  it('only shows the trend after the selected mesh is available', () => {
    const pending = renderToStaticMarkup(<MeshDetails features={[]} selectedId="test" year={2050} onSelect={() => {}} />);
    expect(pending).not.toContain('data-testid="population-trend"');
    const loaded = renderToStaticMarkup(<MeshDetails features={[feature(100, 0)]} selectedId="test" year={2070} onSelect={() => {}} />);
    expect(loaded).toContain('data-testid="population-trend" data-year="2070"');
    expect(loaded.indexOf('</dl>')).toBeLessThan(loaded.indexOf('data-testid="population-trend"'));
  });
  it('renders independent visibility and opacity controls', () => {
    const html = renderToStaticMarkup(<LayerControls layers={{ population: true, border: false, buildings: true }} opacity={0.25} onVisibility={() => {}} onOpacity={() => {}} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3); expect(html).toContain('min="0.1"'); expect(html).toContain('max="0.8"');
  });
  it('keeps sharing unavailable until population data is validated', () => {
    const loading = renderToStaticMarkup(<ShareLink disabled />);
    expect(loading).toContain('この表示をコピー');
    expect(loading).toContain('disabled=""');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('人口データの読込後にコピーできます。');
    expect(renderToStaticMarkup(<ShareLink disabled={false} />)).not.toContain('disabled=""');
  });
  it('provides the coefficient, fixed categories, temporal caveats, licenses and credits', () => {
    const html = renderToStaticMarkup(<><Legend /><DataNotes /><Attribution /></>);
    for (const text of ['0.5m/人', '75%', '2055', '1km', '2025年度', '692', 'CC BY 4.0', '地理院タイル', '整備範囲外', 'PTN']) expect(html).toContain(text);
  });
});
