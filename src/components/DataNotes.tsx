import { DATA_SOURCES } from '../config/dataSources';
export function DataNotes() {
  return <details id="data-notes" className="source-notes"><summary>データについて・利用条件</summary>
    <p>人口は国土数値情報の令和6年（2024年）将来推計人口・500mメッシュのPTN系列です。2020年は国勢調査を基に調整した基準人口、2025〜2070年は5年刻みの将来推計です。年の間の値は補間していません。</p>
    <p>2055年以降は2050年の仮定を継続した推計です。無居住化処理は1kmメッシュを基準に、その中の500mメッシュにも適用されます。0人を正確な消滅年と解釈せず、減少原因や政策効果を断定しないでください。</p>
    <p>宮古市コードSHICODE=03202の全692件を対象とし、市境で切り取らず原典のセル形状を表示しています。「500m」は標準地域メッシュの呼称で、厳密な500m四方・等面積ではありません。対象メッシュの合計は完全な市人口ではなく、建物整備範囲にも限定していません。nullは欠損として合計から除外し件数を示します。</p>
    <p>建物はPLATEAU 2025年度データセットのLOD1形状を全年共通で表示します。整備範囲外には表示されず、建物なし・読込失敗は無人口を意味しません。<a href={DATA_SOURCES.buildings.indexMapUrl}>建物整備範囲の索引図</a></p>
    <p>地形基準高Bは楕円体高のレベル12・セル内9点最大値+2mの近似です。山地では浮き・潜りが残り得ます。柱長Lと上端高度B+Lは異なります。地形・背景は同一時点の復元資料ではなく、将来景観を再現するものではありません。PLATEAU-Terrainは複数データ由来の試験配信です。</p>
    <p>原本取得日：2026-09-05。加工：宮古市抽出、PTN列選択、JGD2011→WGS84変換、人口押し出し表示。建物形状・高さは未加工です。</p>
    <p><a href={DATA_SOURCES.population.sourceUrl}>国土数値情報・説明と試算方法</a> ／ <a href={DATA_SOURCES.population.licenseUrl}>人口：CC BY 4.0</a> ／ <a href={DATA_SOURCES.buildings.licenseUrl}>PLATEAU利用条件</a> ／ <a href={DATA_SOURCES.terrain.documentationUrl}>地形の出典・配信条件</a></p>
  </details>;
}
