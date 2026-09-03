import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  FolderOpen,
  Layers,
  Loader2,
  Package,
  Plus,
  Puzzle,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, ConfirmDialog, Input, Modal, Search, Select, Switch } from '@/component-library';
import { GalleryDetailModal } from '@/app/components';
import type { SkillInfo, SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import type { MatrixSkillSummary } from '@/infrastructure/api/service-api/MatrixSkillAPI';
import {
  buildSkillCoverageSourceMap,
  canDeleteSkill,
  findSkillByKey,
  getSkillSourceLabel,
} from '@/infrastructure/config/skillSourcePresentation';
import { workspaceAPI } from '@/infrastructure/api';
import { usePeerDeviceModeOptional } from '@/infrastructure/peer-device/peerDeviceContextState';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useNotification } from '@/shared/notification-system';
import { isRemoteWorkspace } from '@/shared/types';
import { createLogger } from '@/shared/utils/logger';
import { getCardGradient } from '@/shared/utils/cardGradients';
import { useInstalledSkills } from './hooks/useInstalledSkills';
import { useSkillMarket } from './hooks/useSkillMarket';
import { useMatrixSkillMarket } from './hooks/useMatrixSkillMarket';
import SkillCard from './components/SkillCard';
import SkillsLoadMoreSentinel from './components/SkillsLoadMoreSentinel';
import SkillsSuiteView from './components/SkillsSuiteView';
import MatrixMarketView from './components/MatrixMarketView';
import './SkillsScene.scss';
import { useSkillsSceneStore, type InstalledFilter } from './skillsSceneStore';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';

const log = createLogger('SkillsScene');

function formatDisplayPath(path: string): string {
  return path.replace(
    '/data/storage/el2/base/files/bitfun',
    '/storage/Users/currentUser/appdata/el2/base/com.develop.opensource.ohpcd.bitfun/files/bitfun'
  );
}
type SkillTab = 'installed' | 'discover' | 'matrix';

const INSTALLED_PAGE_SIZE = 12;

interface CategoryInfo {
  id: InstalledFilter;
  icon: React.ReactNode;
  labelKey: string;
  descKey: string;
}

const CATEGORIES: CategoryInfo[] = [
  { id: 'all', icon: <Layers size={15} strokeWidth={1.6} />, labelKey: 'filters.all', descKey: 'categories.all' },
  { id: 'builtin', icon: <ShieldCheck size={15} strokeWidth={1.6} />, labelKey: 'filters.builtin', descKey: 'categories.builtin' },
  { id: 'user', icon: <User size={15} strokeWidth={1.6} />, labelKey: 'filters.user', descKey: 'categories.user' },
  { id: 'project', icon: <FolderOpen size={15} strokeWidth={1.6} />, labelKey: 'filters.project', descKey: 'categories.project' },
  { id: 'suite', icon: <Zap size={15} strokeWidth={1.6} />, labelKey: 'filters.suite', descKey: 'categories.suite' },
];

