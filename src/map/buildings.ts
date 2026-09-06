import { Cesium3DTileset } from 'cesium';
import type { Viewer } from 'cesium';
import { DATA_SOURCES } from '../config/dataSources';
import { describeError } from './createViewer';
import type { LayerControl, ReportState } from './createViewer';

export function connectBuildings(viewer: Viewer, report: ReportState): LayerControl & { setVisible: (visible: boolean) => void } {
  let show = true;
  let disposed = false;
  let generation = 0;
  let current: Cesium3DTileset | undefined;
  let removeListeners: (() => void)[] = [];

  function clear() {
    removeListeners.forEach((remove) => remove());
    removeListeners = [];
    if (current && !viewer.isDestroyed()) viewer.scene.primitives.remove(current);
    current = undefined;
  }

  async function load() {
    const attempt = ++generation;
    clear();
    report({ status: 'loading', message: '2025年度LOD1を取得中' });
    try {
      const tileset = await Cesium3DTileset.fromUrl(DATA_SOURCES.buildings.url, {
        maximumScreenSpaceError: 24,
        enableCollision: false,
      });
      if (disposed || attempt !== generation || viewer.isDestroyed()) {
        tileset.destroy();
        return;
      }
      current = tileset;
            tileset.show = show;
      let visible = false;
      let failed = false;
      removeListeners = [
        tileset.tileFailed.addEventListener((error) => {
          failed = true;
          report({ status: 'error', message: `建物タイルの取得に失敗: ${describeError(error)}` });
        }),
        tileset.tileVisible.addEventListener(() => {
          if (!visible && !failed) {
            visible = true;
            report({ status: 'ready', message: 'LOD1タイル表示中（市全域ではありません）' });
          }
        }),
      ];
      viewer.scene.primitives.add(tileset);
      viewer.scene.requestRender();
    } catch (error) {
      if (!disposed && attempt === generation) report({ status: 'error', message: `建物の取得に失敗: ${describeError(error)}` });
    }
  }
  void load();
  return {
    retry: () => { void load(); },
        setVisible(visible: boolean) { show = visible; if (current) current.show = visible; viewer.scene.requestRender(); },
    destroy() { disposed = true; generation += 1; clear(); },
  };
}
