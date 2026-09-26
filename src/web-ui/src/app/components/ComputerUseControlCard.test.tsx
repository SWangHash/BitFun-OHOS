// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComputerUseControlCard } from './ComputerUseControlCard';
import type { ComputerUseControlSnapshot } from '@/infrastructure/api/service-api/ComputerUseControlAPI';

const mocks = vi.hoisted(() => ({ status: vi.fn(), stop: vi.fn(), preview: vi.fn(),
  scope: { epoch: 1, isCurrent: () => true }, listeners: new Set<() => void>() }));
vi.mock('@/infrastructure/api/service-api/ComputerUseControlAPI', async original => ({
  ...await original<object>(), computerUseControlAPI: mocks,
}));
vi.mock('@/infrastructure/peer-device/deviceSurface', () => ({
  getActiveSurfaceScope: () => mocks.scope,
  onSurfaceActivated: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); },
}));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@bitfun/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  OverlayLayer: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  OverflowText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: {} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const active = (target: string, generation = 4): ComputerUseControlSnapshot => ({
  supported: true, generation, owner: 'session', mode: 'background', state: 'active', target,
  action: null, sequence: 1, reason: null, pointer: null, capabilities: [],
});
beforeEach(() => {
  vi.useFakeTimers(); mocks.status.mockReset(); mocks.stop.mockReset(); mocks.preview.mockReset();
  mocks.scope = { epoch: 1, isCurrent: () => mocks.scope.epoch === 1 };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it('stops the generation the user saw, then removes the stop action', async () => {
  mocks.status.mockResolvedValue(active('Window A'));
  mocks.stop.mockResolvedValue({ ...active('Window A', 5), state: 'stopped' });
  await act(async () => root.render(<ComputerUseControlCard />));
  const stop = [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.stop')!;
  await act(async () => stop.click());
  expect(mocks.stop).toHaveBeenCalledWith(4);
  expect(container.textContent).toContain('computerControl.stopped');
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'computerControl.stop')).toBe(false);
});

it('discards an old device response when the surface changes with a read in flight', async () => {
  let resolveOld!: (value: ComputerUseControlSnapshot) => void;
  mocks.status.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue(active('Peer B'));
  await act(async () => root.render(<ComputerUseControlCard />));
  await act(async () => {
    mocks.scope = { epoch: 2, isCurrent: () => mocks.scope.epoch === 2 };
    mocks.listeners.forEach(fn => fn());
  });
  await act(async () => resolveOld(active('Local secret')));
  expect(container.textContent).toContain('Peer B');
  expect(container.textContent).not.toContain('Local secret');
  expect(mocks.stop).not.toHaveBeenCalled();
});


it('does not restore active control from a read started before Stop completed', async () => {
  let resolveRead!: (value: ComputerUseControlSnapshot) => void;
  mocks.status.mockResolvedValueOnce(active('Window A'))
    .mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
  mocks.stop.mockResolvedValue({ ...active('Window A', 5), state: 'stopped' });
  await act(async () => root.render(<ComputerUseControlCard />));
  await act(async () => vi.advanceTimersByTime(1000));
  const stop = [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.stop')!;
  await act(async () => stop.click());
  await act(async () => resolveRead(active('Window A')));
  expect(container.textContent).toContain('computerControl.stopped');
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'computerControl.stop')).toBe(false);
});

it('renders a retained click even when the instantaneous pointer is already up', async () => {
  mocks.status.mockResolvedValue({ ...active('Window A'), pointer: {
    x: 80, y: 70, click: false, sequence: 9,
    last_click: { x: 25, y: 50, sequence: 8, occurred_at_ms: 1 },
  } });
  mocks.preview.mockResolvedValue({ generation: 4, target: 'Window A', image_base64: 'AA==', mime_type: 'image/png',
    width: 100, height: 100, origin_x: 0, origin_y: 0, span_width: 100, span_height: 100 });
  await act(async () => root.render(<ComputerUseControlCard />));
  const preview = [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.showPreview')!;
  await act(async () => preview.click());
  await act(async () => vi.advanceTimersByTime(1000));
  const ring = container.querySelector<HTMLElement>('[data-bitfun-part="click"]');
  expect(ring?.style.left).toBe('25%');
  expect(ring?.style.top).toBe('50%');
  await act(async () => vi.advanceTimersByTime(300));
  expect(container.querySelector('[data-bitfun-part="click"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('[data-bitfun-part="click"]')).toBeNull();
});


it('does not show a preview from a different target in the same session', async () => {
  mocks.status.mockResolvedValue(active('Window A'));
  mocks.preview.mockResolvedValue({ generation: 4, target: 'Window B', image_base64: 'AA==', mime_type: 'image/png',
    width: 100, height: 100, origin_x: 0, origin_y: 0, span_width: 100, span_height: 100 });
  await act(async () => root.render(<ComputerUseControlCard />));
  const preview = [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.showPreview')!;
  await act(async () => preview.click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('computerControl.previewUnavailable');
});


it('keeps the session arrow after click feedback expires and clears it on stop', async () => {
  mocks.status.mockResolvedValue({ ...active('Window A'), pointer: {
    x: 40, y: 60, click: false, sequence: 10,
  } });
  mocks.preview.mockResolvedValue({ generation: 4, target: 'Window A', image_base64: 'AA==', mime_type: 'image/png',
    width: 100, height: 100, origin_x: 0, origin_y: 0, span_width: 100, span_height: 100 });
  mocks.stop.mockResolvedValue({ ...active('Window A', 5), state: 'stopped' });
  await act(async () => root.render(<ComputerUseControlCard />));
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.showPreview')!.click());
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => vi.advanceTimersByTime(2000));
  const arrow = container.querySelector<HTMLElement>('[data-bitfun-part="pointer"]');
  expect(arrow?.querySelector('svg path')).not.toBeNull();
  expect(arrow?.style.left).toBe('40%');
  expect(arrow?.style.top).toBe('60%');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.stop')!.click());
  expect(container.querySelector('[data-bitfun-part="pointer"]')).toBeNull();
});


it('removes the old target pointer while waiting for the new target preview', async () => {
  mocks.status.mockResolvedValue({ ...active('Window A'), pointer: { x: 40, y: 60, click: false, sequence: 10 } });
  mocks.preview.mockResolvedValue({ generation: 4, target: 'Window A', image_base64: 'AA==', mime_type: 'image/png',
    width: 100, height: 100, origin_x: 0, origin_y: 0, span_width: 100, span_height: 100 });
  await act(async () => root.render(<ComputerUseControlCard />));
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'computerControl.showPreview')!.click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('[data-bitfun-part="pointer"]')).not.toBeNull();
  mocks.status.mockResolvedValue(active('Window B'));
  mocks.preview.mockReturnValue(new Promise(() => {}));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('[data-bitfun-part="pointer"]')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});
