import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matrixSkillAPI } from '@/infrastructure/api';
import type {
  MatrixCategoryItem,
  MatrixSidebarItem,
  MatrixSkillSummary,
  MatrixSkillsListRequest,
  MatrixSkillsPage,
  MatrixTag,
} from '@/infrastructure/api/service-api/MatrixSkillAPI';
import type { SkillLevel } from '@/infrastructure/config/types';
import { useWorkspaceManagerSync } from '@/infrastructure/hooks/useWorkspaceManagerSync';
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

export type MatrixSection = 'feature' | 'tag' | 'cat' | 'org';

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
  skillsError: string | null;

  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  goToPrevPage: () => void;
  goToNextPage: () => Promise<void>;

  installingEnName: string | null;
  installError: string | null;
  handleInstall: (skill: MatrixSkillSummary, targetLevel?: SkillLevel) => Promise<void>;

  hasWorkspace: boolean;
  isRemoteWorkspace: boolean;

  refresh: () => Promise<void>;
}

export function useMatrixSkillMarket({
  enabled = true,
  onInstalledChanged,
}: UseMatrixSkillMarketOptions): MatrixListState {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const { hasWorkspace, workspacePath, isRemoteWorkspace } = useWorkspaceManagerSync();

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

  const [page, setPage] = useState<MatrixSkillsPage | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(0);

  const [installingEnName, setInstallingEnName] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const tagsRequestIdRef = useRef(0);
  const categoriesRequestIdRef = useRef(0);
  const organizationsRequestIdRef = useRef(0);
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
        isFeatured: activeSection === 'feature' ? true : undefined,
        tagIds: activeSection === 'tag' && selectedTagIds.length > 0 ? selectedTagIds : undefined,
        categoryId: activeSection === 'cat' && selectedCategoryId ? selectedCategoryId : undefined,
        orgId: activeSection === 'org' && selectedOrgId ? selectedOrgId : undefined,
      };
      setSkillsLoading(true);
      setSkillsError(null);
      try {
        log.info('Loading Matrix skills', { page: targetPage + 1, section: activeSection, request });
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
    [enabled, pageSize, submittedKeyword, activeSection, selectedTagIds, selectedCategoryId, selectedOrgId],
  );

  useEffect(() => {
    if (!enabled) {
      setTags([]);
      setCategories([]);
      setOrganizations([]);
      setPage(null);
      setCurrentPage(0);
      setSkillsLoading(false);
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
      return;
    }
    void Promise.all([loadTags(), loadCategories(), loadOrganizations()]);
  }, [enabled, loadTags, loadCategories, loadOrganizations]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadSkillsPage(currentPage);
  }, [enabled, currentPage, loadSkillsPage]);

  const skills = useMemo(() => page?.list ?? [], [page]);
  const totalCount = page?.count ?? 0;
  const hasMore = (currentPage + 1) * pageSize < totalCount;
  const loadingMore = false;

  const totalPages = useMemo(() => {
    if (totalCount === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  const selectSection = useCallback((section: MatrixSection) => {
    setSelectedTagIds([]);
    setSelectedCategoryId(null);
    setSelectedOrgId(null);
    setActiveSection(section);
    setCurrentPage(0);
  }, []);

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

  const toggleCategory = useCallback((categoryId: string) => {
    setSelectedCategoryId((prev) => (prev === categoryId ? null : categoryId));
    setCurrentPage(0);
  }, []);

  const toggleOrganization = useCallback((orgId: string) => {
    setSelectedOrgId((prev) => (prev === orgId ? null : orgId));
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
    async (skill: MatrixSkillSummary, targetLevel: SkillLevel = 'user') => {
      if (!enabled || !skill.enName) {
        return;
      }
      const resolvedLevel: SkillLevel = isRemoteWorkspace ? 'user' : targetLevel;
      if (resolvedLevel === 'project' && !hasWorkspace) {
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
        setInstallError(String(message || 'Unknown install error'));
        notification.error(
          t('matrix.messages.installFailed', { name: skill.enName, error: String(message || 'Unknown error') }),
        );
      } finally {
        setInstallingEnName(null);
      }
    },
    [enabled, notification, onInstalledChanged, t, isRemoteWorkspace, hasWorkspace, workspacePath],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      loadTags(),
      loadCategories(),
      loadOrganizations(),
      loadSkillsPage(currentPage),
    ]);
  }, [loadTags, loadCategories, loadOrganizations, loadSkillsPage, currentPage]);

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
    hasWorkspace,
    isRemoteWorkspace,
    refresh,
  };
}
