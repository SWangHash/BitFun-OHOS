import { accountIdentityAPI } from './AccountIdentityAPI';
import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { isMarketSummary, isStringArray, readMarketCatalog, writeMarketCatalog } from './MarketCatalogCache';
import type {
  MiniApp,
  MiniAppI18n,
  MiniAppMeta,
  MiniAppPermissionDiff,
  MiniAppPermissions,
} from './MiniAppAPI';

export type MarketSort = 'newest' | 'downloads' | 'rating';
export type MarketSubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export interface MarketUserSummary {
  githubId: number;
  login: string;
  avatarUrl: string;
}

export interface MarketRelease {
  releaseId: string;
  listingId: string;
  releaseNumber: number;
  minOpenBitFunVersion: string;
  changelog: string;
  packageSha256: string;
  packageSize: number;
  reviewBundleHash: string;
  permissions: MiniAppPermissions;
  publishedAt: number;
  yanked: boolean;
}

export interface MarketListingSummary {
  listingId: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  owner: MarketUserSummary;
  latestRelease: number;
  minOpenBitFunVersion: string;
  permissions: MiniAppPermissions;
  screenshotUrls: string[];
  ratingAverage: number;
  ratingCount: number;
  favoriteCount: number;
  downloadCount: number;
  publishedAt: number;
  i18n?: MiniAppI18n;
  isFavorited?: boolean;
  myRating?: number;
}

export interface MarketListingDetail extends MarketListingSummary {
  changelog: string;
  license: { spdxExpression?: string; customUrl?: string };
  repositoryUrl?: string;
  releases: MarketRelease[];
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface MarketBrowseRequest {
  query?: string;
  category?: string;
  sort?: MarketSort;
  cursor?: string;
  limit?: number;
}

export interface MarketMe {
  user: MarketUserSummary;
  isAdmin: boolean;
}

export interface DesktopAuthStart {
  transactionId: string;
  authorizationUrl: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}

export interface MarketSubmission {
  submissionId: string;
  listingId?: string;
  slug: string;
  releaseNumber: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  minOpenBitFunVersion: string;
  changelog: string;
  license: { spdxExpression?: string; customUrl?: string };
  repositoryUrl?: string;
  permissions: MiniAppPermissions;
  status: MarketSubmissionStatus;
  packageSha256?: string;
  packageSize?: number;
  screenshotUrls: string[];
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MarketSubmissionDraftRequest {
  listingId?: string;
  slug: string;
  releaseNumber: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  minOpenBitFunVersion: string;
  changelog: string;
  license: { spdxExpression?: string; customUrl?: string };
  repositoryUrl?: string;
}

export interface InstalledMarketOrigin {
  listingId: string;
  releaseId: string;
  releaseNumber: number;
  packageSha256: string;
}

export interface MarketInstalledStatus {
  appId: string;
  appVersion: number;
  permissions: MiniAppPermissions;
  origin: InstalledMarketOrigin;
  localOverride: boolean;
}

export interface MarketInstallResult {
  app: MiniApp;
  origin: InstalledMarketOrigin;
  updated: boolean;
  permissionDiff: MiniAppPermissionDiff;
}

export interface MarketPackageInspection {
  name: string;
  description: string;
  packageSha256: string;
  permissions: MiniAppPermissions;
  permissionDiff: MiniAppPermissionDiff;
}

export interface MarketUploadProgress {
  submissionId?: string;
  phase: 'validating' | 'package' | 'screenshots' | 'submitted';
  completed: number;
  total: number;
}

export class MiniAppMarketAPI {
  getCachedPage(request: MarketBrowseRequest): CursorPage<MarketListingSummary> | undefined {
    if (request.cursor) return undefined;
    return readMarketCatalog(this.catalogKey(request), (value): value is MarketListingSummary => (
      isMarketSummary(value)
      && typeof value.category === 'string' && typeof value.icon === 'string'
      && isStringArray(value.tags) && isStringArray(value.screenshotUrls)
      && Boolean(value.permissions && typeof value.permissions === 'object')
      && ['ratingAverage', 'ratingCount', 'favoriteCount'].every(key => Number.isFinite(value[key]))
    ));
  }

  private catalogKey(request: MarketBrowseRequest): string {
    return getActiveSurfaceScope().key('miniapp-market', JSON.stringify([
      request.query?.trim() ?? '', request.category ?? 'all', request.sort ?? 'newest', request.limit ?? 20,
    ]));
  }

