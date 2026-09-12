import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YEARS, type MeshProperties, type Year } from '../domain/types';
import { PopulationTrendChart } from './PopulationTrendChart';

const series = (values: (number | null)[]) => Object.fromEntries(
  YEARS.map((year, index) => [year, values[index] ?? null]),
) as MeshProperties['population'];
const render = (population: MeshProperties['population'], year: Year = 2050) => renderToStaticMarkup(
  <PopulationTrendChart population={population} year={year} />,
);
const line = (html: string) => html.match(/class="population-trend-line" d="([^"]*)"/)?.[1];
const circles = (html: string) => [...html.matchAll(/<circle\b[^>]*>/g)].map(([tag]) => tag);

describe('selected mesh population trend', () => {
  it('breaks the line at missing years while retaining zero and isolated values', () => {
    const html = render(series([10, 0, null, 5, null, null, 2, 1, null, null, null]), 2030);
    expect(line(html)?.match(/M/g)).toHaveLength(3);
    expect(line(html)?.match(/L/g)).toHaveLength(2);
    expect(circles(html)).toHaveLength(5);
    expect(circles(html).some((tag) => tag.includes('data-year="2025"'))).toBe(true);
    expect(circles(html).some((tag) => tag.includes('data-year="2030"'))).toBe(false);
    expect(circles(html).some((tag) => tag.includes('data-current'))).toBe(false);
    expect(html).toContain('現在表示は2030年、データなし');
    expect(html).toContain('<td>0人</td>');
    expect(html).toContain('データなしの年は線をつなぎません。');
  });

  it('draws all-zero series on the zero baseline with a current point', () => {
    const html = render(series(YEARS.map(() => 0)));
    const positions = circles(html).map((tag) => tag.match(/cy="([^"]+)"/)?.[1]);
    expect(positions).toHaveLength(11);
    expect(new Set(positions).size).toBe(1);
    expect(circles(html).filter((tag) => tag.includes('data-current="true"'))).toHaveLength(1);
    expect(html.match(/<td>0人<\/td>/g)).toHaveLength(11);
    expect(html).not.toMatch(/NaN|Infinity|全11時点のデータなし/);
  });

  it('does not invent zero populations for an entirely missing series', () => {
    const html = render(series(YEARS.map(() => null)));
    expect(line(html)).toBeUndefined();
    expect(circles(html)).toHaveLength(0);
    expect(html).toContain('全11時点のデータなし');
    expect(html.match(/<td>データなし<\/td>/g)).toHaveLength(11);
    expect(html).not.toMatch(/NaN|Infinity|<td>0人<\/td>/);
  });

  it('retains the existing formatting and a positive height for populations below 0.1', () => {
    const html = render(series([0, 0.01, 0.025]), 2025);
    const positions = circles(html).map((tag) => Number(tag.match(/cy="([^"]+)"/)?.[1]));
    expect(positions[1]).toBeLessThan(positions[0]!);
    expect(positions[2]).toBeLessThan(positions[1]!);
    expect(html).toContain('現在表示は2025年、0.1人未満');
    expect(html.match(/<td>0.1人未満<\/td>/g)).toHaveLength(2);
  });

  it('keeps the series and scale fixed while the marker and text follow every year', () => {
    const population = series([100, 120, 80, 60, 65, 50, 30, 25, 10, 5, 0]);
    const initial = line(render(population, 2020));
    for (const year of YEARS) {
      const html = render(population, year);
      expect(line(html)).toBe(initial);
      const current = circles(html).filter((tag) => tag.includes('data-current="true"'));
      expect(current).toHaveLength(1);
      expect(current[0]).toContain(`data-year="${year}"`);
      expect(html).toContain(`現在表示は${year}年`);
      expect(html).toContain(`<tr aria-current="true"><th scope="row">${year}年（表示中）</th>`);
    }
  });

  it('provides a labelled image and an accessible table for all eleven years', () => {
    const html = render(series(YEARS.map(() => 100)));
    expect(html).toContain('role="img" aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('横軸は年、縦軸は人口（人）');
    expect(html).toContain('<summary>年別の人口を表示（11時点）</summary>');
    expect(html.match(/scope="row"/g)).toHaveLength(11);
  });
});
