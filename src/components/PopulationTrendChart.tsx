import { useId } from 'react';
import { formatPopulation } from '../domain/population';
import { YEARS, type MeshProperties, type Year } from '../domain/types';

const WIDTH = 280;
const HEIGHT = 156;
const LEFT = 42;
const RIGHT = 266;
const TOP = 28;
const BOTTOM = 118;
const axisFormatter = new Intl.NumberFormat('ja-JP', { maximumSignificantDigits: 3 });

export function PopulationTrendChart({ population, year }: {
  population: MeshProperties['population']; year: Year;
}) {
  const id = useId();
  // Use the whole series so changing the current year never changes the scale.
  const maximum = Math.max(0, ...YEARS.map((value) => population[value] ?? 0));
  const magnitude = 10 ** Math.floor(Math.log10(maximum || 1));
  const ceiling = ([1, 2, 5, 10].find((step) => step * magnitude >= maximum) ?? 10) * magnitude;
  const points = YEARS.map((pointYear, index) => ({
    year: pointYear,
    value: population[pointYear],
    x: LEFT + index * (RIGHT - LEFT) / (YEARS.length - 1),
    y: population[pointYear] === null ? null : BOTTOM - population[pointYear] / ceiling * (BOTTOM - TOP),
  }));
  const current = points[YEARS.indexOf(year)]!;
  const hasData = points.some((point) => point.value !== null);
  const hasMissing = points.some((point) => point.value === null);
  let connected = false;
  const path = points.map((point) => {
    if (point.y === null) {
      connected = false;
      return '';
    }
    const command = connected ? 'L' : 'M';
    connected = true;
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');

  return <figure className="population-trend" data-testid="population-trend" data-year={year}>
    <figcaption>
      <span>人口推移</span>
      <span className="population-trend-year">表示中：{year}年</span>
    </figcaption>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <title id={`${id}-title`}>2020〜2070年の人口推移（5年刻み）</title>
      <desc id={`${id}-description`}>横軸は年、縦軸は人口（人）。現在表示は{year}年、{formatPopulation(current.value)}。0人はゼロの位置に描き、データなしの年は線をつなぎません。全11時点の数値は下の「年別の人口を表示」で確認できます。</desc>
      <g aria-hidden="true">
        <text x="0" y="13">人口（人）</text>
        {hasData ? [0, ceiling / 2, ceiling].map((value) => {
          const y = BOTTOM - value / ceiling * (BOTTOM - TOP);
          return <g key={value}>
            <line className="population-trend-grid" x1={LEFT} x2={RIGHT} y1={y} y2={y} />
            <text x={LEFT - 7} y={y + 4} textAnchor="end">{axisFormatter.format(value)}</text>
          </g>;
        }) : <text x={(LEFT + RIGHT) / 2} y={(TOP + BOTTOM) / 2} textAnchor="middle">全11時点のデータなし</text>}
        <path className="population-trend-axis" d={`M${LEFT},${TOP} V${BOTTOM} H${RIGHT}`} />
        {points.map((point, index) => <g key={point.year}>
          <line className="population-trend-axis" x1={point.x} x2={point.x} y1={BOTTOM} y2={BOTTOM + 4} />
          {index % 5 === 0 ? <text x={point.x} y={BOTTOM + 19} textAnchor="middle">{point.year}</text> : null}
        </g>)}
        <text x={RIGHT} y={HEIGHT - 2} textAnchor="end">年</text>
        <line className="population-trend-current" x1={current.x} x2={current.x} y1={TOP - 5} y2={BOTTOM + 5} />
        {hasData ? <path className="population-trend-line" d={path} /> : null}
        {points.map((point) => point.y === null ? null : <circle
          key={point.year}
          className="population-trend-point"
          data-year={point.year}
          data-current={point.year === year ? 'true' : undefined}
          cx={point.x} cy={point.y} r={point.year === year ? 4.5 : 2.5}
        />)}
      </g>
    </svg>
    <p className="note population-trend-note">傾向を見る補助図です。現在年の数値は上の人口欄を参照。{hasMissing ? 'データなしの年は線をつなぎません。' : ''}</p>
    <details className="population-trend-values">
      <summary>年別の人口を表示（11時点）</summary>
      <table>
        <caption className="visually-hidden">選択メッシュの人口（2020〜2070年・5年刻み）</caption>
        <thead><tr><th scope="col">年</th><th scope="col">人口</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.year} aria-current={point.year === year ? 'true' : undefined}>
          <th scope="row">{point.year}年{point.year === year ? '（表示中）' : ''}</th>
          <td>{formatPopulation(point.value)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </figure>;
}
