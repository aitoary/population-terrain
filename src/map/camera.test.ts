import { describe, expect, it, vi } from 'vitest';
import { focusAll, focusMesh, focusStation } from './camera';
import type { MeshFeature } from '../domain/types';

describe('T08 camera presets', () => {
  it('uses camera operations only and cancels old flights', () => {
    const viewer = { camera: { cancelFlight: vi.fn(), lookAt: vi.fn(), lookAtTransform: vi.fn(), setView: vi.fn() }, scene: { requestRender: vi.fn() } };
    focusStation(viewer as never);
    expect(viewer.camera.lookAt.mock.lastCall![1].range).toBe(2800);
    focusAll(viewer as never, [141, 39, 142, 40]);
    expect(viewer.camera.setView).toHaveBeenCalledOnce();
    const feature = { geometry: { coordinates: [[[141, 39], [142, 39], [142, 40], [141, 40], [141, 39]]] } } as unknown as MeshFeature;
    focusMesh(viewer as never, feature, 123);
    expect(viewer.camera.lookAt.mock.lastCall![1].range).toBe(1800);
    expect(viewer.camera.cancelFlight).toHaveBeenCalledTimes(3);
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(3);
  });
});
