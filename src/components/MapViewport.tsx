import { useEffect, useRef, useState } from 'react';
import { Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4 } from 'cesium';
import type { CesiumTerrainProvider, CustomDataSource } from 'cesium';
import { DATA_SOURCES } from '../config/dataSources';
import { INSPECTION_YEAR, SAMPLE_CELLS } from '../config/sampleCells';
import { loadPopulation, meshBbox } from '../data/loadPopulation';
import { formatChangeRate, formatPopulation, changeRate, populationHeight } from '../domain/population';
import type { PopulationDataset } from '../domain/types';
import { connectTerrain, createViewer, describeError } from '../map/createViewer';
import type { LayerControl, LoadState } from '../map/createViewer';
import { connectBuildings } from '../map/buildings';
import { TerrainSampler, TERRAIN_LEVEL } from '../map/terrainSampling';
import { buildPopulationLayer } from '../map/populationLayer';
import type { InspectionRow } from '../map/populationLayer';

const LOADING: LoadState = { status: 'loading', message: '準備中' };

function selectSamples(data: PopulationDataset) {
  return SAMPLE_CELLS.map(({ meshId }) => {
    const feature = data.byId.get(meshId);
    if (!feature) throw new Error(`検証対象 ${meshId} は原本にありません。代替セルは生成しません。`);
    return feature;
  });
}

