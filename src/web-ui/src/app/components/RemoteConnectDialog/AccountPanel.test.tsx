/** @vitest-environment jsdom */
import React, { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountPanel } from './AccountPanel';
import { useUpdateInstallStore } from '@/infrastructure/update/updateInstallStore';
import { AccountIdentityService } from '@/infrastructure/account-identity/AccountIdentityService';
import { useDeviceOrderPreferences } from '@/app/navigation/deviceOrderPreferences';
import { useDeviceVisibilityPreferences } from '@/app/navigation/deviceVisibilityPreferences';
const mocks = vi.hoisted(() => ({
  identity: { resolved: true, status: 'signed-in', me: { user: { githubId: 42, login: 'alice' } } } as { resolved: boolean; status: string; me: { user: { githubId: number; login: string } } | null },
  useAccountIdentity: vi.fn(), signIn: vi.fn(), logout: vi.fn(), reopenSignIn: vi.fn(),
  confirmDanger: vi.fn(), accountDeleteDevice: vi.fn(),
  getDeviceInfo: vi.fn(), accountStatus: vi.fn(), accountLogin: vi.fn(),
  accountRelayCapabilities: vi.fn(), accountUpdateDevice: vi.fn(),
  accountConnectDevices: vi.fn(), accountListDevices: vi.fn(),
  checkForUpdates: vi.fn(), installUpdate: vi.fn(),
  peerMode: { active: false } as { active: boolean },
  switchToDevice: vi.fn(), switchToLocal: vi.fn(),
  t: (key: string) => key,
}));
const presenceListeners = vi.hoisted(() => [] as Array<(payload: { devices: Array<Record<string, unknown>> }) => void>);
vi.mock('@/infrastructure/account-identity', () => ({
  useAccountIdentity: () => mocks.useAccountIdentity(),
  accountIdentityService: { signIn: mocks.signIn, logout: mocks.logout, reopenSignIn: mocks.reopenSignIn },
}));
vi.mock('@/infrastructure/api/service-api/RemoteConnectAPI', async importOriginal => ({ ...await importOriginal<typeof import('@/infrastructure/api/service-api/RemoteConnectAPI')>(), remoteConnectAPI: mocks }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: {
    listen: (_event: string, handler: (payload: { devices: Array<Record<string, unknown>> }) => void) => {
      presenceListeners.push(handler);
      return () => {};
    },
  },
}));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: mocks.t, formatRelativeTime: () => '' }) }));
vi.mock('@/infrastructure/i18n/hooks/useI18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({
  usePeerDeviceMode: () => ({
    peerMode: mocks.peerMode,
    switchToDevice: mocks.switchToDevice,
    switchToLocal: mocks.switchToLocal,
  }),
}));
vi.mock('@/infrastructure/api/service-api/SystemAPI', () => ({
  systemAPI: { checkForUpdates: mocks.checkForUpdates, installUpdate: mocks.installUpdate },
}));
vi.mock('@/infrastructure/confirm-dialog', () => ({ confirmDanger: mocks.confirmDanger }));
vi.mock('@/shared/notification-system', () => ({ useNotification: () => ({ success: vi.fn() }) }));
vi.mock('@bitfun/ui', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Button = ({ children, onClick, disabled, loading }: { children?: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean; loading?: boolean }) => <button onClick={onClick} disabled={disabled || loading}>{children}</button>;
  const IconButton = ({ 'aria-label': ariaLabel, onClick, disabled }: { 'aria-label'?: string; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean }) => <button aria-label={ariaLabel} onClick={onClick} disabled={disabled} />;
  const Input = ({ value, onChange, onKeyDown, placeholder, disabled, 'aria-label': ariaLabel }: { value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>; placeholder?: string; disabled?: boolean; 'aria-label'?: string }) => (
    <input aria-label={ariaLabel} disabled={disabled} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} value={value} />
  );
  return { Avatar: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />, OverflowText: Box, Alert: ({ message }: { message: string }) => <div>{message}</div>, Button, Icon: () => null, IconButton, Input, ScrollArea: Box, StatusPill: Box };
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  useDeviceVisibilityPreferences.setState({ hidden: {} });
  useDeviceOrderPreferences.setState({ order: [] });
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 42, login: 'alice' } } };
  mocks.useAccountIdentity.mockImplementation(() => mocks.identity);
  mocks.peerMode = { active: false };
  mocks.getDeviceInfo.mockResolvedValueOnce({ device_id: 'local', device_name: 'My computer' })
    .mockImplementation(() => new Promise(() => {}));
  // A second initialization is deliberately held so the regression fails
  // deterministically instead of creating an unbounded render loop.
  mocks.accountStatus.mockResolvedValueOnce({ logged_in: true, user_id: '42' })
    .mockImplementation(() => new Promise(() => {}));
  mocks.accountRelayCapabilities.mockResolvedValue([]);
  mocks.accountConnectDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer' }]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', online: true }]);
  // Discovery is initialized up front so an explicit check never starts a version read.
  useUpdateInstallStore.setState({
    initialized: true, currentVersion: '1.0.0', availableUpdate: null, checkStatus: 'idle',
    checkError: null, detailsOpen: false, notice: null, error: null, version: null,
  });
  presenceListeners.length = 0;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps initialization alive when the local device ID arrives', async () => {
  await act(async () => { root.render(<AccountPanel />); });
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
});

