// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRosterEntry } from './useAccountDeviceRoster';
import { DeviceSurfaceSwitcher } from './DeviceSurfaceSwitcher';

const state = vi.hoisted(() => ({
  devices: [] as DeviceRosterEntry[],
  switchToDevice: vi.fn().mockResolvedValue('activated'),
  switchToLocal: vi.fn().mockResolvedValue('activated'),
  disconnectDevice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./useAccountDeviceRoster', () => ({
  useAccountDeviceRoster: () => ({ loggedIn: true, localDeviceId: 'local', devices: state.devices }),
}));
vi.mock('./peerDeviceContextState', () => ({
  usePeerDeviceModeOptional: () => ({
    peerMode: { active: false },
    attachments: [{ deviceId: 'old-peer' }],
    switchToDevice: state.switchToDevice,
    switchToLocal: state.switchToLocal,
    disconnectDevice: state.disconnectDevice,
  }),
}));
vi.mock('./deviceActivity', () => ({
  isDeviceBusy: () => false,
  subscribeDeviceActivity: () => () => {},
}));
vi.mock('@/infrastructure/i18n/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('@/shared/notification-system', () => ({
  useNotification: () => ({ success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/infrastructure/appearance/runtime/AppearanceOverlayHost', () => ({
  getAppearanceOverlayHost: () => document.body,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.devices = [
    { deviceId: 'local', deviceName: 'This computer', online: true, isLocal: true, controllable: true },
    { deviceId: 'old-peer', deviceName: 'Peer alias', online: true, isLocal: false, controllable: false },
    { deviceId: 'peer', deviceName: 'Available peer', online: true, isLocal: false, controllable: true },
  ];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<DeviceSurfaceSwitcher />));
  act(() => document.querySelector<HTMLButtonElement>('[data-testid="device-surface-switcher"]')!.click());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function menuItem(name: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    .find(element => element.textContent?.includes(name));
  expect(item).toBeDefined();
  return item!;
}

describe('device surface switcher compatibility', () => {
  it('keeps an incompatible device visible and disconnectable without offering control', async () => {
    const item = menuItem('Peer alias');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('accountLogin.deviceClientIncompatibleTag');
    await act(async () => item.click());
    expect(state.switchToDevice).not.toHaveBeenCalled();

    const disconnect = item.parentElement!.querySelector<HTMLButtonElement>('[aria-label="accountLogin.deviceSwitcher.disconnectHint"]');
    expect(disconnect).not.toBeNull();
    await act(async () => disconnect!.click());
    expect(state.disconnectDevice).toHaveBeenCalledWith('old-peer');
  });

  it('switches to a compatible peer without disconnecting attached work', async () => {
    await act(async () => menuItem('Available peer').click());
    expect(state.switchToDevice).toHaveBeenCalledWith('peer', 'Available peer');
    expect(state.disconnectDevice).not.toHaveBeenCalled();
  });
});
