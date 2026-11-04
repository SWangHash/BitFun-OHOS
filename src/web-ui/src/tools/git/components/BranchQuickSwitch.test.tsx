/** @vitest-environment jsdom */

import React, { forwardRef, useRef, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchQuickSwitch } from './BranchQuickSwitch';

const mocks = vi.hoisted(() => ({
  addFiles: vi.fn(),
  checkoutBranch: vi.fn(),
  commit: vi.fn(),
  emit: vi.fn(),
  getBranches: vi.fn(),
  getDiff: vi.fn(),
  getState: vi.fn(),
  notificationError: vi.fn(),
  notificationSuccess: vi.fn(),
  refresh: vi.fn(async () => undefined),
}));

vi.mock('@bitfun/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@bitfun/ui')>(),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  ScrollArea: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>,
  ),
}));

vi.mock('@/infrastructure/appearance/runtime/AppearanceOverlayHost', () => ({
  getAppearanceOverlayHost: () => document.body,
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'quickSwitch.menuLabel': 'Switch branch',
        'quickSwitch.searchLabel': 'Search branches',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/shared/notification-system/services/NotificationService', () => ({
  notificationService: {
    error: mocks.notificationError,
    success: mocks.notificationSuccess,
  },
}));

vi.mock('@/shared/utils/useAnchoredPopoverPosition', () => ({
  useAnchoredPopoverPosition: () => ({ top: 10, left: 12, placement: 'top' }),
}));

vi.mock('@/tools/git/services', () => ({
  gitEventService: { emit: mocks.emit },
  gitService: {
    addFiles: mocks.addFiles,
    checkoutBranch: mocks.checkoutBranch,
    commit: mocks.commit,
    getBranches: mocks.getBranches,
    getDiff: mocks.getDiff,
  },
}));

vi.mock('@/tools/git/state/GitStateManager', () => ({
  gitStateManager: {
    getState: mocks.getState,
    refresh: mocks.refresh,
  },
}));

const branches = [
  { name: 'main', current: true, remote: false, ahead: 0, behind: 0 },
  { name: 'feature', current: false, remote: false, ahead: 0, behind: 0 },
];

function Harness({ onSwitchSuccess }: { onSwitchSuccess: (branch: string) => void }) {
  const [open, setOpen] = useState(true);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">branch</button>
      <BranchQuickSwitch
        isOpen={open}
        onClose={() => setOpen(false)}
        repositoryPath={{ workspaceId: 'workspace-1' }}
        currentBranch="main"
        anchorRef={anchorRef}
        onSwitchSuccess={onSwitchSuccess}
      />
    </>
  );
}

describe('BranchQuickSwitch', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ branches });
    mocks.getBranches.mockResolvedValue(branches);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('[data-testid="branch-quick-switch"]')
      .forEach(node => node.remove());
  });

  it('keeps the design-system search field as one labeled visual surface', async () => {
    await act(async () => {
      root.render(<Harness onSwitchSuccess={vi.fn()} />);
    });

    const searchField = document.querySelector('[data-bitfun-component="search-field"]');
    const fieldSurface = searchField?.querySelector('[data-bitfun-component="input"]');
    const input = searchField?.querySelector<HTMLInputElement>('input[type="search"]');

    expect(searchField).not.toBeNull();
    expect(fieldSurface).not.toBeNull();
    expect(input?.getAttribute('aria-label')).toBe('Search branches');
    expect(input?.classList.contains('branch-quick-switch__input')).toBe(false);
  });

  it('keeps the selected current branch readable instead of applying disabled colors', async () => {
    await act(async () => {
      root.render(<Harness onSwitchSuccess={vi.fn()} />);
    });
    await vi.waitFor(() => expect(
      document.querySelector('[data-testid="branch-quick-switch-option-main"]'),
    ).not.toBeNull());

    const currentBranch = document.querySelector<HTMLButtonElement>(
      '[data-testid="branch-quick-switch-option-main"]',
    );
    expect(currentBranch?.getAttribute('aria-selected')).toBe('true');
    expect(currentBranch?.dataset.bitfunState).toBe('current');
    expect(currentBranch?.disabled).toBe(false);
  });

  it.each([
    { selected: 'feature', checkedOut: 'feature', data: undefined },
    { selected: 'origin/feature', checkedOut: 'feature', data: { branch: 'feature' } },
  ])('publishes the checked-out branch after selecting $selected', async ({ selected, checkedOut, data }) => {
    const onSwitchSuccess = vi.fn();
    mocks.getState.mockReturnValue({
      branches: [branches[0], { ...branches[1], name: selected, remote: selected.startsWith('origin/') }],
    });
    mocks.checkoutBranch.mockResolvedValue({ success: true, data });

    await act(async () => {
      root.render(<Harness onSwitchSuccess={onSwitchSuccess} />);
    });
    await vi.waitFor(() => expect(
      document.querySelector(`[data-testid="branch-quick-switch-option-${selected}"]`),
    ).not.toBeNull());

    await act(async () => {
      document.querySelector<HTMLButtonElement>(
        `[data-testid="branch-quick-switch-option-${selected}"]`,
      )?.click();
    });

    expect(mocks.checkoutBranch).toHaveBeenCalledWith({ workspaceId: 'workspace-1' }, selected);
    expect(mocks.emit).toHaveBeenCalledWith('branch:changed', expect.objectContaining({
      repositoryPath: { workspaceId: 'workspace-1' },
      branch: expect.objectContaining({ name: checkedOut, current: true }),
    }));
    expect(onSwitchSuccess).toHaveBeenCalledWith(checkedOut);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    expect(document.querySelector('[data-testid="branch-quick-switch"]')).toBeNull();
  });

  it.each([
    {
      reason: 'diverged history',
      error: 'git_branch_diverged: Local and remote branch have diverged',
      expectedMessage: 'quickSwitch.errors.diverged',
    },
    {
      reason: 'blocking local changes',
      error: 'error: Your local changes to the following files would be overwritten by checkout:',
      expectedMessage: 'quickSwitch.errors.localChanges',
    },
  ])('keeps the current branch and only notifies on $reason', async ({ error, expectedMessage }) => {
    const onSwitchSuccess = vi.fn();
    mocks.checkoutBranch.mockResolvedValue({ success: false, error });

    await act(async () => {
      root.render(<Harness onSwitchSuccess={onSwitchSuccess} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(
        '[data-testid="branch-quick-switch-option-feature"]',
      )?.click();
    });

    expect(mocks.checkoutBranch).toHaveBeenCalledTimes(1);
    expect(mocks.notificationError).toHaveBeenCalledExactlyOnceWith(
      expectedMessage,
      expect.objectContaining({ title: 'quickSwitch.errors.title' }),
    );
    expect(document.querySelector('[data-testid="branch-quick-switch-option-main"]')
      ?.getAttribute('aria-selected')).toBe('true');
    // The picker stays open; checkout failure adds no confirmation dialog.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.addFiles).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.getDiff).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.notificationSuccess).not.toHaveBeenCalled();
    expect(onSwitchSuccess).not.toHaveBeenCalled();
  });
});