it('shares sidebar visibility with the preview card, including offline devices, without switching hosts', async () => {
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer-a', device_name: 'Offline host', online: false },
  ]);
  // This is the same preference written by the preview card's eye button.
  useDeviceVisibilityPreferences.getState().setVisible('peer-a', false);
  await act(async () => { root.render(<AccountPanel />); });
  const row = Array.from(container.querySelectorAll('.account-panel__device-card'))
    .find(element => element.textContent?.includes('Offline host'))!;
  const toggle = row.querySelector<HTMLButtonElement>('[aria-label="nav.devices.showInSidebar"]')!;
  expect(toggle).not.toBeNull();
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  expect(useDeviceVisibilityPreferences.getState().hidden['peer-a']).toBe(false);
  expect(row.querySelector('[aria-label="nav.devices.hideInSidebar"]')).not.toBeNull();
  await act(async () => useDeviceVisibilityPreferences.getState().setVisible('peer-a', false));
  expect(row.querySelector('[aria-label="nav.devices.showInSidebar"]')).not.toBeNull();
  expect(mocks.switchToDevice).not.toHaveBeenCalled();
  expect(mocks.switchToLocal).not.toHaveBeenCalled();
});

it('waits for local identity before saving a visibility choice under the canonical local key', async () => {
  let resolveIdentity!: (device: { device_id: string; device_name: string }) => void;
  mocks.getDeviceInfo.mockReset().mockReturnValue(new Promise(resolve => { resolveIdentity = resolve; }));
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'actual-local-id', device_name: 'My computer', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="nav.devices.hideInSidebar"]')!;
  expect(toggle.disabled).toBe(true);
  await act(async () => resolveIdentity({ device_id: 'actual-local-id', device_name: 'My computer' }));
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  expect(useDeviceVisibilityPreferences.getState().hidden).toEqual({ local: true });
});

it('loads the device snapshot and retains it across a normal rerender', async () => {
  mocks.getDeviceInfo.mockResolvedValue({ device_id: 'local', device_name: 'My computer' });
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
  await act(async () => { root.render(<AccountPanel />); });
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
});
it('ignores a late device connection after shared identity signs out', async () => {
  let resolve!: (devices: Array<{ device_id: string; device_name: string }>) => void;
  mocks.accountConnectDevices.mockReturnValue(new Promise(res => { resolve = res; }));
  await act(async () => { root.render(<AccountPanel />); });
  mocks.identity = { resolved: true, status: 'signed-out', me: null };
  await act(async () => { root.render(<AccountPanel />); });
  await act(async () => { resolve([{ device_id: 'old', device_name: 'Old account device' }]); });
  expect(container.textContent).not.toContain('Old account device');
  expect(container.textContent).toContain('accountLogin.login');
  expect(mocks.accountListDevices).not.toHaveBeenCalled();
});

it('fences a late snapshot when switching accounts', async () => {
  let resolve!: (devices: Array<{ device_id: string; device_name: string; online: boolean }>) => void;
  mocks.accountListDevices.mockReturnValueOnce(new Promise(res => { resolve = res; }));
  await act(async () => { root.render(<AccountPanel />); });
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 7, login: 'bob' } } };
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '7' });
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'new', device_name: 'New account device', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
  await act(async () => { resolve([{ device_id: 'old', device_name: 'Old account device', online: true }]); });
  expect(container.textContent).toContain('New account device');
  expect(container.textContent).not.toContain('Old account device');
});
it('shows a connection failure while retaining the signed-in account', async () => {
  mocks.accountStatus.mockReset().mockRejectedValue(new Error('network unavailable'));
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('alice');
  expect(container.textContent).toContain('accountLogin.retryConnect');
  expect(container.textContent).not.toContain('accountLogin.loadingDevices');
});

it('explains a retired Relay version and offers an update instead of the raw error', async () => {
  vi.stubGlobal('__TAURI__', {});
  mocks.accountStatus.mockReset().mockRejectedValue(
    Object.assign(new Error('List devices failed: HTTP 410'), { status: 410 }),
  );
  mocks.checkForUpdates.mockResolvedValue({ updateAvailable: true, currentVersion: '1.0.0', latestVersion: '2.0.0', releaseNotes: null, releaseDate: null });
  await act(async () => { root.render(<AccountPanel />); });
  // The actionable sentence replaces the raw transport detail and HTTP status.
  expect(container.textContent).toContain('accountLogin.relayFailureVersionRetired');
  expect(container.textContent).not.toContain('List devices failed');
  expect(container.textContent).not.toContain('410');
  // The retired version can only be fixed by updating, never by retrying here.
  const updateButton = Array.from(container.querySelectorAll('button')).find(node => node.textContent === 'update.checkForUpdates');
  expect(updateButton).toBeDefined();
  await act(async () => { updateButton!.click(); });
  // Discovery and the dialog stay in the shared update store, which the shell renders.
  expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
  expect(useUpdateInstallStore.getState()).toMatchObject({ checkStatus: 'available', detailsOpen: true });
});

