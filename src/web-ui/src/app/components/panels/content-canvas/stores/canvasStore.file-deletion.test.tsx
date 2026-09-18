// @vitest-environment jsdom

// React 19 requires this flag for act() to run without warnings in tests.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAgentCanvasForPeerSwitch,
  useAgentCanvasStore,
} from './canvasStore';
import { globalEventBus } from '@/infrastructure/event-bus';
import { useFileDeletionSync } from '../hooks/useFileDeletionSync';

const addEditorTab = (
  filePath: string,
  overrides?: { title?: string; contentData?: Record<string, unknown> },
) => {
  const store = useAgentCanvasStore.getState();
  store.addTab(
    {
      type: 'code-editor',
      title: overrides?.title ?? filePath.split('/').pop() ?? filePath,
      data: overrides?.contentData ?? { filePath },
      metadata: { filePath },
    },
    'active',
  );
};

const tabs = () => useAgentCanvasStore.getState().primaryGroup.tabs;
const deletedFlags = () => tabs().map(t => t.fileDeletedFromDisk ?? false);
const flagFor = (title: string) =>
  tabs().find(t => t.title === title)?.fileDeletedFromDisk ?? false;

describe('markTabsFileDeletedByPath', () => {
  beforeEach(() => {
    clearAgentCanvasForPeerSwitch();
  });

  it('marks the tab whose file was deleted', () => {
    addEditorTab('C:/work/repo/src/a.ts');
    addEditorTab('C:/work/repo/src/b.ts');

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/src/a.ts');

    expect(flagFor('a.ts')).toBe(true);
    expect(flagFor('b.ts')).toBe(false);
  });

  it('marks tabs under a deleted directory', () => {
    addEditorTab('C:/work/repo/pkg/inner/x.ts');
    addEditorTab('C:/work/repo/pkg-sibling/y.ts');

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/pkg');

    expect(flagFor('x.ts')).toBe(true);
    expect(flagFor('y.ts')).toBe(false);
  });

  it('matches path spellings case-insensitively on Windows-style paths', () => {
    addEditorTab('C:\\Work\\Repo\\src\\a.ts');

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('c:/work/repo/src/A.TS');

    expect(deletedFlags()).toEqual([true]);
  });

  it('does not treat a same-prefix sibling directory as deleted', () => {
    addEditorTab('C:/work/repo/pkg-other/x.ts');

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/pkg');

    expect(deletedFlags()).toEqual([false]);
  });

  it('marks tabs across all canvas stores', async () => {
    const { useGitCanvasStore } = await import('./canvasStore');
    addEditorTab('C:/work/repo/src/agent.ts');
    useGitCanvasStore.getState().addTab(
      {
        type: 'code-editor',
        title: 'git.ts',
        data: { filePath: 'C:/work/repo/src/git.ts' },
        metadata: { filePath: 'C:/work/repo/src/git.ts' },
      },
      'active',
    );

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/src/agent.ts');
    useGitCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/src/git.ts');

    expect(deletedFlags()).toEqual([true]);
    expect(
      useGitCanvasStore.getState().primaryGroup.tabs.map(t => t.fileDeletedFromDisk ?? false),
    ).toEqual([true]);
  });

  it('ignores tabs without a file path', () => {
    useAgentCanvasStore.getState().addTab(
      { type: 'browser', title: 'Browser', data: { url: 'https://example.com' } },
      'active',
    );

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/a.ts');

    expect(deletedFlags()).toEqual([false]);
  });

  it('falls back to metadata.filePath when data.filePath is absent', () => {
    addEditorTab('C:/work/repo/src/meta.ts', {
      title: 'meta.ts',
      contentData: { content: '' },
    });

    useAgentCanvasStore.getState().markTabsFileDeletedByPath('C:/work/repo/src/meta.ts');

    expect(deletedFlags()).toEqual([true]);
  });
});

describe('useFileDeletionSync event wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearAgentCanvasForPeerSwitch();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('marks tabs when the global deletion event fires', () => {
    act(() => {
      root.render(React.createElement(() => {
        useFileDeletionSync();
        return null;
      }));
    });
    addEditorTab('C:/work/repo/src/event.ts');

    act(() => {
      globalEventBus.emit('editor:file-deleted', { filePath: 'C:/work/repo/src/event.ts' });
    });

    expect(deletedFlags()).toEqual([true]);
  });

  it('stops marking tabs after unmount', () => {
    const Hook = React.createElement(() => {
      useFileDeletionSync();
      return null;
    });
    act(() => {
      root.render(Hook);
    });
    addEditorTab('C:/work/repo/src/late.ts');
    act(() => root.unmount());

    act(() => {
      globalEventBus.emit('editor:file-deleted', { filePath: 'C:/work/repo/src/late.ts' });
    });

    expect(deletedFlags()).toEqual([false]);
  });
});
