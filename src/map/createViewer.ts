import {
  Cartesian3, CesiumTerrainProvider, Credit, EllipsoidTerrainProvider,
  HeadingPitchRange, Math as CesiumMath, Matrix4, Rectangle,
  UrlTemplateImageryProvider, Viewer,
} from 'cesium';
import { DATA_SOURCES, MIYAKO_STATION } from '../config/dataSources';

export type LoadState = { status: 'loading' | 'ready' | 'error'; message: string };
export type ReportState = (state: LoadState) => void;
export type LayerControl = { retry: () => void; destroy: () => void };

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return String(error);
}

export function createViewer(container: HTMLElement, onImageryError: (message: string) => void) {
  const viewer = new Viewer(container, {
    baseLayer: false,
    terrainProvider: new EllipsoidTerrainProvider(), // Bootstrap only, never used for population heights.
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shadows: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  const imagery = new UrlTemplateImageryProvider({
    url: DATA_SOURCES.imagery.url,
    minimumLevel: DATA_SOURCES.imagery.minimumLevel,
    maximumLevel: DATA_SOURCES.imagery.maximumLevel,
    credit: new Credit(DATA_SOURCES.imagery.credit, true),
    // Limit requests to the study region; this is a display envelope, not a city boundary.
    rectangle: Rectangle.fromDegrees(141.25, 39.3, 142.15, 40.05),
  });
  viewer.imageryLayers.addImageryProvider(imagery);
  const removeImageryError = imagery.errorEvent.addEventListener((error) => onImageryError(describeError(error)));
  viewer.creditDisplay.addStaticCredit(new Credit(DATA_SOURCES.terrain.credit, true));
  viewer.creditDisplay.addStaticCredit(new Credit(
    `<a href="${DATA_SOURCES.buildings.catalogUrl}">宮古市／PLATEAU 2025年度 LOD1</a>`, true,
  ));
  viewer.camera.lookAt(
    Cartesian3.fromDegrees(MIYAKO_STATION.longitude, MIYAKO_STATION.latitude),
    new HeadingPitchRange(CesiumMath.toRadians(10), CesiumMath.toRadians(-42), 4500),
  );
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  viewer.scene.requestRender();
  return {
    viewer,
    destroy() {
      removeImageryError();
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
}

export function connectTerrain(
  viewer: Viewer,
  report: ReportState,
  onProvider: (provider: CesiumTerrainProvider) => void,
): LayerControl {
  let disposed = false;
  let generation = 0;
  let removeError: (() => void) | undefined;
  let request: AbortController | undefined;
  let settledTimer: ReturnType<typeof setInterval> | undefined;
  async function load() {
    const attempt = ++generation;
    clearInterval(settledTimer);
    removeError?.();
    removeError = undefined;
    request?.abort();
    request = new AbortController();
    report({ status: 'loading', message: 'PLATEAU地形に接続中' });
    try {
      // Cesium can interpret a missing layer.json as legacy heightmap terrain.
      // Reject that fallback explicitly instead of calling it an empty landscape.
      const response = await fetch(DATA_SOURCES.terrain.metadataUrl, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error(`地形メタデータ HTTP ${response.status}`);
      const metadata = await response.json();
      if (metadata?.format !== 'quantized-mesh-1.0' || metadata.scheme !== 'tms' || !Array.isArray(metadata.tiles)) {
        throw new Error('地形メタデータの仕様が変わっています。出典を再検証してください。');
      }
      if (disposed || attempt !== generation) return;
      const provider = await CesiumTerrainProvider.fromUrl(DATA_SOURCES.terrain.url, {
        requestVertexNormals: true,
        credit: new Credit(DATA_SOURCES.terrain.credit, true),
      });
      if (disposed || attempt !== generation || viewer.isDestroyed()) return;
      removeError = provider.errorEvent.addEventListener((error) => {
        clearInterval(settledTimer);
        report({ status: 'error', message: `地形の取得に失敗: ${describeError(error)}` });
      });
      viewer.terrainProvider = provider;
      onProvider(provider);
      report({ status: 'loading', message: '地形・背景タイルの描画を待機中' });
      let stableSince: number | undefined;
      // Metadata availability is not evidence of a rendered terrain surface.
      settledTimer = setInterval(() => {
        if (!viewer.scene.globe.tilesLoaded) { stableSince = undefined; return; }
        stableSince ??= performance.now();
        if (performance.now() - stableSince >= 1000) {
          clearInterval(settledTimer);
          report({ status: 'ready', message: '現在視点の地形・背景タイル読込済み' });
          viewer.scene.requestRender();
        }
      }, 200);
      viewer.scene.requestRender();
    } catch (error) {
      if (!disposed && attempt === generation) report({ status: 'error', message: `地形の取得に失敗: ${describeError(error)}` });
    }
  }
  void load();
  return {
    retry: () => { void load(); },
    destroy: () => { disposed = true; generation += 1; request?.abort(); removeError?.(); clearInterval(settledTimer); },
  };
}
