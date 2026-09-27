import { Math as CesiumMath } from 'cesium';
import type { CustomDataSource, Viewer } from 'cesium';
import type { Bbox } from '../domain/types';

/** Entityは保持したまま、遠方の形状生成と描画を抑えてソフトウェアGPUの負荷を減らす。 */
export function connectVisibility(viewer: Viewer, source: CustomDataSource, bounds: ReadonlyMap<string, Bbox>) {
  function update() {
    if (viewer.isDestroyed()) return;
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) return;
    // 地表の範囲外にいても柱の上部が見える場合があるため、判定に余裕を持たせる。
    const west = CesiumMath.toDegrees(rectangle.west) - 0.005;
    const east = CesiumMath.toDegrees(rectangle.east) + 0.005;
    const south = CesiumMath.toDegrees(rectangle.south) - 0.005;
    const north = CesiumMath.toDegrees(rectangle.north) + 0.005;
    source.entities.suspendEvents();
    try {
      for (const entity of source.entities.values) {
        const bbox = bounds.get(entity.id);
        entity.show = !bbox || bbox[0] <= east && bbox[2] >= west && bbox[1] <= north && bbox[3] >= south;
      }
    } finally { source.entities.resumeEvents(); }
    viewer.scene.requestRender();
  }
  update();
  const remove = viewer.camera.changed.addEventListener(update);
  return remove;
}