it('does not offer an update check in a runtime that cannot install updates', async () => {
  mocks.accountStatus.mockReset().mockRejectedValue(
    Object.assign(new Error('List devices failed: HTTP 410'), { status: 410 }),
  );
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('accountLogin.relayFailureVersionRetired');
  expect(container.textContent).not.toContain('update.checkForUpdates');
  // Without a banner action the section heading still offers a way forward.
  const retryButtons = Array.from(container.querySelectorAll('button'))
    .filter(node => node.textContent === 'accountLogin.retryConnect');
  expect(retryButtons).toHaveLength(1);
});

it('offers a retry when the Relay is temporarily unavailable', async () => {
  mocks.accountStatus.mockReset().mockRejectedValue(
    Object.assign(new Error('List devices failed: HTTP 502'), { status: 502 }),
  );
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('accountLogin.relayFailureUnavailable');
  expect(container.textContent).not.toContain('502');
  const retryButtons = Array.from(container.querySelectorAll('button'))
    .filter(node => node.textContent === 'accountLogin.retryConnect');
  expect(retryButtons).toHaveLength(1);
  expect(retryButtons[0]!.closest('[data-bitfun-part="error"]')).not.toBeNull();
});

async function retryConnection() {
  const button = Array.from(container.querySelectorAll('button')).find(node => node.textContent === 'accountLogin.retryConnect');
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
it('retries a failed connection without asking for GitHub authorization again', async () => {
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '42' });
  mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'));
  await act(async () => { root.render(<AccountPanel />); });
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
  await act(async () => { root.render(<AccountPanel />); });
  await retryConnection();
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 7, login: 'bob' } } };
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '7' });
  mocks.accountConnectDevices.mockRejectedValueOnce(new Error('socket failure'))
    .mockResolvedValueOnce([{ device_id: 'new', device_name: 'New account device' }]);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'new', device_name: 'New account device', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
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
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.querySelector('[aria-label="accountLogin.thisDevice"]')).toBeNull();
  await act(async () => { finishInfo({ device_id: 'local' }); });
  expect(container.querySelector('[aria-label="accountLogin.thisDevice"]')).not.toBeNull();
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
  expect(mocks.accountStatus).toHaveBeenCalledTimes(1);
});

it('finishes loading an empty device list', async () => {
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.accountListDevices.mockResolvedValue([]);
  await act(async () => { root.render(<AccountPanel />); });
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
    await act(async () => { root.render(<AccountPanel />); });
    await retryConnection();
    mocks.identity = { resolved: true, status: 'signed-out', me: null };
    await act(async () => { root.render(<AccountPanel />); });
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
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.querySelector('[aria-label="accountLogin.thisDevice"]')).not.toBeNull();
  await act(async () => { finishOldInfo({ device_id: 'before-auth' }); });
  expect(container.querySelector('[aria-label="accountLogin.thisDevice"]')).not.toBeNull();
  expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(1);
});

it('lets a pending login reopen its external sign-in page', async () => {
  mocks.identity = { resolved: true, status: 'authorizing', me: null };
  mocks.accountStatus.mockResolvedValue({ logged_in: false });
  await act(async () => { root.render(<AccountPanel />); });
  const reopen = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.reopen');
  expect(reopen).toBeDefined();
  expect(reopen!.disabled).toBe(false);
  await act(async () => { reopen!.click(); });
  expect(mocks.reopenSignIn).toHaveBeenCalledOnce();
});

