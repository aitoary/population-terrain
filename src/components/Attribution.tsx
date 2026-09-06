import { DATA_SOURCES } from '../config/dataSources';
export function Attribution() {
  return <footer className="app-footer">
    <a href={DATA_SOURCES.population.sourceUrl}>人口：国土数値情報 R6推計（加工）</a> ｜ <a href={DATA_SOURCES.buildings.catalogUrl}>建物：宮古市／PLATEAU 2025年度</a> ｜ <a href={DATA_SOURCES.terrain.documentationUrl}>地形：PLATEAU・Mapterhorn・国土地理院</a> ｜ <a href="https://maps.gsi.go.jp/development/ichiran.html">背景：地理院タイル</a> ｜ <a href="#data-notes" onClick={() => { const notes = document.getElementById('data-notes'); if (notes instanceof HTMLDetailsElement) notes.open = true; }}>データについて</a>
    <br />建物は全年共通。自治体・国の公式アプリではありません。
  </footer>;
}
