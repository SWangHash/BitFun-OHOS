import { afterEach, expect, it, vi } from 'vitest';
import { startAgentCompanionDrag } from './AgentCompanionDragService';

const { cursor, move } = vi.hoisted(() => ({ cursor: vi.fn(), move: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  cursorPosition: cursor,
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
  getCurrentWindow: () => ({ outerPosition: async () => ({ x: 100, y: 200 }), setPosition: move }),
}));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('moves in physical coordinates, switches direction, holds through pauses and stops on release', async () => {
  vi.useFakeTimers();
  cursor.mockResolvedValue({ x: 150, y: 250 });
  move.mockResolvedValue(undefined);
  const direction = vi.fn();
  const stop = startAgentCompanionDrag(direction, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  cursor.mockResolvedValue({ x: 180, y: 260 });
  await vi.advanceTimersByTimeAsync(16);
  expect(move).toHaveBeenLastCalledWith(expect.objectContaining({ x: 130, y: 210 }));
  expect(direction).toHaveBeenLastCalledWith('right');
  await vi.advanceTimersByTimeAsync(160);
  expect(direction).toHaveBeenCalledTimes(1);
  cursor.mockResolvedValue({ x: 140, y: 260 });
  await vi.advanceTimersByTimeAsync(16);
  expect(direction).toHaveBeenLastCalledWith('left');
  stop();
  const count = move.mock.calls.length;
  await vi.advanceTimersByTimeAsync(160);
  expect(move).toHaveBeenCalledTimes(count);
});

it('does not move after release while initial cursor acquisition is pending', async () => {
  vi.useFakeTimers();
  let resolve!: (point: { x: number; y: number }) => void;
  cursor.mockReturnValue(new Promise(done => { resolve = done; }));
  const stop = startAgentCompanionDrag(vi.fn(), vi.fn());
  stop();
  resolve({ x: 10, y: 10 });
  await vi.advanceTimersByTimeAsync(100);
  expect(move).not.toHaveBeenCalled();
});
