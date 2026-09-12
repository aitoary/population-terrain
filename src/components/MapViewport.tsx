import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Cartesian3, Color, CustomDataSource } from 'cesium';
import type { CesiumTerrainProvider } from 'cesium';
import { DATA_SOURCES } from '../config/dataSources';
import type { Bbox, PopulationDataset, Year } from '../domain/types';
import { meshBbox } from '../data/loadPopulation';
import { connectVisibility } from '../map/visibility';
import { connectTerrain, createViewer, describeError } from '../map/createViewer';
import type { LayerControl, LoadState } from '../map/createViewer';
import { connectBuildings } from '../map/buildings';
import { TerrainSampler } from '../map/terrainSampling';
import { buildPopulationLayer, type PopulationLayer } from '../map/populationLayer';
import { connectSelection } from '../map/selection';
import { focusAll, focusMesh, focusStation } from '../map/camera';
import type { LayerVisibility } from './LayerControls';

declare const __ACCEPTANCE__: boolean;

const LOADING: LoadState = { status: 'loading', message: '準備中' };
export type MapProps = { data: PopulationDataset | null; year: Year; selectedId: string; opacity: number; layers: LayerVisibility; onSelect: (id: string) => void };

export default function MapViewport({ data, year, selectedId, opacity, layers, onSelect }: MapProps) {
  const element = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createViewer> | null>(null);
  const controls = useRef<{ terrain: LayerControl; buildings: ReturnType<typeof connectBuildings> } | null>(null);
  const samplerRef = useRef<{ provider: CesiumTerrainProvider; sampler: TerrainSampler } | null>(null);
  const populationRef = useRef<PopulationLayer | null>(null);
  const borderRef = useRef<CustomDataSource | null>(null);
  const [ready, setReady] = useState(false);
  const [terrain, setTerrain] = useState<LoadState>(LOADING);
  const [buildings, setBuildings] = useState<LoadState>(LOADING);
  const [population, setPopulation] = useState<LoadState>(LOADING);
  const [border, setBorder] = useState<LoadState>(LOADING);
  const [provider, setProvider] = useState<CesiumTerrainProvider | null>(null);
  const [heightAttempt, setHeightAttempt] = useState(0);
  const [borderAttempt, setBorderAttempt] = useState(0);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const applyCurrent = useEffectEvent(() => {
    const layer = populationRef.current;
    layer?.setYear(year); layer?.setOpacity(opacity); layer?.setVisible(layers.population); layer?.setSelectedMesh(selectedId);
    controls.current?.buildings.setVisible(layers.buildings);
    if (borderRef.current) borderRef.current.show = layers.border;
    sceneRef.current?.viewer.scene.requestRender();
  });
  const select = useEffectEvent((id: string) => onSelect(id));

  useEffect(() => {
    const container = element.current;
    if (!container) return;
    let active = true;
    let scene: ReturnType<typeof createViewer> | undefined;
    let connections: typeof controls.current = null;
    let removeRenderError: (() => void) | undefined;
    setMapError(null); setReady(false); setProvider(null);
    try {
      scene = createViewer(container, (message) => { if (active) setMapError(`背景地図の取得失敗: ${message}`); });
      sceneRef.current = scene;
      if (__ACCEPTANCE__ && new URLSearchParams(location.search).get('acceptance') === '1') Object.assign(window, { __mvpViewer: scene.viewer });
      removeRenderError = scene.viewer.scene.renderError.addEventListener((_scene, error) => { if (active) setMapError(`描画エラー: ${describeError(error)}`); });
      connections = {
        terrain: connectTerrain(scene.viewer, (state) => { if (active) setTerrain(state); }, (next) => { if (active) setProvider(next); }),
        buildings: connectBuildings(scene.viewer, (state) => { if (active) setBuildings(state); }),
      };
      controls.current = connections;
      setReady(true);
      applyCurrent();
    } catch (error) { setMapError(`Viewerの初期化失敗: ${describeError(error)}`); }
    return () => {
      active = false; controls.current = null; sceneRef.current = null;
      samplerRef.current?.sampler.destroy(); samplerRef.current = null;
      connections?.terrain.destroy(); connections?.buildings.destroy();
      removeRenderError?.(); scene?.destroy();
      // A throwing Cesium constructor can leave DOM without returning a Viewer to destroy.
      container.replaceChildren();
      if (__ACCEPTANCE__ && '__mvpViewer' in window) delete (window as Window & { __mvpViewer?: unknown }).__mvpViewer;
    };
  }, [mapAttempt]);

  useEffect(() => {
    const viewer = sceneRef.current?.viewer;
    if (!viewer || !ready) return;
    const request = new AbortController();
    let source: CustomDataSource | undefined;
    let removeVisibility: (() => void) | undefined;
    setBorder(LOADING);
    void (async () => {
      try {
        const response = await fetch(DATA_SOURCES.population.borderUrl, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (json.type !== 'FeatureCollection' || !Array.isArray(json.features) || !json.features.length) throw new Error('市境FeatureCollectionが不正です');
        source = new CustomDataSource('border');
        const bounds = new Map<string, Bbox>();
        for (const [index, feature] of json.features.entries()) {
          const points: unknown = feature.geometry?.coordinates;
          if (feature.geometry?.type !== 'LineString' || !Array.isArray(points) || points.length < 2 || !points.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) throw new Error('市境は有効なLineStringである必要があります');
          const coordinates = points as number[][];
                    bounds.set(`border:${index}`, [Math.min(...coordinates.map((p) => p[0]!)), Math.min(...coordinates.map((p) => p[1]!)), Math.max(...coordinates.map((p) => p[0]!)), Math.max(...coordinates.map((p) => p[1]!))]);
                    source.entities.add({ id: `border:${index}`, polyline: { positions: Cartesian3.fromDegreesArray(points.flat()), width: 2, material: Color.fromCssColorString('#475569'), clampToGround: true } });
        }
        if (request.signal.aborted || viewer.isDestroyed()) return;
        removeVisibility = connectVisibility(viewer, source, bounds);
                await viewer.dataSources.add(source);
        if (request.signal.aborted || viewer.isDestroyed()) { if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true); return; }
        borderRef.current = source; applyCurrent();
        setBorder({ status: 'ready', message: `${source.entities.values.length}本の市境LineString` });
      } catch (error) { if (!request.signal.aborted) setBorder({ status: 'error', message: `市境の取得失敗: ${describeError(error)}` }); }
    })();
    return () => { request.abort(); removeVisibility?.(); borderRef.current = null; if (source && !viewer.isDestroyed()) viewer.dataSources.remove(source, true); };
  }, [ready, borderAttempt, mapAttempt]);

  useEffect(() => {
    const viewer = sceneRef.current?.viewer;
    if (!viewer || !provider || !data || !ready) return;
    let active = true;
    let layer: PopulationLayer | undefined;
    let removeSelection: (() => void) | undefined;
        let removeVisibility: (() => void) | undefined;
    if (samplerRef.current?.provider !== provider) {
      samplerRef.current?.sampler.destroy(); samplerRef.current = { provider, sampler: new TerrainSampler(provider) };
    }
    const { sampler } = samplerRef.current;
    setPopulation({ status: 'loading', message: `${data.metadata.meshCount}セル × 9点の基準高を取得中` });
    void (async () => {
      try {
        const bases = await sampler.sampleCells(data.collection.features);
        if (!active || viewer.isDestroyed()) return;
        layer = buildPopulationLayer(data.collection.features, bases, 2050);
        removeVisibility = connectVisibility(viewer, layer.source, new Map(data.collection.features.map((feature) => [`mesh:${feature.id}`, meshBbox(feature)])));
        await viewer.dataSources.add(layer.source);
        if (!active || viewer.isDestroyed()) { if (!viewer.isDestroyed()) viewer.dataSources.remove(layer.source, true); layer.destroy(); return; }
        populationRef.current = layer;
        applyCurrent();
        removeSelection = connectSelection(viewer, layer.source, select);
        const failed = layer.rows.filter((row) => row.terrain?.status !== 'ready').length;
        setPopulation(failed ? { status: 'error', message: `高さ取得失敗 ${failed}/${data.metadata.meshCount}セル。数値は引き続き参照できます。` } : { status: 'ready', message: `${data.metadata.meshCount}セルを表示` });
        // Compiled out of ordinary builds; local acceptance never substitutes data.
        if (__ACCEPTANCE__ && new URLSearchParams(location.search).get('acceptance') === '1') {
          Object.assign(window, { __mvp: { viewer, layer, bases } });
        }
      } catch (error) { if (active && !viewer.isDestroyed()) setPopulation({ status: 'error', message: `人口描画の準備失敗: ${describeError(error)}` }); }
    })();
    return () => {
      active = false; removeSelection?.(); removeVisibility?.(); populationRef.current = null;
      if (layer && !viewer.isDestroyed()) viewer.dataSources.remove(layer.source, true);
      layer?.destroy();
      if (__ACCEPTANCE__ && '__mvp' in window) delete (window as Window & { __mvp?: unknown }).__mvp;
    };
  }, [provider, data, ready, heightAttempt, mapAttempt]);

  useEffect(() => { applyCurrent(); }, [year, selectedId, opacity, layers]);

  function focus(kind: 'station' | 'all' | 'selection') {
    const viewer = sceneRef.current?.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    if (kind === 'station') focusStation(viewer);
    else if (kind === 'all' && data) focusAll(viewer, data.metadata.bbox);
    else {
      const row = populationRef.current?.rows.find((item) => item.feature.id === selectedId);
      if (row?.terrain?.status === 'ready') focusMesh(viewer, row.feature, row.terrain.baseHeight);
    }
  }
  const geometryState: LoadState = !data ? { status: 'loading', message: '人口データを待機中' } : !provider ? { status: terrain.status === 'error' ? 'error' : 'loading', message: '地形接続を待機中。数値は参照できます。' } : population;
  return <>
    <div className="map-viewport" ref={element} data-testid="map-viewport" data-viewer-ready={ready} />
    <div className="map-tools">
      <nav className="camera-controls" aria-label="視点操作">
        <button disabled={!ready} onClick={() => focus('station')}>宮古駅周辺</button>
        <button disabled={!ready || !data} onClick={() => focus('all')}>対象メッシュ全体</button>
        <button disabled={!ready || populationRef.current?.rows.find((row) => row.feature.id === selectedId)?.terrain?.status !== 'ready'} onClick={() => focus('selection')}>選択メッシュへ</button>
      </nav>
      <details className="map-status" open><summary>地図の読込状態</summary><ul className="load-states" aria-live="polite">
        {([
          ['buildings', '建物 · 2025年度 LOD1', buildings, () => controls.current?.buildings.retry()],
          ['terrain', '地形 · 楕円体高', terrain, () => controls.current?.terrain.retry()],
          ['population', '人口の立体表示', geometryState, () => setHeightAttempt((n) => n + 1)],
          ['border', '市境', border, () => setBorderAttempt((n) => n + 1)],
        ] as const).map(([key, label, state, retry]) => <li key={key} data-testid={`${key}-status`} data-state={state.status}><strong>{label}</strong><span>{state.message}</span>{state.status === 'error' && (key !== 'population' || provider) && <button onClick={retry}>{key === 'population' ? '高さ取得' : label.split(' · ')[0]}を再試行</button>}</li>)}
      </ul></details>
      {mapError && <div role="alert" className="error-message">{mapError}<button onClick={() => setMapAttempt((n) => n + 1)}>地図を再初期化</button></div>}
    </div>
  </>;
}
