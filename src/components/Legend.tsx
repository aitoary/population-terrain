import type { SyntheticEvent } from 'react';
import { CHANGE_STYLES, METERS_PER_PERSON } from '../domain/population';

const stopMapEvent = (event: SyntheticEvent) => event.stopPropagation();

export function Legend({ populationVisible = true }: { populationVisible?: boolean }) {
  return <section className="legend" aria-label="人口地図の凡例" data-population-visible={populationVisible}
    onPointerDown={stopMapEvent} onPointerUp={stopMapEvent} onPointerMove={stopMapEvent}
    onMouseDown={stopMapEvent} onMouseUp={stopMapEvent} onClick={stopMapEvent} onDoubleClick={stopMapEvent}
    onTouchStart={stopMapEvent} onTouchMove={stopMapEvent} onTouchEnd={stopMapEvent}
    onWheel={stopMapEvent} onKeyDown={stopMapEvent} onKeyUp={stopMapEvent}>
    <p className="legend-title">色：2020年からの人口増減率</p>
    <p className="legend-visibility" role="status">{populationVisible ? null : '人口レイヤーは非表示です'}</p>
    <ul>{Object.entries(CHANGE_STYLES).map(([key, style]) => <li key={key} data-category={key}><span className="swatch" aria-hidden="true" style={{ backgroundColor: style.color }} />{style.label}</li>)}</ul>
    <div className="legend-keys">
      <p>柱の高さ：表示年の人口</p>
      <p className="legend-selection"><span className="selection-swatch" aria-hidden="true" />白枠：選択中</p>
    </div>
    <details className="legend-reading"><summary>詳しい読み方</summary>
      <div className="legend-explanation">
        <p>柱長 = 人口 × <strong>{METERS_PER_PERSON}m/人</strong>（全年共通）。地形の基準高からの高さです。</p>
        <p>色は2020年比で、年ごとの正規化はしていません。増減率の境界判定には丸め前の値を使います。基準人口が0人・欠損の場合は算出不可です。</p>
        <p>0人は柱なし・選択可能な薄い平面と枠。欠損も柱を立てず、算出不可の色の薄い平面と枠で示します。「データなし」であり、0人ではありません。白い太枠は選択セルです。</p>
      </div>
    </details>
  </section>;
}
