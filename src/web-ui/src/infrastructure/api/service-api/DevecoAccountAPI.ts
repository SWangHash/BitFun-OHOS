import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export interface DevecoAccountSnapshot {
  available: boolean;
  /** Null means credential metadata is unavailable; stored credentials are not online validation. */
  credentialPresent: boolean | null;
  login?: {
    id: string;
    state: 'pending' | 'succeeded' | 'failed' | 'cancelled';
    error?: string;
  };
}

async function invoke(command: string, request: { sessionId?: string } = {}): Promise<DevecoAccountSnapshot> {
  try {
    // A cold management launch plus its bounded local requests can take 55 s.
    const snapshot = await api.invoke<DevecoAccountSnapshot>(command, { request }, { timeout: 60000, retries: 0 });
    if (!snapshot || typeof snapshot.available !== 'boolean'
      || (snapshot.credentialPresent !== null && typeof snapshot.credentialPresent !== 'boolean')
      || (snapshot.login !== undefined && (!snapshot.login || typeof snapshot.login.id !== 'string'
        || !['pending', 'succeeded', 'failed', 'cancelled'].includes(snapshot.login.state)
        || (snapshot.login.error !== undefined && typeof snapshot.login.error !== 'string')))) {
      throw new Error('deveco_auth_invalid_response');
    }
    return snapshot;
  } catch (error) {
    throw createTauriCommandError(command, error);
  }
}

export const devecoAccountAPI = {
  getStatus: () => invoke('deveco_account_status'),
  startLogin: () => invoke('deveco_account_start_login'),
  cancelLogin: (sessionId: string) => invoke('deveco_account_cancel_login', { sessionId }),
  logout: () => invoke('deveco_account_logout'),
};
