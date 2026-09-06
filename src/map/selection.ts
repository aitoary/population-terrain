import { Entity, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Cartesian2, CustomDataSource, Viewer } from 'cesium';

export function pickedMesh(hits: readonly unknown[], source: CustomDataSource): string | null {
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || !('id' in hit)) continue;
    const entity = hit.id;
    if (entity instanceof Entity && entity.id.startsWith('mesh:') && source.entities.getById(entity.id) === entity) {
      return entity.id.slice(5);
    }
  }
  return null;
}

export function connectSelection(viewer: Viewer, source: CustomDataSource, onSelect: (meshId: string) => void) {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(({ position }: { position: Cartesian2 }) => {
    if (!source.show) return;
    // Bound synchronous GPU readbacks in dense building stacks; the ID selector remains available.
        const meshId = pickedMesh(viewer.scene.drillPick(position, 8), source);
    if (meshId) onSelect(meshId);
  }, ScreenSpaceEventType.LEFT_CLICK);
  return () => { if (!handler.isDestroyed()) handler.destroy(); };
}
