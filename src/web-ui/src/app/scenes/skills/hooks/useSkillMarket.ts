import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configAPI } from '@/infrastructure/api';
import type { SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import { useWorkspaceManagerSync } from '@/infrastructure/hooks/useWorkspaceManagerSync';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SkillsScene:useSkillMarket');

const DEFAULT_PAGE_SIZE = 10;
const MAX_TOTAL_SKILLS = 500;

interface InstalledDirNamesByLevel {
  user: Set<string>;
  project: Set<string>;
}

interface UseSkillMarketOptions {
  searchQuery: string;
  isMarketSkillInstalled: (skill: SkillMarketItem) => boolean;
  installedDirNamesByLevel: InstalledDirNamesByLevel;
  onInstalledChanged?: () => Promise<void> | void;
  pageSize?: number;
  enabled?: boolean;
}

export function useSkillMarket({
  searchQuery,
  isMarketSkillInstalled,
  installedDirNamesByLevel,
  onInstalledChanged,
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
}: UseSkillMarketOptions) {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const { hasWorkspace, workspacePath, isRemoteWorkspace, isAssistantWorkspace } = useWorkspaceManagerSync();

  const [marketSkills, setMarketSkills] = useState<SkillMarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [downloadingPackage, setDownloadingPackage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const marketRequestIdRef = useRef(0);
  const capabilityKey = `${enabled}\u0000${workspacePath ?? ''}\u0000${isRemoteWorkspace}`;
  const capabilityRef = useRef({ key: capabilityKey, epoch: 0, enabled });
  useLayoutEffect(() => {
    if (capabilityRef.current.key !== capabilityKey) {
      capabilityRef.current = {
        key: capabilityKey,
        epoch: capabilityRef.current.epoch + 1,
        enabled,
      };
    } else {
      capabilityRef.current.enabled = enabled;
    }
  }, [capabilityKey, enabled]);

  const currentCapabilityEpoch = useCallback((): number | null => (
    capabilityRef.current.enabled ? capabilityRef.current.epoch : null
  ), []);
  const capabilityIsCurrent = useCallback((epoch: number): boolean => (
    capabilityRef.current.enabled && capabilityRef.current.epoch === epoch
  ), []);

  const fetchSkills = useCallback(async (query: string | undefined, limit: number, offset: number) => {
    const normalized = query?.trim();
    return normalized
      ? await configAPI.searchSkillMarket(normalized, limit, offset)
      : await configAPI.listSkillMarket(undefined, limit, offset);
  }, []);

  const loadFirstPage = useCallback(async (query?: string) => {
    const capabilityEpoch = currentCapabilityEpoch();
    if (capabilityEpoch === null) {
      return;
    }
    if (query && query.trim().length < 2) {
      setMarketLoading(false);
      setMarketError('market.errors.tooShort');
      return;
    }
    const requestId = ++marketRequestIdRef.current;

    setMarketLoading(true);
    setMarketError(null);
    setLoadMoreError(false);
    try {
      const fetchBatch = pageSize + 1;
      const skillList = await fetchSkills(query, fetchBatch, 0);
      if (requestId !== marketRequestIdRef.current || !capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      const displaySkills = skillList.slice(0, pageSize);
      setMarketSkills(displaySkills);
      setHasMore(skillList.length > pageSize);
    } catch (err) {
      if (requestId !== marketRequestIdRef.current || !capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      log.error('Failed to load skill market', err);
      setMarketError('market.errors.loadFailed');
    } finally {
      if (requestId === marketRequestIdRef.current && capabilityIsCurrent(capabilityEpoch)) {
        setMarketLoading(false);
      }
    }
  }, [capabilityIsCurrent, currentCapabilityEpoch, fetchSkills, pageSize]);

  useEffect(() => {
    marketRequestIdRef.current += 1;
    if (!enabled) {
      setMarketSkills([]);
      setMarketLoading(false);
      setLoadingMore(false);
      setMarketError(null);
      setDownloadingPackage(null);
      setHasMore(false);
      return;
    }
    loadFirstPage(searchQuery || undefined);
  }, [capabilityKey, enabled, loadFirstPage, searchQuery]);

  const refresh = useCallback(async () => {
    await loadFirstPage(searchQuery || undefined);
  }, [loadFirstPage, searchQuery]);

  const displayMarketSkills = useMemo(() => {
    const entries = marketSkills.map((skill, index) => ({
      skill,
      index,
      installed: isMarketSkillInstalled(skill),
    }));

    // Sort by install count (popular first), then original fetch order for a
    // stable position. Installed skills are prioritized to the front.
    entries.sort((a, b) => {
      if (a.installed !== b.installed) {
        return a.installed ? -1 : 1;
      }
      const installDelta = (b.skill.installs ?? 0) - (a.skill.installs ?? 0);
      if (installDelta !== 0) {
        return installDelta;
      }
      return a.index - b.index;
    });

    return entries.map((entry) => entry.skill);
  }, [isMarketSkillInstalled, marketSkills]);

  const goToNextPage = useCallback(async () => {
    const capabilityEpoch = currentCapabilityEpoch();
    if (capabilityEpoch === null) {
      return;
    }
    if (marketLoading || loadingMore || loadMoreError || !hasMore) {
      return;
    }

    const requestId = ++marketRequestIdRef.current;
    setLoadingMore(true);
    try {
      const nextOffset = displayMarketSkills.length;
      const remainingBudget = Math.max(0, MAX_TOTAL_SKILLS - nextOffset);
      if (remainingBudget < pageSize) {
        setHasMore(false);
        return;
      }
      // Fetch one extra item so an exhausted result set is detected without an
      // extra request (no next page → stop scroll loading).
      const fetchBatch = pageSize + 1;
      const skillList = await fetchSkills(searchQuery || undefined, fetchBatch, nextOffset);
      if (requestId !== marketRequestIdRef.current || !capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      if (skillList.length === 0) {
        setHasMore(false);
        return;
      }
      const displaySkills = skillList.slice(0, pageSize);
      const existingIds = new Set(marketSkills.map((s) => s.installId));
      const added = displaySkills.filter((s) => !existingIds.has(s.installId));
      if (added.length === 0) {
        setHasMore(false);
        return;
      }
      setMarketSkills((prev) => [...prev, ...added]);
      setHasMore(skillList.length > pageSize);
      setLoadMoreError(false);
    } catch (err) {
      if (requestId !== marketRequestIdRef.current || !capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      log.error('Failed to load more skills', err);
      setLoadMoreError(true);
    } finally {
      if (requestId === marketRequestIdRef.current && capabilityIsCurrent(capabilityEpoch)) {
        setLoadingMore(false);
      }
    }
  }, [capabilityIsCurrent, currentCapabilityEpoch, displayMarketSkills.length, fetchSkills, hasMore, loadingMore, marketLoading, marketSkills, pageSize, searchQuery]);

  const handleDownload = useCallback(async (skill: SkillMarketItem, targetLevel: SkillLevel = 'project') => {
    const capabilityEpoch = currentCapabilityEpoch();
    if (capabilityEpoch === null) {
      return;
    }

    const resolvedLevel: SkillLevel = isRemoteWorkspace ? 'user' : targetLevel;
    // Block project-level install when the active workspace is the assistant
    // workspace — it would land in the assistant dir and "disappear" when the
    // workspace switches. User must open a real project first (no auto-fallback).
    if (resolvedLevel === 'project' && (!hasWorkspace || isAssistantWorkspace)) {
      notification.warning(t('messages.noWorkspace'));
      return;
    }

    // Block install: a same-level skill with this dirName already exists.
    // Cross-level installs land in a different directory and are allowed.
    const atIdx = skill.installId.lastIndexOf('@');
    const subdir = atIdx < 0 ? skill.installId : skill.installId.slice(atIdx + 1);
    const slashIdx = subdir.lastIndexOf('/');
    const dirName = slashIdx < 0 ? subdir : subdir.slice(slashIdx + 1);
    const conflictSet = resolvedLevel === 'user'
      ? installedDirNamesByLevel.user
      : installedDirNamesByLevel.project;
    if (conflictSet.has(dirName) && !isMarketSkillInstalled(skill)) {
      notification.error(t('messages.nameConflict', { name: skill.name }));
      return;
    }

    try {
      setDownloadingPackage(skill.installId);
      const result = await configAPI.downloadSkillMarket({
        packageId: skill.installId,
        level: resolvedLevel,
        workspacePath: resolvedLevel === 'project' ? workspacePath || undefined : undefined,
      });
      if (!capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      const installedName = result.installedSkills[0] ?? skill.name;
      notification.success(t('messages.marketDownloadSuccess', { name: installedName }));
      await onInstalledChanged?.();
    } catch (err) {
      if (!capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      notification.error(
        t('messages.marketDownloadFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      if (capabilityIsCurrent(capabilityEpoch)) {
        setDownloadingPackage(null);
      }
    }
  }, [capabilityIsCurrent, currentCapabilityEpoch, hasWorkspace, installedDirNamesByLevel, isAssistantWorkspace, isMarketSkillInstalled, isRemoteWorkspace, notification, onInstalledChanged, t, workspacePath]);

  const retryLoadMore = useCallback(() => {
    setLoadMoreError(false);
    void goToNextPage();
  }, [goToNextPage]);

  return {
    marketSkills: displayMarketSkills,
    marketLoading,
    loadingMore,
    loadMoreError,
    marketError,
    downloadingPackage,
    hasMore,
    refresh,
    goToNextPage,
    retryLoadMore,
    handleDownload,
    hasWorkspace,
    isRemoteWorkspace,
    isAssistantWorkspace,
    totalLoaded: displayMarketSkills.length,
  };
}
