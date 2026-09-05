import { lazy, Suspense } from 'react';
import { DATA_SOURCES } from './config/dataSources';

const MapViewport = lazy(() => import('./components/MapViewport'));

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">MIYAKO · POPULATION TERRAIN</p><h1>宮古市の人口変化</h1></div>
        <span className="stage-label">T06 · 実データ3セルの立体検証</span>
      </header>
      <main className="map-shell has-panel">
        <Suspense fallback={<p className="map-loading" role="status">3Dエンジンを読み込み中…</p>}><MapViewport /></Suspense>
      </main>
      <footer className="app-footer">
        <a href={DATA_SOURCES.population.sourceUrl}>人口：国土数値情報 R6推計（加工）</a> ｜{' '}
        <a href={DATA_SOURCES.buildings.catalogUrl}>建物：宮古市／PLATEAU 2025年度</a> ｜{' '}
        <a href={DATA_SOURCES.terrain.documentationUrl}>地形：PLATEAU・Mapterhorn・国土地理院</a> ｜{' '}
        <a href="https://maps.gsi.go.jp/development/ichiran.html">背景：地理院タイル</a>
        <br />建物形状は人口の年に連動しません。自治体・国の公式アプリではありません。
      </footer>
    </div>
  );
}
