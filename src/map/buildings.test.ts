// @vitest-environment node

import { Cesium3DTileset } from 'cesium';
import type { Viewer } from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_SOURCES } from '../config/dataSources';
import { connectBuildings } from './buildings';
import type { LayerControl, ReportState } from './createViewer';

vi.mock('cesium', () => ({
  Cesium3DTileset: { fromUrl: vi.fn() },
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

function createTileset() {
  const fake = {
    tileFailed: createEvent<[unknown]>(),
    tileVisible: createEvent<[unknown]>(),
    allTilesLoaded: createEvent<[]>(),
    loadProgress: createEvent<[number, number]>(),
    tilesLoaded: false,
    destroy: vi.fn(),
  };
  // Only the Cesium boundary is cast; the event and ownership fakes remain typed.
  return {
    value: fake as unknown as Cesium3DTileset,
    tileFailed: fake.tileFailed,
    tileVisible: fake.tileVisible,
    allTilesLoaded: fake.allTilesLoaded,
    loadProgress: fake.loadProgress,
    destroy: fake.destroy,
    setTilesLoaded(value: boolean) { fake.tilesLoaded = value; },
  };
}

function createViewerStub() {
  const attached = new Set<Cesium3DTileset>();
  return {
    attached,
    isDestroyed: vi.fn(() => false),
    scene: {
      primitives: {
        add: vi.fn((tileset: Cesium3DTileset) => {
          attached.add(tileset);
          return tileset;
        }),
        remove: vi.fn((tileset: Cesium3DTileset) => {
          if (!attached.delete(tileset)) return false;
          // PrimitiveCollection owns and destroys removed primitives by default.
          tileset.destroy();
          return true;
        }),
      },
      requestRender: vi.fn(),
    },
  };
}

let controls: LayerControl[];

function connect() {
  const viewer = createViewerStub();
  const report = vi.fn<ReportState>();
  const control = connectBuildings(viewer as unknown as Viewer, report);
  controls.push(control);
  return { viewer, report, control };
}

async function flushLoads() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(Cesium3DTileset.fromUrl).mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request in a node unit test'); }));
  controls = [];
});

afterEach(() => {
  for (const control of controls) control.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectBuildings', () => {
  it('loads the configured LOD1 tileset but reports ready only when a tile is visible', async () => {
    const pending = deferred<Cesium3DTileset>();
    const tileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl).mockReturnValueOnce(pending.promise);
    const { viewer, report } = connect();

    expect(Cesium3DTileset.fromUrl).toHaveBeenCalledExactlyOnceWith(DATA_SOURCES.buildings.url, {
      maximumScreenSpaceError: 24,
      enableCollision: false,
    });
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(viewer.scene.primitives.add).not.toHaveBeenCalled();

    pending.resolve(tileset.value);
    await flushLoads();
    expect(viewer.scene.primitives.add).toHaveBeenCalledExactlyOnceWith(tileset.value);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(tileset.tileFailed.numberOfListeners).toBe(1);
    expect(tileset.tileVisible.numberOfListeners).toBe(1);

    tileset.tileVisible.raiseEvent({});
    tileset.tileVisible.raiseEvent({});
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'ready']);
    expect(tileset.destroy).not.toHaveBeenCalled();
  });

  it('reports a tileset metadata rejection as an actionable error, not an empty or ready layer', async () => {
    vi.mocked(Cesium3DTileset.fromUrl).mockRejectedValueOnce(new Error('tileset.json HTTP 503'));
    const { viewer, report } = connect();
    await flushLoads();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error']);
    expect(report).toHaveBeenLastCalledWith({ status: 'error', message: '建物の取得に失敗: tileset.json HTTP 503' });
    expect(viewer.scene.primitives.add).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
  });

  it.each(['before any visible tile', 'after ready'] as const)(
    'keeps tileFailed as error rather than no-buildings/ready (%s)',
    async (phase) => {
      const tileset = createTileset();
      vi.mocked(Cesium3DTileset.fromUrl).mockResolvedValueOnce(tileset.value);
      const { report } = connect();
      await flushLoads();
      if (phase === 'after ready') tileset.tileVisible.raiseEvent({});

      tileset.tileFailed.raiseEvent({ message: 'building.b3dm HTTP 404' });
      expect(report).toHaveBeenLastCalledWith({
        status: 'error', message: '建物タイルの取得に失敗: building.b3dm HTTP 404',
      });
      const callsAtFailure = [...report.mock.calls];

      tileset.setTilesLoaded(true);
      tileset.loadProgress.raiseEvent(0, 0);
      tileset.allTilesLoaded.raiseEvent();
      await vi.advanceTimersByTimeAsync(60_000);
      tileset.tileVisible.raiseEvent({});
      tileset.allTilesLoaded.raiseEvent();

      expect(report.mock.calls).toEqual(callsAtFailure);
    },
  );

  it.each(['resolve', 'reject'] as const)('ignores a late load %s after layer destroy', async (outcome) => {
    const pending = deferred<Cesium3DTileset>();
    const tileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl).mockReturnValueOnce(pending.promise);
    const { viewer, report, control } = connect();
    control.destroy();

    if (outcome === 'resolve') pending.resolve(tileset.value);
    else pending.reject(new Error('late failure after unmount'));
    await flushLoads();

    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
    expect(viewer.scene.primitives.add).not.toHaveBeenCalled();
    expect(viewer.scene.primitives.remove).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(tileset.tileFailed.addEventListener).not.toHaveBeenCalled();
    expect(tileset.tileVisible.addEventListener).not.toHaveBeenCalled();
    expect(tileset.destroy).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
  });

  it('destroys a late tileset without touching a viewer that was already destroyed', async () => {
    const pending = deferred<Cesium3DTileset>();
    const tileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl).mockReturnValueOnce(pending.promise);
    const { viewer, report } = connect();
    viewer.isDestroyed.mockReturnValue(true);

    pending.resolve(tileset.value);
    await flushLoads();

    expect(tileset.destroy).toHaveBeenCalledOnce();
    expect(tileset.tileFailed.addEventListener).not.toHaveBeenCalled();
    expect(tileset.tileVisible.addEventListener).not.toHaveBeenCalled();
    expect(viewer.scene.primitives.add).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading']);
  });

  it.each([
    { outcome: 'resolve', phase: 'before the current load' },
    { outcome: 'reject', phase: 'before the current load' },
    { outcome: 'resolve', phase: 'after the current load' },
    { outcome: 'reject', phase: 'after the current load' },
  ] as const)('ignores the stale generation on retry: $outcome $phase', async ({ outcome, phase }) => {
    const oldLoad = deferred<Cesium3DTileset>();
    const newLoad = deferred<Cesium3DTileset>();
    const oldTileset = createTileset();
    const newTileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl)
      .mockReturnValueOnce(oldLoad.promise)
      .mockReturnValueOnce(newLoad.promise);
    const { viewer, report, control } = connect();
    control.retry();
    expect(Cesium3DTileset.fromUrl).toHaveBeenCalledTimes(2);

    async function finishCurrentLoad() {
      newLoad.resolve(newTileset.value);
      await flushLoads();
      newTileset.tileVisible.raiseEvent({});
    }
    if (phase === 'after the current load') await finishCurrentLoad();
    const callsBeforeStaleCompletion = [...report.mock.calls];

    if (outcome === 'resolve') oldLoad.resolve(oldTileset.value);
    else oldLoad.reject(new Error('stale tileset failure'));
    await flushLoads();

    expect(report.mock.calls).toEqual(callsBeforeStaleCompletion);
    expect(oldTileset.tileFailed.addEventListener).not.toHaveBeenCalled();
    expect(oldTileset.tileVisible.addEventListener).not.toHaveBeenCalled();
    expect(oldTileset.destroy).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
    expect(viewer.scene.primitives.add).not.toHaveBeenCalledWith(oldTileset.value);
    if (phase === 'before the current load') await finishCurrentLoad();

    expect(viewer.scene.primitives.add).toHaveBeenCalledExactlyOnceWith(newTileset.value);
    expect(viewer.attached).toEqual(new Set([newTileset.value]));
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(newTileset.destroy).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'ready']);
  });

  it('detaches the old events before removing its primitive on retry and allows the new generation to recover', async () => {
    const oldTileset = createTileset();
    const newTileset = createTileset();
    const newLoad = deferred<Cesium3DTileset>();
    vi.mocked(Cesium3DTileset.fromUrl)
      .mockResolvedValueOnce(oldTileset.value)
      .mockReturnValueOnce(newLoad.promise);
    const { viewer, report, control } = connect();
    await flushLoads();
    oldTileset.tileFailed.raiseEvent({ message: 'old tile failed' });
    oldTileset.destroy.mockImplementation(() => {
      oldTileset.tileFailed.raiseEvent({ message: 'event during primitive removal' });
    });

    control.retry();
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error', 'loading']);
    expect(oldTileset.tileFailed.removeEventListener).toHaveBeenCalledOnce();
    expect(oldTileset.tileVisible.removeEventListener).toHaveBeenCalledOnce();
    expect(oldTileset.tileFailed.numberOfListeners).toBe(0);
    expect(oldTileset.tileVisible.numberOfListeners).toBe(0);
    expect(viewer.scene.primitives.remove).toHaveBeenCalledExactlyOnceWith(oldTileset.value);
    expect(oldTileset.destroy).toHaveBeenCalledOnce();
    expect(viewer.attached.size).toBe(0);
    const callsAfterRetry = [...report.mock.calls];
    oldTileset.tileFailed.raiseEvent({ message: 'stale event after retry' });
    oldTileset.tileVisible.raiseEvent({});
    expect(report.mock.calls).toEqual(callsAfterRetry);

    newLoad.resolve(newTileset.value);
    await flushLoads();
    newTileset.tileVisible.raiseEvent({});
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'error', 'loading', 'ready']);
    expect(viewer.attached).toEqual(new Set([newTileset.value]));
    expect(newTileset.tileFailed.numberOfListeners).toBe(1);
    expect(newTileset.tileVisible.numberOfListeners).toBe(1);
    oldTileset.tileFailed.raiseEvent({ message: 'stale event after recovery' });
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('removes events and the owned primitive exactly once on repeated destroy', async () => {
    const tileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl).mockResolvedValueOnce(tileset.value);
    const { viewer, report, control } = connect();
    await flushLoads();
    tileset.destroy.mockImplementation(() => {
      tileset.tileFailed.raiseEvent({ message: 'event during destroy' });
    });
    const callsBeforeDestroy = [...report.mock.calls];

    control.destroy();
    control.destroy();
    tileset.tileVisible.raiseEvent({});
    tileset.tileFailed.raiseEvent({ message: 'event after destroy' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tileset.tileFailed.removeEventListener).toHaveBeenCalledOnce();
    expect(tileset.tileVisible.removeEventListener).toHaveBeenCalledOnce();
    expect(tileset.tileFailed.numberOfListeners).toBe(0);
    expect(tileset.tileVisible.numberOfListeners).toBe(0);
    expect(viewer.scene.primitives.remove).toHaveBeenCalledExactlyOnceWith(tileset.value);
    expect(tileset.destroy).toHaveBeenCalledOnce();
    expect(viewer.attached.size).toBe(0);
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual(callsBeforeDestroy);
  });

  it('still detaches events when the viewer has already destroyed its primitives', async () => {
    const tileset = createTileset();
    vi.mocked(Cesium3DTileset.fromUrl).mockResolvedValueOnce(tileset.value);
    const { viewer, report, control } = connect();
    await flushLoads();
    viewer.isDestroyed.mockReturnValue(true);
    const callsBeforeDestroy = [...report.mock.calls];

    control.destroy();
    tileset.tileFailed.raiseEvent({ message: 'event from a destroyed viewer' });
    tileset.tileVisible.raiseEvent({});

    expect(tileset.tileFailed.numberOfListeners).toBe(0);
    expect(tileset.tileVisible.numberOfListeners).toBe(0);
    expect(viewer.scene.primitives.remove).not.toHaveBeenCalled();
    expect(report.mock.calls).toEqual(callsBeforeDestroy);
  });
});
