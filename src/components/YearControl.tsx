import { YEARS, type Year } from '../domain/types';

export function YearControl({ year, onChange }: { year: Year; onChange: (year: Year) => void }) {
  return <section className="year-control" aria-label="対象年">
    <label htmlFor="population-year">対象年 <strong data-testid="year-label">{year}年</strong> <span>{year === 2020 ? '調整済み基準人口' : '将来推計'}</span></label>
    <input id="population-year" type="range" min="2020" max="2070" step="5" value={year} aria-valuetext={`${year}年`} onChange={(event) => {
      const next = Number(event.target.value);
      if (YEARS.includes(next as Year)) onChange(next as Year);
    }} />
    <div className="year-ticks" aria-hidden="true">{YEARS.map((value) => <span key={value}>{value}</span>)}</div>
  </section>;
}
