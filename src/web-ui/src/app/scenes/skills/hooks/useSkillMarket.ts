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

interface UseSkillMarketOptions {
  searchQuery: string;
  installedSkillNames: Set<string>;
  onInstalledChanged?: () => Promise<void> | void;
  pageSize?: number;
  enabled?: boolean;
}

export function useSkillMarket({
  searchQuery,
  installedSkillNames,
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
  const [marketError, setMarketError] = useState<string | null>(null);
  const [downloadingPackage, setDownloadingPackage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
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
    setCurrentPage(0);
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
      setCurrentPage(0);
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
      installed: installedSkillNames.has(skill.name),
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
  }, [installedSkillNames, marketSkills]);

  const loadedPages = Math.ceil(displayMarketSkills.length / pageSize);
  const totalPages = hasMore ? loadedPages + 1 : Math.max(1, loadedPages);

  const paginatedSkills = useMemo(() => displayMarketSkills.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  ), [currentPage, displayMarketSkills, pageSize]);

  const goToPrevPage = useCallback(() => {
    if (currentCapabilityEpoch() === null) {
      return;
    }
    setCurrentPage((page) => Math.max(0, page - 1));
  }, [currentCapabilityEpoch]);

  const goToNextPage = useCallback(async () => {
    const capabilityEpoch = currentCapabilityEpoch();
    if (capabilityEpoch === null) {
      return;
    }

    const nextPage = currentPage + 1;
    const nextOffset = nextPage * pageSize;

    // If the next page is already loaded locally, just advance the view.
    if (displayMarketSkills.length >= nextOffset + pageSize) {
      setCurrentPage(nextPage);
      return;
    }

    if (!hasMore) {
      return;
    }

    const requestId = ++marketRequestIdRef.current;
    try {
      setLoadingMore(true);
      const remainingBudget = Math.max(0, MAX_TOTAL_SKILLS - displayMarketSkills.length);
      if (remainingBudget < pageSize) {
        setHasMore(false);
        return;
      }
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

      const updatedTotal = marketSkills.length + added.length;
      if (nextPage * pageSize >= updatedTotal) {
        setHasMore(false);
        return;
      }

      setCurrentPage(nextPage);
      const itemsOnThisPage = Math.min(pageSize, updatedTotal - nextPage * pageSize);
      setHasMore(itemsOnThisPage >= pageSize && skillList.length > pageSize);
    } catch (err) {
      if (requestId !== marketRequestIdRef.current || !capabilityIsCurrent(capabilityEpoch)) {
        return;
      }
      log.error('Failed to load more skills', err);
      notification.error(t('market.errors.loadMoreFailed'));
    } finally {
      if (requestId === marketRequestIdRef.current && capabilityIsCurrent(capabilityEpoch)) {
        setLoadingMore(false);
      }
    }
  }, [capabilityIsCurrent, currentCapabilityEpoch, currentPage, displayMarketSkills.length, fetchSkills, hasMore, notification, pageSize, searchQuery, t]);

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
  }, [capabilityIsCurrent, currentCapabilityEpoch, hasWorkspace, isAssistantWorkspace, isRemoteWorkspace, notification, onInstalledChanged, t, workspacePath]);

  return {
    marketSkills: paginatedSkills,
    marketLoading,
    loadingMore,
    marketError,
    downloadingPackage,
    hasMore,
    currentPage,
    totalPages,
    refresh,
    goToPrevPage,
    goToNextPage,
    handleDownload,
    hasWorkspace,
    isRemoteWorkspace,
    isAssistantWorkspace,
    totalLoaded: displayMarketSkills.length,
  };
}
