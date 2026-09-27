import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { loadPopulation } from './data/loadPopulation';
import { readSharedView, resolveSharedMesh, sharedViewUrl } from './domain/shareLink';
import type { PopulationDataset } from './domain/types';
import { YearControl } from './components/YearControl';
import { LayerControls, type LayerVisibility } from './components/LayerControls';
import { Legend } from './components/Legend';
import { MeshDetails } from './components/MeshDetails';
import { DataNotes } from './components/DataNotes';
import { Attribution } from './components/Attribution';
import { FeaturedLocations } from './components/FeaturedLocations';
import { FEATURED_YEAR } from './config/featuredLocations';

const MapViewport = lazy(() => import('./components/MapViewport'));
const EMPTY_FEATURES: never[] = [];
export default function App() {
  const [view, setView] = useState(() => readSharedView(window.location.search));
  const { year } = view;
  const [opacity, setOpacity] = useState(0.25);
  const [layers, setLayers] = useState<LayerVisibility>({ buildings: true, population: true, border: true });
  const [data, setData] = useState<PopulationDataset | null>(null);
  // 共有URLのIDはデータ取得後に検証する。再試行中も指定値を失わない。
  const selectedId = resolveSharedMesh(view.meshId, data?.byId);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectionFocusRequest, setSelectionFocusRequest] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  function selectFeaturedLocation(meshId: string) {
    if (!data?.byId.has(meshId)) return;
    // 注目地点への切替は手動操作なので、YearControl側の再生を止める。
    setView({ year: FEATURED_YEAR, meshId });
    // 同じ地点を再選択してもカメラを動かせるよう、選択値とは別に指示を送る。
    setSelectionFocusRequest((request) => request + 1);
    const panel = panelRef.current;
    const heading = detailsHeadingRef.current;
    if (!panel || !heading) return;
    // 詳細へフォーカスを移す際、ブラウザーによるページ全体のスクロールを抑える。
    heading.focus({ preventScroll: true });
    const summary = panel.querySelector('.mesh-summary');
    const bounds = (summary ?? heading).getBoundingClientRect();
    const panelStyle = window.getComputedStyle(panel);
    if (panelStyle.overflowY === 'auto') {
      const panelBounds = panel.getBoundingClientRect();
      const inset = parseFloat(panelStyle.paddingTop);
      if (bounds.top < panelBounds.top + inset || bounds.bottom > panelBounds.bottom - inset) {
        panel.scrollTo({ top: panel.scrollTop + bounds.top - panelBounds.top - inset, behavior: 'instant' });
      }
    } else {
      // モバイルでは詳細パネルが通常のページ内にあるため、ページ側をスクロールする。
      if (bounds.top < 16 || bounds.bottom > window.innerHeight - 16) {
        window.scrollTo({ top: window.scrollY + bounds.top - 16, behavior: 'instant' });
      }
    }
  }
  useEffect(() => {
    const request = new AbortController();
    setError(null);
    void loadPopulation(request.signal).then((result) => { if (!request.signal.aborted) setData(result); }).catch((reason: unknown) => {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => request.abort();
  }, [attempt]);
  useEffect(() => {
    // 人口の読込中に共有URLのメッシュを既定値へ置き換えない。
    if (!data) return;
    const url = sharedViewUrl(window.location.href, { year, meshId: selectedId });
    if (url !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [data, year, selectedId]);
  return <div className="app-shell">
    <header className="app-header">
      <div><p className="eyebrow">MIYAKO · POPULATION TERRAIN</p><h1>宮古市の人口変化</h1></div>
    </header>
    <YearControl year={year} onChange={(next) => setView((previous) => ({ ...previous, year: next }))} />
    <main className="map-shell has-panel">
      <div className="map-stage">
        <Suspense fallback={<p className="map-loading" role="status">3Dエンジンを読み込み中…</p>}><MapViewport data={data} year={year} selectedId={selectedId} selectionFocusRequest={selectionFocusRequest} opacity={opacity} layers={layers} onSelect={(meshId) => setView((previous) => ({ ...previous, meshId }))} /></Suspense>
        <Legend populationVisible={layers.population} />
      </div>
      <aside ref={panelRef} className="inspection-panel" aria-label="人口の詳細と表示設定">
        <div data-testid="data-status" data-state={error ? 'error' : data ? 'ready' : 'loading'} aria-live="polite">{error ? <p role="alert">人口の取得・検査失敗: {error}<button onClick={() => setAttempt((n) => n + 1)}>人口を再試行</button></p> : data ? null : <p>人口データを読み込み中…</p>}</div>
        <FeaturedLocations data={data} selectedId={selectedId} onSelect={selectFeaturedLocation} />
        <MeshDetails headingRef={detailsHeadingRef} features={data?.collection.features ?? EMPTY_FEATURES} selectedId={selectedId} year={year} onSelect={(meshId) => setView((previous) => ({ ...previous, meshId }))} />
        <LayerControls layers={layers} opacity={opacity} onVisibility={(key, visible) => setLayers((previous) => ({ ...previous, [key]: visible }))} onOpacity={setOpacity} />
        <DataNotes />
      </aside>
    </main>
    <Attribution />
  </div>;
}