it('signs out the shared identity when removing this device and completes a fresh login', async () => {
  const profile = { user: { githubId: 42, login: 'alice', avatarUrl: '' }, isAdmin: false };
  let finishLogout!: () => void;
  let authorize!: (status: 'authorized') => void;
  const identityApi = {
    me: vi.fn().mockResolvedValue(profile),
    logout: vi.fn(() => new Promise<void>(resolve => { finishLogout = resolve; })),
    authStart: vi.fn().mockResolvedValue({
      transactionId: 'new-login', authorizationUrl: 'https://example.com/sign-in',
      expiresAt: 100, pollIntervalSeconds: 1,
    }),
    authPoll: vi.fn(() => new Promise<'authorized'>(resolve => { authorize = resolve; })),
  };
  const service = new AccountIdentityService({
    api: identityApi,
    openExternal: vi.fn().mockResolvedValue(undefined),
    syncPort: { publish: () => undefined, subscribe: () => () => undefined },
    now: () => 0,
    sleep: () => Promise.resolve(),
    sourceId: 'account-panel',
  });
  mocks.useAccountIdentity.mockImplementation(() => useSyncExternalStore(
    listener => service.subscribe(listener),
    () => service.getSnapshot(),
  ));
  mocks.logout.mockImplementation(() => service.logout());
  mocks.signIn.mockImplementation(() => service.signIn());
  mocks.reopenSignIn.mockImplementation(() => service.reopenSignIn());
  mocks.confirmDanger.mockResolvedValue(true);
  mocks.accountDeleteDevice.mockResolvedValue(undefined);
  mocks.getDeviceInfo.mockReset().mockResolvedValue({ device_id: 'local' });
  mocks.accountStatus.mockReset().mockResolvedValue({ logged_in: true, user_id: '42' });

  try {
    await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.removeCurrentDevice: My computer"]');
    expect(remove).not.toBeNull();
    await act(async () => { remove!.click(); });
    expect(mocks.accountDeleteDevice).toHaveBeenCalledWith('local');
    expect(identityApi.logout).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-bitfun-view="login"]')).toBeNull();
    expect(remove!.disabled).toBe(true);
    await act(async () => { remove!.click(); });
    expect(mocks.accountDeleteDevice).toHaveBeenCalledOnce();

    identityApi.me.mockResolvedValue(null);
    mocks.accountStatus.mockResolvedValue({ logged_in: false });
    mocks.accountLogin.mockResolvedValue({ user_id: '42' });
    await act(async () => { finishLogout(); });
    expect(service.getSnapshot()).toMatchObject({ status: 'signed-out', me: null });
    const login = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.login');
    expect(login).toBeDefined();
    await act(async () => { login!.click(); });
    expect(service.getSnapshot().status).toBe('authorizing');
    const reopen = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.reopen');
    expect(reopen).toBeDefined();
    await act(async () => { reopen!.click(); reopen!.click(); });
    expect(identityApi.authStart).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledOnce();

    identityApi.me.mockResolvedValue(profile);
    await act(async () => { authorize('authorized'); });
    expect(service.getSnapshot()).toMatchObject({ status: 'signed-in', me: profile });
    expect(container.querySelector('[data-bitfun-view="devices"]')).not.toBeNull();
    expect(container.textContent).toContain('My computer');
    expect(mocks.accountLogin).toHaveBeenCalledOnce();
    expect(mocks.accountConnectDevices).toHaveBeenCalledTimes(2);
  } finally {
    service.dispose();
  }
});

it('retains the shared identity when removing another device', async () => {
  mocks.confirmDanger.mockResolvedValue(true);
  mocks.accountDeleteDevice.mockResolvedValue(undefined);
  mocks.accountListDevices.mockResolvedValueOnce([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer', device_name: 'Other computer', online: true },
  ]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.removeDevice: Other computer"]');
  expect(remove).not.toBeNull();
  await act(async () => { remove!.click(); });
  expect(mocks.accountDeleteDevice).toHaveBeenCalledWith('peer');
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(container.querySelector('[data-bitfun-view="devices"]')).not.toBeNull();
  expect(container.textContent).not.toContain('Other computer');
});

it.each(['device removal', 'shared logout'])('keeps logout available when %s fails', async failure => {
  mocks.confirmDanger.mockResolvedValue(true);
  const message = `${failure} failed`;
  if (failure === 'device removal') {
    mocks.accountDeleteDevice.mockRejectedValue(new Error(message));
  } else {
    mocks.accountDeleteDevice.mockResolvedValue(undefined);
    mocks.logout.mockRejectedValue(new Error(message));
  }
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.removeCurrentDevice: My computer"]');
  expect(remove).not.toBeNull();
  await act(async () => { remove!.click(); });
  expect(mocks.logout).toHaveBeenCalledTimes(failure === 'device removal' ? 0 : 1);
  expect(container.textContent).toContain(message);
  expect(container.querySelector('[data-bitfun-view="login"]')).toBeNull();
  const logout = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.logout');
  expect(logout).toBeDefined();
  expect(logout!.disabled).toBe(false);
});

it('keeps the current device and shared identity when removal is cancelled', async () => {
  mocks.confirmDanger.mockResolvedValue(false);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.removeCurrentDevice: My computer"]');
  expect(remove).not.toBeNull();
  await act(async () => { remove!.click(); });
  expect(mocks.accountDeleteDevice).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(container.textContent).toContain('alice');
  expect(remove!.disabled).toBe(false);
});

it('shows explicit old Relay capability state before any mutation', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue([]);
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('accountLogin.deviceAliasUnsupported');
  expect(mocks.accountUpdateDevice).not.toHaveBeenCalled();
});
it('accepts the negotiated alias capability and displays only alias plus metadata', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'technical', device_alias: 'Studio', device_model: 'Model', device_os: 'Linux', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
  expect(container.textContent).not.toContain('technical');
  expect(container.textContent).toContain('Studio');
  expect(container.textContent).toContain('Model');
});
it('marks each row with the system it reported, a server for a CLI host, and the neutral mark when it is unknown', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'win', device_name: 'lwb_winpc', device_os: 'Windows 11', device_kind: 'desktop', online: true },
    { device_id: 'mac', device_name: 'lwb_macbook', device_os: 'macOS 15.7.3', device_kind: 'desktop', online: true },
    { device_id: 'srv', device_name: 'lwb_server', device_os: 'Linux', device_kind: 'cli', online: true },
    { device_id: 'legacy', device_name: 'lwb_legacy', online: true },
  ]);
  await act(async () => { root.render(<AccountPanel />); });

  const rowFor = (name: string) => Array.from(
    container.querySelectorAll('[data-bitfun-part="deviceCard"]'),
  ).find(row => row.textContent?.includes(name));

  expect(rowFor('lwb_winpc')?.querySelector('[data-system]')?.getAttribute('data-system')).toBe('windows');
  expect(rowFor('lwb_macbook')?.querySelector('[data-system]')?.getAttribute('data-system')).toBe('macos');
  // A CLI host has no system silhouette to draw, whatever machine it runs on.
  expect(rowFor('lwb_server')?.querySelector('[data-system]')?.getAttribute('data-system')).toBe('server');
  // No system reported: this list keeps the neutral mark it always drew.
  expect(rowFor('lwb_legacy')?.querySelector('[data-system]')).toBeNull();
  expect(rowFor('lwb_legacy')?.querySelector('svg')).not.toBeNull();
});

