// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from './ImageViewer';

const mocks = vi.hoisted(() => ({ read: vi.fn(), localRead: vi.fn(), current: vi.fn(() => true) }));
vi.mock('../services/EditorDocument', () => {
  const session = { files: { readFileContent: mocks.read }, isCurrent: mocks.current };
  return { useEditorDocument: () => session };
});
vi.mock('@/infrastructure/api', () => ({ workspaceAPI: { readFileContent: mocks.localRead } }));
vi.mock('@/infrastructure/i18n', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock('@bitfun/ui', () => ({
  OverflowText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
  Icon: () => null,
  IconButton: ({ onClick, disabled, 'aria-label': label }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button onClick={onClick} disabled={disabled} aria-label={label} />,
  Toolbar: ({ leading, trailing }: { leading: React.ReactNode; trailing: React.ReactNode }) => <div>{leading}{trailing}</div>,
  ToolbarGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ToolbarSeparator: () => null,
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  createOverlayPortal: (node: React.ReactNode) => node,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('uses supplied bytes without local IO and reports the actual byte size', async () => {
  await act(async () => root.render(<ImageViewer filePath="dispatch-file://job/a.png" imageSource={{ dataUrl: 'data:image/png;base64,AP8B', size: 3 }} />));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AP8B');
  expect(container.textContent).toContain('3 B');
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.localRead).not.toHaveBeenCalled();
});

it('does not retry a failed read until the tab is reactivated', async () => {
  mocks.read.mockRejectedValue(new Error('offline'));
  await act(async () => root.render(<ImageViewer filePath="/remote/a.png" />));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ImageViewer filePath="/remote/a.png" isActiveTab={false} />));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ImageViewer filePath="/remote/a.png" isActiveTab />));
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('drops a stale read after switching to an immutable dispatch result', async () => {
  let complete!: (value: string) => void;
  mocks.read.mockImplementation(() => new Promise<string>(resolve => { complete = resolve; }));
  await act(async () => root.render(<ImageViewer filePath="/remote/a.png" />));
  await act(async () => root.render(<ImageViewer filePath="dispatch-file://job/b.png" imageSource={{ dataUrl: 'data:image/png;base64,Ag==', size: 1 }} />));
  await act(async () => complete('AQ=='));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,Ag==');
});

it('swaps the wrapper footprint on quarter turns while the img keeps its aspect-true box', async () => {
  await act(async () => root.render(<ImageViewer filePath="dispatch-file://job/a.png" imageSource={{ dataUrl: 'data:image/png;base64,AP8B', size: 3 }} />));
  const img = container.querySelector('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'naturalHeight', { value: 400 });
  await act(async () => { img.dispatchEvent(new Event('load')); });
  const wrapper = container.querySelector('[data-bitfun-part="imageWrapper"]') as HTMLElement;
  expect(wrapper.style.width).toBe('840px');
  expect(wrapper.style.height).toBe('440px');
  expect(img.style.width).toBe('800px');
  expect(img.style.height).toBe('400px');
  expect(img.style.transform).toBe('rotate(0deg)');
  const rotate = container.querySelector('button[aria-label="editor.imageViewer.rotate90"]') as HTMLButtonElement;
  await act(async () => { rotate.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(wrapper.style.width).toBe('440px');
  expect(wrapper.style.height).toBe('840px');
  expect(img.style.width).toBe('800px');
  expect(img.style.height).toBe('400px');
  expect(img.style.transform).toBe('rotate(90deg)');
});
