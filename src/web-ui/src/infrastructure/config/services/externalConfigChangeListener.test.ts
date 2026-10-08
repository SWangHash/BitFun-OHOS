import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  applyExternalReload: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { listen: mocks.listen },
}));

vi.mock('./ConfigManager', () => ({
  configManager: { applyExternalReload: mocks.applyExternalReload },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('externalConfigChangeListener', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.listen.mockReturnValue(() => undefined);
    mocks.applyExternalReload.mockResolvedValue(undefined);
  });

  it('reloads the config cache when the native tray changes a config value', async () => {
    const { ensureExternalConfigChangeListener, TRAY_DESKTOP_PET_CHANGED_EVENT } = await import(
      './externalConfigChangeListener'
    );
    ensureExternalConfigChangeListener();

    expect(mocks.listen).toHaveBeenCalledTimes(1);
    const [event, handler] = mocks.listen.mock.calls[0];
    expect(event).toBe('tray://desktop-pet-changed');
    expect(event).toBe(TRAY_DESKTOP_PET_CHANGED_EVENT);

    handler();

    await vi.waitFor(() => expect(mocks.applyExternalReload).toHaveBeenCalledTimes(1));
  });

  it('registers the listener only once', async () => {
    const { ensureExternalConfigChangeListener } = await import('./externalConfigChangeListener');
    ensureExternalConfigChangeListener();
    ensureExternalConfigChangeListener();

    expect(mocks.listen).toHaveBeenCalledTimes(1);
  });
});
