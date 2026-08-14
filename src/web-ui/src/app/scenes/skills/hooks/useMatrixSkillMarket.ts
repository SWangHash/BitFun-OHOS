import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matrixSkillAPI } from '@/infrastructure/api';
import type {
  MatrixSkillSummary,
  MatrixSkillsListRequest,
  MatrixSkillsPage,
  MatrixTag,
} from '@/infrastructure/api/service-api/MatrixSkillAPI';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useMatrixSkillMarket');

function extractErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const obj = err as Record<string, unknown>;
  if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
  if (typeof obj.kind === 'string') return `Matrix API error: ${obj.kind}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

const DEFAULT_PAGE_SIZE = 15;

interface UseMatrixSkillMarketOptions {
  enabled?: boolean;
  onInstalledChanged?: () => Promise<void> | void;
}

interface MatrixListState {
  tags: MatrixTag[];
  tagsLoading: boolean;
  tagsError: string | null;
  selectedTagIds: string[];
  toggleTag: (tagId: string) => void;
  clearTags: () => void;

  keyword: string;
  setKeyword: (value: string) => void;
  submitKeyword: () => void;

  skills: MatrixSkillSummary[];
  totalCount: number;
  skillsLoading: boolean;
  loadingMore: boolean;
  skillsError: string | null;

  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  goToPrevPage: () => void;
  goToNextPage: () => Promise<void>;

  installingEnName: string | null;
  installError: string | null;
  handleInstall: (skill: MatrixSkillSummary) => Promise<void>;

  refresh: () => Promise<void>;
}

export function useMatrixSkillMarket({
  enabled = true,
  onInstalledChanged,
}: UseMatrixSkillMarketOptions): MatrixListState {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();

  const [tags, setTags] = useState<MatrixTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const [page, setPage] = useState<MatrixSkillsPage | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(0);

  const [installingEnName, setInstallingEnName] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  // Separate request ID refs for tags and skills to prevent parallel calls
  // from invalidating each other's responses.
  const tagsRequestIdRef = useRef(0);
  const skillsRequestIdRef = useRef(0);
  const pageSize = DEFAULT_PAGE_SIZE;

  const loadTags = useCallback(async () => {
    if (!enabled) {
      setTags([]);
      setTagsLoading(false);
      return;
    }
    const requestId = ++tagsRequestIdRef.current;
    setTagsLoading(true);
    setTagsError(null);
    try {
      log.info('Loading Matrix tags');
      const result = await matrixSkillAPI.listTags('skill');
      if (requestId !== tagsRequestIdRef.current) {
        log.info('Matrix tags response discarded (stale request)');
        return;
      }
      log.info('Matrix tags loaded', { count: result.length });
      setTags(result);
    } catch (err) {
      if (requestId !== tagsRequestIdRef.current) {
        return;
      }
      const msg = extractErrorMessage(err);
      log.error('Failed to load Matrix tags', { error: msg, raw: err });
      setTagsError(msg);
    } finally {
      if (requestId === tagsRequestIdRef.current) {
        setTagsLoading(false);
      }
    }
  }, [enabled]);

  const loadSkillsPage = useCallback(
    async (targetPage: number) => {
      if (!enabled) {
        setPage(null);
        setSkillsLoading(false);
        setSkillsError(null);
        return;
      }
      const requestId = ++skillsRequestIdRef.current;
      const request: MatrixSkillsListRequest = {
        pageNum: String(targetPage + 1),
        pageSize: String(pageSize),
        keyword: submittedKeyword.trim() || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      };
      setSkillsLoading(true);
      setSkillsError(null);
      try {
        log.info('Loading Matrix skills', { page: targetPage + 1, request });
        const result = await matrixSkillAPI.listSkills(request);
        if (requestId !== skillsRequestIdRef.current) {
          log.info('Matrix skills response discarded (stale request)');
          return;
        }
        log.info('Matrix skills loaded', {
          page: targetPage + 1,
          count: result.count,
          returned: result.list.length,
        });
        setPage(result);
      } catch (err) {
        if (requestId !== skillsRequestIdRef.current) {
          return;
        }
        const msg = extractErrorMessage(err);
        log.error('Failed to load Matrix skills', { error: msg, raw: err });
        setSkillsError(msg);
      } finally {
        if (requestId === skillsRequestIdRef.current) {
          setSkillsLoading(false);
        }
      }
    },
    [enabled, pageSize, submittedKeyword, selectedTagIds],
  );

  useEffect(() => {
    if (!enabled) {
      setTags([]);
      setPage(null);
      setCurrentPage(0);
      setSkillsLoading(false);
      setSkillsError(null);
      setTagsError(null);
      setInstallingEnName(null);
      setInstallError(null);
      return;
    }
    void loadTags();
  }, [enabled, loadTags]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadSkillsPage(currentPage);
  }, [enabled, currentPage, loadSkillsPage]);

  const skills = useMemo(() => page?.list ?? [], [page]);
  const totalCount = page?.count ?? 0;
  // hasMore: there are more pages beyond the current one
  const hasMore = (currentPage + 1) * pageSize < totalCount;
  const loadingMore = false;

  const totalPages = useMemo(() => {
    if (totalCount === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) {
        return prev.filter((id) => id !== tagId);
      }
      return [...prev, tagId];
    });
    setCurrentPage(0);
  }, []);

  const clearTags = useCallback(() => {
    setSelectedTagIds([]);
    setCurrentPage(0);
  }, []);

  const submitKeyword = useCallback(() => {
    setSubmittedKeyword(keyword);
    setCurrentPage(0);
  }, [keyword]);

  const goToPrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(0, p - 1));
  }, []);

  const goToNextPage = useCallback(async () => {
    if (!hasMore) {
      return;
    }
    setCurrentPage((p) => p + 1);
  }, [hasMore]);

  const handleInstall = useCallback(
    async (skill: MatrixSkillSummary) => {
      if (!enabled || !skill.enName) {
        return;
      }
      try {
        setInstallError(null);
        setInstallingEnName(skill.enName);
        log.info('Installing Matrix skill', { enName: skill.enName });
        const result = await matrixSkillAPI.installSkill(skill.enName);
        log.info('Matrix skill installed', { enName: skill.enName, path: result.installPath });
        notification.success(
          t('matrix.messages.installSuccess', { name: skill.enName, path: result.installPath }),
        );
        await onInstalledChanged?.();
      } catch (err) {
        const message = extractErrorMessage(err);
        console.error('[Matrix] Install failed:', { enName: skill.enName, rawError: err, extractedMessage: message });
        log.error('Failed to install Matrix skill', { enName: skill.enName, error: message, raw: err });
        setInstallError(String(message || 'Unknown install error'));
        notification.error(
          t('matrix.messages.installFailed', { name: skill.enName, error: String(message || 'Unknown error') }),
        );
      } finally {
        setInstallingEnName(null);
      }
    },
    [enabled, notification, onInstalledChanged, t],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadTags(), loadSkillsPage(currentPage)]);
  }, [loadTags, loadSkillsPage, currentPage]);

  return {
    tags,
    tagsLoading,
    tagsError,
    selectedTagIds,
    toggleTag,
    clearTags,
    keyword,
    setKeyword,
    submitKeyword,
    skills,
    totalCount,
    skillsLoading,
    loadingMore,
    skillsError,
    currentPage,
    totalPages,
    hasMore,
    goToPrevPage,
    goToNextPage,
    installingEnName,
    installError,
    handleInstall,
    refresh,
  };
}
