import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./ApiClient', () => ({ api: { invoke } }));
import { devecoAccountAPI } from './DevecoAccountAPI';

describe('DevEco Code account response contract', () => {
  beforeEach(() => { invoke.mockReset(); });

  it.each([true, false, null] as const)('preserves shared credential metadata %s without inferring it from a completed sign-in', async (credentialPresent) => {
    const snapshot = { available: true, credentialPresent, login: { id: 'login-1', state: 'succeeded' } };
    invoke.mockResolvedValue(snapshot);
    await expect(devecoAccountAPI.getStatus()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith('deveco_account_status', { request: {} }, { timeout: 60000, retries: 0 });
  });
});
