// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/runtime', () => ({ isOpenHarmonyRuntime: () => true }));

import { useNativeFileDrop } from './useNativeFileDrop';

let root: Root;
let container: HTMLDivElement;
const onDragOver = vi.fn();

function Harness() {
  const targetRef = useRef<HTMLDivElement>(null);
  useNativeFileDrop({ targetRef, onDragOver, onDrop: vi.fn() });
  return <div ref={targetRef} />;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('keeps the native drop hint during a DOM drag and clears it on dragend', () => {
  act(() => window.dispatchEvent(new Event('dragstart')));
  act(() => window.__bitFunNativeFileDrop?.({ type: 'enter', paths: [] }));
  expect(onDragOver).toHaveBeenLastCalledWith(true);

  act(() => window.dispatchEvent(new Event('dragend')));
  expect(onDragOver).toHaveBeenLastCalledWith(false);
});

it('clears the native hover synchronously on DOM drop and blur', () => {
  act(() => window.__bitFunNativeFileDrop?.({ type: 'enter', paths: [] }));
  expect(onDragOver).toHaveBeenLastCalledWith(true);

  act(() => window.dispatchEvent(new Event('drop')));
  expect(onDragOver).toHaveBeenLastCalledWith(false);

  act(() => window.__bitFunNativeFileDrop?.({ type: 'enter', paths: [] }));
  act(() => window.dispatchEvent(new Event('blur')));
  expect(onDragOver).toHaveBeenLastCalledWith(false);
});
