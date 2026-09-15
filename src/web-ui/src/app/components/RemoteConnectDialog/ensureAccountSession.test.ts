import { describe, expect, it, vi } from 'vitest';
import { ensureAccountSession } from './ensureAccountSession';

describe('shared identity device session', () => {
  it('registers an identity signed in from a market without another OAuth flow', async () => {
    const api = { accountStatus: vi.fn().mockResolvedValue({ logged_in: false }), accountLogin: vi.fn().mockResolvedValue({}) };
    expect(await ensureAccountSession(api, () => true, 42)).toBe(true);
    expect(api.accountLogin).toHaveBeenCalledOnce();
  });
  it('preserves an existing device session', async () => {
    const api = { accountStatus: vi.fn().mockResolvedValue({ logged_in: true, user_id: '42' }), accountLogin: vi.fn() };
    expect(await ensureAccountSession(api, () => true, 42)).toBe(true);
    expect(api.accountLogin).not.toHaveBeenCalled();
  });
  it('does not register after the observing account changes', async () => {
    let current = true;
    const api = { accountStatus: vi.fn(async () => { current = false; return { logged_in: false }; }), accountLogin: vi.fn() };
    expect(await ensureAccountSession(api, () => current, 42)).toBe(false);
    expect(api.accountLogin).not.toHaveBeenCalled();
  });
  it('surfaces connection errors without replacing or clearing identity', async () => {
    const api = { accountStatus: vi.fn().mockRejectedValue(new Error('offline')), accountLogin: vi.fn() };
    await expect(ensureAccountSession(api, () => true, 42)).rejects.toThrow('offline');
    expect(api.accountLogin).not.toHaveBeenCalled();
  });
  it('replaces a stale Relay session belonging to a different GitHub account', async () => {
    const api = { accountStatus: vi.fn().mockResolvedValue({ logged_in: true, user_id: '7' }), accountLogin: vi.fn().mockResolvedValue({}) };
    expect(await ensureAccountSession(api, () => true, 42)).toBe(true);
    expect(api.accountLogin).toHaveBeenCalledOnce();
  });

});
