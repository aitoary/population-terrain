// @vitest-environment node

import {
  CesiumTerrainProvider, Credit, EllipsoidTerrainProvider,
  UrlTemplateImageryProvider, Viewer,
} from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DATA_SOURCES, MIYAKO_STATION } from '../config/dataSources';
import { connectTerrain, createViewer } from './createViewer';
import type { ReportState } from './createViewer';

vi.mock('cesium', () => ({
  Viewer: vi.fn(),
  CesiumTerrainProvider: { fromUrl: vi.fn() },
  EllipsoidTerrainProvider: vi.fn(),
  UrlTemplateImageryProvider: vi.fn(),
  Credit: vi.fn(function (html: string, showOnScreen: boolean) { return { html, showOnScreen }; }),
  Cartesian3: { fromDegrees: (longitude: number, latitude: number) => ({ longitude, latitude }) },
  HeadingPitchRange: vi.fn(function (heading: number, pitch: number, range: number) {
    return { heading, pitch, range };
  }),
  Math: { toRadians: (degrees: number) => degrees * Math.PI / 180 },
  Matrix4: { IDENTITY: 'identity-transform' },
  Rectangle: { fromDegrees: (...degrees: number[]) => degrees },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createEvent<Args extends unknown[]>() {
  type Listener = (...args: Args) => void;
  const listeners = new Set<Listener>();
  const removeEventListener = vi.fn((listener: Listener) => { listeners.delete(listener); });
  return {
    addEventListener: vi.fn((listener: Listener) => {
      listeners.add(listener);
      return () => removeEventListener(listener);
    }),
    removeEventListener,
    raiseEvent(...args: Args) {
      for (const listener of [...listeners]) listener(...args);
    },
    get numberOfListeners() { return listeners.size; },
  };
}

function createProvider() {
  const fake = { errorEvent: createEvent<[unknown]>() };
  return { ...fake, value: fake as unknown as CesiumTerrainProvider };
}

function createViewerStub() {
  const isDestroyed = vi.fn(() => false);
  return {
    terrainProvider: { bootstrap: true } as unknown,
    isDestroyed,
    destroy: vi.fn(() => { isDestroyed.mockReturnValue(true); }),
    scene: {
      globe: { depthTestAgainstTerrain: false, tilesLoaded: false },
      requestRender: vi.fn(),
    },
    imageryLayers: { addImageryProvider: vi.fn() },
    creditDisplay: { addStaticCredit: vi.fn() },
    camera: { lookAt: vi.fn(), lookAtTransform: vi.fn() },
  };
}

const validMetadata = { format: 'quantized-mesh-1.0', scheme: 'tms', tiles: ['{z}/{x}/{y}.terrain'] };

function metadataResponse(metadata: unknown = validMetadata) {
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let viewer: ReturnType<typeof createViewerStub>;
let imagery: { errorEvent: ReturnType<typeof createEvent<[unknown]>> };
let fetchMock: Mock<typeof fetch>;
let report: Mock<ReportState>;
let onProvider: Mock<(provider: CesiumTerrainProvider) => void>;
let disposables: { destroy: () => void }[];

function connect() {
  const control = connectTerrain(viewer as unknown as Viewer, report, onProvider);
  disposables.push(control);
  return control;
}

function createScene(onImageryError: (message: string) => void) {
  // The mocked Viewer never reads the container, so no DOM shim is necessary.
  const container = {} as HTMLElement;
  const scene = createViewer(container, onImageryError);
  disposables.push(scene);
  return { ...scene, container };
}

async function flushLoads() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.clearAllMocks();
  vi.mocked(CesiumTerrainProvider.fromUrl).mockReset();
  viewer = createViewerStub();
  imagery = { errorEvent: createEvent<[unknown]>() };
  // Constructor mocks must be constructable functions, not arrow functions.
  vi.mocked(Viewer).mockImplementation(function () { return viewer as unknown as Viewer; });
  vi.mocked(UrlTemplateImageryProvider).mockImplementation(function () {
    return imagery as unknown as UrlTemplateImageryProvider;
  });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(metadataResponse()));
  vi.stubGlobal('fetch', fetchMock);
  report = vi.fn<ReportState>();
  onProvider = vi.fn<(provider: CesiumTerrainProvider) => void>();
  disposables = [];
});

afterEach(() => {
  for (const disposable of disposables) disposable.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createViewer', () => {
  it('initializes explicit imagery and a bootstrap terrain without DOM or network access', () => {
    const { viewer: result, container } = createScene(vi.fn());

    expect(typeof document).toBe('undefined');
    expect(result).toBe(viewer);
    expect(Viewer).toHaveBeenCalledExactlyOnceWith(container, expect.objectContaining({
      baseLayer: false,
      terrainProvider: expect.any(EllipsoidTerrainProvider),
      baseLayerPicker: false,
      geocoder: false,
      shadows: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    }));
    expect(UrlTemplateImageryProvider).toHaveBeenCalledExactlyOnceWith({
      url: DATA_SOURCES.imagery.url,
      minimumLevel: DATA_SOURCES.imagery.minimumLevel,
      maximumLevel: DATA_SOURCES.imagery.maximumLevel,
      credit: { html: DATA_SOURCES.imagery.credit, showOnScreen: true },
      rectangle: [141.25, 39.3, 142.15, 40.05],
    });
    expect(viewer.imageryLayers.addImageryProvider).toHaveBeenCalledExactlyOnceWith(imagery);
    expect(Credit).toHaveBeenCalledWith(DATA_SOURCES.terrain.credit, true);
    expect(viewer.creditDisplay.addStaticCredit).toHaveBeenCalledTimes(2);
    expect(viewer.scene.globe.depthTestAgainstTerrain).toBe(true);
    expect(viewer.camera.lookAt).toHaveBeenCalledExactlyOnceWith(
      { longitude: MIYAKO_STATION.longitude, latitude: MIYAKO_STATION.latitude },
      { heading: 10 * Math.PI / 180, pitch: -42 * Math.PI / 180, range: 2800 },
    );
    expect(viewer.camera.lookAtTransform).toHaveBeenCalledExactlyOnceWith('identity-transform');
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(imagery.errorEvent.numberOfListeners).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(CesiumTerrainProvider.fromUrl).not.toHaveBeenCalled();
  });

  it('forwards imagery errors and unsubscribes before destroying the viewer, even on repeated cleanup', () => {
    const onImageryError = vi.fn<(message: string) => void>();
    const scene = createScene(onImageryError);
    imagery.errorEvent.raiseEvent(new Error('imagery HTTP 503'));
    imagery.errorEvent.raiseEvent({ message: 'imagery retry failed' });
    expect(onImageryError.mock.calls).toEqual([['imagery HTTP 503'], ['imagery retry failed']]);
    viewer.destroy.mockImplementation(() => {
      imagery.errorEvent.raiseEvent({ message: 'event during viewer destruction' });
      viewer.isDestroyed.mockReturnValue(true);
    });

    scene.destroy();
    expect(imagery.errorEvent.removeEventListener).toHaveBeenCalledOnce();
    scene.destroy();
    imagery.errorEvent.raiseEvent({ message: 'event after viewer destruction' });

    expect(imagery.errorEvent.numberOfListeners).toBe(0);
    expect(viewer.destroy).toHaveBeenCalledOnce();
    expect(onImageryError.mock.calls).toEqual([['imagery HTTP 503'], ['imagery retry failed']]);
  });

  it('unsubscribes imagery errors even if another owner already destroyed the viewer', () => {
    const onImageryError = vi.fn<(message: string) => void>();
    const scene = createScene(onImageryError);
    viewer.isDestroyed.mockReturnValue(true);

    scene.destroy();
    imagery.errorEvent.raiseEvent({ message: 'late imagery failure' });

    expect(imagery.errorEvent.removeEventListener).toHaveBeenCalledOnce();
    expect(imagery.errorEvent.numberOfListeners).toBe(0);
    expect(viewer.destroy).not.toHaveBeenCalled();
    expect(onImageryError).not.toHaveBeenCalled();
  });
});

describe('connectTerrain', () => {
  it('validates metadata, attaches the provider, and waits for a continuously stable rendered view', async () => {
    const provider = createProvider();
    vi.mocked(CesiumTerrainProvider.fromUrl).mockResolvedValueOnce(provider.value);
    connect();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    await flushLoads();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(DATA_SOURCES.terrain.metadataUrl, {
      signal: expect.any(AbortSignal),
    });
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledExactlyOnceWith(DATA_SOURCES.terrain.url, {
      requestVertexNormals: true,
      credit: { html: DATA_SOURCES.terrain.credit, showOnScreen: true },
    });
    expect(viewer.terrainProvider).toBe(provider.value);
    expect(onProvider).toHaveBeenCalledExactlyOnceWith(provider.value);
    expect(provider.errorEvent.numberOfListeners).toBe(1);
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading']);

    await vi.advanceTimersByTimeAsync(2000);
    expect(report).toHaveBeenCalledTimes(2);
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(800);
    viewer.scene.globe.tilesLoaded = false;
    await vi.advanceTimersByTimeAsync(200);
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(report).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'ready']);
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(report).toHaveBeenCalledTimes(3);
  });

  it.each([
    { label: 'legacy heightmap', metadata: { ...validMetadata, format: 'heightmap-1.0' } },
    { label: 'non-TMS scheme', metadata: { ...validMetadata, scheme: 'xyz' } },
    { label: 'missing tile templates', metadata: { format: validMetadata.format, scheme: 'tms' } },
    { label: 'non-array tile templates', metadata: { ...validMetadata, tiles: 'terrain' } },
    { label: 'null metadata', metadata: null },
  ])('rejects $label rather than silently accepting Cesium fallback terrain', async ({ metadata }) => {
    fetchMock.mockResolvedValueOnce(metadataResponse(metadata));
    const initialProvider = viewer.terrainProvider;
    connect();
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error']);
    expect(report).toHaveBeenLastCalledWith({
      status: 'error', message: '地形の取得に失敗: 地形メタデータの仕様が変わっています。出典を再検証してください。',
    });
    expect(CesiumTerrainProvider.fromUrl).not.toHaveBeenCalled();
    expect(viewer.terrainProvider).toBe(initialProvider);
    expect(onProvider).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports HTTP metadata failures without calling Cesium fromUrl', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    connect();
    await flushLoads();

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error']);
    expect(report).toHaveBeenLastCalledWith({ status: 'error', message: '地形の取得に失敗: 地形メタデータ HTTP 404' });
    expect(CesiumTerrainProvider.fromUrl).not.toHaveBeenCalled();
    expect(onProvider).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a current fromUrl rejection and never marks the bootstrap terrain ready', async () => {
    vi.mocked(CesiumTerrainProvider.fromUrl).mockRejectedValueOnce({ message: 'terrain provider unavailable' });
    const initialProvider = viewer.terrainProvider;
    connect();
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error']);
    expect(report).toHaveBeenLastCalledWith({ status: 'error', message: '地形の取得に失敗: terrain provider unavailable' });
    expect(viewer.terrainProvider).toBe(initialProvider);
    expect(onProvider).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a provider tile error from being overwritten by the readiness timer', async () => {
    const provider = createProvider();
    vi.mocked(CesiumTerrainProvider.fromUrl).mockResolvedValueOnce(provider.value);
    connect();
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(800);
    provider.errorEvent.raiseEvent({ message: 'terrain tile HTTP 503' });
    const callsAtFailure = [...report.mock.calls];
    await vi.advanceTimersByTimeAsync(60_000);

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'error']);
    expect(report).toHaveBeenLastCalledWith({ status: 'error', message: '地形の取得に失敗: terrain tile HTTP 503' });
    expect(report.mock.calls).toEqual(callsAtFailure);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('aborts metadata and ignores its late %s after destroy', async (outcome) => {
    // Deliberately ignore the abort in this fake to exercise the disposed guard too.
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const initialProvider = viewer.terrainProvider;
    const control = connect();
    const signal = fetchMock.mock.calls.at(0)?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    control.destroy();
    expect(signal?.aborted).toBe(true);

    if (outcome === 'resolve') pending.resolve(metadataResponse());
    else pending.reject(new Error('late metadata failure'));
    await flushLoads();

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(CesiumTerrainProvider.fromUrl).not.toHaveBeenCalled();
    expect(viewer.terrainProvider).toBe(initialProvider);
    expect(onProvider).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores metadata body completion after destroy, not just the fetch response', async () => {
    const body = deferred<unknown>();
    const response = metadataResponse();
    const readJson = vi.spyOn(response, 'json').mockReturnValueOnce(body.promise);
    fetchMock.mockResolvedValueOnce(response);
    const control = connect();
    await flushLoads();
    expect(readJson).toHaveBeenCalledOnce();

    control.destroy();
    body.resolve(validMetadata);
    await flushLoads();

    expect(CesiumTerrainProvider.fromUrl).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(onProvider).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('ignores a late provider %s after destroy', async (outcome) => {
    const pending = deferred<CesiumTerrainProvider>();
    const provider = createProvider();
    const initialProvider = viewer.terrainProvider;
    vi.mocked(CesiumTerrainProvider.fromUrl).mockReturnValueOnce(pending.promise);
    const control = connect();
    await flushLoads();
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledOnce();
    control.destroy();
    expect(fetchMock.mock.calls.at(0)?.[1]?.signal?.aborted).toBe(true);

    if (outcome === 'resolve') pending.resolve(provider.value);
    else pending.reject(new Error('late provider failure'));
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    provider.errorEvent.raiseEvent({ message: 'late provider event' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(viewer.terrainProvider).toBe(initialProvider);
    expect(provider.errorEvent.addEventListener).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(onProvider).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not attach a provider if the viewer was independently destroyed while loading', async () => {
    const pending = deferred<CesiumTerrainProvider>();
    const provider = createProvider();
    const initialProvider = viewer.terrainProvider;
    vi.mocked(CesiumTerrainProvider.fromUrl).mockReturnValueOnce(pending.promise);
    connect();
    await flushLoads();
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledOnce();
    viewer.isDestroyed.mockReturnValue(true);

    pending.resolve(provider.value);
    await flushLoads();

    expect(viewer.terrainProvider).toBe(initialProvider);
    expect(provider.errorEvent.addEventListener).not.toHaveBeenCalled();
    expect(onProvider).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('aborts stale metadata on retry and ignores its late %s', async (outcome) => {
    const oldMetadata = deferred<Response>();
    const provider = createProvider();
    fetchMock.mockReturnValueOnce(oldMetadata.promise);
    vi.mocked(CesiumTerrainProvider.fromUrl).mockResolvedValueOnce(provider.value);
    const control = connect();
    const oldSignal = fetchMock.mock.calls.at(0)?.[1]?.signal;
    expect(oldSignal?.aborted).toBe(false);

    control.retry();
    expect(oldSignal?.aborted).toBe(true);
    await flushLoads();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.at(1)?.[1]?.signal?.aborted).toBe(false);
    const callsBeforeStaleCompletion = [...report.mock.calls];
    if (outcome === 'resolve') oldMetadata.resolve(metadataResponse());
    else oldMetadata.reject(new Error('stale metadata failure'));
    await flushLoads();

    expect(report.mock.calls).toEqual(callsBeforeStaleCompletion);
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'loading']);
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledOnce();
    expect(viewer.terrainProvider).toBe(provider.value);
    expect(onProvider).toHaveBeenCalledExactlyOnceWith(provider.value);
    expect(provider.errorEvent.numberOfListeners).toBe(1);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
  });

  it.each([
    { outcome: 'resolve', phase: 'before the current load' },
    { outcome: 'reject', phase: 'before the current load' },
    { outcome: 'resolve', phase: 'after the current load' },
    { outcome: 'reject', phase: 'after the current load' },
  ] as const)('ignores a stale provider on retry: $outcome $phase', async ({ outcome, phase }) => {
    const oldLoad = deferred<CesiumTerrainProvider>();
    const newLoad = deferred<CesiumTerrainProvider>();
    const oldProvider = createProvider();
    const newProvider = createProvider();
    vi.mocked(CesiumTerrainProvider.fromUrl)
      .mockReturnValueOnce(oldLoad.promise)
      .mockReturnValueOnce(newLoad.promise);
    const control = connect();
    await flushLoads();
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledTimes(1);
    control.retry();
    await flushLoads();
    expect(CesiumTerrainProvider.fromUrl).toHaveBeenCalledTimes(2);

    async function finishCurrentLoad() {
      newLoad.resolve(newProvider.value);
      await flushLoads();
    }
    if (phase === 'after the current load') await finishCurrentLoad();
    const callsBeforeStaleCompletion = [...report.mock.calls];
    if (outcome === 'resolve') oldLoad.resolve(oldProvider.value);
    else oldLoad.reject(new Error('stale provider failure'));
    await flushLoads();
    oldProvider.errorEvent.raiseEvent({ message: 'stale provider event' });

    expect(report.mock.calls).toEqual(callsBeforeStaleCompletion);
    expect(oldProvider.errorEvent.addEventListener).not.toHaveBeenCalled();
    if (phase === 'before the current load') await finishCurrentLoad();
    expect(viewer.terrainProvider).toBe(newProvider.value);
    expect(onProvider).toHaveBeenCalledExactlyOnceWith(newProvider.value);
    expect(newProvider.errorEvent.numberOfListeners).toBe(1);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'loading']);
  });

  it('detaches the previous provider error listener immediately when retry starts', async () => {
    const oldProvider = createProvider();
    vi.mocked(CesiumTerrainProvider.fromUrl).mockResolvedValueOnce(oldProvider.value);
    const control = connect();
    await flushLoads();
    expect(oldProvider.errorEvent.numberOfListeners).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    fetchMock.mockReturnValueOnce(deferred<Response>().promise);

    control.retry();
    expect(vi.getTimerCount()).toBe(0);
    const callsAfterRetry = [...report.mock.calls];
    oldProvider.errorEvent.raiseEvent({ message: 'stale tile failure during retry' });

    expect(report.mock.calls).toEqual(callsAfterRetry);
    expect(oldProvider.errorEvent.removeEventListener).toHaveBeenCalledOnce();
    expect(oldProvider.errorEvent.numberOfListeners).toBe(0);
  });

  it('cancels the previous readiness timer and scopes events to the successfully retried provider', async () => {
    const oldProvider = createProvider();
    const newProvider = createProvider();
    const newLoad = deferred<CesiumTerrainProvider>();
    vi.mocked(CesiumTerrainProvider.fromUrl)
      .mockResolvedValueOnce(oldProvider.value)
      .mockReturnValueOnce(newLoad.promise);
    const control = connect();
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(800);

    control.retry();
    await flushLoads();
    const callsWhileRetrying = [...report.mock.calls];
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(report.mock.calls).toEqual(callsWhileRetrying);

    newLoad.resolve(newProvider.value);
    await flushLoads();
    expect(oldProvider.errorEvent.removeEventListener).toHaveBeenCalledOnce();
    expect(oldProvider.errorEvent.numberOfListeners).toBe(0);
    expect(newProvider.errorEvent.numberOfListeners).toBe(1);
    expect(viewer.terrainProvider).toBe(newProvider.value);
    expect(onProvider.mock.calls).toEqual([[oldProvider.value], [newProvider.value]]);
    const callsAfterReplacement = [...report.mock.calls];
    oldProvider.errorEvent.raiseEvent({ message: 'obsolete provider error' });
    expect(report.mock.calls).toEqual(callsAfterReplacement);

    await vi.advanceTimersByTimeAsync(1200);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
    newProvider.errorEvent.raiseEvent({ message: 'current provider error' });
    expect(report).toHaveBeenLastCalledWith({ status: 'error', message: '地形の取得に失敗: current provider error' });
  });

  it('aborts requests, detaches provider events, and cancels readiness on destroy', async () => {
    const provider = createProvider();
    vi.mocked(CesiumTerrainProvider.fromUrl).mockResolvedValueOnce(provider.value);
    const control = connect();
    await flushLoads();
    viewer.scene.globe.tilesLoaded = true;
    await vi.advanceTimersByTimeAsync(800);
    expect(provider.errorEvent.numberOfListeners).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    const callsBeforeDestroy = [...report.mock.calls];

    control.destroy();
    expect(provider.errorEvent.removeEventListener).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.at(0)?.[1]?.signal?.aborted).toBe(true);
    control.destroy();
    provider.errorEvent.raiseEvent({ message: 'provider error after destroy' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(provider.errorEvent.numberOfListeners).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(report.mock.calls).toEqual(callsBeforeDestroy);
    expect(onProvider).toHaveBeenCalledExactlyOnceWith(provider.value);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
  });
});
