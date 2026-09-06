import { CustomDataSource, Event, Rectangle } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { connectVisibility } from './visibility';
import type { Bbox } from '../domain/types';

describe('view-dependent geometry visibility', () => {
  it('retains distant entities and restores them on camera changes, with cleanup', () => {
    const source = new CustomDataSource();
    const a = source.entities.add({ id: 'near' }); const b = source.entities.add({ id: 'far' });
    const changed = new Event();
    const rectangle = vi.fn(() => Rectangle.fromDegrees(141, 39, 142, 40));
    const viewer = { isDestroyed: () => false, camera: { computeViewRectangle: rectangle, changed }, scene: { globe: { ellipsoid: {} }, requestRender: vi.fn() } };
    const bounds = new Map<string, Bbox>([['near', [141.1, 39.1, 141.2, 39.2]], ['far', [143, 39, 144, 40]]]);
    const stop = connectVisibility(viewer as never, source, bounds);
    expect(a.show).toBe(true); expect(b.show).toBe(false); expect(source.entities.values).toHaveLength(2);
    rectangle.mockReturnValue(Rectangle.fromDegrees(140, 38, 145, 41)); changed.raiseEvent();
    expect(b.show).toBe(true); expect(source.entities.getById('far')).toBe(b);
    stop(); expect(changed.numberOfListeners).toBe(0);
  });
});
