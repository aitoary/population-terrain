import { Cartographic, sampleTerrain } from 'cesium';
import type { TerrainProvider } from 'cesium';
import { meshBbox } from '../data/loadPopulation';
import type { MeshFeature } from '../domain/types';

export const TERRAIN_LEVEL = 12;
export const BASE_CLEARANCE = 2;

export type TerrainBaseResult =
  | { status: 'ready'; meshId: string; baseHeight: number; minHeight: number; maxHeight: number; heights: readonly number[] }
  | { status: 'error'; meshId: string; message: string };

type ReadyBase = Extract<TerrainBaseResult, { status: 'ready' }>;
type SamplePoint = { key: string; position: Cartographic };

function cellPoints(feature: MeshFeature): SamplePoint[] {
  const [west, south, east, north] = meshBbox(feature);
  const points: SamplePoint[] = [];
  for (const latitude of [south, (south + north) / 2, north]) {
    for (const longitude of [west, (west + east) / 2, east]) {
      points.push({
        key: `${longitude},${latitude}`,
        // Cesium can leave a height untouched; its default zero is not a measured height.
        position: Cartographic.fromDegrees(longitude, latitude, Number.NaN),
      });
    }
  }
  return points;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TerrainSampler {
  private readonly sampleHeights = new Map<string, number>();
  private readonly bases = new Map<string, ReadyBase>();
  private readonly lifecycle = new AbortController();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly provider: TerrainProvider, private readonly sample = sampleTerrain) {}

  async sampleCells(features: readonly MeshFeature[]): Promise<ReadonlyMap<string, TerrainBaseResult>> {
    const { signal } = this.lifecycle;
    signal.throwIfAborted();
    const requested = [...features];
    // One queue per instance keeps overlapping callers within the same two-worker limit.
    const work = this.queue.then(() => this.sampleQueuedCells(requested));
    this.queue = work.then(() => undefined, () => undefined);

    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const results = await Promise.race([work, aborted]);
      signal.throwIfAborted();
      return results;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  destroy(): void {
    this.lifecycle.abort(new DOMException('地形サンプラーは破棄されています', 'AbortError'));
    this.sampleHeights.clear();
    this.bases.clear();
  }

  private async sampleQueuedCells(features: readonly MeshFeature[]): Promise<ReadonlyMap<string, TerrainBaseResult>> {
    const { signal } = this.lifecycle;
    signal.throwIfAborted();
    const cells = new Map<string, string[]>();
    const pending = new Map<string, SamplePoint>();
    for (const feature of features) {
      const { meshId } = feature.properties;
      if (this.bases.has(meshId) || cells.has(meshId)) continue;
      const points = cellPoints(feature);
      cells.set(meshId, points.map((point) => point.key));
      for (const point of points) {
        if (!this.sampleHeights.has(point.key) && !pending.has(point.key)) pending.set(point.key, point);
      }
    }

    const failures = new Map<string, string>();
    const tiles = new Map<string, SamplePoint[]>();
    for (const point of pending.values()) {
      try {
        const tile = this.provider.tilingScheme.positionToTileXY(point.position, TERRAIN_LEVEL);
        if (!tile) throw new Error('サンプル点が地形タイルの範囲外です');
        const tileKey = `${TERRAIN_LEVEL}/${tile.x}/${tile.y}`;
        const group = tiles.get(tileKey);
        if (group) group.push(point);
        else tiles.set(tileKey, [point]);
      } catch (error) {
        failures.set(point.key, `地形タイルを特定できません: ${errorMessage(error)}`);
      }
    }

    const groups = tiles.entries();
    const worker = async () => {
      for (let next = groups.next(); !next.done; next = groups.next()) {
        signal.throwIfAborted();
        const [tileKey, points] = next.value;
        try {
          const sampled = await this.sample(this.provider, TERRAIN_LEVEL, points.map((point) => point.position), true);
          // sampleTerrain has no AbortSignal; never retain a late completion after destroy.
          signal.throwIfAborted();
          for (const [index, point] of points.entries()) {
            const height = sampled[index]?.height;
            if (typeof height === 'number' && Number.isFinite(height)) this.sampleHeights.set(point.key, height);
            else failures.set(point.key, `地形タイル ${tileKey} の高さが有限値ではありません`);
          }
        } catch (error) {
          signal.throwIfAborted();
          for (const point of points) {
            failures.set(point.key, `地形タイル ${tileKey} の取得に失敗: ${errorMessage(error)}`);
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
    signal.throwIfAborted();

    const results = new Map<string, TerrainBaseResult>();
    for (const feature of features) {
      const { meshId } = feature.properties;
      const cached = this.bases.get(meshId);
      if (cached) {
        results.set(meshId, cached);
        continue;
      }
      const heights: number[] = [];
      let failure: string | undefined;
      for (const key of cells.get(meshId)!) {
        const height = this.sampleHeights.get(key);
        if (typeof height === 'number' && Number.isFinite(height)) heights.push(height);
        else failure ??= failures.get(key) ?? '地形の高さが取得できません';
      }
      if (heights.length !== 9) {
        results.set(meshId, { status: 'error', meshId, message: `${failure}（有効な高さ ${heights.length}/9点）` });
        continue;
      }
      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      const base: ReadyBase = Object.freeze({
        status: 'ready', meshId, baseHeight: maxHeight + BASE_CLEARANCE,
        minHeight, maxHeight, heights: Object.freeze(heights),
      });
      this.bases.set(meshId, base);
      results.set(meshId, base);
    }
    return results;
  }
}
