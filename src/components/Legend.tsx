import type { SyntheticEvent } from 'react';
import { CHANGE_STYLES } from '../domain/population';

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
  </section>;
}
