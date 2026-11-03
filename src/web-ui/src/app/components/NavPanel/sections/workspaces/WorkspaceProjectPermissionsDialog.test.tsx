// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from '@/shared/types';
import WorkspaceProjectPermissionsDialog from './WorkspaceProjectPermissionsDialog';

const mocks = vi.hoisted(() => ({
  listGrants: vi.fn(),
  getRules: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  // The dialog memoizes its loaders from `t`; keep one stable i18n surface so
  // the mocked hook does not re-arm the load effect on every render.
  i18n: {
    t: (key: string) => key,
    formatDate: () => '2026-01-01 10:00',
  },
}));

vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => mocks.i18n }));
vi.mock('@/infrastructure/api/service-api/PermissionAPI', () => ({
  permissionAPI: {
    listProjectGrants: mocks.listGrants,
    getProjectRules: mocks.getRules,
    removeProjectGrant: vi.fn(),
    clearProjectGrants: vi.fn(),
    saveProjectRules: vi.fn(),
  },
}));
vi.mock('@/shared/notification-system', () => ({
  notificationService: { success: mocks.success, error: mocks.error },
}));
vi.mock('@/infrastructure/confirm-dialog', () => ({ confirmDanger: vi.fn() }));
vi.mock('@bitfun/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bitfun/ui')>();
  const Wrapper = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  return {
    ...actual,
    Dialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) => (open ? <div role="dialog">{children}</div> : null),
    DialogBody: Wrapper,
    DialogHeader: Wrapper,
    DialogHeading: Wrapper,
    DialogTitle: Wrapper,
    DialogClose: () => null,
    Icon: () => null,
    IconButton: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => <button {...props} />,
    Select: () => null,
    Input: () => null,
    Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

describe('project permissions dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  const workspace = { id: 'workspace-1', name: 'Project', rootPath: '/project' } as unknown as WorkspaceInfo;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.listGrants.mockReset();
    mocks.getRules.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderDialog(rules: Array<{ action: string; resource: string; effect: string }> = []) {
    mocks.listGrants.mockResolvedValue([
      { projectId: 'workspace-1', action: 'bash', resource: 'pnpm --dir src/web-ui run test', createdAtMs: 1 },
    ]);
    mocks.getRules.mockResolvedValue({ rules, revision: 'revision-1' });
    await act(async () => root.render(
      <WorkspaceProjectPermissionsDialog workspace={workspace} isOpen onClose={() => undefined} />,
    ));
  }

  it('keeps one tooltip source per memory grant row', async () => {
    await renderDialog();

    const rows = container.querySelectorAll('[data-bitfun-part="grant"]');
    expect(rows).toHaveLength(1);
    const cells = rows[0].querySelectorAll('code');
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe('bash');
    expect(cells[1].textContent).toBe('pnpm --dir src/web-ui run test');

    // The clipped slot owns the full-text tooltip. A native `title` on the same
    // wrapper opens a second, non-tracking bubble on the same hover target.
    for (const cell of Array.from(cells)) {
      expect(cell.hasAttribute('title')).toBe(false);
      expect(cell.querySelector('[data-marquee-trigger]')).not.toBeNull();
    }

    const removeGrant = rows[0].querySelector('button[aria-label="projectPermissions.removeGrant"]');
    expect(removeGrant).not.toBeNull();
    expect(removeGrant!.hasAttribute('title')).toBe(false);
  });

  it('scrolls the rules pane to a newly appended rule', async () => {
    await renderDialog([{ action: 'bash', resource: 'git status', effect: 'ask' }]);

    const list = container.querySelector('[data-bitfun-part="rules"]') as HTMLElement;
    expect(list).not.toBeNull();
    // jsdom has no layout; stand in for a pane that is taller than its viewport.
    let scrollTop = 0;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 480 });
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });

    const addRule = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'projectPermissions.addRule');
    expect(addRule).toBeDefined();
    await act(async () => {
      addRule!.click();
    });

    expect(container.querySelectorAll('[data-bitfun-part="rule"]')).toHaveLength(2);
    expect(scrollTop).toBe(480);
  });

  it('surfaces an unparseable rules file and keeps saving available to repair it', async () => {
    mocks.listGrants.mockResolvedValue([]);
    mocks.getRules.mockResolvedValue({
      rules: [],
      revision: 'revision-broken',
      loadError: {
        path: '/project/.bitfun/config/tool_permissions.json',
        message:
          "Failed to parse project permission config '/project/.bitfun/config/tool_permissions.json': expected `,` or `}` at line 9 column 3",
      },
    });
    await act(async () => root.render(
      <WorkspaceProjectPermissionsDialog workspace={workspace} isOpen onClose={() => undefined} />,
    ));

    const issue = container.querySelector('[data-bitfun-part="empty"][role="alert"]');
    expect(issue).not.toBeNull();
    expect(issue!.textContent).toContain('projectPermissions.rulesUnreadableTitle');
    expect(issue!.textContent).toContain('/project/.bitfun/config/tool_permissions.json');
    expect(issue!.textContent).toContain('line 9 column 3');

    // The draft is unchanged, but the repair action must still be reachable.
    const save = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'projectPermissions.saveRules');
    expect(save).toBeDefined();
    expect(save!.hasAttribute('disabled')).toBe(false);
  });
});