it('keeps the unsupported notice hidden while the capability answer is pending', async () => {
  // An unanswered capability read used to render as an unsupported relay, which
  // flashed the notice on every panel entry while `/api/info` was in flight.
  mocks.accountRelayCapabilities.mockImplementation(() => new Promise(() => {}));
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
});
it('keeps the unsupported notice hidden when the capability read fails', async () => {
  // Relay reachability owns its own banner; a transport error is not evidence
  // that the relay lacks the capability.
  mocks.accountRelayCapabilities.mockRejectedValue(new Error('network down'));
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
});

it('keeps aliases readable without flashing unsupported while the capability answer is pending', async () => {
  mocks.accountRelayCapabilities.mockImplementation(() => new Promise(() => {}));
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).toContain('Studio');
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]')?.disabled).toBe(true);
  expect(mocks.accountUpdateDevice).not.toHaveBeenCalled();
});

it('keeps aliases readable when the capability read fails without declaring the Relay unsupported', async () => {
  mocks.accountRelayCapabilities.mockRejectedValue(new Error('network unavailable'));
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).toContain('Studio');
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]')?.disabled).toBe(true);
  expect(mocks.accountUpdateDevice).not.toHaveBeenCalled();
});

it('accepts a pending capability answer after another directory refresh finishes', async () => {
  let finishCapability!: (capabilities: string[]) => void;
  mocks.accountRelayCapabilities
    .mockReturnValueOnce(new Promise<string[]>(resolve => { finishCapability = resolve; }))
    .mockRejectedValue(new Error('network unavailable'));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.refreshDevices');
  await act(async () => { refresh!.click(); });
  await act(async () => { finishCapability(['device_alias_v1']); });
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]')?.disabled).toBe(false);
  expect(container.textContent).not.toContain('accountLogin.deviceAliasUnsupported');
});

/** Emit a presence signal to every listener the panel registered for this epoch. */
async function emitPresence(devices: Array<Record<string, unknown>>) {
  expect(presenceListeners.length).toBeGreaterThan(0);
  await act(async () => { for (const listener of [...presenceListeners]) listener({ devices }); });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openAliasEditor() {
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]');
  expect(edit).not.toBeNull();
  await act(async () => { edit!.click(); });
  const input = container.querySelector<HTMLInputElement>('input[aria-label="accountLogin.deviceAlias"]');
  expect(input).not.toBeNull();
  return input!;
}

it('replaces the device name in place instead of showing two names', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.querySelector('.account-panel__device-name')).not.toBeNull();
  const input = await openAliasEditor();
  // The editor occupies the name's slot; the technical name is not repeated.
  expect(input.value).toBe('');
  expect(container.querySelector('.account-panel__device-name')).toBeNull();
  expect(container.querySelector('.account-panel__device-badge')).toBeNull();
  expect(container.textContent).not.toContain('My computer');
  // Losing the row must not lose the device's status or hardware line.
  expect(container.querySelector('.account-panel__device-meta')).not.toBeNull();
});

it('saves an edited alias from the device row with Enter', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  await act(async () => { root.render(<AccountPanel />); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, '  Studio  '); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledWith('local', 'Studio');
});

it('clears an alias when the row editor is saved empty', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true }]);
  await act(async () => { root.render(<AccountPanel />); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, '   '); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledWith('local', null);
});

it('closes the row editor on Escape without renaming', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  await act(async () => { root.render(<AccountPanel />); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, 'Studio'); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('input[aria-label="accountLogin.deviceAlias"]')).toBeNull();
  expect(mocks.accountUpdateDevice).not.toHaveBeenCalled();
});

