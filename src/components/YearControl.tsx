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
  const [playbackStart, setPlaybackStart] = useState(0);
  const playingRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const previousYearRef = useRef(year);
  const playbackYearRef = useRef<Year | null>(null);
  const changeYear = useEffectEvent((next: Year) => onChange(next));

  function stopPlayback() {
    playingRef.current = false;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    playbackYearRef.current = null;
    setIsPlaying(false);
  }

  useEffect(() => {
    const previousYear = previousYearRef.current;
    previousYearRef.current = year;
    if (!isPlaying) {
      playingRef.current = false;
      playbackYearRef.current = null;
      return;
    }
    if (year !== previousYear) {
      // タイマーが要求していない年への変更は、利用者の操作として再生を止める。
      if (year !== playbackYearRef.current) {
        playingRef.current = false;
        playbackYearRef.current = null;
        setIsPlaying(false);
        return;
      }
      playbackYearRef.current = null;
    }
    const next = nextPopulationYear(year);
    if (next === null) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      playbackYearRef.current = next;
      changeYear(next);
      if (next === LAST_YEAR) { playingRef.current = false; setIsPlaying(false); }
    }, PLAYBACK_INTERVAL_MS);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [isPlaying, year, playbackStart]);

  const playbackState = isPlaying ? '再生中' : year === LAST_YEAR ? '停止中（最終年）' : '停止中';
  const playbackLabel = isPlaying
    ? '一時停止'
    : year === LAST_YEAR ? '2020年から再生' : '再生';
  return <section className="year-control" aria-label="対象年">
    <div className="year-control-heading">
      <label htmlFor="population-year">対象年 <strong data-testid="year-label">{year}年</strong></label>
      <div className="playback-controls">
        <button
          type="button"
          className="playback-button"
          data-testid="playback-toggle"
          aria-label={playbackLabel}
          aria-pressed={isPlaying}
          onClick={() => {
            if (playingRef.current) stopPlayback();
            else {
              playingRef.current = true;
              // 停止と再開が同じ描画にまとめられても、タイマーを再設定させる。
              setPlaybackStart((request) => request + 1);
              if (year === LAST_YEAR) {
                // 最終年からの巻き戻しは再生操作なので、手動変更として停止させない。
                playbackYearRef.current = YEARS[0];
                onChange(YEARS[0]);
              }
              setIsPlaying(true);
            }
          }}
        >{playbackLabel}</button>
        <span className="visually-hidden" data-testid="playback-status" role="status" aria-live="polite">{playbackState}</span>
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
