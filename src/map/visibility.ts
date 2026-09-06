import { Math as CesiumMath } from 'cesium';
import type { CustomDataSource, Viewer } from 'cesium';
import type { Bbox } from '../domain/types';

/** Retain every Entity, but avoid tessellating/drawing distant geometry on software GPUs. */
export function connectVisibility(viewer: Viewer, source: CustomDataSource, bounds: ReadonlyMap<string, Bbox>) {
  function update() {
    if (viewer.isDestroyed()) return;
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) return;
    // Conservative margin admits tall columns just outside the ground footprint.
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
