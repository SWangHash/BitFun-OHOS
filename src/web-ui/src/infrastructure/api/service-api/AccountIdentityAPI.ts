import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export interface MarketUserSummary {
  githubId: number;
  accountId?: string;
  login: string;
  avatarUrl: string;
}

export interface MarketMe {
  email?: string;
  user: MarketUserSummary;
  isAdmin: boolean;
}

export interface DesktopAuthStart {
  transactionId: string;
  authorizationUrl: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}

class AccountIdentityAPI {
  async authStart(): Promise<DesktopAuthStart> {
    try {
      return await api.invoke('account_github_start', {});
    } catch (error) {
      throw createTauriCommandError('account_github_start', error);
    }
  }

  async authPoll(transaction: DesktopAuthStart): Promise<'pending' | 'authorized' | 'expired'> {
    try {
      const response = await api.invoke<{ status?: unknown } | null>(
        'account_github_poll',
        {
          request: {
            transactionId: transaction.transactionId,
          },
        },
      );
      const status = response?.status;
      if (status === 'pending' || status === 'authorized' || status === 'expired') return status;
      if (status === 'consumed') {
        throw new Error('The GitHub authorization has already been consumed. Please sign in again.');
      }
      throw new Error('The market returned an invalid GitHub authorization response. Please sign in again.');
    } catch (error) {
      throw createTauriCommandError('account_github_poll', error);
    }
  }

  async me(): Promise<MarketMe | null> {
    try {
      return await api.invoke('account_github_info', {});
    } catch (error) {
      throw createTauriCommandError('account_github_info', error);
    }
  }

  async logout(): Promise<void> {
    try {
      await api.invoke('account_logout', {});
    } catch (error) {
      throw createTauriCommandError('account_logout', error);
    }
  }

  onAccountChanged(handler: () => void): () => void {
    return api.listen('account-identity-changed', handler);
  }
}

export const accountIdentityAPI = new AccountIdentityAPI();
