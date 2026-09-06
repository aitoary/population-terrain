import { lazy, Suspense, useEffect, useState } from 'react';
import { loadPopulation } from './data/loadPopulation';
import { changeRate, formatChangeRate, formatPopulation } from './domain/population';
import type { PopulationDataset, Year } from './domain/types';
import { YearControl } from './components/YearControl';
import { LayerControls, type LayerVisibility } from './components/LayerControls';
import { Legend } from './components/Legend';
import { MeshDetails } from './components/MeshDetails';
import { DataNotes } from './components/DataNotes';
import { Attribution } from './components/Attribution';

const MapViewport = lazy(() => import('./components/MapViewport'));
const EMPTY_FEATURES: never[] = [];
export default function App() {
  const [year, setYear] = useState<Year>(2050);
  const [selectedId, setSelectedId] = useState('594137654');
  const [opacity, setOpacity] = useState(0.25);
  const [layers, setLayers] = useState<LayerVisibility>({ buildings: true, population: true, border: true });
  const [data, setData] = useState<PopulationDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setError(null);
    void loadPopulation(request.signal).then((result) => { if (!request.signal.aborted) setData(result); }).catch((reason: unknown) => {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => request.abort();
  }, [attempt]);
  const total = data?.metadata.totals[year] ?? null;
  const baseline = data?.metadata.totals[2020] ?? null;
  const missing = data?.metadata.nullCounts[year] ?? 0;
  return <div className="app-shell">
    <header className="app-header">
      <div><p className="eyebrow">MIYAKO · POPULATION TERRAIN</p><h1>宮古市の人口変化</h1></div>
      <div className="totals" data-testid="totals" data-year={year} data-total={total ?? 'null'}><strong>{year}年 · 対象メッシュの合計</strong><span>{formatPopulation(total)}{missing > 0 ? `（欠損${missing}件を除く）` : ''}</span><small>2020年比 {formatChangeRate(changeRate(baseline, total))} · 全692メッシュ</small></div>
    </header>
    <YearControl year={year} onChange={setYear} />
    <main className="map-shell has-panel">
      <Suspense fallback={<p className="map-loading" role="status">3Dエンジンを読み込み中…</p>}><MapViewport data={data} year={year} selectedId={selectedId} opacity={opacity} layers={layers} onSelect={setSelectedId} /></Suspense>
      <aside className="inspection-panel" aria-label="人口の詳細と表示設定">
        <div data-testid="data-status" data-state={error ? 'error' : data ? 'ready' : 'loading'} aria-live="polite">{error ? <p role="alert">人口の取得・検査失敗: {error}<button onClick={() => setAttempt((n) => n + 1)}>人口を再試行</button></p> : data ? <p className="muted">PTN · {data.metadata.meshCount}件 · 11年分読込済み</p> : <p>人口の11年分を読み込み中…</p>}</div>
        <MeshDetails features={data?.collection.features ?? EMPTY_FEATURES} selectedId={selectedId} year={year} onSelect={setSelectedId} />
        <LayerControls layers={layers} opacity={opacity} onVisibility={(key, visible) => setLayers((previous) => ({ ...previous, [key]: visible }))} onOpacity={setOpacity} />
        <Legend /><DataNotes />
      </aside>
    </main>
    <Attribution />
  </div>;
}