it('never renders a device offline from an empty presence signal', async () => {
  // The desktop emits an empty presence list when its own routing socket drops.
  // Holding the follow-up snapshot open reproduces the window in which the
  // directory still reports the device online.
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([{ device_id: 'local', device_name: 'My computer', device_model: 'Model', online: true, last_seen_at: 1_700_000_000 }])
    .mockImplementation(() => new Promise(() => {}));
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).toContain('accountLogin.online');
  await emitPresence([]);
  expect(container.textContent).toContain('accountLogin.online');
  expect(container.textContent).not.toContain('accountLogin.lastSeen');
  expect(container.textContent).toContain('Model');
});

it('merges presence metadata without clearing fields an older relay omits', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([{ device_id: 'local', device_name: 'My computer', device_model: 'Model', device_os: 'Linux', online: true }])
    .mockImplementation(() => new Promise(() => {}));
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.textContent).not.toContain('Studio');
  await emitPresence([{ device_id: 'local', device_name: 'My computer', device_alias: 'Studio' }]);
  expect(container.textContent).toContain('Studio');
  expect(container.textContent).toContain('Model');
  expect(container.textContent).toContain('Linux');
  expect(container.textContent).toContain('accountLogin.online');
});

it('clears an alias from explicit null presence while the directory refresh is pending', async () => {
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([{ device_id: 'local', device_name: 'My computer', device_alias: 'Studio', device_model: 'Model', online: true }])
    .mockImplementation(() => new Promise(() => {}));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  expect(container.textContent).toContain('Studio');
  await emitPresence([{ device_id: 'local', device_name: 'My computer', device_alias: null }]);
  expect(container.textContent).not.toContain('Studio');
  expect(container.textContent).toContain('My computer');
  expect(container.textContent).toContain('Model');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(2);
});

