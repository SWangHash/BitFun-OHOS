/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountPanel } from './AccountPanel';
const mocks = vi.hoisted(() => ({
  identity: { resolved: true, status: 'signed-in', me: { user: { githubId: 42, login: 'alice' } } } as { resolved: boolean; status: string; me: { user: { githubId: number; login: string } } | null },
  reopenSignIn: vi.fn(),
  getDeviceInfo: vi.fn(), accountStatus: vi.fn(), accountLogin: vi.fn(),
  accountConnectDevices: vi.fn(), accountListDevices: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('@/infrastructure/account-identity', () => ({ useAccountIdentity: () => mocks.identity, accountIdentityService: { reopenSignIn: mocks.reopenSignIn } }));
vi.mock('@/infrastructure/api/service-api/RemoteConnectAPI', () => ({ remoteConnectAPI: mocks }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { listen: () => () => {} } }));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: mocks.t, formatRelativeTime: () => '' }) }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({ usePeerDeviceMode: () => ({ peerMode: { active: false } }) }));
vi.mock('@/infrastructure/confirm-dialog', () => ({ confirmDanger: vi.fn() }));
vi.mock('@/shared/notification-system', () => ({ useNotification: () => ({ success: vi.fn() }) }));
vi.mock('@bitfun/ui', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Button = ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>;
  return { Avatar: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />, OverflowText: Box, Alert: Box, Button, Icon: () => null, IconButton: () => null, ScrollArea: Box, StatusPill: Box };
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 42, login: 'alice' } } };
  mocks.getDeviceInfo.mockResolvedValueOnce({ device_id: 'local', device_name: 'My computer' })
    .mockImplementation(() => new Promise(() => {}));
  // A second initialization is deliberately held so the regression fails
  // deterministically instead of creating an unbounded render loop.
  mocks.accountStatus.mockResolvedValueOnce({ logged_in: true, user_id: '42' })
    .mockImplementation(() => new Promise(() => {}));
  mocks.accountConnectDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer' }]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', online: true }]);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
it('keeps initialization alive when the local device ID arrives', async () => {
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
});

it('loads the device snapshot and retains it across a normal rerender', async () => {
  mocks.getDeviceInfo.mockResolvedValue({ device_id: 'local', device_name: 'My computer' });
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
});
it('ignores a late device connection after shared identity signs out', async () => {
  let resolve!: (devices: Array<{ device_id: string; device_name: string }>) => void;
  mocks.accountConnectDevices.mockReturnValue(new Promise(res => { resolve = res; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  mocks.identity = { resolved: true, status: 'signed-out', me: null };
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await act(async () => { resolve([{ device_id: 'old', device_name: 'Old account device' }]); });
  expect(container.textContent).not.toContain('Old account device');
  expect(container.textContent).toContain('accountLogin.login');
  expect(mocks.accountListDevices).not.toHaveBeenCalled();
});

it('fences a late snapshot when switching accounts', async () => {
  let resolve!: (devices: Array<{ device_id: string; device_name: string; online: boolean }>) => void;
  mocks.accountListDevices.mockReturnValueOnce(new Promise(res => { resolve = res; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 7, login: 'bob' } } };
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '7' });
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'new', device_name: 'New account device', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await act(async () => { resolve([{ device_id: 'old', device_name: 'Old account device', online: true }]); });
  expect(container.textContent).toContain('New account device');
  expect(container.textContent).not.toContain('Old account device');
});
it('shows a connection failure while retaining the signed-in account', async () => {
  mocks.accountStatus.mockReset().mockRejectedValue(new Error('network unavailable'));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).toContain('alice');
  expect(container.textContent).toContain('accountLogin.retryConnect');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
});

async function retryConnection() {
  const button = Array.from(container.querySelectorAll('button')).find(node => node.textContent === 'accountLogin.retryConnect');
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
it('retries a failed connection without asking for GitHub authorization again', async () => {
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '42' });
  mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await retryConnection();
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
  expect(mocks.accountLogin).not.toHaveBeenCalled();
});
it('allows the new account to retry while an old recovery is still pending', async () => {
  let finishOld!: (devices: Array<{ device_id: string; device_name: string }>) => void;
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '42' });
  mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'))
    .mockReturnValueOnce(new Promise(res => { finishOld = res; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await retryConnection();
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 7, login: 'bob' } } };
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '7' });
  mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'))
    .mockResolvedValueOnce([{ device_id: 'new', device_name: 'New account device' }]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'new', device_name: 'New account device', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  await retryConnection();
  expect(container.textContent).toContain('New account device');
  await act(async () => { finishOld([{ device_id: 'old', device_name: 'Old account device' }]); });
  expect(container.textContent).not.toContain('Old account device');
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(4);
});

it('adopts the account-bound local device ID without reconnecting', async () => {
  let finishInfo!: (info: { device_id: string }) => void;
  mocks.getDeviceInfo.mockReset().mockResolvedValueOnce({ device_id: 'before-auth' })
    .mockReturnValueOnce(new Promise(resolve => { finishInfo = resolve; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).not.toContain('accountLogin.thisDevice');
  await act(async () => { finishInfo({ device_id: 'local' }); });
  expect(container.textContent).toContain('accountLogin.thisDevice');
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
});

it('finishes loading an empty device list', async () => {
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.accountListDevices.mockResolvedValue([]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
});

it('does not restart polling when a recovery snapshot finishes after logout', async () => {
  vi.useFakeTimers();
  try {
    let finishSnapshot!: (devices: []) => void;
    mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '42' });
    mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'));
    mocks.accountListDevices.mockReturnValueOnce(new Promise(resolve => { finishSnapshot = resolve; }));
    await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
    await retryConnection();
    mocks.identity = { resolved: true, status: 'signed-out', me: null };
    await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
    await act(async () => { finishSnapshot([]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('accountLogin.login');
  } finally {
    vi.useRealTimers();
  }
});

it('ignores pre-auth device information that arrives after the adopted ID', async () => {
  let finishOldInfo!: (info: { device_id: string }) => void;
  mocks.getDeviceInfo.mockReset()
    .mockReturnValueOnce(new Promise(resolve => { finishOldInfo = resolve; }))
    .mockResolvedValueOnce({ device_id: 'local' });
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).toContain('accountLogin.thisDevice');
  await act(async () => { finishOldInfo({ device_id: 'before-auth' }); });
  expect(container.textContent).toContain('accountLogin.thisDevice');
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
});

it('lets a pending login reopen its external sign-in page', async () => {
  mocks.identity = { resolved: true, status: 'authorizing', me: null };
  mocks.accountStatus.mockResolvedValue({ logged_in: false });
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const reopen = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.reopen');
  expect(reopen).toBeDefined();
  expect(reopen!.disabled).toBe(false);
  await act(async () => { reopen!.click(); });
  expect(mocks.reopenSignIn).toHaveBeenCalledOnce();
});
