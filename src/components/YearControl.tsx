import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { YEARS, type Year } from '../domain/types';

export const PLAYBACK_INTERVAL_MS = 900;
const LAST_YEAR = YEARS[YEARS.length - 1];

export function nextPopulationYear(year: Year): Year | null {
  const next = YEARS[YEARS.indexOf(year) + 1];
  return next ?? null;
}

export function YearControl({ year, onChange }: { year: Year; onChange: (year: Year) => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const previousYearRef = useRef(year);
  const playbackYearRef = useRef<Year | null>(null);
  const changeYear = useEffectEvent((next: Year) => onChange(next));

  function stopPlayback() {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    playbackYearRef.current = null;
    setIsPlaying(false);
  }

  useEffect(() => {
    const previousYear = previousYearRef.current;
    previousYearRef.current = year;
    if (!isPlaying) {
      playbackYearRef.current = null;
      return;
    }
    if (year !== previousYear) {
      // A year that was not requested by this timer is a direct/manual change.
      if (year !== playbackYearRef.current) {
        playbackYearRef.current = null;
        setIsPlaying(false);
        return;
      }
      playbackYearRef.current = null;
    }
    const next = nextPopulationYear(year);
    if (next === null) {
      setIsPlaying(false);
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      playbackYearRef.current = next;
      changeYear(next);
      if (next === LAST_YEAR) setIsPlaying(false);
    }, PLAYBACK_INTERVAL_MS);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [isPlaying, year]);

  const playbackState = isPlaying ? '再生中' : year === LAST_YEAR ? '停止中（最終年）' : '停止中';
  const playbackLabel = isPlaying
    ? '人口推移を一時停止（再生中）'
    : year === LAST_YEAR ? '人口推移を再生（2070年で停止中）' : '人口推移を再生（停止中）';
  return <section className="year-control" aria-label="対象年">
    <div className="year-control-heading">
      <label htmlFor="population-year">対象年 <strong data-testid="year-label">{year}年</strong> <span>{year === 2020 ? '調整済み基準人口' : '将来推計'}</span></label>
      <div className="playback-controls">
        <button
          type="button"
          className="playback-button"
          data-testid="playback-toggle"
          aria-label={playbackLabel}
          aria-pressed={isPlaying}
          disabled={!isPlaying && year === LAST_YEAR}
          onClick={() => {
            if (isPlaying) stopPlayback();
            else if (year !== LAST_YEAR) setIsPlaying(true);
          }}
        >{isPlaying ? '一時停止' : '再生'}</button>
        <span className="playback-status" data-testid="playback-status" role="status" aria-live="polite">{playbackState}</span>
      </div>
    </div>
    <input id="population-year" type="range" min="2020" max="2070" step="5" value={year} aria-valuetext={`${year}年`} onChange={(event) => {
      const next = Number(event.target.value);
      if (YEARS.includes(next as Year)) {
        stopPlayback();
        onChange(next as Year);
      }
    }} />
    <div className="year-ticks" aria-hidden="true">{YEARS.map((value) => <span key={value}>{value}</span>)}</div>
  </section>;
}
