import { CustomDataSource, Entity, ScreenSpaceEventType } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { pickedMesh, connectSelection } from './selection';

const mocks = vi.hoisted(() => ({ input: vi.fn(), destroy: vi.fn(), destroyed: false }));
vi.mock('cesium', async (original) => ({ ...await original<typeof import('cesium')>(), ScreenSpaceEventHandler: class {
  setInputAction = mocks.input;
  isDestroyed = () => mocks.destroyed;
  destroy() { mocks.destroyed = true; mocks.destroy(); }
} }));
describe('T08 population identity selection', () => {
  it('drills past buildings/borders and rejects forged IDs and foreign Entity instances', () => {
    const source = new CustomDataSource();
    const entity = source.entities.add({ id: 'mesh:594137654' });
    expect(pickedMesh([null, { id: 'mesh:594137654' }, { id: new Entity({ id: entity.id }) }, { id: new Entity({ id: 'border:1' }) }, { id: entity }], source)).toBe('594137654');
    expect(pickedMesh([{ id: new Entity({ id: entity.id }) }], source)).toBeNull();
  });
  it('selects footprint identities, ignores hidden layers and cleans up once', () => {
    mocks.destroyed = false; mocks.destroy.mockClear();
    const source = new CustomDataSource(); const entity = source.entities.add({ id: 'mesh:zero' });
    const pick = vi.fn(() => [{ id: entity }]); const onSelect = vi.fn();
    const stop = connectSelection({ scene: { canvas: {}, drillPick: pick } } as never, source, onSelect);
    expect(mocks.input.mock.lastCall![1]).toBe(ScreenSpaceEventType.LEFT_CLICK);
    const click = mocks.input.mock.lastCall![0]; click({ position: { x: 1, y: 2 } });
    expect(onSelect).toHaveBeenCalledWith('zero');
    source.show = false; click({ position: {} }); expect(onSelect).toHaveBeenCalledTimes(1);
    stop(); stop(); expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