it('refreshes again after presence arrives during an older directory request', async () => {
  let finishOldSnapshot!: (devices: Array<{ device_id: string; device_name: string; device_alias: string; online: boolean }>) => void;
  const oldDevice = { device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true };
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([oldDevice])
    .mockReturnValueOnce(new Promise(resolve => { finishOldSnapshot = resolve; }))
    .mockResolvedValue([{ ...oldDevice, device_alias: 'Workshop' }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.refreshDevices');
  expect(refresh).toBeDefined();
  await act(async () => { refresh!.click(); });
  await emitPresence([{ device_id: 'local', device_name: 'My computer', device_alias: 'Workshop' }]);
  expect(container.textContent).toContain('Workshop');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(2);
  await act(async () => { finishOldSnapshot([oldDevice]); });
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain('Workshop');
  expect(container.textContent).not.toContain('Studio');
});

it('refreshes again after saving an alias during an older directory request', async () => {
  let finishOldSnapshot!: (devices: Array<{ device_id: string; device_name: string; device_alias: string; online: boolean }>) => void;
  const oldDevice = { device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true };
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([oldDevice])
    .mockReturnValueOnce(new Promise(resolve => { finishOldSnapshot = resolve; }))
    .mockResolvedValue([{ ...oldDevice, device_alias: 'Workshop' }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.refreshDevices');
  expect(refresh).toBeDefined();
  await act(async () => { refresh!.click(); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, 'Workshop'); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledWith('local', 'Workshop');
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(2);
  await act(async () => { finishOldSnapshot([oldDevice]); });
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain('Workshop');
  expect(container.textContent).not.toContain('Studio');
});

it('keeps an incompatible device listed with a reason and never targets it', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.getDeviceInfo.mockReset().mockResolvedValue({ device_id: 'local' });
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer', device_name: 'Old build', online: true, compatible: false, device_client_version: '0.9.0' },
  ]);
  await act(async () => { root.render(<AccountPanel />); });
  // The device stays visible; the reason mentions the peer version.
  expect(container.textContent).toContain('Old build');
  expect(container.textContent).toContain('accountLogin.deviceClientIncompatibleWithVersion');
  // No control target: the peer never becomes a peer-mode switch button.
  expect(container.querySelector('button[aria-label="accountLogin.openDevice"]')).toBeNull();
  expect(mocks.switchToDevice).not.toHaveBeenCalled();
  // Alias editing is a plain directory operation and stays available on both rows.
  expect(container.querySelectorAll('button[aria-label="accountLogin.editDeviceAlias"]').length).toBe(2);
});

it.each([false, true])('keeps device rows non-interactive while peer mode is %s', async active => {
  mocks.peerMode = { active };
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.getDeviceInfo.mockReset().mockResolvedValue({ device_id: 'local' });
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer', device_name: 'Peer build', online: true },
    { device_id: 'offline', device_name: 'Offline host', online: false },
  ]);
  await act(async () => { root.render(<AccountPanel />); });
  const summaries = container.querySelectorAll<HTMLElement>('.account-panel__device-summary');
  expect(summaries).toHaveLength(3);
  for (const summary of summaries) {
    expect(summary.tagName).toBe('DIV');
    expect(summary.tabIndex).toBe(-1);
    expect(summary.getAttribute('role')).toBeNull();
    await act(async () => {
      summary.click();
      summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      summary.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
  }
  expect(container.querySelector('button[aria-label="accountLogin.openDevice"]')).toBeNull();
  expect(container.querySelector('.account-panel__device-chevron')).toBeNull();
  expect(mocks.switchToDevice).not.toHaveBeenCalled();
  expect(mocks.switchToLocal).not.toHaveBeenCalled();
  expect(useDeviceVisibilityPreferences.getState().hidden).toEqual({});
  expect(container.querySelectorAll('[aria-label="nav.devices.hideInSidebar"]')).toHaveLength(3);
});

it('submits an alias save once while Enter and save actions are pending', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  let finishSave!: () => void;
  mocks.accountUpdateDevice.mockReturnValue(new Promise<void>(resolve => { finishSave = resolve; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, 'Studio'); });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    container.querySelector<HTMLButtonElement>('[aria-label="accountLogin.saveDeviceAlias"]')!.click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledTimes(1);
  await act(async () => { finishSave(); });
  expect(container.querySelector('[aria-label="accountLogin.deviceAlias"]')).toBeNull();
});

it('keeps a new account alias save independent of an old account response', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  let finishOld!: () => void;
  let finishNew!: () => void;
  mocks.accountUpdateDevice
    .mockReturnValueOnce(new Promise<void>(resolve => { finishOld = resolve; }))
    .mockReturnValueOnce(new Promise<void>(resolve => { finishNew = resolve; }));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const oldInput = await openAliasEditor();
  await act(async () => {
    setInputValue(oldInput, 'Old account alias');
    oldInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  mocks.identity = { resolved: true, status: 'signed-in', me: { user: { githubId: 7, login: 'bob' } } };
  mocks.accountStatus.mockResolvedValue({ logged_in: true, user_id: '7' });
  mocks.getDeviceInfo.mockResolvedValue({ device_id: 'local', device_name: 'New account computer' });
  mocks.accountListDevices.mockResolvedValue([{ device_id: 'local', device_name: 'New account computer', online: true }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const newInput = await openAliasEditor();
  await act(async () => {
    setInputValue(newInput, 'New account alias');
    newInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledTimes(2);
  const readsBeforeOldResponse = mocks.accountListDevices.mock.calls.length;
  await act(async () => { finishOld(); });
  expect(container.querySelector('[aria-label="accountLogin.deviceAlias"]')).toBe(newInput);
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(readsBeforeOldResponse);
  await act(async () => { newInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledTimes(2);
  await act(async () => { finishNew(); });
  expect(container.querySelector('[aria-label="accountLogin.deviceAlias"]')).toBeNull();
});

it('keeps alias editing available after logout fails during a pending save', async () => {
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  let finishSave!: () => void;
  mocks.accountUpdateDevice
    .mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve; }))
    .mockResolvedValue(undefined);
  mocks.logout.mockRejectedValue(new Error('logout failed'));
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, 'Studio'); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const logout = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.logout');
  expect(logout?.disabled).toBe(false);
  await act(async () => { logout!.click(); });
  expect(container.textContent).toContain('logout failed');
  await act(async () => { finishSave(); });
  const editor = container.querySelector<HTMLInputElement>('input[aria-label="accountLogin.deviceAlias"]') ?? await openAliasEditor();
  expect(editor.disabled).toBe(false);
  await act(async () => { setInputValue(editor, 'Workshop'); });
  await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenLastCalledWith('local', 'Workshop');
});

it('cannot reopen a pre-save alias while its older snapshot is still pending', async () => {
  const oldDevice = { device_id: 'local', device_name: 'My computer', device_alias: 'Studio', online: true };
  let finishOldSnapshot!: (devices: typeof oldDevice[]) => void;
  let finishSuccessor!: (devices: typeof oldDevice[]) => void;
  mocks.accountRelayCapabilities.mockResolvedValue(['device_alias_v1']);
  mocks.accountListDevices.mockReset()
    .mockResolvedValueOnce([oldDevice])
    .mockReturnValueOnce(new Promise(resolve => { finishOldSnapshot = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { finishSuccessor = resolve; }))
    .mockResolvedValue([{ ...oldDevice, device_alias: 'Workshop' }]);
  await act(async () => { root.render(<AccountPanel onCloseDialog={() => {}} />); });
  const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'accountLogin.refreshDevices');
  await act(async () => { refresh!.click(); });
  const input = await openAliasEditor();
  await act(async () => { setInputValue(input, 'Workshop'); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice).toHaveBeenCalledWith('local', 'Workshop');
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]');
  await act(async () => { edit?.click(); });
  // The row may wait for the post-save read, or expose the saved alias immediately.
  const reopened = container.querySelector<HTMLInputElement>('input[aria-label="accountLogin.deviceAlias"]');
  if (reopened) {
    expect(reopened.value).toBe('Workshop');
    await act(async () => { reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  }
  await act(async () => { finishOldSnapshot([oldDevice]); });
  expect(mocks.accountListDevices).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain('Studio');
  const pendingEdit = container.querySelector<HTMLButtonElement>('button[aria-label="accountLogin.editDeviceAlias"]');
  await act(async () => { pendingEdit?.click(); });
  const pendingEditor = container.querySelector<HTMLInputElement>('input[aria-label="accountLogin.deviceAlias"]');
  if (pendingEditor) expect(pendingEditor.value).toBe('Workshop');
  await act(async () => { finishSuccessor([{ ...oldDevice, device_alias: 'Workshop' }]); });
  const editor = container.querySelector<HTMLInputElement>('input[aria-label="accountLogin.deviceAlias"]') ?? await openAliasEditor();
  expect(editor.value).toBe('Workshop');
  await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.accountUpdateDevice.mock.calls.every(([, alias]) => alias === 'Workshop')).toBe(true);
});

it('groups the account and its devices into titled sections with fixed row columns', async () => {
  mocks.accountConnectDevices.mockResolvedValue([]);
  mocks.getDeviceInfo.mockReset().mockResolvedValue({ device_id: 'local' });
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer', device_name: 'Peer build', online: false },
  ]);
  await act(async () => { root.render(<AccountPanel />); });
  const titles = Array.from(container.querySelectorAll('.account-panel__section-title')).map(node => node.textContent);
  expect(titles).toEqual(['accountLogin.accountSectionTitle', 'accountLogin.linkedDevices']);
  const statuses = Array.from(container.querySelectorAll('.account-panel__device-status'))
    .map(node => node.getAttribute('data-bitfun-state'));
  expect(statuses).toEqual(['online', 'offline']);
  for (const row of container.querySelectorAll('[data-bitfun-part="deviceCard"]')) {
    const children = Array.from(row.children).map(node => node.className);
    expect(children).toEqual([
      'account-panel__device-drag-handle',
      'account-panel__device-summary',
      'account-panel__device-actions',
    ]);
  }
});

it('shows the sign-in action inside the account section when signed out', async () => {
  mocks.identity = { resolved: true, status: 'signed-out', me: null };
  mocks.accountStatus.mockReset().mockResolvedValue({ logged_in: false });
  await act(async () => { root.render(<AccountPanel />); });
  expect(container.querySelector('.account-panel__section-title')?.textContent).toBe('accountLogin.accountSectionTitle');
  expect(container.querySelector('[data-bitfun-part="form"]')?.textContent).toContain('accountLogin.login');
});

function deviceOrderInPanel() {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-device-id]')).map(row => row.dataset.deviceId);
}

function dispatchDeviceDrag(element: Element, type: string, clientY = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientY: { value: clientY }, dataTransfer: {
    value: { effectAllowed: '', dropEffect: '', setData: vi.fn() },
  } });
  element.dispatchEvent(event);
}