const SkillsScene: React.FC = () => {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const peerDevice = usePeerDeviceModeOptional();
  const remoteConnectionActive = peerDevice?.peerMode.active === true;
  const desktopConfigAvailable = isTauriRuntime() && !remoteConnectionActive;
  const {
    searchDraft,
    marketQuery,
    installedFilter,
    hideDuplicates,
    isAddFormOpen,
    setSearchDraft,
    submitMarketQuery,
    setInstalledFilter,
    setHideDuplicates,
    setAddFormOpen,
    toggleAddForm,
  } = useSkillsSceneStore();

  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [deleteTarget, setDeleteTarget] = useState<SkillInfo | null>(null);
  const [installedListPage, setInstalledListPage] = useState(0);
  const [installedSearch, setInstalledSearch] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<
    | { type: 'installed'; skillKey: string }
    | { type: 'market'; skill: SkillMarketItem }
    | { type: 'matrix'; skill: MatrixSkillSummary }
    | null
  >(null);

  const installed = useInstalledSkills({
    searchQuery: installedSearch,
    activeFilter: installedFilter,
    enabled: desktopConfigAvailable,
  });

  const installedSkillNames = useMemo(
    () => new Set(installed.skills.map((skill) => skill.name)),
    [installed.skills],
  );
  const installedMatrixEnNames = useMemo(
    () => new Set(
      installed.skills
        .filter((skill) => skill.sourceId === 'matrix')
        .map((skill) => skill.dirName),
    ),
    [installed.skills],
  );
  const coverageSourceBySkillKey = useMemo(
    () => buildSkillCoverageSourceMap(installed.skills, t('list.item.unknownSource')),
    [installed.skills, t],
  );
  const selectedInstalledSkill = useMemo(
    () => findSkillByKey(
      installed.skills,
      selectedDetail?.type === 'installed' ? selectedDetail.skillKey : null,
    ),
    [installed.skills, selectedDetail],
  );
  const selectedMarketSkill = selectedDetail?.type === 'market' ? selectedDetail.skill : null;
  const selectedMatrixSkill = selectedDetail?.type === 'matrix' ? selectedDetail.skill : null;

  useEffect(() => {
    if (selectedDetail?.type === 'installed' && !installed.loading && !selectedInstalledSkill) {
      setSelectedDetail(null);
    }
  }, [installed.loading, selectedDetail, selectedInstalledSkill]);

  useEffect(() => {
    if (desktopConfigAvailable) {
      return;
    }
    setActiveTab('installed');
    setAddFormOpen(false);
    setDeleteTarget(null);
    setSelectedDetail(null);
  }, [desktopConfigAvailable, setAddFormOpen]);

  const market = useSkillMarket({
    searchQuery: marketQuery,
    installedSkillNames,
    pageSize: 12,
    enabled: desktopConfigAvailable,
    onInstalledChanged: async () => {
      await installed.loadSkills(true);
    },
  });
  const matrix = useMatrixSkillMarket({
    enabled: desktopConfigAvailable,
    installedEnNames: installedMatrixEnNames,
    onInstalledChanged: async () => {
      await installed.loadSkills(true);
    },
  });
  const refetchSkillsScene = useCallback(async () => {
    await Promise.all([installed.loadSkills(true), market.refresh()]);
  }, [installed, market]);

  useGallerySceneAutoRefresh({
    sceneId: 'skills',
    refetch: refetchSkillsScene,
  });

  const canRevealSkillPath = !isRemoteWorkspace(workspaceManager.getState().currentWorkspace);

  const openExternalUrl = useCallback(async (url: string) => {
    try {
      const { systemAPI } = await import('@/infrastructure/api');
      await systemAPI.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  }, []);

  const handleRevealSkillPath = useCallback(
    async (path: string) => {
      if (!canRevealSkillPath || !path.trim()) {
        return;
      }
      try {
        await workspaceAPI.revealInExplorer(path);
      } catch (error) {
        log.error('Failed to reveal skill path in explorer', { path, error });
        notification.error(t('messages.revealPathFailed', { error: String(error) }));
      }
    },
    [canRevealSkillPath, notification, t],
  );

  const handleAddSkill = async () => {
    const added = await installed.handleAdd();
    if (added) {
      setAddFormOpen(false);
      await market.refresh();
    }
  };

  const installedFiltered = useMemo(() => {
    const list = hideDuplicates
      ? installed.filteredSkills.filter((s) => !s.isShadowed)
      : installed.filteredSkills;
    return list;
  }, [hideDuplicates, installed.filteredSkills]);

  const installedTotalPages = Math.max(
    1,
    Math.ceil(installedFiltered.length / INSTALLED_PAGE_SIZE),
  );
  const currentInstalledPage = Math.min(installedListPage, installedTotalPages - 1);
  const pagedInstalledSkills = installedFiltered.slice(
    currentInstalledPage * INSTALLED_PAGE_SIZE,
    (currentInstalledPage + 1) * INSTALLED_PAGE_SIZE,
  );

  useEffect(() => {
    setInstalledListPage(0);
  }, [installedFilter, installedSearch, hideDuplicates]);

  useEffect(() => {
    setInstalledListPage((p) => Math.min(p, Math.max(0, installedTotalPages - 1)));
  }, [installedTotalPages]);

  return (
    <div className="bitfun-skills-scene" data-testid="agent-skill-panel" data-bf-scene="skills" data-bf-part="root" data-bf-tab={activeTab}>
      <div className="skills-header" data-bf-scene="skills" data-bf-part="skillsHeader">
        <h1 className="skills-header__title">{t('skillsCenter')}</h1>
        <button
          type="button"
          className="skills-header__add-btn"
          data-testid="skills-add-btn"
          disabled={!desktopConfigAvailable}
          onClick={toggleAddForm}
        >
          <Plus size={14} />
          <span>{t('addSkill')}</span>
        </button>
      </div>
      <div className="skills-tabs-bar" data-testid="skills-tabs" data-bf-scene="skills" data-bf-part="header" data-bf-tab={activeTab}>
        <div className="skills-tabs-bar__tabs" data-bf-scene="skills" data-bf-part="tabs">
          <button
            type="button"
            className={`skills-tabs-bar__tab ${activeTab === 'installed' ? 'is-active' : ''}`}
            data-testid="skills-tab-installed"
            onClick={() => setActiveTab('installed')}
            data-bf-scene="skills"
            data-bf-part="tab"
            data-bf-tab="installed"
            data-bf-state={activeTab === 'installed' ? 'active' : undefined}
          ><span>{t('installed.titleAll')}</span></button>
          <button
            type="button"
            className={`skills-tabs-bar__tab ${activeTab === 'discover' ? 'is-active' : ''}`}
            data-testid="skills-tab-market"
            disabled={!desktopConfigAvailable}
            onClick={() => setActiveTab('discover')}
            data-bf-scene="skills"
            data-bf-part="tab"
            data-bf-tab="discover"
            data-bf-state={activeTab === 'discover' ? 'active' : undefined}
          ><span>{t('market.title')}</span></button>
          <button
            type="button"
            className={`skills-tabs-bar__tab ${activeTab === 'matrix' ? 'is-active' : ''}`}
            disabled={!desktopConfigAvailable}
            onClick={() => setActiveTab('matrix')}
          ><span>{t('matrix.tabLabel')}</span></button>
        </div>
        {desktopConfigAvailable && (
          <div className="skills-tabs-bar__actions">
            {activeTab === 'installed' && (
              <button
                type="button"
                className={`skills-main__chip-btn${hideDuplicates ? ' is-active' : ''}`}
                data-testid="skills-duplicates-chip"
                onClick={() => setHideDuplicates(!hideDuplicates)}
                data-bf-scene="skills"
                data-bf-part="filterAction"
                data-bf-state={hideDuplicates ? 'active' : undefined}
              >
                <Filter size={13} />
                <span>{t('toolbar.hideDuplicates')}</span>
              </button>
            )}
            <div className="skills-tabs-bar__search" data-bf-scene="skills" data-bf-part="sceneSearch">
              <Search
                inputTestId="skills-search-input"
                value={activeTab === 'matrix'
                  ? matrix.keyword
                  : activeTab === 'discover'
                    ? searchDraft
                    : installedSearch}
                onChange={activeTab === 'matrix'
                  ? matrix.setKeyword
                  : activeTab === 'discover'
                    ? setSearchDraft
                    : setInstalledSearch}
                onSearch={activeTab === 'discover'
                  ? submitMarketQuery
                  : activeTab === 'matrix'
                    ? matrix.submitKeyword
                    : undefined}
                onClear={activeTab === 'discover'
                  ? submitMarketQuery
                  : activeTab === 'matrix'
                    ? matrix.submitKeyword
                    : () => setInstalledSearch('')}
                placeholder={t('searchSkills')}
                size="small"
                clearable
                enterToSearch={activeTab !== 'installed'}
              />
            </div>
          </div>
        )}
      </div>

      <div className="skills-page" data-bf-scene="skills" data-bf-part="content" data-bf-tab={activeTab}>

        {activeTab === 'installed' && (
          <div className="skills-installed" data-bf-scene="skills" data-bf-part="installed">
            {desktopConfigAvailable && <aside className="skills-sidebar" data-bf-scene="skills" data-bf-part="sidebar">
              <nav className="skills-sidebar__nav" data-bf-scene="skills" data-bf-part="sidebarNav">
                {CATEGORIES.map((cat) => {
                  const count = installed.counts[cat.id];
                  const isEmpty = count === 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`skills-sidebar__item ${installedFilter === cat.id ? 'is-active' : ''} ${isEmpty ? 'is-empty' : ''}`}
                      data-testid={`skills-sidebar-item-${cat.id}`}
                      onClick={() => setInstalledFilter(cat.id)}
                      data-bf-scene="skills"
                      data-bf-part="sidebarItem"
                      data-bf-category={cat.id}
                      data-bf-state={[
                        installedFilter === cat.id && 'active',
                        isEmpty && 'empty',
                      ].filter(Boolean).join(' ') || undefined}
                    >
                      <span className="skills-sidebar__item-icon" data-bf-scene="skills" data-bf-part="sidebarItemIcon">{cat.icon}</span>
                      <span className="skills-sidebar__item-label" data-bf-scene="skills" data-bf-part="sidebarItemLabel">{t(cat.labelKey)}</span>
                      <span className="skills-sidebar__item-count" data-bf-scene="skills" data-bf-part="sidebarItemCount">{isEmpty ? '—' : count}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="skills-sidebar__footer" data-bf-scene="skills" data-bf-part="sidebarFooter">
                <p className="skills-sidebar__hint" data-bf-scene="skills" data-bf-part="sidebarHint">
                  {t(CATEGORIES.find((c) => c.id === installedFilter)?.descKey ?? 'categories.all')}
                </p>
              </div>
            </aside>}

            <div className="skills-main" data-bf-scene="skills" data-bf-part="main">
              {!desktopConfigAvailable ? (
                <div className="skills-main__empty" data-testid="skills-management-unavailable" data-bf-scene="skills" data-bf-part="empty">
                  <Package size={28} strokeWidth={1.2} />
                  <span>{t(remoteConnectionActive ? 'list.remoteUnavailable' : 'list.desktopUnavailable')}</span>
                </div>
              ) : installedFilter === 'suite' ? (
                <SkillsSuiteView />
              ) : (
                <>
                  {installed.loading && (
                    <div className="skills-main__loading" aria-busy="true" aria-label={t('list.loading')} data-bf-scene="skills" data-bf-part="loading">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={`ins-sk-${i}`}
                          className="skills-card-skeleton"
                          style={{ '--surface-stagger-index': i } as React.CSSProperties}
                          data-bf-scene="skills"
                          data-bf-part="skeleton"
                        />
                      ))}
                    </div>
                  )}

                  {!installed.loading && installed.error && (
                    <div className="skills-main__empty skills-main__empty--error" data-bf-scene="skills" data-bf-part="error">
                      <Package size={28} strokeWidth={1.2} />
                      <span>{t('list.loadFailed')}</span>
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => void installed.loadSkills(true)}
                      >
                        {t('list.retry')}
                      </Button>
                    </div>
                  )}

                  {!installed.loading && !installed.error && installedFiltered.length === 0 && (
                    <div className="skills-main__empty" data-testid="skill-list-empty" data-bf-scene="skills" data-bf-part="empty">
                      <Package size={28} strokeWidth={1.2} />
                      <span>
                        {installed.skills.length === 0
                          ? t('list.empty.noSkills')
                          : t('list.empty.noMatch')}
                      </span>
                    </div>
                  )}

                  {!installed.loading && !installed.error && (
                    <>
                      <div className="skills-main__grid" data-testid="skill-list" data-bf-scene="skills" data-bf-part="list">
                        {pagedInstalledSkills.map((skill, index) => {
                          const canDelete = canDeleteSkill(skill);
                          const isGloballyDisabled = skill.level === 'user'
                            && installed.globallyDisabledSkillKeys.has(skill.key);
                          return (
                            <SkillCard
                              key={skill.key}
                              data-testid={`skill-list-item-${skill.key}`}
                              data-skill-key={skill.key}
                              data-skill-id={skill.key}
                              data-skill-name={skill.name}
                              data-skill-installed="true"
                              data-skill-level={skill.level}
                              data-skill-builtin={skill.isBuiltin ? 'true' : 'false'}
                              name={skill.name}
                              description={skill.description}
                              className={[
                                skill.isShadowed && 'is-shadowed',
                                isGloballyDisabled && 'is-globally-disabled',
                              ].filter(Boolean).join(' ') || undefined}
                              style={{ '--surface-stagger-index': index } as React.CSSProperties}
                              headerRight={skill.level === 'user' ? (
                                <span
                                  className="skill-card__toggle-wrap"
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  <Switch
                                    size="small"
                                    checked={!isGloballyDisabled}
                                    loading={installed.savingGlobalSkillKey === skill.key}
                                    disabled={installed.savingGlobalSkillKey !== null}
                                    aria-label={t('list.item.globalToggleLabel', { name: skill.name })}
                                    onChange={(event) => {
                                      void installed.handleGlobalSkillToggle(skill, event.target.checked);
                                    }}
                                  />
                                </span>
                              ) : undefined}
                              leftContent={(
                                <>
                                  <Badge variant="neutral">
                                    {getSkillSourceLabel(skill, t('list.item.unknownSource'))}
                                  </Badge>
                                  <Badge variant={skill.level === 'user' ? 'info' : 'purple'}>
                                    {skill.level === 'user' ? t('list.item.user') : t('list.item.project')}
                                  </Badge>
                                  {skill.isBuiltin && (
                                    <Badge variant="accent">
                                      <ShieldCheck size={11} />
                                      {t('list.item.builtin')}
                                    </Badge>
                                  )}
                                  {skill.isShadowed && (
                                    <span title={t('list.item.shadowedTooltip', {
                                      source: coverageSourceBySkillKey.get(skill.key)
                                        ?? t('list.item.unknownSource'),
                                    })}>
                                      <Badge variant="warning">{t('list.item.shadowed')}</Badge>
                                    </span>
                                  )}
                                </>
                              )}
                              rightAction={{
                                label: t('list.item.detail'),
                                icon: <ArrowRight size={12} />,
                                onClick: () => setSelectedDetail({ type: 'installed', skillKey: skill.key }),
                              }}
                              afterAction={canDelete ? (
                                <button
                                  type="button"
                                  className="skills-card__delete"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget(skill);
                                  }}
                                  aria-label={t('list.item.deleteTooltip')}
                                  title={t('list.item.deleteTooltip')}
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : undefined}
                              onOpenDetails={() => setSelectedDetail({ type: 'installed', skillKey: skill.key })}
                            />
                          );
                        })}
                      </div>

                      {installedFiltered.length > 0 && installedTotalPages > 1 && (
                        <div className="skills-installed__pagination" data-bf-scene="skills" data-bf-part="pagination">
                          <button
                            type="button"
                            className="skills-installed__page-btn"
                            onClick={() => setInstalledListPage((p) => Math.max(0, p - 1))}
                            disabled={currentInstalledPage === 0}
                            aria-label={t('market.pagination.prev')}
                            data-bf-scene="skills"
                            data-bf-part="pageButton"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <span className="skills-installed__page-info" data-bf-scene="skills" data-bf-part="pageInfo">
                            {t('market.pagination.info', {
                              current: currentInstalledPage + 1,
                              total: installedTotalPages,
                            })}
                          </span>
                          <button
                            type="button"
                            className="skills-installed__page-btn"
                            onClick={() => setInstalledListPage((p) => Math.min(installedTotalPages - 1, p + 1))}
                            disabled={currentInstalledPage >= installedTotalPages - 1}
                            aria-label={t('market.pagination.next')}
                            data-bf-scene="skills"
                            data-bf-part="pageButton"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {desktopConfigAvailable && activeTab === 'discover' && (
          <div className="skills-discover" data-bf-scene="skills" data-bf-part="discover">
            <div className="skills-discover__content" data-bf-scene="skills" data-bf-part="discoverContent">
              {market.marketLoading && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')} data-bf-scene="skills" data-bf-part="loading">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`mkt-sk-${i}`}
                      className="skills-discover__skeleton-card"
                      style={{ '--surface-stagger-index': i } as React.CSSProperties}
                      data-bf-scene="skills"
                      data-bf-part="skeleton"
                    />
                  ))}
                </div>
              )}

              {!market.marketLoading && market.marketError && (
                <div className="skills-discover__empty skills-discover__empty--error" data-bf-scene="skills" data-bf-part="error">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{t(market.marketError)}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.marketSkills.length === 0 && (
                <div className="skills-discover__empty" data-testid="skill-list-empty" data-bf-scene="skills" data-bf-part="empty">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{marketQuery ? t('market.empty.noMatch') : t('market.empty.noSkills')}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.marketSkills.length > 0 && (
                <>
                  {marketQuery && (
                    <div className="skills-discover__results-info" data-bf-scene="skills" data-bf-part="resultsInfo">
                      <span>
                        {t('market.resultsInfo', { query: marketQuery })}
                      </span>
                    </div>
                  )}

                  <div className="skills-discover__grid" data-testid="skill-list" data-bf-scene="skills" data-bf-part="list">
                    {market.marketSkills.map((skill) => {
                      const isInstalled = installedSkillNames.has(skill.name);
                      const isDownloading = market.downloadingPackage === skill.installId;
                      return (
                        <SkillCard
                          key={skill.installId}
                          data-testid={`skills-market-card-${skill.installId}`}
                          data-skill-install-id={skill.installId}
                          data-skill-id={skill.installId}
                          data-skill-name={skill.name}
                          data-skill-installed={isInstalled ? 'true' : 'false'}
                          name={skill.name}
                          description={skill.description}
                          leftContent={(
                            <span className="skills-card__count">
                              <TrendingUp size={12} />
                              {skill.installs ?? 0}
                            </span>
                          )}
                          rightAction={{
                            label: isInstalled ? t('market.item.installed') : t('installSkill'),
                            icon: isInstalled ? <CheckCircle2 size={13} /> : <Download size={13} />,
                            disabled:
                              isDownloading
                              || !market.hasWorkspace
                              || market.isRemoteWorkspace
                              || market.isAssistantWorkspace
                              || isInstalled,
                            onClick: () => void market.handleDownload(skill, 'project'),
                          }}
                          onOpenDetails={() => setSelectedDetail({ type: 'market', skill })}
                        />
                       );
                     })}
                   </div>

                   <SkillsLoadMoreSentinel
                     active={market.hasMore && !market.loadingMore && !market.loadMoreError}
                     onLoad={() => void market.goToNextPage()}
                   />
                   {market.loadingMore && (
                     <div className="skills-load-more-row">
                       <Loader2 className="skills-load-more-spinner" size={14} />
                       <span>{t('list.loading')}</span>
                     </div>
                   )}
                   {market.loadMoreError && (
                     <div className="skills-load-more-row">
                       <span>{t('list.loadMoreFailed')}</span>
                       <button
                         type="button"
                         className="skills-load-more-retry"
                         onClick={() => market.retryLoadMore()}
                       >
                         {t('list.retry')}
                       </button>
                     </div>
                   )}
                   {!market.loadingMore && !market.loadMoreError && !market.hasMore && (
                     <div className="skills-load-more-row">
                       <span>{t('list.noMore')}</span>
                     </div>
                   )}
                 </>
               )}
             </div>
           </div>
         )}

        {desktopConfigAvailable && activeTab === 'matrix' && (
          <MatrixMarketView
            tags={matrix.tags}
            tagsLoading={matrix.tagsLoading}
            tagsError={matrix.tagsError}
            selectedTagIds={matrix.selectedTagIds}
            onToggleTag={matrix.toggleTag}
            onClearTags={matrix.clearTags}
            categories={matrix.categories}
            categoriesLoading={matrix.categoriesLoading}
            categoriesError={matrix.categoriesError}
            selectedCategoryId={matrix.selectedCategoryId}
            onToggleCategory={matrix.toggleCategory}
            organizations={matrix.organizations}
            organizationsLoading={matrix.organizationsLoading}
            organizationsError={matrix.organizationsError}
            selectedOrgId={matrix.selectedOrgId}
            onToggleOrganization={matrix.toggleOrganization}
            activeSection={matrix.activeSection}
            onSelectSection={matrix.selectSection}
            hasWorkspace={matrix.hasWorkspace}
            isRemoteWorkspace={matrix.isRemoteWorkspace}
            isAssistantWorkspace={matrix.isAssistantWorkspace}
             skills={matrix.skills}
             totalCount={matrix.totalCount}
             skillsLoading={matrix.skillsLoading}
             skillsError={matrix.skillsError}
             hasMore={matrix.hasMore}
             loadingMore={matrix.loadingMore}
             loadMoreError={matrix.loadMoreError}
             onLoadMore={() => void matrix.loadMore()}
             onRetryLoadMore={() => matrix.retryLoadMore()}
             installingEnName={matrix.installingEnName}
             onInstall={matrix.handleInstall}
            onOpenDetails={(skill) => setSelectedDetail({ type: 'matrix', skill })}
            installedEnNames={installedMatrixEnNames}
          />
        )}
      </div>

      <GalleryDetailModal
        isOpen={desktopConfigAvailable && Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        icon={selectedMarketSkill || selectedMatrixSkill ? <Package size={24} strokeWidth={1.6} /> : <Puzzle size={24} strokeWidth={1.6} />}
        iconGradient={getCardGradient(
          selectedInstalledSkill?.name
          ?? selectedMarketSkill?.installId
          ?? selectedMarketSkill?.name
          ?? selectedMatrixSkill?.id
          ?? selectedMatrixSkill?.enName
          ?? 'skill'
        )}
        title={selectedInstalledSkill?.name ?? selectedMarketSkill?.name ?? selectedMatrixSkill?.name ?? selectedMatrixSkill?.enName ?? ''}
        badges={selectedInstalledSkill ? (
          <>
            {selectedInstalledSkill.isShadowed && (
              <span title={t('list.item.shadowedTooltip', {
                source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                  ?? t('list.item.unknownSource'),
              })}>
                <Badge variant="warning">
                  <ShieldAlert size={11} />
                  {t('list.item.shadowed')}
                </Badge>
              </span>
            )}
            <Badge variant="neutral">
              {getSkillSourceLabel(selectedInstalledSkill, t('list.item.unknownSource'))}
            </Badge>
            <Badge variant={selectedInstalledSkill.isBuiltin ? 'accent' : 'success'}>
              {selectedInstalledSkill.isBuiltin ? t('list.item.builtin') : t('list.item.userInstalled')}
            </Badge>
            <Badge variant={selectedInstalledSkill.level === 'user' ? 'info' : 'purple'}>
              {market.isRemoteWorkspace
                ? selectedInstalledSkill.level === 'user'
                  ? t('list.item.localUser')
                  : t('list.item.remoteProject')
                : selectedInstalledSkill.level === 'user'
                  ? t('list.item.user')
                  : t('list.item.project')}
            </Badge>
          </>
        ) : selectedMarketSkill && installedSkillNames.has(selectedMarketSkill.name) ? (
          <Badge variant="success">
            <CheckCircle2 size={11} />
            {t('market.item.installed')}
          </Badge>
        ) : null}
        description={selectedInstalledSkill?.description ?? selectedMarketSkill?.description ?? selectedMatrixSkill?.description}
        testId="skill-detail-panel"
        titleTestId="skill-detail-title"
        descriptionTestId="skill-detail-description"
        closeButtonTestId="skill-detail-close"
        meta={selectedMarketSkill ? (
          <span className="bitfun-skills-scene__market-meta">
            <TrendingUp size={12} />
            {selectedMarketSkill.installs ?? 0}
          </span>
        ) : selectedMatrixSkill ? (
          <span className="bitfun-skills-scene__market-meta">
            <TrendingUp size={12} />
            {selectedMatrixSkill.download ?? 0}
          </span>
        ) : null}
        actions={selectedInstalledSkill && canDeleteSkill(selectedInstalledSkill) ? (
          <Button
            variant="danger"
            size="small"
            onClick={() => {
              setDeleteTarget(selectedInstalledSkill);
              setSelectedDetail(null);
            }}
          >
            <Trash2 size={14} />
            {t('deleteModal.delete')}
          </Button>
        ) : selectedMarketSkill ? (
          <>
            {installedSkillNames.has(selectedMarketSkill.name) ? (
              <Button variant="secondary" size="small" disabled>
                {t('market.item.installed')}
              </Button>
            ) : (
              <>
                {!market.isRemoteWorkspace && !market.isAssistantWorkspace && (
                  <Button
                    variant="primary"
                    size="small"
                    data-testid="skill-detail-download-project-btn"
                    onClick={() => void market.handleDownload(selectedMarketSkill, 'project')}
                    disabled={market.downloadingPackage === selectedMarketSkill.installId || !market.hasWorkspace}
                  >
                    {t('market.item.downloadProject')}
                  </Button>
                )}
                {(!market.hasWorkspace || market.isRemoteWorkspace || market.isAssistantWorkspace) && (
                  <p className="bitfun-skills-scene__modal-project-hint">
                    {t('messages.noWorkspace')}
                  </p>
                )}
                <Button
                  variant={market.isRemoteWorkspace ? 'primary' : 'secondary'}
                  size="small"
                  data-testid="skill-detail-download-user-btn"
                  onClick={() => void market.handleDownload(selectedMarketSkill, 'user')}
                  disabled={market.downloadingPackage === selectedMarketSkill.installId}
                >
                  {t('market.item.downloadUser')}
                </Button>
              </>
            )}
          </>
        ) : selectedMatrixSkill ? (
          <>
            {installedMatrixEnNames.has(selectedMatrixSkill.enName) ? (
              <Button variant="secondary" size="small" disabled>
                {t('matrix.item.installed')}
              </Button>
            ) : (
              <>
                {!matrix.isRemoteWorkspace && !matrix.isAssistantWorkspace && (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() => void matrix.handleInstall(selectedMatrixSkill, 'project')}
                    disabled={
                      matrix.installingEnName === selectedMatrixSkill.enName || !matrix.hasWorkspace
                    }
                  >
                    {matrix.installingEnName === selectedMatrixSkill.enName
                      ? t('matrix.item.installing')
                      : t('market.item.downloadProject')}
                  </Button>
                )}
                {(!matrix.hasWorkspace || matrix.isRemoteWorkspace || matrix.isAssistantWorkspace) && (
                  <p className="bitfun-skills-scene__modal-project-hint">
                    {t('messages.noWorkspace')}
                  </p>
                )}
                <Button
                  variant={matrix.isRemoteWorkspace ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => void matrix.handleInstall(selectedMatrixSkill, 'user')}
                  disabled={matrix.installingEnName === selectedMatrixSkill.enName}
                >
                  {matrix.installingEnName === selectedMatrixSkill.enName
                    ? t('matrix.item.installing')
                    : t('market.item.downloadUser')}
                </Button>
              </>
            )}
          </>
        ) : null}
      >
        {selectedInstalledSkill ? (
          <>
            <div className="bitfun-skills-scene__detail-row">
              <span className="bitfun-skills-scene__detail-label">{t('list.item.sourceLabel')}</span>
              <span className="bitfun-skills-scene__detail-value">
                {getSkillSourceLabel(selectedInstalledSkill, t('list.item.unknownSource'))}
              </span>
            </div>
            {selectedInstalledSkill.isShadowed && (
              <div className="bitfun-skills-scene__detail-row">
                <span className="bitfun-skills-scene__detail-label">{t('list.item.shadowedLabel')}</span>
                <span className="bitfun-skills-scene__detail-value">
                  {t('list.item.shadowedDetail', {
                    source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                      ?? t('list.item.unknownSource'),
                  })}
                </span>
              </div>
            )}
            <div className="bitfun-skills-scene__detail-row" data-testid="skill-detail-capabilities-section">
              <span className="bitfun-skills-scene__detail-label">{t('list.item.pathLabel')}</span>
              {canRevealSkillPath ? (
                <button
                  type="button"
                  className="bitfun-skills-scene__detail-path-btn"
                  title={t('list.item.openPathInExplorer')}
                  onClick={() => void handleRevealSkillPath(selectedInstalledSkill.path)}
                  data-testid="skills-detail-path-btn"
                >
                  {formatDisplayPath(selectedInstalledSkill.path)}
                </button>
              ) : (
                <code className="bitfun-skills-scene__detail-value">{formatDisplayPath(selectedInstalledSkill.path)}</code>
              )}
            </div>
          </>
        ) : null}

        {selectedMarketSkill?.source ? (
          <div className="bitfun-skills-scene__detail-row" data-testid="skill-detail-capabilities-section">
            <span className="bitfun-skills-scene__detail-label">{t('market.item.sourceLabel')}</span>
            <span className="bitfun-skills-scene__detail-value">{selectedMarketSkill.source}</span>
          </div>
        ) : null}

        {selectedMatrixSkill ? (
          <>
            {(() => {
              const repo = selectedMatrixSkill.repository;
              return repo ? (
                <div className="bitfun-skills-scene__detail-row">
                  <span className="bitfun-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
                  <button
                    type="button"
                    className="bitfun-skills-scene__detail-link"
                    onClick={(e) => {
                      e.preventDefault();
                      void openExternalUrl(repo);
                    }}
                  >
                    {repo}
                  </button>
                </div>
              ) : null;
            })()}
            {selectedMatrixSkill.version && (
              <div className="bitfun-skills-scene__detail-row">
                <span className="bitfun-skills-scene__detail-label">{t('market.detail.versionLabel')}</span>
                <span className="bitfun-skills-scene__detail-value">{selectedMatrixSkill.version}</span>
              </div>
            )}
            {selectedMatrixSkill.organization?.name && (
              <div className="bitfun-skills-scene__detail-row">
                <span className="bitfun-skills-scene__detail-label">{t('market.detail.orgLabel')}</span>
                <span className="bitfun-skills-scene__detail-value">{selectedMatrixSkill.organization.name}</span>
              </div>
            )}
            {selectedMatrixSkill.tags && selectedMatrixSkill.tags.length > 0 && (
              <div className="bitfun-skills-scene__detail-row">
                <span className="bitfun-skills-scene__detail-label">{t('market.detail.tagsLabel')}</span>
                <span className="bitfun-skills-scene__detail-value">
                  {selectedMatrixSkill.tags.map((tag) => tag.name).join(', ')}
                </span>
              </div>
            )}
          </>
        ) : null}

        {selectedMarketSkill ? (
          <div className="bitfun-skills-scene__detail-row">
            <span className="bitfun-skills-scene__detail-label">{t('market.detail.installsLabel')}</span>
            <span className="bitfun-skills-scene__detail-value">{selectedMarketSkill.installs ?? 0}</span>
          </div>
        ) : null}

        {selectedMarketSkill?.url ? (
          <div className="bitfun-skills-scene__detail-row">
            <span className="bitfun-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
            <button
              type="button"
              className="bitfun-skills-scene__detail-link"
              data-testid="skills-detail-external-link"
              onClick={async (e) => {
                e.preventDefault();
                await openExternalUrl(selectedMarketSkill.url);
              }}
            >
              {selectedMarketSkill.url}
            </button>
          </div>
        ) : null}
      </GalleryDetailModal>

      <Modal
        isOpen={desktopConfigAvailable && isAddFormOpen}
        onClose={() => {
          installed.resetForm();
          setAddFormOpen(false);
        }}
        title={t('form.title')}
        size="small"
        closeButtonTestId="skills-add-form-close-btn"
      >
        <div className="bitfun-skills-scene__modal-form">
          <Select
            label={t('form.level.label')}
            triggerTestId="skills-add-form-level-select"
            options={[
              { label: t('form.level.user'), value: 'user' },
              {
                label: `${t('form.level.project')}${installed.hasWorkspace && !installed.isRemoteWorkspace && !installed.isAssistantWorkspace ? '' : t('form.level.projectDisabled')}`,
                value: 'project',
                disabled: !installed.hasWorkspace || installed.isRemoteWorkspace || installed.isAssistantWorkspace,
              },
            ]}
            value={installed.formLevel}
            onChange={(value) => installed.setFormLevel(value as SkillLevel)}
            size="medium"
          />

          {installed.formLevel === 'project' && installed.hasWorkspace ? (
            <div className="bitfun-skills-scene__form-hint">
              {t('form.level.selectedProjectPath', { path: installed.workspacePath })}
            </div>
          ) : null}

          <div className="bitfun-skills-scene__path-input">
            <Input
              label={t('form.path.label')}
              data-testid="skills-add-form-path-input"
              placeholder={t('form.path.placeholder')}
              value={installed.formPath}
              onChange={(e) => installed.setFormPath(e.target.value)}
              variant="outlined"
            />
            <button
              type="button"
              className="gallery-action-btn"
              data-testid="skills-add-form-browse-btn"
              onClick={installed.handleBrowse}
              aria-label={t('form.path.browseTooltip')}
            >
              <FolderOpen size={15} />
            </button>
          </div>
          <div className="bitfun-skills-scene__path-hint">
            {t('form.path.hint')}
          </div>

          {installed.isValidating ? (
            <div className="bitfun-skills-scene__validating">{t('form.validating')}</div>
          ) : null}

          {installed.validationResult ? (
            <div
              className={[
                'bitfun-skills-scene__validation',
                installed.validationResult.valid ? 'is-valid' : 'is-invalid',
              ].filter(Boolean).join(' ')}
            >
              {installed.validationResult.valid ? (
                <>
                  <div className="bitfun-skills-scene__validation-name">
                    {installed.validationResult.name}
                  </div>
                  <div className="bitfun-skills-scene__validation-desc">
                    {installed.validationResult.description}
                  </div>
                </>
              ) : (
                <div className="bitfun-skills-scene__validation-error">
                  {installed.validationResult.error}
                </div>
              )}
            </div>
          ) : null}

          <div className="bitfun-skills-scene__modal-form-actions">
            <Button
              variant="secondary"
              size="small"
              data-testid="skills-add-form-cancel-btn"
              onClick={() => {
                installed.resetForm();
                setAddFormOpen(false);
              }}
            >
              {t('form.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="small"
              data-testid="skills-add-form-submit-btn"
              onClick={handleAddSkill}
              disabled={!installed.validationResult?.valid || installed.isAdding}
            >
              {installed.isAdding ? t('form.actions.adding') : t('form.actions.add')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={desktopConfigAvailable && Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!desktopConfigAvailable || !deleteTarget || !canDeleteSkill(deleteTarget)) {
            setDeleteTarget(null);
            return;
          }
          const deleted = await installed.handleDelete(deleteTarget);
          if (deleted) {
            setDeleteTarget(null);
          }
        }}
        title={t('deleteModal.title')}
        message={t('deleteModal.message', { name: deleteTarget?.name ?? '' })}
        type="warning"
        confirmDanger
        confirmText={t('deleteModal.delete')}
        cancelText={t('deleteModal.cancel')}
      />
    </div>
  );
};

export default SkillsScene;
