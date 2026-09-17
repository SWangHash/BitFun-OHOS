import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const remoteConnectDialogAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'remote-connect-dialog',
  parts: [
    { id: 'root' },
    { id: 'sidebar' },
    { id: 'sidebarBrand' },
    { id: 'main' },
    { id: 'overview' },
    { id: 'overviewSection' },
    { id: 'overviewAction' },
    { id: 'sectionMarker' },
    { id: 'viewHeader' },
    { id: 'subtabs' },
    { id: 'panel' },
    { id: 'body' },
    { id: 'pairingCard' },
    { id: 'connections' },
    { id: 'botCard' },
    { id: 'status' },
    { id: 'error' },
  ],
  facets: [
    { id: 'view', attribute: 'data-bitfun-view', values: ['overview', 'network', 'bot', 'account'] },
    { id: 'group', attribute: 'data-bitfun-group', values: ['network', 'bot', 'account'] },
  ],
  states: [
    { id: 'authenticated', selector: { kind: 'self', suffix: '[data-bitfun-state~="authenticated"]' } },
    { id: 'connected', selector: { kind: 'self', suffix: '[data-bitfun-state~="connected"]' } },
    { id: 'disabled', selector: { kind: 'self', suffix: '[data-bitfun-state~="disabled"]' } },
  ],
};

export const remoteAccountPanelAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'remote-account-panel',
  parts: [
    { id: 'root' },
    { id: 'error' },
    { id: 'loading' },
    { id: 'scroll' },
    { id: 'form' },
    { id: 'actions' },
    { id: 'deviceList' },
    { id: 'deviceCard' },
  ],
  facets: [
    { id: 'view', attribute: 'data-bitfun-view', values: ['login', 'devices'] },
  ],
  states: [
    { id: 'offline', selector: { kind: 'self', suffix: '[data-bitfun-state~="offline"]' } },
    { id: 'current', selector: { kind: 'self', suffix: '[data-bitfun-state~="current"]' } },
    { id: 'syncing', selector: { kind: 'self', suffix: '[data-bitfun-state~="syncing"]' } },
  ],
};