  async browse(request: MarketBrowseRequest): Promise<CursorPage<MarketListingSummary>> {
    const key = this.catalogKey(request);
    try {
      const page = await api.invoke<CursorPage<MarketListingSummary>>('miniapp_market_browse', { request });
      if (!request.cursor) {
        writeMarketCatalog(key, {
          ...page,
          items: page.items.map(({ isFavorited: _favorite, myRating: _rating, ...item }) => item),
        });
      }
      return page;
    } catch (error) {
      throw createTauriCommandError('miniapp_market_browse', error);
    }
  }

  async getListing(slug: string): Promise<MarketListingDetail> {
    try {
      return await api.invoke('miniapp_market_get_listing', { request: { slug } });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_get_listing', error, { slug });
    }
  }

  authStart = () => accountIdentityAPI.authStart();
  authPoll = (transaction: DesktopAuthStart) => accountIdentityAPI.authPoll(transaction);
  me = () => accountIdentityAPI.me();
  logout = () => accountIdentityAPI.logout();

  async setRating(slug: string, value?: number): Promise<{
    average: number;
    count: number;
    myRating?: number;
  }> {
    try {
      return await api.invoke('miniapp_market_set_rating', {
        request: { slug, value },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_set_rating', error, { slug });
    }
  }

  async setFavorite(slug: string, enabled: boolean): Promise<{
    count: number;
    isFavorited: boolean;
  }> {
    try {
      return await api.invoke('miniapp_market_set_favorite', {
        request: { slug, enabled },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_set_favorite', error, { slug });
    }
  }

  async listSubmissions(): Promise<MarketSubmission[]> {
    try {
      return await api.invoke('miniapp_market_list_submissions', {});
    } catch (error) {
      throw createTauriCommandError('miniapp_market_list_submissions', error);
    }
  }

  async withdrawSubmission(submissionId: string): Promise<MarketSubmission> {
    try {
      return await api.invoke('miniapp_market_withdraw_submission', {
        request: { submissionId },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_withdraw_submission', error, {
        submissionId,
      });
    }
  }

  async installedStatus(listingId: string): Promise<MarketInstalledStatus | null> {
    try {
      return await api.invoke('miniapp_market_installed_status', { request: { listingId } });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_installed_status', error, { listingId });
    }
  }

  /**
   * Marketplace origins of every installed MiniApp, keyed by local app id.
   * Installed apps carry a local version counter that is independent from the
   * marketplace release number, so surfaces that want to name the installed
   * release read it from here.
   */
  async installedOrigins(): Promise<Record<string, InstalledMarketOrigin>> {
    try {
      return await api.invoke('miniapp_market_installed_origins', {});
    } catch (error) {
      throw createTauriCommandError('miniapp_market_installed_origins', error);
    }
  }

  async install(
    slug: string,
    releaseNumber: number,
    options: {
      existingAppId?: string;
      confirmPermissions: boolean;
      confirmOverwrite: boolean;
    },
  ): Promise<MarketInstallResult> {
    try {
      return await api.invoke('miniapp_market_install', {
        request: {
          slug,
          releaseNumber,
          existingAppId: options.existingAppId,
          confirmPermissions: options.confirmPermissions,
          confirmOverwrite: options.confirmOverwrite,
        },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_install', error, { slug, releaseNumber });
    }
  }

  async inspectPackage(path: string): Promise<MarketPackageInspection> {
    try {
      return await api.invoke('miniapp_market_inspect_package', { request: { path } });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_inspect_package', error, { path });
    }
  }

  async captureWindow(): Promise<string> {
    try {
      return await api.invoke('miniapp_market_capture_window', {});
    } catch (error) {
      throw createTauriCommandError('miniapp_market_capture_window', error);
    }
  }

  async importPackage(path: string, confirmPermissions: boolean): Promise<MiniApp> {
    try {
      return await api.invoke('miniapp_market_import_package', {
        request: { path, confirmPermissions },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_import_package', error, { path });
    }
  }

  async submitInstalled(
    appId: string,
    draft: MarketSubmissionDraftRequest,
    screenshotPaths: string[],
  ): Promise<MarketSubmission> {
    try {
      return await api.invoke('miniapp_market_submit_installed', {
        request: { appId, draft, screenshotPaths },
      });
    } catch (error) {
      throw createTauriCommandError('miniapp_market_submit_installed', error, { appId });
    }
  }

  onUploadProgress(handler: (progress: MarketUploadProgress) => void): () => void {
    return api.listen<MarketUploadProgress>('miniapp-market-upload-progress', handler);
  }

  onAccountChanged(handler: () => void): () => void {
    return accountIdentityAPI.onAccountChanged(handler);
  }
}

export const miniAppMarketAPI = new MiniAppMarketAPI();

export type { MiniAppMeta };
