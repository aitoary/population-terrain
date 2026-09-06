import { CHANGE_STYLES } from '../domain/population';
export function Legend() {
  return <details className="legend" open><summary>高さと色の凡例</summary>
    <p>柱長 = 人口 × <strong>0.5m/人</strong>（全年共通）</p>
    <p>色：2020年比（年ごとの正規化なし）</p>
    <ul>{Object.entries(CHANGE_STYLES).map(([key, style]) => <li key={key}><span className="swatch" style={{ backgroundColor: style.color }} />{style.label}</li>)}</ul>
    <p>0人は柱なし・選択可能な薄い平面と枠。欠損は「データなし」であり、0人ではありません。白い太枠は選択セルです。</p>
  </details>;
}
