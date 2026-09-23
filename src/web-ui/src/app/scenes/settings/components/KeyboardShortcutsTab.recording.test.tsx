// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shortcutManager } from '@/infrastructure/services/ShortcutManager';
import KeyboardShortcutsTab from './KeyboardShortcutsTab';

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

vi.mock('@bitfun/ui', () => ({
  // ShortcutManager consults this before letting Escape through; no overlays here.
  hasOverlayLayers: () => false,
  OverflowText: ({ children }: AnyProps) => <span>{children}</span>,
  Tooltip: ({ children }: AnyProps) => <>{children}</>,
  Icon: () => <i />,
  SearchField: ({ value }: AnyProps) => <input readOnly value={String(value ?? '')} />,
  Button: ({ children, onClick, ...rest }: AnyProps & { onClick?: () => void }) => (
    <button type="button" onClick={onClick} aria-pressed={rest['aria-pressed'] as boolean}>
      {children}
    </button>
  ),
  IconButton: ({ onClick }: AnyProps & { onClick?: () => void }) => (
    <button type="button" onClick={onClick} />
  ),
}));

vi.mock('@/infrastructure/config/components/common', () => ({
  ConfigFieldStatus: () => <div />,
  ConfigPageLayout: ({ children }: AnyProps) => <div>{children}</div>,
  ConfigPageHeader: () => <header />,
  ConfigPageContent: ({ children }: AnyProps) => <div>{children}</div>,
  ConfigPageSection: ({ children }: AnyProps) => <section>{children}</section>,
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    getConfig: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/infrastructure/config/settingsDraftRegistry', () => ({
  useSettingsDraft: () => undefined,
}));

vi.mock('@/infrastructure/confirm-dialog', () => ({
  confirmWarning: vi.fn().mockResolvedValue(false),
}));

function pressModB(): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'b',
    code: 'KeyB',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

/** The record button of the row for `panel.toggleLeft`. */
function recordButton(): HTMLButtonElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-bitfun-part="item"]'));
  // With `t` echoing keys, the row label falls back to the readable shortcut id.
  const row = rows.find((candidate) => candidate.textContent?.includes('panel toggleLeft'));
  if (!row) throw new Error('panel.toggleLeft row was not rendered');
  const button = row.querySelector('button');
  if (!button) throw new Error('panel.toggleLeft row has no record control');
  return button as HTMLButtonElement;
}

describe('KeyboardShortcutsTab recording', () => {
  let root: Root;
  let container: HTMLDivElement;
  let toggleLeftPanel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    shortcutManager.clear();
    shortcutManager.loadUserOverrides({});
    shortcutManager.setEnabled(true);
    toggleLeftPanel = vi.fn();
    shortcutManager.register(
      'panel.toggleLeft',
      { key: 'B', ctrl: true, scope: 'app' },
      toggleLeftPanel,
      { priority: 5, description: 'keyboard.shortcuts.panel.toggleLeft' },
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    shortcutManager.clear();
    shortcutManager.setEnabled(true);
    vi.clearAllMocks();
  });

  // ShortcutManager's window/capture listener is installed at construction, so
  // it runs before the recorder's listener whatever order the effects mount in:
  // the sidebar had already collapsed by the time the recorder called
  // preventDefault. Recording has to suspend dispatch, not try to outrun it.
  it('does not run the global shortcut while recording it', async () => {
    await act(async () => root.render(<KeyboardShortcutsTab />));

    await act(async () => { recordButton().click(); });
    expect(shortcutManager.isShortcutEnabled()).toBe(false);

    await act(async () => { pressModB(); });

    expect(toggleLeftPanel).not.toHaveBeenCalled();
    // Recording ended, so the same key works again immediately.
    expect(shortcutManager.isShortcutEnabled()).toBe(true);
    await act(async () => { pressModB(); });
    expect(toggleLeftPanel).toHaveBeenCalledTimes(1);
  });

  it('restores dispatch when recording is cancelled with Escape', async () => {
    await act(async () => root.render(<KeyboardShortcutsTab />));
    await act(async () => { recordButton().click(); });

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
    });

    expect(shortcutManager.isShortcutEnabled()).toBe(true);
    await act(async () => { pressModB(); });
    expect(toggleLeftPanel).toHaveBeenCalledTimes(1);
  });

  it('restores dispatch when the settings page goes away mid-recording', async () => {
    await act(async () => root.render(<KeyboardShortcutsTab />));
    await act(async () => { recordButton().click(); });
    expect(shortcutManager.isShortcutEnabled()).toBe(false);

    // Unmounting the tab runs the same cleanup the user's navigation would.
    await act(async () => root.render(<></>));

    expect(shortcutManager.isShortcutEnabled()).toBe(true);
    await act(async () => { pressModB(); });
    expect(toggleLeftPanel).toHaveBeenCalledTimes(1);
  });

  // Recording must hand back the state it found. Restoring `true` here would
  // switch shortcuts on for whoever had deliberately switched them off.
  it('keeps shortcuts disabled when they were already disabled', async () => {
    shortcutManager.setEnabled(false);
    await act(async () => root.render(<KeyboardShortcutsTab />));

    await act(async () => { recordButton().click(); });
    await act(async () => { pressModB(); });

    expect(shortcutManager.isShortcutEnabled()).toBe(false);
    expect(toggleLeftPanel).not.toHaveBeenCalled();
  });
});