export default function MapViewport() {
  const element = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createViewer> | null>(null);
  const controls = useRef<{ terrain: LayerControl; buildings: LayerControl } | null>(null);
  const samplerRef = useRef<{ provider: CesiumTerrainProvider; data: PopulationDataset; sampler: TerrainSampler } | null>(null);
  const [ready, setReady] = useState(false);
  const [terrain, setTerrain] = useState<LoadState>(LOADING);
  const [buildings, setBuildings] = useState<LoadState>(LOADING);
  const [population, setPopulation] = useState<LoadState>(LOADING);
  const [provider, setProvider] = useState<CesiumTerrainProvider | null>(null);
  const [data, setData] = useState<PopulationDataset | null>(null);
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [dataAttempt, setDataAttempt] = useState(0);
  const [heightAttempt, setHeightAttempt] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!element.current) return;
    let active = true;
    let scene: ReturnType<typeof createViewer> | undefined;
    let layers: typeof controls.current = null;
    let removeRenderError: (() => void) | undefined;
    try {
      scene = createViewer(element.current, (message) => { if (active) setMapError(`背景地図の取得失敗: ${message}`); });
      sceneRef.current = scene;
      removeRenderError = scene.viewer.scene.renderError.addEventListener((_scene, error) => {
        if (active) setMapError(`描画エラー: ${describeError(error)}`);
      });
      layers = {
        terrain: connectTerrain(scene.viewer, (state) => { if (active) setTerrain(state); }, (next) => { if (active) setProvider(next); }),
        buildings: connectBuildings(scene.viewer, (state) => { if (active) setBuildings(state); }),
      };
      controls.current = layers;
      setReady(true);
    } catch (error) {
      setMapError(`Viewerの初期化失敗: ${describeError(error)}`);
    }
    return () => {
      active = false;
      controls.current = null;
      sceneRef.current = null;
      samplerRef.current?.sampler.destroy();
      samplerRef.current = null;
      layers?.terrain.destroy();
      layers?.buildings.destroy();
      removeRenderError?.();
      scene?.destroy();
    };
  }, []);

  useEffect(() => {
    const request = new AbortController();
    setData(null);
    setRows([]);
    setPopulation({ status: 'loading', message: '人口の11年分を検査中' });
    void loadPopulation(request.signal).then((result) => {
      if (request.signal.aborted) return;
      // Numeric access must not depend on the terrain service being available.
      const numericRows = selectSamples(result).map((feature) => ({
        feature, terrain: undefined, length: populationHeight(feature.properties.population[INSPECTION_YEAR]),
      }));
      setData(result);
      setRows(numericRows);
      setPopulation({ status: 'loading', message: `${result.metadata.meshCount}件読込済み · 地形基準高を待機中` });
    }).catch((error: unknown) => {
      if (!request.signal.aborted) setPopulation({ status: 'error', message: `人口の取得・検査失敗: ${describeError(error)}` });
    });
    return () => request.abort();
  }, [dataAttempt]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !provider || !data || !ready) return;
    let active = true;
    let source: CustomDataSource | undefined;
    const { viewer } = scene;
    if (samplerRef.current?.provider !== provider || samplerRef.current.data !== data) {
      samplerRef.current?.sampler.destroy();
      samplerRef.current = { provider, data, sampler: new TerrainSampler(provider) };
    }
    const { sampler } = samplerRef.current;
    async function display() {
      try {
        const features = selectSamples(data!);
        setRows(features.map((feature) => ({ feature, terrain: undefined, length: populationHeight(feature.properties.population[INSPECTION_YEAR]) })));
        setPopulation({ status: 'loading', message: '3セル × 9点の地形高を取得中' });
        const bases = await sampler.sampleCells(features);
        if (!active || viewer.isDestroyed()) return;
        const layer = buildPopulationLayer(features, bases, INSPECTION_YEAR);
        source = layer.source;
        await viewer.dataSources.add(source);
        if (!active || viewer.isDestroyed()) {
          if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
          return;
        }
        setRows(layer.rows);
        const failed = layer.rows.filter((row) => row.terrain?.status !== 'ready').length;
        setPopulation(failed
          ? { status: 'error', message: `高さ取得失敗 ${failed}/3セル。数値は下で参照できます。` }
          : { status: 'ready', message: `${data!.metadata.meshCount}件検査済み · 3セルを表示` });
        viewer.scene.requestRender();
      } catch (error) {
        if (active && !viewer.isDestroyed()) setPopulation({ status: 'error', message: `人口描画の準備失敗: ${describeError(error)}` });
      }
    }
    void display();
    return () => {
      active = false;
      if (source && !viewer.isDestroyed()) viewer.dataSources.remove(source, true);
    };
  }, [provider, data, ready, heightAttempt]);

  function focusCell(row: InspectionRow) {
    const viewer = sceneRef.current?.viewer;
    if (!viewer || viewer.isDestroyed() || row.terrain?.status !== 'ready') return;
    const [west, south, east, north] = meshBbox(row.feature);
    const targetHeight = row.length === null ? row.terrain.baseHeight : row.terrain.baseHeight + row.length * 0.35;
    viewer.camera.lookAt(
      Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, targetHeight),
      new HeadingPitchRange(CesiumMath.toRadians(10), CesiumMath.toRadians(-35), 1650),
    );
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }

  const terrainUnavailable = data !== null && provider === null && terrain.status === 'error';
  const populationState: LoadState = terrainUnavailable
    ? { status: 'error', message: `${data.metadata.meshCount}件読込済み · 地形接続失敗のため未描画。数値は下に表示します。` }
    : population;

  return (
    <>
      <div className="map-viewport" ref={element} data-testid="map-viewport" data-viewer-ready={ready} />
      <aside className="inspection-panel" aria-label="3セルの立体表示検証">
        <h2>{INSPECTION_YEAR}年 · 3セル検証</h2>
        <p className="muted">全692件のうち代表3セルだけを描画</p>
        <ul className="load-states" aria-live="polite">
          <li data-testid="buildings-status" data-state={buildings.status}>
            <strong>建物 · 2025年度 LOD1</strong><span>{buildings.message}</span>
            {buildings.status === 'error' && <button onClick={() => controls.current?.buildings.retry()}>建物を再試行</button>}
          </li>
          <li data-testid="terrain-status" data-state={terrain.status}>
            <strong>地形 · 楕円体高</strong><span>{terrain.message}</span>
            {terrain.status === 'error' && <button onClick={() => controls.current?.terrain.retry()}>地形を再試行</button>}
          </li>
          <li data-testid="population-status" data-state={populationState.status}>
            <strong>人口 · PTN系列</strong><span>{populationState.message}</span>
            {populationState.status === 'error' && !terrainUnavailable && <button onClick={() => data ? setHeightAttempt((n) => n + 1) : setDataAttempt((n) => n + 1)}>{data ? '高さ取得を再試行' : '人口を再試行'}</button>}
          </li>
        </ul>
        {mapError && <p role="alert" className="error-message">{mapError}</p>}
        <p className="formula">柱長 L = 人口 × <strong>0.5m/人</strong><br />上端の楕円体高 = 基準高 B + L</p>
        <div className="sample-cells">
          {rows.map((row) => {
            const base = row.terrain?.status === 'ready' ? row.terrain : null;
            const values = row.feature.properties.population;
            return (
              <section key={row.feature.id} className="sample-cell" data-testid="sample-cell"
                data-mesh-id={row.feature.id} data-base-height={base?.baseHeight} data-length={row.length ?? undefined}
                data-population={values[INSPECTION_YEAR] ?? undefined} data-sample-min={base?.minHeight} data-sample-max={base?.maxHeight}>
                <h3>{SAMPLE_CELLS.find((cell) => cell.meshId === row.feature.id)?.label}</h3>
                <code>{row.feature.id}</code>
                <dl>
                  <div><dt>2020 基準人口</dt><dd>{formatPopulation(values[2020])}</dd></div>
                  <div><dt>2050 推計人口</dt><dd>{formatPopulation(values[INSPECTION_YEAR])}</dd></div>
                  <div><dt>2020年比</dt><dd>{formatChangeRate(changeRate(values[2020], values[INSPECTION_YEAR]))}</dd></div>
                  <div><dt>基準高 B</dt><dd>{base ? `${base.baseHeight.toFixed(2)} m` : terrainUnavailable ? '取得失敗' : '未取得'}</dd></div>
                  <div><dt>人口の柱長 L</dt><dd>{row.length === null ? 'データなし' : `${row.length.toFixed(4)} m`}</dd></div>
                </dl>
                {row.terrain?.status === 'error' && <p className="error-message">{row.terrain.message}</p>}
                <button data-testid="cell-focus" disabled={!base} onClick={() => focusCell(row)}>このセルへ移動</button>
              </section>
            );
          })}
        </div>
        <p className="note">Bは地形レベル{TERRAIN_LEVEL}の9点最大値+2m。セル内の厳密な最大標高ではなく、斜面では浮き・突き抜けが残り得ます。比較するのは上端の高度ではなく柱長Lです。</p>
        <p className="note">2020年は国勢調査を基に調整した基準人口、2025年以降は推計です。色は2020年比の固定区分、初期不透明度は0.25。0人は平面、欠損は「データなし」と区別します。</p>
        <p className="note">建物は全年共通の公開形状です。読込失敗・整備範囲外・建物なしを無人口と解釈しないでください。</p>
        <details className="source-notes">
          <summary>出典と加工内容</summary>
          <p>取得日：2026-09-05。人口は宮古市抽出・PTN列選択・JGD2011→WGS84変換・立体可視化を行っています。建物形状や高さは加工していません。</p>
          <p><a href={DATA_SOURCES.population.licenseUrl}>人口：CC BY 4.0</a> ／ <a href={DATA_SOURCES.buildings.licenseUrl}>PLATEAU利用条件</a> ／ <a href={DATA_SOURCES.buildings.indexMapUrl}>建物整備範囲の索引図</a></p>
          <p>地形は複数のデータ由来で試験配信です。全年の歴史的な景観や将来の建物を復元するものではありません。2055年以降は2050年の仮定の延長推計です。</p>
        </details>
      </aside>
    </>
  );
}
