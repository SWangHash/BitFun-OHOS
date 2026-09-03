import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matrixSkillAPI } from '@/infrastructure/api';
import type {
  MatrixCategoryItem,
  MatrixSidebarItem,
  MatrixSkillSummary,
  MatrixSkillsListRequest,
  MatrixTag,
} from '@/infrastructure/api/service-api/MatrixSkillAPI';
import type { SkillLevel } from '@/infrastructure/config/types';
import { useWorkspaceManagerSync } from '@/infrastructure/hooks/useWorkspaceManagerSync';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useMatrixSkillMarket');

const EMPTY_INSTALLED_SET: Set<string> = new Set();

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

const DEFAULT_PAGE_SIZE = 12;

export type MatrixSection = 'feature' | 'tag' | 'cat' | 'org';

interface UseMatrixSkillMarketOptions {
  enabled?: boolean;
  installedEnNames?: Set<string>;
  onInstalledChanged?: () => Promise<void> | void;
}

interface MatrixListState {
  tags: MatrixTag[];
  tagsLoading: boolean;
  tagsError: string | null;
  selectedTagIds: string[];
  toggleTag: (tagId: string) => void;
  clearTags: () => void;

  categories: MatrixCategoryItem[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  selectedCategoryId: string | null;
  toggleCategory: (categoryId: string) => void;

  organizations: MatrixSidebarItem[];
  organizationsLoading: boolean;
  organizationsError: string | null;
  selectedOrgId: string | null;
  toggleOrganization: (orgId: string) => void;

  activeSection: MatrixSection;
  selectSection: (section: MatrixSection) => void;

  keyword: string;
  setKeyword: (value: string) => void;
  submitKeyword: () => void;

  skills: MatrixSkillSummary[];
  totalCount: number;
  skillsLoading: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  skillsError: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  retryLoadMore: () => void;

  installingEnName: string | null;
  installError: string | null;
  handleInstall: (skill: MatrixSkillSummary, targetLevel?: SkillLevel) => Promise<void>;

  hasWorkspace: boolean;
  isRemoteWorkspace: boolean;
  isAssistantWorkspace: boolean;

  refresh: () => Promise<void>;
}

export function useMatrixSkillMarket({
  enabled = true,
  installedEnNames = EMPTY_INSTALLED_SET,
  onInstalledChanged,
}: UseMatrixSkillMarketOptions): MatrixListState {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const { hasWorkspace, workspacePath, isRemoteWorkspace, isAssistantWorkspace } = useWorkspaceManagerSync();

  const [tags, setTags] = useState<MatrixTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const [categories, setCategories] = useState<MatrixCategoryItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<MatrixSidebarItem[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<MatrixSection>('feature');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const keywordRef = useRef('');

  const [skills, setSkills] = useState<MatrixSkillSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [installingEnName, setInstallingEnName] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const tagsRequestIdRef = useRef(0);
  const categoriesRequestIdRef = useRef(0);
  const organizationsRequestIdRef = useRef(0);
  const skillsRequestIdRef = useRef(0);
  const skillsLoadingRef = useRef(false);
  const skillsLoadingMoreRef = useRef(false);
  const fetchedCountRef = useRef(0);
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

  const loadCategories = useCallback(async () => {
    if (!enabled) {
      setCategories([]);
      setCategoriesLoading(false);
      return;
    }
    const requestId = ++categoriesRequestIdRef.current;
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      log.info('Loading Matrix categories');
      const result = await matrixSkillAPI.listCategories();
      if (requestId !== categoriesRequestIdRef.current) {
        log.info('Matrix categories response discarded (stale request)');
        return;
      }
      log.info('Matrix categories loaded', { count: result.length });
      const sorted = [...result].sort(
        (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER),
      );
      setCategories(sorted);
    } catch (err) {
      if (requestId !== categoriesRequestIdRef.current) {
        return;
      }
      const msg = extractErrorMessage(err);
      log.error('Failed to load Matrix categories', { error: msg, raw: err });
      setCategoriesError(msg);
    } finally {
      if (requestId === categoriesRequestIdRef.current) {
        setCategoriesLoading(false);
      }
    }
  }, [enabled]);

  const loadOrganizations = useCallback(async () => {
    if (!enabled) {
      setOrganizations([]);
      setOrganizationsLoading(false);
      return;
    }
    const requestId = ++organizationsRequestIdRef.current;
    setOrganizationsLoading(true);
    setOrganizationsError(null);
    try {
      log.info('Loading Matrix organizations');
      const result = await matrixSkillAPI.listOrganizations({
        keyword: '',
        pageNum: 1,
        pageSize: 1000,
      });
      if (requestId !== organizationsRequestIdRef.current) {
        log.info('Matrix organizations response discarded (stale request)');
        return;
      }
      const filtered = result.list.filter(
        (item) => item.enName !== 'Other' && item.enName !== '',
      );
      log.info('Matrix organizations loaded', { count: filtered.length });
      setOrganizations(filtered);
    } catch (err) {
      if (requestId !== organizationsRequestIdRef.current) {
        return;
      }
      const msg = extractErrorMessage(err);
      log.error('Failed to load Matrix organizations', { error: msg, raw: err });
      setOrganizationsError(msg);
    } finally {
      if (requestId === organizationsRequestIdRef.current) {
        setOrganizationsLoading(false);
      }
    }
  }, [enabled]);

  const loadFirstPage = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const requestId = ++skillsRequestIdRef.current;
    const request: MatrixSkillsListRequest = {
      pageNum: '1',
      pageSize: String(pageSize),
      keyword: submittedKeyword.trim() || undefined,
      isFeatured: activeSection === 'feature' ? true : undefined,
      tagIds: activeSection === 'tag' && selectedTagIds.length > 0 ? selectedTagIds : undefined,
      categoryId: activeSection === 'cat' && selectedCategoryId ? selectedCategoryId : undefined,
      orgId: activeSection === 'org' && selectedOrgId ? selectedOrgId : undefined,
    };
    fetchedCountRef.current = 0;
    setSkills([]);
    setTotalCount(0);
    setHasMore(false);
    setLoadMoreError(false);
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      log.info('Loading Matrix skills first page', { section: activeSection, request });
      const result = await matrixSkillAPI.listSkills(request);
      if (requestId !== skillsRequestIdRef.current) {
        log.info('Matrix skills response discarded (stale request)');
        return;
      }
      log.info('Matrix skills loaded', {
        page: 1,
        count: result.count,
        returned: result.list.length,
      });
      setSkills(result.list);
      setTotalCount(result.count);
      setHasMore(result.list.length >= pageSize);
      fetchedCountRef.current = result.list.length;
    } catch (err) {
      if (requestId !== skillsRequestIdRef.current) {
        return;
      }
      const msg = extractErrorMessage(err);
      log.error('Failed to load Matrix skills', { error: msg, raw: err });
      setSkillsError('matrix.errors.loadFailed');
    } finally {
      if (requestId === skillsRequestIdRef.current) {
        setSkillsLoading(false);
      }
    }
  }, [enabled, pageSize, submittedKeyword, activeSection, selectedTagIds, selectedCategoryId, selectedOrgId]);

  const loadMoreSkills = useCallback(async () => {
    if (!enabled || skillsLoadingRef.current || skillsLoadingMoreRef.current || loadMoreError || !hasMore) {
      return;
    }
    const requestId = ++skillsRequestIdRef.current;
    const request: MatrixSkillsListRequest = {
      pageNum: String(Math.floor(fetchedCountRef.current / pageSize) + 1),
      pageSize: String(pageSize),
      keyword: submittedKeyword.trim() || undefined,
      isFeatured: activeSection === 'feature' ? true : undefined,
      tagIds: activeSection === 'tag' && selectedTagIds.length > 0 ? selectedTagIds : undefined,
      categoryId: activeSection === 'cat' && selectedCategoryId ? selectedCategoryId : undefined,
      orgId: activeSection === 'org' && selectedOrgId ? selectedOrgId : undefined,
    };
    skillsLoadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      log.info('Loading more Matrix skills', { section: activeSection, request });
      const result = await matrixSkillAPI.listSkills(request);
      if (requestId !== skillsRequestIdRef.current) {
        log.info('Matrix skills response discarded (stale request)');
        return;
      }
      log.info('Matrix skills loaded', {
        page: Math.floor(fetchedCountRef.current / pageSize) + 1,
        count: result.count,
        returned: result.list.length,
      });
      fetchedCountRef.current += result.list.length;
      setSkills((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const fresh = result.list.filter((s) => !seen.has(s.id));
        return [...prev, ...fresh];
      });
      setTotalCount(result.count);
      setHasMore(result.list.length >= pageSize);
      setLoadMoreError(false);
    } catch (err) {
      if (requestId !== skillsRequestIdRef.current) {
        return;
      }
      const msg = extractErrorMessage(err);
      log.error('Failed to load more Matrix skills', { error: msg, raw: err });
      setLoadMoreError(true);
    } finally {
      if (requestId === skillsRequestIdRef.current) {
        skillsLoadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [enabled, hasMore, loadMoreError, pageSize, submittedKeyword, activeSection, selectedTagIds, selectedCategoryId, selectedOrgId]);

  useEffect(() => {
    if (!enabled) {
      setTags([]);
      setCategories([]);
      setOrganizations([]);
      setSkills([]);
      setTotalCount(0);
      setHasMore(false);
      setSkillsLoading(false);
      setLoadingMore(false);
      setLoadMoreError(false);
      setSkillsError(null);
      setTagsError(null);
      setCategoriesError(null);
      setOrganizationsError(null);
      setInstallingEnName(null);
      setInstallError(null);
      setActiveSection('feature');
      setSelectedTagIds([]);
      setSelectedCategoryId(null);
      setSelectedOrgId(null);
      setKeyword('');
      keywordRef.current = '';
      setSubmittedKeyword('');
      fetchedCountRef.current = 0;
      return;
    }
    void Promise.all([loadTags(), loadCategories(), loadOrganizations()]);
  }, [enabled, loadTags, loadCategories, loadOrganizations]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadFirstPage();
  }, [enabled, loadFirstPage]);

  const sortedSkills = useMemo(() => {
    const entries = skills.map((skill, index) => ({
      skill,
      index,
      installed: installedEnNames.has(skill.enName),
    }));
    entries.sort((a, b) => {
      if (a.installed !== b.installed) {
        return a.installed ? -1 : 1;
      }
      const downloadDelta = (b.skill.download ?? 0) - (a.skill.download ?? 0);
      if (downloadDelta !== 0) {
        return downloadDelta;
      }
      return a.index - b.index;
    });
    return entries.map((entry) => entry.skill);
  }, [skills, installedEnNames]);

  const selectSection = useCallback((section: MatrixSection) => {
    setSelectedTagIds([]);
    setSelectedCategoryId(null);
    setSelectedOrgId(null);
    setActiveSection(section);
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) {
        return prev.filter((id) => id !== tagId);
      }
      return [...prev, tagId];
    });
  }, []);

  const clearTags = useCallback(() => {
    setSelectedTagIds([]);
  }, []);

  const toggleCategory = useCallback((categoryId: string) => {
    setSelectedCategoryId((prev) => (prev === categoryId ? null : categoryId));
  }, []);

  const toggleOrganization = useCallback((orgId: string) => {
    setSelectedOrgId((prev) => (prev === orgId ? null : orgId));
  }, []);

  const updateKeyword = useCallback((value: string) => {
    keywordRef.current = value;
    setKeyword(value);
    if (value.trim() === '') {
      setSubmittedKeyword('');
    }
  }, []);

  const submitKeyword = useCallback(() => {
    setSubmittedKeyword(keywordRef.current.trim());
  }, []);

  const handleInstall = useCallback(
    async (skill: MatrixSkillSummary, targetLevel: SkillLevel = 'project') => {
      if (!enabled || !skill.enName) {
        return;
      }
      const resolvedLevel: SkillLevel = isRemoteWorkspace ? 'user' : targetLevel;
      if (resolvedLevel === 'project' && (!hasWorkspace || isAssistantWorkspace)) {
        notification.warning(t('messages.noWorkspace'));
        return;
      }
      try {
        setInstallError(null);
        setInstallingEnName(skill.enName);
        log.info('Installing Matrix skill', { enName: skill.enName, level: resolvedLevel });
        const result = await matrixSkillAPI.installSkill(
          skill.enName,
          resolvedLevel,
          resolvedLevel === 'project' ? workspacePath || undefined : undefined,
        );
        log.info('Matrix skill installed', { enName: skill.enName, path: result.installPath });
        notification.success(
          t('matrix.messages.installSuccess', { name: skill.enName, path: result.installPath }),
        );
        await onInstalledChanged?.();
      } catch (err) {
        const message = extractErrorMessage(err);
        log.error('Failed to install Matrix skill', { enName: skill.enName, error: message, raw: err });
        setInstallError(t('matrix.messages.installFailed', { name: skill.enName, error: String(message || 'Unknown error') }));
        notification.error(
          t('matrix.messages.installFailed', { name: skill.enName, error: String(message || 'Unknown error') }),
        );
      } finally {
        setInstallingEnName(null);
      }
    },
    [enabled, notification, onInstalledChanged, t, isRemoteWorkspace, hasWorkspace, isAssistantWorkspace, workspacePath],
  );

  const retryLoadMore = useCallback(() => {
    setLoadMoreError(false);
    void loadMoreSkills();
  }, [loadMoreSkills]);

  const refresh = useCallback(async () => {
    await Promise.all([
      loadTags(),
      loadCategories(),
      loadOrganizations(),
      loadFirstPage(),
    ]);
  }, [loadTags, loadCategories, loadOrganizations, loadFirstPage]);

  return {
    tags,
    tagsLoading,
    tagsError,
    selectedTagIds,
    toggleTag,
    clearTags,
    categories,
    categoriesLoading,
    categoriesError,
    selectedCategoryId,
    toggleCategory,
    organizations,
    organizationsLoading,
    organizationsError,
    selectedOrgId,
    toggleOrganization,
    activeSection,
    selectSection,
    keyword,
    setKeyword: updateKeyword,
    submitKeyword,
    skills: sortedSkills,
    totalCount,
    skillsLoading,
    loadingMore,
    loadMoreError,
    skillsError,
    hasMore,
    loadMore: loadMoreSkills,
    retryLoadMore,
    installingEnName,
    installError,
    handleInstall,
    hasWorkspace,
    isRemoteWorkspace,
    isAssistantWorkspace,
    refresh,
  };
}
