/**
 * @vitest-environment jsdom
 *
 * HarmonyOS WebViews can expose the `localStorage` property as null instead of
 * throwing on access. zustand's default JSON storage then crashes every
 * setState with "Cannot read properties of null (reading 'setItem')", which
 * surfaced as the "应用错误 / Cannot read properties of null (reading 'setItem')"
 * error boundary when opening a session (see contextStore replaceContexts).
 * These tests pin the memory-fallback behavior for every persist store that
 * used to reference localStorage directly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceSessionViewStore } from '@/app/components/NavPanel/workspaceSessionView';
import { useWorkspaceResourceState } from '@/app/scenes/workspace-resources/workspaceResourceState';
import { useI18nStore } from '@/infrastructure/i18n/store/i18nStore';
import { useContextStore } from './contextStore';

type StorageDescriptor = PropertyDescriptor | undefined;

let originalLocalStorage: StorageDescriptor;

function hideLocalStorageAsNull(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: null,
  });
}

beforeEach(() => {
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    delete (globalThis as { localStorage?: Storage | null }).localStorage;
  }
});

describe('persist stores survive a null localStorage WebView', () => {
  it('keeps context store state and persistence in memory', () => {
    hideLocalStorageAsNull();

    expect(() => {
      useContextStore.getState().replaceContexts([
        {
          id: 'ctx-1',
          type: 'url',
          timestamp: 1,
          url: 'https://example.com',
        },
      ]);
    }).not.toThrow();

    expect(useContextStore.getState().contexts).toHaveLength(1);
    useContextStore.getState().clearContexts();
    expect(useContextStore.getState().contexts).toHaveLength(0);
  });

  it('keeps workspace session view preferences in memory', () => {
    hideLocalStorageAsNull();

    expect(() => useWorkspaceSessionViewStore.getState().setGrouping('all')).not.toThrow();
    expect(useWorkspaceSessionViewStore.getState().grouping).toBe('all');

    useWorkspaceSessionViewStore.getState().setGrouping('grouped');
    expect(useWorkspaceSessionViewStore.getState().grouping).toBe('grouped');
  });

  it('keeps workspace resource layouts in memory', () => {
    hideLocalStorageAsNull();

    expect(() => useWorkspaceResourceState.getState().updateLayout('ws-1', { filesCollapsed: true })).not.toThrow();
    expect(useWorkspaceResourceState.getState().layouts['ws-1']?.filesCollapsed).toBe(true);
  });

  it('keeps i18n language preference in memory', () => {
    hideLocalStorageAsNull();

    expect(() => useI18nStore.getState().setCurrentLanguage('en-US')).not.toThrow();
    expect(useI18nStore.getState().currentLanguage).toBe('en-US');

    useI18nStore.getState().setCurrentLanguage('zh-CN');
    expect(useI18nStore.getState().currentLanguage).toBe('zh-CN');
  });
});
