import { beforeEach, expect, it, vi } from 'vitest';
import { prepareAgentCompanionPointerDrag } from './AgentCompanionPointerDragService';
const mocks = vi.hoisted(() => ({ position: vi.fn(), scale: vi.fn(), move: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  LogicalPosition: class { constructor(public x: number, public y: number) {} },
  getCurrentWindow: () => ({ outerPosition: mocks.position, scaleFactor: mocks.scale, setPosition: mocks.move }),
}));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  mocks.position.mockReset().mockResolvedValue({ x: 7360, y: 1824 });
  mocks.scale.mockReset().mockResolvedValue(2);
  mocks.move.mockReset().mockResolvedValue(undefined);
});
it('uses Retina logical screen coordinates and follows both directions without a global cursor poll', async () => {
  const direction = vi.fn();
  const drag = prepareAgentCompanionPointerDrag({ x: 3760, y: 974 }, direction, vi.fn());
  await settle();
  drag.move({ x: 3690, y: 974 }); await settle();
  expect(mocks.move).toHaveBeenLastCalledWith(expect.objectContaining({ x: 3610, y: 912 }));
  expect(direction).toHaveBeenLastCalledWith('left');
  drag.move({ x: 3790, y: 964 }); await settle();
  expect(mocks.move).toHaveBeenLastCalledWith(expect.objectContaining({ x: 3710, y: 902 }));
  expect(direction).toHaveBeenLastCalledWith('right');
  drag.cancel();
  drag.move({ x: 4000, y: 964 }); await settle();
  expect(mocks.move).toHaveBeenCalledTimes(2);
});
it('applies the final move even when a quick release precedes origin acquisition', async () => {
  let resolve!: (point: { x: number; y: number }) => void;
  mocks.position.mockReturnValue(new Promise(done => { resolve = done; }));
  const drag = prepareAgentCompanionPointerDrag({ x: 30, y: 40 }, vi.fn(), vi.fn());
  drag.move({ x: 10, y: 60 }); drag.finish();
  drag.move({ x: 500, y: 500 });
  resolve({ x: -200, y: -80 }); await settle();
  expect(mocks.move).toHaveBeenCalledOnce();
  expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({ x: -120, y: -20 }));
});
it('coalesces pending movement and flushes the last position on release', async () => {
  let resolve!: () => void;
  mocks.move.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
  const drag = prepareAgentCompanionPointerDrag({ x: 30, y: 40 }, vi.fn(), vi.fn());
  await settle(); drag.move({ x: 50, y: 40 });
  drag.move({ x: 60, y: 40 }); drag.move({ x: 70, y: 40 }); drag.finish();
  expect(mocks.move).toHaveBeenCalledTimes(1);
  resolve(); await settle();
  expect(mocks.move).toHaveBeenCalledTimes(2);
  expect(mocks.move).toHaveBeenLastCalledWith(expect.objectContaining({ x: 3720, y: 912 }));
});
it('cancels pending movement on lost capture or unmount', async () => {
  let resolve!: (point: { x: number; y: number }) => void;
  mocks.position.mockReturnValue(new Promise(done => { resolve = done; }));
  const drag = prepareAgentCompanionPointerDrag({ x: 30, y: 40 }, vi.fn(), vi.fn());
  drag.move({ x: 60, y: 40 }); drag.cancel();
  resolve({ x: 200, y: 300 }); await settle();
  expect(mocks.move).not.toHaveBeenCalled();
});
it('reports move failures and stops accepting subsequent movement', async () => {
  mocks.move.mockRejectedValue(new Error('Window closed'));
  const error = vi.fn();
  const drag = prepareAgentCompanionPointerDrag({ x: 30, y: 40 }, vi.fn(), error);
  await settle(); drag.move({ x: 50, y: 40 }); await settle();
  drag.move({ x: 60, y: 40 }); await settle();
  expect(error).toHaveBeenCalledOnce();
  expect(mocks.move).toHaveBeenCalledOnce();
});