it('commits a drag only on drop without row activation, key bindings or helper tooltips', async () => {
  mocks.accountListDevices.mockResolvedValue([
    { device_id: 'local', device_name: 'My computer', online: true },
    { device_id: 'peer', device_name: 'Peer', online: true },
    { device_id: 'offline', device_name: 'Offline', online: false },
  ]);
  await act(async () => { root.render(<AccountPanel />); });
  const row = (id: string) => container.querySelector<HTMLElement>(`[data-device-id="${id}"]`)!;
  vi.spyOn(row('local'), 'getBoundingClientRect').mockReturnValue({ top: 20, height: 60 } as DOMRect);
  act(() => dispatchDeviceDrag(row('offline'), 'dragstart'));
  act(() => dispatchDeviceDrag(row('local'), 'dragover', 21));
  expect(row('local').dataset.dropPosition).toBe('before');
  expect(deviceOrderInPanel()).toEqual(['local', 'peer', 'offline']);
  expect(useDeviceOrderPreferences.getState().order).toEqual([]);
  act(() => dispatchDeviceDrag(row('local'), 'drop', 21));
  expect(deviceOrderInPanel()).toEqual(['offline', 'local', 'peer']);
  expect(useDeviceOrderPreferences.getState().order).toEqual(['offline', 'local', 'peer']);
  const handle = row('offline').querySelector<HTMLElement>('.account-panel__device-drag-handle')!;
  expect(handle.tagName).toBe('SPAN');
  expect(handle.hasAttribute('title')).toBe(false);
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(deviceOrderInPanel()).toEqual(['offline', 'local', 'peer']);
  act(() => dispatchDeviceDrag(row('offline'), 'dragstart'));
  act(() => dispatchDeviceDrag(row('peer'), 'dragover', 100));
  act(() => dispatchDeviceDrag(row('offline'), 'dragend'));
  expect(deviceOrderInPanel()).toEqual(['offline', 'local', 'peer']);
  expect(container.querySelector('[data-drop-position]')).toBeNull();
  expect(mocks.switchToDevice).not.toHaveBeenCalled();
  expect(mocks.switchToLocal).not.toHaveBeenCalled();
  expect(mocks.accountUpdateDevice).not.toHaveBeenCalled();
});
