/** @vitest-environment jsdom */
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined),
  listener: null as null | ((event: { payload: Record<string, unknown> }) => void), unlisten: vi.fn(),
}));
vi.mock('@/infrastructure/runtime', () => ({ isWindowsDesktopRuntime: () => true }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke: mocks.invoke } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (_name: string, listener: typeof mocks.listener) => {
  mocks.listener = listener; return mocks.unlisten;
} }));
import { useWindowsFileDropPreview } from './useWindowsFileDropPreview';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div'); document.body.appendChild(container);
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); vi.clearAllMocks(); mocks.invoke.mockResolvedValue(undefined); });

async function setup() {
  const onDragOver = vi.fn(), onPreview = vi.fn(), onPosition = vi.fn(), onDropPaths = vi.fn();
  function Pane() {
    const ref = useRef<HTMLDivElement>(null);
    useWindowsFileDropPreview({ targetRef: ref, enabled: true, onDragOver, onPreview, onPosition, onDropPaths });
    return <div ref={ref}>Chat</div>;
  }
  root = createRoot(container);
  await act(async () => { root.render(<Pane />); });
  container.firstElementChild!.getBoundingClientRect = () => new DOMRect(100, 100, 600, 500);
  const drag = (types: string[]) => {
    const event = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types } });
    container.firstElementChild!.dispatchEvent(event);
    return event;
  };
  const emit = (targetId: string, kind: string, fields = {}) => {
    act(() => mocks.listener?.({ payload: { targetId, kind, generation: 1, x: 100, y: 200,
      count: 5, files: [{ name: 'photo.png' }], ...fields } }));
  };
  return { onDragOver, onPreview, onPosition, onDropPaths, drag, emit };
}

describe('Windows enhanced file drop adapter', () => {
  it('arms only external file drags without consuming HTML drag events', async () => {
    const { drag } = await setup();
    expect(drag(['text/plain']).defaultPrevented).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => { expect(drag(['Files']).defaultPrevented).toBe(false); });
    expect(mocks.invoke).toHaveBeenCalledWith('set_file_drop_preview_target', expect.objectContaining({
      request: expect.objectContaining({ bounds: expect.objectContaining({ scale: window.devicePixelRatio }) }),
    }));
  });
  it('accepts all paths once, isolates targets, and ignores stale thumbnails after drop', async () => {
    const { drag, emit, onPreview, onDropPaths, onDragOver, onPosition } = await setup();
    await act(async () => { drag(['Files']); });
    const id = mocks.invoke.mock.calls[0][1].request.targetId;
    emit('other-pane', 'enter'); expect(onPreview).not.toHaveBeenCalled();
    emit(id, 'enter'); expect(onDragOver).toHaveBeenLastCalledWith(true);
    emit(id, 'over', { x: 120 }); expect(onPosition).toHaveBeenLastCalledWith({ x: 120, y: 200 });
    const paths = ['/a.png', '/b.png', '/c.png', '/d.png', '/report.pdf'];
    emit(id, 'drop', { paths }); emit(id, 'drop', { paths });
    expect(onDropPaths).toHaveBeenCalledExactlyOnceWith(paths);
    emit(id, 'thumbnails'); expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onDragOver).toHaveBeenLastCalledWith(false);
  });
  it('reports unsupported older hosts and preserves browser file intake', async () => {
    const { drag, onPreview, onDropPaths } = await setup();
    mocks.invoke.mockRejectedValueOnce(new Error('Command unavailable'));
    await act(async () => { expect(drag(['Files']).defaultPrevented).toBe(false); });
    expect(onPreview).toHaveBeenLastCalledWith({ count: 0, files: [], unavailable: true });
    expect(onDropPaths).not.toHaveBeenCalled();
  });
  it('returns to browser intake if native drag-image suppression fails', async () => {
    const { drag, emit, onPreview, onDragOver } = await setup();
    await act(async () => { drag(['Files']); });
    const id = mocks.invoke.mock.calls[0][1].request.targetId;
    emit(id, 'unavailable');
    expect(onPreview).toHaveBeenLastCalledWith({ count: 0, files: [], unavailable: true });
    expect(onDragOver).toHaveBeenLastCalledWith(false);
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    emit(id, 'thumbnails');
    expect(onPreview).toHaveBeenLastCalledWith({ count: 0, files: [], unavailable: true });
  });
  it('retries the next visit after a transient failure instead of disabling the pane', async () => {
    const { drag, emit, onDragOver } = await setup();
    mocks.invoke.mockRejectedValueOnce(new Error('Native target creation failed'));
    await act(async () => { drag(['Files']); });
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    act(() => container.firstElementChild!.dispatchEvent(new MouseEvent('dragleave', {
      bubbles: true, clientX: 20, clientY: 20,
    })));
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    emit(mocks.invoke.mock.calls[1][1].request.targetId, 'enter');
    expect(onDragOver).toHaveBeenLastCalledWith(true);
  });
  it('recovers after a failed drag is dropped through the browser', async () => {
    const { drag } = await setup();
    mocks.invoke.mockRejectedValueOnce(new Error('Native target unavailable'));
    await act(async () => { drag(['Files']); });
    act(() => window.dispatchEvent(new Event('drop')));
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
  it('does not re-arm or release during the browser-to-native receiver handoff', async () => {
    const { drag } = await setup();
    await act(async () => { drag(['Files']); });
    act(() => container.firstElementChild!.dispatchEvent(new MouseEvent('dragleave', { bubbles: true })));
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('ignores a late failed activation after the drag has already ended', async () => {
    const { drag, onPreview } = await setup();
    let reject!: (error: Error) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
    await act(async () => { drag(['Files']); });
    act(() => window.dispatchEvent(new Event('drop')));
    await act(async () => { reject(new Error('Late native error')); });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    await act(async () => { drag(['Files']); });
    expect(mocks.invoke.mock.calls.filter(([, args]) => args.request.bounds !== null)).toHaveLength(2);
  });
});
