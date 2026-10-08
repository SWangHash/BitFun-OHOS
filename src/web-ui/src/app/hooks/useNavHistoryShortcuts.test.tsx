/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavHistoryShortcuts } from './useNavHistoryShortcuts';
import { useNavSceneStore } from '../stores/navSceneStore';
import { shortcutManager } from '@/infrastructure/services/ShortcutManager';

function ShortcutHost() {
  useNavHistoryShortcuts();
  return null;
}

function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
}

function pressAltArrow(
  key: 'ArrowLeft' | 'ArrowRight',
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function mountEditorSurface(): HTMLDivElement {
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  editor.appendChild(document.createElement('textarea'));
  document.body.appendChild(editor);
  return editor;
}

describe('useNavHistoryShortcuts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    shortcutManager.clear();
    shortcutManager.setEnabled(true);
    useNavSceneStore.setState({ showSceneNav: false, navSceneId: null, resourceWorkspace: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    shortcutManager.clear();
    vi.restoreAllMocks();
  });

  it('goes back with Alt+ArrowLeft while a scene nav is open', () => {
    useNavSceneStore.setState({ showSceneNav: true, navSceneId: 'file-viewer' });
    act(() => root.render(<ShortcutHost />));

    act(() => { pressAltArrow('ArrowLeft'); });

    expect(useNavSceneStore.getState().showSceneNav).toBe(false);
  });

  it('goes forward with Alt+ArrowRight after going back', () => {
    useNavSceneStore.setState({ showSceneNav: false, navSceneId: 'file-viewer' });
    act(() => root.render(<ShortcutHost />));

    act(() => { pressAltArrow('ArrowRight'); });

    expect(useNavSceneStore.getState().showSceneNav).toBe(true);
  });

  it('stays inert when there is no navigation to move to', () => {
    act(() => root.render(<ShortcutHost />));

    const event = pressAltArrow('ArrowLeft');

    expect(event.defaultPrevented).toBe(false);
    expect(useNavSceneStore.getState().showSceneNav).toBe(false);
  });

  it('yields Alt+Arrow to a focused macOS editor', () => {
    setPlatform('MacIntel');
    useNavSceneStore.setState({ showSceneNav: true, navSceneId: 'file-viewer' });
    act(() => root.render(<ShortcutHost />));
    const editor = mountEditorSurface();

    let event!: KeyboardEvent;
    act(() => { event = pressAltArrow('ArrowLeft', editor.querySelector('textarea')!); });

    expect(event.defaultPrevented).toBe(false);
    expect(useNavSceneStore.getState().showSceneNav).toBe(true);

    editor.remove();
  });

  it('keeps Alt+Arrow for navigation inside the editor off macOS', () => {
    setPlatform('Win32');
    useNavSceneStore.setState({ showSceneNav: true, navSceneId: 'file-viewer' });
    act(() => root.render(<ShortcutHost />));
    const editor = mountEditorSurface();

    act(() => { pressAltArrow('ArrowLeft', editor.querySelector('textarea')!); });

    expect(useNavSceneStore.getState().showSceneNav).toBe(false);

    editor.remove();
  });
});
