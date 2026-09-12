export type LayerVisibility = { buildings: boolean; population: boolean; border: boolean };
const LABELS = { buildings: '建物（2025年度 LOD1）', population: '人口', border: '市境' } as const;
export function LayerControls({ layers, opacity, onVisibility, onOpacity }: {
  layers: LayerVisibility; opacity: number;
  onVisibility: (layer: keyof LayerVisibility, visible: boolean) => void; onOpacity: (opacity: number) => void;
}) {
  return <details className="display-settings"><summary>表示設定</summary>
    <fieldset className="layer-controls"><legend>レイヤー表示</legend>
    {(Object.keys(LABELS) as (keyof LayerVisibility)[]).map((key) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(event) => onVisibility(key, event.target.checked)} />{LABELS[key]}</label>)}
    <label htmlFor="population-opacity">人口の不透明度 <output>{opacity.toFixed(2)}</output></label>
    <input id="population-opacity" type="range" min="0.1" max="0.8" step="0.05" value={opacity} onChange={(event) => onOpacity(Number(event.target.value))} />
    </fieldset>
  </details>;
}
