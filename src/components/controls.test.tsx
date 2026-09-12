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
import { CHANGE_STYLES, METERS_PER_PERSON } from '../domain/population';
const feature = (baseline: number | null, value: number | null): MeshFeature => ({ type: 'Feature', id: 'test', geometry: { type: 'Polygon', coordinates: [[]] }, properties: { meshId: 'test', cityCode: '03202', population: { ...Object.fromEntries(YEARS.map((year) => [year, value])), 2020: baseline } as MeshFeature['properties']['population'] } });
describe('T09/T10 props-only accessible UI', () => {
  it.each(YEARS)('renders only the five-year range at %s', (year) => {
    const html = renderToStaticMarkup(<YearControl year={year} onChange={() => {}} />);
    expect(html).toContain('min="2020"'); expect(html).toContain('max="2070"'); expect(html).toContain('step="5"'); expect(html).toContain(`value="${year}"`);
  });
  it('renders playback stopped with an accessible label and no automatic start', () => {
    const html = renderToStaticMarkup(<YearControl year={2050} onChange={() => {}} />);
    expect(html).toContain('aria-label="再生"');
    expect(html).toContain('>再生</button>');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('role="status"');
    expect(html).toContain('>停止中</span>');
  });
  it('advances every 900ms through the fixed years and stops at 2070', () => {
    expect(PLAYBACK_INTERVAL_MS).toBe(900);
    expect(YEARS.map(nextPopulationYear)).toEqual([...YEARS.slice(1), null]);
    const html = renderToStaticMarkup(<YearControl year={2070} onChange={() => {}} />);
    expect(html).toContain('aria-label="2020年から再生"');
    expect(html).toContain('>2020年から再生</button>');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-pressed="false"');
  });
  it.each([[100, 0, '0人'], [0, 50, '算出不可（基準人口0）'], [100, null, 'データなし'], [null, 50, '算出不可'], [100, 0.01, '0.1人未満']] as const)('labels baseline %s / future %s honestly in the summary', (baseline, value, text) => {
    const html = renderToStaticMarkup(<MeshDetails features={[feature(baseline, value)]} selectedId="test" year={2050} onSelect={() => {}} />);
    expect(html.split('<details')[0]).toContain(text);
  });
  it('keeps only the unnamed place, current population, rate, note and one share button in the summary', () => {
    const html = renderToStaticMarkup(<MeshDetails features={[feature(100, 25)]} selectedId="test" year={2070} onSelect={() => {}} />);
    const [summary, more] = html.split('<details');
    expect(summary).toContain('>選択地点</h2>');
    expect(summary!.match(/<dt>/g)).toHaveLength(2);
    expect(summary).toContain('500mメッシュ全体の人口。将来値は推計です。');
    expect(summary).toContain('この表示をコピー');
    for (const text of ['基準人口', '増減人数', 'mesh-select', 'population-trend', '減少（']) expect(summary).not.toContain(text);
    for (const text of ['詳しく見る', '基準人口', '増減人数', 'mesh-select', 'population-trend', '年別人口']) expect(more).toContain(text);
    expect(more).not.toContain('この表示をコピー');
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).not.toContain('open=""');
  });
  it('only shows the trend after the selected mesh is available', () => {
    const pending = renderToStaticMarkup(<MeshDetails features={[]} selectedId="test" year={2050} onSelect={() => {}} />);
    expect(pending).not.toContain('data-testid="population-trend"');
    const loaded = renderToStaticMarkup(<MeshDetails features={[feature(100, 0)]} selectedId="test" year={2070} onSelect={() => {}} />);
    expect(loaded).toContain('data-testid="population-trend" data-year="2070"');
    expect(loaded.indexOf('</dl>')).toBeLessThan(loaded.indexOf('data-testid="population-trend"'));
    expect(loaded.match(/>この表示をコピー<\/button>/g)).toHaveLength(1);
  });
  it('renders independent visibility and opacity controls', () => {
    const html = renderToStaticMarkup(<LayerControls layers={{ population: true, border: false, buildings: true }} opacity={0.25} onVisibility={() => {}} onOpacity={() => {}} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3); expect(html).toContain('min="0.1"'); expect(html).toContain('max="0.8"');
    expect(html).toContain('<details class="display-settings"><summary>表示設定</summary>');
    expect(html).not.toContain('open=""');
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
  it('keeps renderer categories on the map and consolidates explanations in data notes', () => {
    const html = renderToStaticMarkup(<Legend />);
    const basic = html.split('<details')[0]!;
    for (const [category, style] of Object.entries(CHANGE_STYLES)) {
      expect(basic).toContain(`data-category="${category}"`);
      expect(basic).toContain(`background-color:${style.color}`);
      expect(basic).toContain(style.label);
    }
    expect(basic.match(/class="swatch"/g)).toHaveLength(7);
    for (const text of ['色：2020年からの人口増減率', '柱の高さ：表示年の人口', '白枠：選択中']) expect(basic).toContain(text);
    expect(html).not.toContain('<details');
    const notes = renderToStaticMarkup(<DataNotes />);
    expect(notes).toContain('<summary>データについて</summary>');
    expect(notes).toContain(`${METERS_PER_PERSON}m/人`);
    expect(notes).toContain('欠損も柱を立てず');
    expect(notes).toContain('丸め前の値');
    expect(notes).not.toContain('open=""');
    expect(basic).not.toContain('m/人');
    expect(html).not.toContain('人口レイヤーは非表示です');
    expect(renderToStaticMarkup(<Legend populationVisible={false} />)).toContain('role="status">人口レイヤーは非表示です');
  });
});
