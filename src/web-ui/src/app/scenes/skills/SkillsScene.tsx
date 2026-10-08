import {
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Icon,
  IconButton,
  Input,
  NavigationPanelItem,
  NavigationPanelSection,
  ScrollArea,
  SearchField,
  Select,
  StatusPill,
  Switch,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeading,
  DialogTitle,
  Tooltip,
} from '@bitfun/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, Copy, FolderOpen, Layers, Loader2, Package, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';

import type { SkillInfo, SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import { installedSkillMarketIds, isSkillMarketItemInstalled } from '@/infrastructure/config/skillMarketInstallation';
import {
  buildSkillCoverageSourceMap,
  canDeleteSkill,
  findSkillByKey,
  getSkillSourceLabel,
} from '@/infrastructure/config/skillSourcePresentation';
import { workspaceAPI, systemAPI } from '@/infrastructure/api';
import { usePeerDeviceModeOptional } from '@/infrastructure/peer-device/peerDeviceContextState';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useNotification } from '@/shared/notification-system';
import { isRemoteWorkspace } from '@/shared/types';
import { createLogger } from '@/shared/utils/logger';
import { useInstalledSkills } from './hooks/useInstalledSkills';
import { useSkillMarket } from './hooks/useSkillMarket';
import { useMatrixSkillMarket } from './hooks/useMatrixSkillMarket';
import SkillCard from './components/SkillCard';
import SkillGroupsView from './components/SkillGroupsView';
import { useUserSkillGroups } from '@/features/skill-groups/useUserSkillGroups';
import { resolveSkillGroups } from '@/features/skill-groups/skillGroups';
import SkillsLoadMoreSentinel from './components/SkillsLoadMoreSentinel';
import MatrixMarketView from './components/MatrixMarketView';
import type { MatrixSkillSummary } from '@/infrastructure/api/service-api/MatrixSkillAPI';
import { formatSkillDetailPath } from './skillDetailPath';
import './SkillsScene.scss';
import { useSkillsSceneStore, type InstalledFilter } from './skillsSceneStore';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';

const log = createLogger('SkillsScene');

interface CategoryInfo {
  id: InstalledFilter | 'groups';
  icon: React.ReactNode;
  labelKey: string;
  titleKey: string;
  descKey: string;
  sourceLabel?: string;
}

const CATEGORIES: CategoryInfo[] = [
  {
    id: 'all',
    icon: <Icon glyph={Layers} size="sm" />,
    labelKey: 'filters.all',
    titleKey: 'installed.titleListAll',
    descKey: 'categories.all',
  },
  {
    id: 'builtin',
    icon: <Icon glyph={ShieldCheck} size="sm" />,
    labelKey: 'filters.builtin',
    titleKey: 'installed.titleBuiltin',
    descKey: 'categories.builtin',
  },
  {
    id: 'user',
    icon: <Icon name="user" size="sm" />,
    labelKey: 'filters.user',
    titleKey: 'installed.titleUser',
    descKey: 'categories.user',
  },
  {
    id: 'project',
    icon: <Icon glyph={FolderOpen} size="sm" />,
    labelKey: 'filters.project',
    titleKey: 'installed.titleProject',
    descKey: 'categories.project',
  },
  {
    id: 'groups',
    icon: <Icon glyph={Layers} size="sm" />,
    labelKey: 'filters.groups',
    titleKey: 'groups.title',
    descKey: 'categories.groups',
  },
];

const SkillsScene: React.FC = () => {
  const { t } = useTranslation('scenes/skills');
  const { t: tComponents, formatNumber } = useI18n('components');
  const { t: tCommon } = useI18n('common');
  const notification = useNotification();
  const peerDevice = usePeerDeviceModeOptional();
  const remoteConnectionActive = peerDevice?.peerMode.active === true;
  const desktopConfigAvailable = isTauriRuntime() && !remoteConnectionActive;
  const {
    nativeNavigationRequest,
    searchDraft,
    marketQuery,
    installedView,
    hideDuplicates,
    isAddFormOpen,
    setSearchDraft,
    submitMarketQuery,
    setInstalledView,
    setHideDuplicates,
    setAddFormOpen,
    toggleAddForm,
  } = useSkillsSceneStore();

  const [deleteTarget, setDeleteTarget] = useState<SkillInfo | null>(null);
  const [installedSearch, setInstalledSearch] = useState('');
  // Real scroll element for the market viewport. The IntersectionObserver
  // sentinel judges intersection against this node instead of the browser
  // viewport, which is unreliable inside the nested ScrollArea on ArkWeb.
  const [marketScrollRoot, setMarketScrollRoot] = useState<Element | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<
    | { type: 'installed'; skillKey: string }
    | { type: 'market'; skill: SkillMarketItem }
    | { type: 'matrix'; skill: MatrixSkillSummary }
    | null
  >(null);

  const isMarketView = installedView === 'market';
  const isMatrixView = installedView === 'matrix';

  useEffect(() => {
    if (!nativeNavigationRequest) return;
    setInstalledView('all');
    setInstalledSearch('');
    setSelectedDetail(null);
  }, [nativeNavigationRequest, setInstalledView]);

  const installed = useInstalledSkills({
    searchQuery: installedSearch,
    activeFilter: installedView === 'groups' || isMarketView || isMatrixView ? 'all' : installedView,
    enabled: desktopConfigAvailable,
  });

  const skillGroups = useUserSkillGroups(desktopConfigAvailable);
  const groupSkills = useMemo(() => installed.catalogReady ? installed.skills.map(skill => ({
    ...skill,
    sourceLabel: getSkillSourceLabel(skill, t('list.item.unknownSource')),
    runtimeStatus: installed.globallyDisabledSkillKeys.has(skill.key)
      ? t('groups.globalDisabled')
      : skill.isShadowed ? t('list.item.shadowed') : undefined,
  })) : [], [installed.catalogReady, installed.skills, installed.globallyDisabledSkillKeys, t]);
  const skillGroupCount = useMemo(() => resolveSkillGroups(groupSkills, skillGroups.groups, {
    builtin: key => key, other: '',
  }).length, [groupSkills, skillGroups.groups]);

  const installedMarketIds = useMemo(
    () => installedSkillMarketIds(installed.skills),
    [installed.skills],
  );
  const installedDirNamesByLevel = useMemo(
    () => {
      const user = new Set<string>();
      const project = new Set<string>();
      for (const skill of installed.skills) {
        (skill.level === 'user' ? user : project).add(skill.dirName);
      }
      return { user, project };
    },
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
  const detailDescription = (selectedInstalledSkill?.description ?? selectedMarketSkill?.description ?? selectedMatrixSkill?.description)?.trim();
  const isSelectedMarketSkillInstalled = selectedMarketSkill
    ? isSkillMarketItemInstalled(selectedMarketSkill, installedMarketIds)
    : false;
  const selectedSkillPathSegments = useMemo(
    () => formatSkillDetailPath(selectedInstalledSkill?.path ?? '').split(/(?<=[\\/])/),
    [selectedInstalledSkill?.path],
  );
  const installedMatrixEnNames = useMemo(
    () => new Set(
      installed.skills
        .filter((skill) => skill.sourceId === 'matrix')
        .map((skill) => skill.dirName),
    ),
    [installed.skills],
  );

  useEffect(() => {
    if (selectedDetail?.type === 'installed' && !installed.loading && !selectedInstalledSkill) {
      setSelectedDetail(null);
    }
  }, [installed.loading, selectedDetail, selectedInstalledSkill]);

  useEffect(() => {
    if (desktopConfigAvailable) {
      return;
    }
    setInstalledView('all');
    setAddFormOpen(false);
    setDeleteTarget(null);
    setSelectedDetail(null);
  }, [desktopConfigAvailable, setAddFormOpen, setInstalledView]);

  const market = useSkillMarket({
    searchQuery: marketQuery,
    installedMarketIds,
    installedDirNamesByLevel,
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
  const installedSkillAriaLabel = useCallback((skill: SkillInfo) => {
    const source = getSkillSourceLabel(skill, t('list.item.unknownSource'));
    const scope = market.isRemoteWorkspace
      ? skill.level === 'user'
        ? t('list.item.localUser')
        : t('list.item.remoteProject')
      : skill.level === 'user'
        ? t('list.item.user')
        : t('list.item.project');
    return [
      skill.name,
      source,
      scope,
      skill.level === 'user'
        ? installed.globallyDisabledSkillKeys.has(skill.key)
          ? t('list.item.globalDisabled')
          : t('list.item.globalEnabled')
        : null,
      skill.isShadowed
        ? t('list.item.shadowedTooltip', {
            source: coverageSourceBySkillKey.get(skill.key) ?? t('list.item.unknownSource'),
          })
        : null,
    ].filter(Boolean).join('. ');
  }, [coverageSourceBySkillKey, installed.globallyDisabledSkillKeys, market.isRemoteWorkspace, t]);

  const refetchSkillsScene = useCallback(async () => {
    // The skill market list is intentionally NOT refreshed here. Re-entry
    // refresh previously flipped marketLoading, which replaced the existing
    // list with a skeleton grid and produced the "whole page refreshes"
    // regression. Installed skills and skill groups remain cheap to reload
    // and continue to refresh on focus/visibility. The market keeps its own
    // capability/search effect for first load and explicit search.
    await Promise.all([installed.loadSkills(true), skillGroups.reload()]);
  }, [installed, skillGroups]);

  useGallerySceneAutoRefresh({
    sceneId: 'skills',
    refetch: refetchSkillsScene,
  });

  const canRevealSkillPath = !isRemoteWorkspace(workspaceManager.getState().currentWorkspace);

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

  const handleCopySkillPath = useCallback(async (path: string) => {
    try {
      await systemAPI.setClipboard(path);
      notification.success(tCommon('contextMenu.status.copyPathSuccess'));
    } catch (error) {
      log.error('Failed to copy skill path', { path, error });
      notification.error(t('messages.copyPathFailed', { error: String(error) }));
    }
  }, [notification, t, tCommon]);

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

  const libraryCategories: CategoryInfo[] = CATEGORIES;
  const sourceCategories: CategoryInfo[] = installed.sourceGroups.map((group) => ({
    id: group.id,
    icon: <Icon name="extension" size="sm" />,
    labelKey: 'filters.source',
    titleKey: 'installed.titleSource',
    descKey: 'categories.source',
    sourceLabel: group.label,
  }));
  const installedCategories: CategoryInfo[] = [...libraryCategories, ...sourceCategories];
  const activeInstalledCategory = installedCategories.find((category) => category.id === installedView)
    ?? CATEGORIES[0];

  useEffect(() => {
    if (!installed.loading && !installed.error && installedView.startsWith('source:')
      && !installed.sourceGroups.some((group) => group.id === installedView)) {
      setInstalledView('all');
    }
  }, [installed.loading, installed.error, installed.sourceGroups, installedView, setInstalledView]);

  const sidebarSearch = isMarketView
    ? {
        value: searchDraft,
        onValueChange: setSearchDraft,
        onSearch: () => submitMarketQuery(),
        placeholder: t('market.searchPlaceholder'),
        clearLabel: searchDraft ? tComponents('search.clear') : undefined,
        onClear: searchDraft ? () => {
          setSearchDraft('');
          submitMarketQuery();
        } : undefined,
      }
    : isMatrixView
      ? {
          value: matrix.keyword,
          onValueChange: matrix.setKeyword,
          onSearch: () => matrix.submitKeyword(),
          placeholder: t('matrix.searchPlaceholder'),
          clearLabel: matrix.keyword ? tComponents('search.clear') : undefined,
          onClear: matrix.keyword ? () => {
            matrix.setKeyword('');
            matrix.submitKeyword();
          } : undefined,
        }
      : installedView === 'groups'
        ? {
            value: searchDraft,
            onValueChange: setSearchDraft,
            onSearch: undefined,
            placeholder: t('toolbar.searchPlaceholder'),
            clearLabel: searchDraft ? tComponents('search.clear') : undefined,
            onClear: searchDraft ? () => setSearchDraft('') : undefined,
          }
        : {
            value: installedSearch,
            onValueChange: setInstalledSearch,
            onSearch: undefined,
            placeholder: t('toolbar.searchPlaceholder'),
            clearLabel: installedSearch ? tComponents('search.clear') : undefined,
            onClear: installedSearch ? () => setInstalledSearch('') : undefined,
          };

  const renderSidebarItem = (cat: CategoryInfo) => {
    const count = cat.id === 'groups' ? skillGroupCount : installed.counts[cat.id] ?? 0;
    const isEmpty = count === 0;
    return (
      <div
        key={cat.id}
        className="skills-sidebar__item"
        data-bitfun-scene="skills"
        data-bitfun-part="sidebarItem"
        data-bitfun-category={cat.id}
        data-bitfun-state={[
          installedView === cat.id && 'active',
          isEmpty && 'empty',
        ].filter(Boolean).join(' ') || undefined}
      >
        <NavigationPanelItem
          selected={installedView === cat.id}
          onClick={() => setInstalledView(cat.id)}
          title={t(cat.descKey, { source: cat.sourceLabel })}
          leading={<span data-bitfun-scene="skills" data-bitfun-part="sidebarItemIcon">{cat.icon}</span>}
          metadata={(
            <span className="skills-sidebar__item-count" data-bitfun-scene="skills" data-bitfun-part="sidebarItemCount">
              {formatNumber(count)}
            </span>
          )}
        >
          <span data-bitfun-scene="skills" data-bitfun-part="sidebarItemLabel">{t(cat.labelKey, { source: cat.sourceLabel })}</span>
        </NavigationPanelItem>
      </div>
    );
  };

  return (
    <div className="bitfun-skills-scene" data-testid="agent-skill-panel" data-bitfun-scene="skills" data-bitfun-part="root" data-bitfun-tab={installedView}>
      {desktopConfigAvailable && (
        <ScrollArea className="skills-sidebar" data-bitfun-scene="skills" data-bitfun-part="sidebar">
          <div className="skills-sidebar__header" data-bitfun-scene="skills" data-bitfun-part="sidebarHeader">
            <h2 className="skills-sidebar__title" data-bitfun-scene="skills" data-bitfun-part="sidebarTitle">{t('nav.title')}</h2>
            <SearchField
              className="skills-sidebar__search"
              data-bitfun-scene="skills"
              data-bitfun-part="sidebarSearch"
              value={sidebarSearch.value}
              onValueChange={sidebarSearch.onValueChange}
              onSearch={sidebarSearch.onSearch}
              leadingIcon={<Icon name="search" size="sm" aria-hidden />}
              placeholder={sidebarSearch.placeholder}
              aria-label={sidebarSearch.placeholder}
              size="sm"
              clearLabel={sidebarSearch.clearLabel}
              onClear={sidebarSearch.onClear}
            />
          </div>
          <nav className="skills-sidebar__nav" aria-label={t('nav.title')} data-bitfun-scene="skills" data-bitfun-part="sidebarNav">
            <NavigationPanelSection title={t('nav.categories.installed')} data-bitfun-scene="skills" data-bitfun-part="navSection">
              {libraryCategories.map(renderSidebarItem)}
            </NavigationPanelSection>
            {sourceCategories.length > 0 && (
              <NavigationPanelSection title={t('list.columns.source')} data-bitfun-scene="skills" data-bitfun-part="navSection">
                {sourceCategories.map(renderSidebarItem)}
              </NavigationPanelSection>
            )}
            <NavigationPanelSection title={t('nav.categories.discover')} data-bitfun-scene="skills" data-bitfun-part="navSection">
              <div
                className="skills-sidebar__item"
                data-bitfun-scene="skills"
                data-bitfun-part="sidebarItem"
                data-bitfun-category="market"
                data-bitfun-state={isMarketView ? 'active' : undefined}
              >
                <NavigationPanelItem
                  selected={isMarketView}
                  onClick={() => setInstalledView('market')}
                  title={t('market.subtitle')}
                  leading={<span data-bitfun-scene="skills" data-bitfun-part="sidebarItemIcon"><Icon glyph={Compass} size="sm" /></span>}
                >
                  <span data-bitfun-scene="skills" data-bitfun-part="sidebarItemLabel">{t('market.title')}</span>
                </NavigationPanelItem>
              </div>
              <div
                className="skills-sidebar__item"
                data-bitfun-scene="skills"
                data-bitfun-part="sidebarItem"
                data-bitfun-category="matrix"
                data-bitfun-state={isMatrixView ? 'active' : undefined}
              >
                <NavigationPanelItem
                  selected={isMatrixView}
                  onClick={() => setInstalledView('matrix')}
                  title={t('matrix.subtitle')}
                  leading={<span data-bitfun-scene="skills" data-bitfun-part="sidebarItemIcon"><Icon glyph={Package} size="sm" /></span>}
                >
                  <span data-bitfun-scene="skills" data-bitfun-part="sidebarItemLabel">{t('matrix.tabLabel')}</span>
                </NavigationPanelItem>
              </div>
            </NavigationPanelSection>
          </nav>
        </ScrollArea>
      )}

      <div className="skills-page" data-bitfun-scene="skills" data-bitfun-part="content" data-bitfun-tab={installedView}>

        {!desktopConfigAvailable && (
          <div className="skills-main" data-bitfun-scene="skills" data-bitfun-part="main">
            <div className="skills-main__empty" data-testid="skills-management-unavailable" data-bitfun-scene="skills" data-bitfun-part="empty">
              <Icon name="extension" size="lg" />
              <span>{t(remoteConnectionActive ? 'list.remoteUnavailable' : 'list.desktopUnavailable')}</span>
            </div>
          </div>
        )}

        {desktopConfigAvailable && installedView === 'groups' && (
          <SkillGroupsView
            key={installed.catalogContextKey}
            searchQuery={searchDraft}
            skills={groupSkills}
            collection={skillGroups}
            catalogReady={installed.catalogReady}
            catalogLoading={installed.loading}
            catalogIncomplete={installed.diagnostics.length > 0 || !installed.diagnosticsAvailable}
            onRefresh={() => { void installed.loadSkills(true); void skillGroups.reload(); }}
          />
        )}

        {desktopConfigAvailable && installedView !== 'groups' && !isMarketView && !isMatrixView && (
          <div className="skills-installed" data-bitfun-scene="skills" data-bitfun-part="installed">
            <header className="skills-content-header" data-bitfun-scene="skills" data-bitfun-part="contentHeader">
              <div className="skills-content-header__identity">
                <div className="skills-content-header__copy">
                  <h1 className="skills-content-header__title" data-bitfun-scene="skills" data-bitfun-part="contentTitle">
                    {t(activeInstalledCategory.titleKey, { source: activeInstalledCategory.sourceLabel })}
                  </h1>
                  <p className="skills-content-header__description" data-bitfun-scene="skills" data-bitfun-part="contentSubtitle">
                    {t(activeInstalledCategory.descKey, { source: activeInstalledCategory.sourceLabel })}
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Icon name="plus" size="sm" />}
                onClick={toggleAddForm}
                data-testid="skills-add-skill-btn"
              >
                {t('toolbar.addTooltip')}
              </Button>
            </header>

            <div className="skills-main" data-bitfun-scene="skills" data-bitfun-part="main">
              <div className="skills-main__toolbar" data-bitfun-scene="skills" data-bitfun-part="toolbar">
                <div
                  className="skills-main__filter"
                  data-bitfun-scene="skills"
                  data-bitfun-part="filterAction"
                  data-bitfun-state={hideDuplicates ? 'active' : undefined}
                >
                  <Checkbox
                    checked={hideDuplicates}
                    onCheckedChange={setHideDuplicates}
                    size="sm"
                    label={t('toolbar.hideDuplicates')}
                  />
                </div>
              </div>

              <div className="skills-main__list-shell">
                    <div
                      className="skills-main__list-header"
                      data-bitfun-scene="skills"
                      data-bitfun-part="installedListHeader"
                    >
                      <div className="skills-main__list-heading">
                        <span data-bitfun-scene="skills" data-bitfun-part="installedListTitle">
                          {t(activeInstalledCategory.titleKey, { source: activeInstalledCategory.sourceLabel })}
                        </span>
                        <span
                          className="skills-main__list-count"
                          data-bitfun-scene="skills"
                          data-bitfun-part="installedListCount"
                        >
                          {installedFiltered.length}
                        </span>
                      </div>
                    </div>

                    {installed.loading && (
                      <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')} data-bitfun-scene="skills" data-bitfun-part="loading">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div
                            key={`ins-sk-${i}`}
                            className="skills-discover__skeleton-card"
                            style={{ '--surface-stagger-index': i } as React.CSSProperties}
                            data-bitfun-scene="skills"
                            data-bitfun-part="skeleton"
                          />
                        ))}
                      </div>
                    )}

                    {!installed.loading && installed.error && (
                      <div className="skills-main__empty skills-main__empty--error" data-bitfun-scene="skills" data-bitfun-part="error">
                        <Icon name="extension" size="lg" />
                        <span>{t('list.loadFailed')}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void installed.loadSkills(true)}
                        >
                          {t('list.retry')}
                        </Button>
                      </div>
                    )}

                    {!installed.loading && !installed.error && (
                      installed.diagnostics.length > 0 ? <details className="skills-main__diagnostics">
                        <summary>{t('list.scanIncomplete')}</summary>
                        {installed.diagnostics.map((item, index) => <p key={index}>{item.path}: {item.message}</p>)}
                      </details> : !installed.diagnosticsAvailable && <p role="status">{t('list.diagnosticsUnavailable')}</p>
                    )}

                    {!installed.loading && !installed.error && installedFiltered.length === 0 && installed.diagnostics.length === 0 && (
                      <div className="skills-main__empty" data-testid="skill-list-empty" data-bitfun-scene="skills" data-bitfun-part="empty">
                        <Icon name="extension" size="lg" />
                        <span>
                          {installed.skills.length === 0
                            ? t('list.empty.noSkills')
                            : t('list.empty.noMatch')}
                        </span>
                      </div>
                    )}

                    {!installed.loading && !installed.error && installedFiltered.length > 0 && (
                      <ScrollArea
                        className="skills-discover__grid skills-discover__grid--installed"
                        data-testid="skill-list"
                        data-bitfun-scene="skills"
                        data-bitfun-part="list"
                      >
                        {installedFiltered.map((skill, index) => (
                          <SkillCard
                            key={skill.key}
                            data-testid="skill-list-item"
                            data-skill-key={skill.key}
                            data-skill-id={skill.key}
                            data-skill-name={skill.name}
                            data-skill-level={skill.level}
                            data-skill-builtin={skill.isBuiltin ? 'true' : 'false'}
                            data-bitfun-scene="skills"
                            data-bitfun-part="installedCard"
                            data-bitfun-level={skill.level}
                            data-bitfun-state={[
                              skill.isShadowed && 'shadowed',
                              skill.isBuiltin && 'builtin',
                            ].filter(Boolean).join(' ') || undefined}
                            aria-label={installedSkillAriaLabel(skill)}
                            name={skill.name}
                            description={skill.description}
                            source={getSkillSourceLabel(skill, t('list.item.unknownSource'))}
                            iconKind="skill"
                            index={index}
                            accentSeed={skill.key}
                            badges={(
                              <>
                                {skill.isBuiltin && (
                                  <StatusPill tone="accent" leading={<ShieldCheck size={10} />}>
                                    {t('list.item.builtin')}
                                  </StatusPill>
                                )}
                                {skill.level === 'user'
                                  && installed.globallyDisabledSkillKeys.has(skill.key) && (
                                  <StatusPill tone="neutral">
                                    {t('list.item.globalDisabled')}
                                  </StatusPill>
                                )}
                                {skill.isShadowed && (
                                  <span title={t('list.item.shadowedTooltip', {
                                    source: coverageSourceBySkillKey.get(skill.key)
                                      ?? t('list.item.unknownSource'),
                                  })}>
                                    <StatusPill tone="warning" leading={<ShieldAlert size={10} />}>
                                      {t('list.item.shadowed')}
                                    </StatusPill>
                                  </span>
                                )}
                              </>
                            )}
                            meta={(
                              <span className="bitfun-skills-scene__installed-level">
                                {skill.level === 'user'
                                  ? <Icon name="user" size="xs" />
                                  : <Icon glyph={FolderOpen} size="xs" />}
                                {market.isRemoteWorkspace
                                  ? skill.level === 'user'
                                    ? t('list.item.localUser')
                                    : t('list.item.remoteProject')
                                  : skill.level === 'user'
                                    ? t('list.item.user')
                                    : t('list.item.project')}
                              </span>
                            )}
                            toggleSlot={skill.level === 'user' ? (
                              <Switch
                                checked={!installed.globallyDisabledSkillKeys.has(skill.key)}
                                disabled={installed.savingGlobalSkillKey !== null}
                                aria-busy={installed.savingGlobalSkillKey === skill.key}
                                aria-label={t('list.item.globalToggleLabel', { name: skill.name })}
                                onChange={(event) => {
                                  void installed.handleGlobalSkillToggle(skill, event.target.checked);
                                }}
                              />
                            ) : null}
                            actions={[
                              {
                                id: 'detail',
                                icon: <Icon name="arrow-right" size="xs" />,
                                ariaLabel: t('list.item.detail'),
                                title: t('list.item.detail'),
                                tone: 'muted',
                                onClick: () => setSelectedDetail({ type: 'installed', skillKey: skill.key }),
                              },
                              ...(canDeleteSkill(skill) ? [{
                                id: 'delete',
                                icon: <Icon name="delete" size="xs" />,
                                ariaLabel: t('list.item.deleteTooltip'),
                                title: t('list.item.deleteTooltip'),
                                tone: 'danger' as const,
                                onClick: () => setDeleteTarget(skill),
                              }] : []),
                            ]}
                            onOpenDetails={() => setSelectedDetail({ type: 'installed', skillKey: skill.key })}
                          />
                        ))}
                      </ScrollArea>
                    )}
                  </div>
            </div>
          </div>
        )}

        {desktopConfigAvailable && isMarketView && (
          <div className="skills-discover" data-bitfun-scene="skills" data-bitfun-part="discover">
            <header className="skills-content-header" data-bitfun-scene="skills" data-bitfun-part="contentHeader">
              <div className="skills-content-header__identity">
                <div className="skills-content-header__copy">
                  <h1 className="skills-content-header__title" data-bitfun-scene="skills" data-bitfun-part="contentTitle">{t('market.title')}</h1>
                  <p className="skills-content-header__description" data-bitfun-scene="skills" data-bitfun-part="contentSubtitle">{t('market.subtitle')}</p>
                </div>
              </div>
            </header>

            <ScrollArea ref={setMarketScrollRoot} className="skills-discover__content">
              {/* Initial-load skeleton: only when there is no existing list to
                  keep visible. On refresh/search with existing data we keep
                  the grid mounted and surface a non-blocking refresh row
                  below to avoid the whole-page skeleton flash. */}
              {market.marketLoading && market.marketSkills.length === 0 && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')} data-bitfun-scene="skills" data-bitfun-part="loading">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`mkt-sk-${i}`}
                      className="skills-discover__skeleton-card"
                      style={{ '--surface-stagger-index': i } as React.CSSProperties}
                      data-bitfun-scene="skills"
                      data-bitfun-part="skeleton"
                    />
                  ))}
                </div>
              )}

              {!market.marketLoading && market.marketError && (
                <div className="skills-discover__empty skills-discover__empty--error" data-bitfun-scene="skills" data-bitfun-part="error">
                  <Icon name="extension" size="lg" />
                  <span>{market.marketError}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.marketSkills.length === 0 && (
                <div className="skills-discover__empty" data-testid="skill-list-empty" data-bitfun-scene="skills" data-bitfun-part="empty">
                  <Icon name="extension" size="lg" />
                  <span>{marketQuery ? t('market.empty.noMatch') : t('market.empty.noSkills')}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.marketSkills.length > 0 && (
                <>
                  {marketQuery && (
                    <div className="skills-discover__results-info" data-bitfun-scene="skills" data-bitfun-part="resultsInfo">
                      <span>
                        {t('market.resultsInfo', { query: marketQuery, count: market.totalLoaded })}
                      </span>
                    </div>
                  )}

                  <div className="skills-discover__grid" data-testid="skill-list" data-bitfun-scene="skills" data-bitfun-part="list">
                    {market.marketSkills.map((skill, index) => {
                      const isInstalled = isSkillMarketItemInstalled(skill, installedMarketIds);
                      const isDownloading = market.downloadingPackage === skill.installId;
                      return (
                        <SkillCard
                          key={skill.installId}
                          data-testid="skills-market-card"
                          data-skill-install-id={skill.installId}
                          data-skill-id={skill.installId}
                          data-skill-name={skill.name}
                          data-skill-installed={isInstalled ? 'true' : 'false'}
                          name={skill.name}
                          description={skill.description}
                          index={index}
                          accentSeed={skill.installId}
                          iconKind="market"
                          badges={isInstalled ? (
                            <StatusPill tone="success" leading={<Icon name="check-circle" size="2xs" />}>
                              {t('market.item.installed')}
                            </StatusPill>
                          ) : null}
                          meta={(
                            <span className="bitfun-skills-scene__market-meta">
                              <TrendingUp size={12} />
                              {skill.installs ?? 0}
                            </span>
                          )}
                          actions={[
                            {
                              id: 'download',
                              icon: isInstalled ? <Icon name="check-circle" size="xs" /> : <Icon name="arrow-down" size="xs" />,
                              ariaLabel: isInstalled ? t('market.item.installed') : t('market.item.downloadProject'),
                              title: isDownloading
                                ? t('market.item.downloading')
                                : isInstalled
                                  ? t('market.item.installedTooltip')
                                  : (!market.hasWorkspace || market.isAssistantWorkspace)
                                    ? t('messages.noWorkspace')
                                    : t('market.item.downloadProject'),
                              disabled:
                                isDownloading
                                || !market.hasWorkspace
                                || market.isRemoteWorkspace
                                || market.isAssistantWorkspace
                                || isInstalled,
                              tone: isInstalled ? 'success' : 'primary',
                              onClick: () => void market.handleDownload(skill, 'project'),
                            },
                          ]}
                          onOpenDetails={() => setSelectedDetail({ type: 'market', skill })}
                        />
                      );
                    })}
                  </div>

                  <SkillsLoadMoreSentinel
                    active={market.hasMore && !market.loadingMore && !market.loadMoreError}
                    onLoad={() => void market.goToNextPage()}
                    root={marketScrollRoot}
                  />
                  {/* Non-blocking refresh indicator: keeps the existing grid
                      visible while a fresh search/refresh is in flight, instead
                      of swapping it for a skeleton grid. */}
                  {market.marketLoading && market.marketSkills.length > 0 && (
                    <div className="skills-load-more-row">
                      <Loader2 className="skills-load-more-spinner" size={14} />
                      <span>{t('list.loading')}</span>
                    </div>
                  )}
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
                  {!market.loadingMore && !market.loadMoreError && !market.hasMore && market.marketSkills.length > 0 && (
                    <div className="skills-load-more-row">
                      <span>{t('list.noMore')}</span>
                    </div>
                  )}
                </>
              )}
            </ScrollArea>
          </div>
        )}

        {desktopConfigAvailable && isMatrixView && (
          <div className="skills-matrix-view" data-bitfun-scene="skills" data-bitfun-part="matrixView">
            <header className="skills-content-header" data-bitfun-scene="skills" data-bitfun-part="contentHeader">
              <div className="skills-content-header__identity">
                <div className="skills-content-header__copy">
                  <h1 className="skills-content-header__title" data-bitfun-scene="skills" data-bitfun-part="contentTitle">{t('matrix.title')}</h1>
                  <p className="skills-content-header__description" data-bitfun-scene="skills" data-bitfun-part="contentSubtitle">{t('matrix.subtitle')}</p>
                </div>
              </div>
            </header>

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
          </div>
        )}
      </div>

      <Dialog
        open={desktopConfigAvailable && Boolean(selectedDetail)}
        onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedDetail(null); }}
        size="md"
        data-testid="skill-detail-panel"
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle data-testid="skill-detail-title">
              {selectedInstalledSkill?.name ?? selectedMarketSkill?.name ?? selectedMatrixSkill?.name ?? ''}
            </DialogTitle>
            {selectedInstalledSkill || isSelectedMarketSkillInstalled || (selectedMatrixSkill && installedMatrixEnNames.has(selectedMatrixSkill.enName)) ? (
              <div className="skills-detail__badges" data-bitfun-scene="skills" data-bitfun-part="detailBadges">
                {selectedInstalledSkill ? (
                  <>
                    <StatusPill tone="neutral">
                      {selectedInstalledSkill.isBuiltin ? t('list.item.builtin') : t('list.item.userInstalled')}
                    </StatusPill>
                    <StatusPill tone="neutral">
                      {market.isRemoteWorkspace
                        ? selectedInstalledSkill.level === 'user'
                          ? t('list.item.localUser')
                          : t('list.item.remoteProject')
                        : selectedInstalledSkill.level === 'user'
                          ? t('list.item.user')
                          : t('list.item.project')}
                    </StatusPill>
                    {selectedInstalledSkill.isShadowed && (
                      <span title={t('list.item.shadowedTooltip', {
                        source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                          ?? t('list.item.unknownSource'),
                      })}>
                        <StatusPill tone="warning" leading={<Icon glyph={ShieldAlert} />}>
                          {t('list.item.shadowed')}
                        </StatusPill>
                      </span>
                    )}
                  </>
                ) : selectedMarketSkill ? (
                  <StatusPill tone="success" leading={<Icon name="check-circle" size="2xs" />}>
                    {t('market.item.installed')}
                  </StatusPill>
                ) : selectedMatrixSkill && installedMatrixEnNames.has(selectedMatrixSkill.enName) ? (
                  <StatusPill tone="success" leading={<Icon name="check-circle" size="2xs" />}>
                    {t('matrix.item.installed')}
                  </StatusPill>
                ) : null}
              </div>
            ) : null}
          </DialogHeading>
          <DialogClose data-testid="skill-detail-close" />
        </DialogHeader>
        <DialogBody>
          <div className="skills-detail" data-bitfun-scene="skills" data-bitfun-part="detail">
            {detailDescription ? (
              <ScrollArea
                className="skills-detail__description-scroll"
                tabIndex={0}
                data-bitfun-scene="skills"
                data-bitfun-part="detailDescriptionViewport"
              >
                <p
                  className="skills-detail__description"
                  data-bitfun-scene="skills"
                  data-bitfun-part="detailDescription"
                  data-testid="skill-detail-description"
                >
                  {detailDescription}
                </p>
              </ScrollArea>
            ) : null}
            <dl className="skills-detail__fields" data-bitfun-scene="skills" data-bitfun-part="detailMetadata">
              {selectedInstalledSkill ? (
                <>
                  <div className="skills-detail__field">
                    <dt>{t('list.columns.source')}</dt>
                    <dd>{getSkillSourceLabel(selectedInstalledSkill, t('list.item.unknownSource'))}</dd>
                  </div>
                  {selectedInstalledSkill.isShadowed && (
                    <div className="skills-detail__field">
                      <dt>{t('list.item.shadowedLabel')}</dt>
                      <dd>
                        {t('list.item.shadowedDetail', {
                          source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                            ?? t('list.item.unknownSource'),
                        })}
                      </dd>
                    </div>
                  )}
                  <div className="skills-detail__field" data-testid="skill-detail-capabilities-section">
                    <dt>{t('list.item.pathLabel')}</dt>
                    <dd className="skills-detail__location">
                      <Tooltip content={selectedInstalledSkill.path} trigger="hover-focus" interactive>
                        <span className="skills-detail__path" tabIndex={0}>
                          {selectedSkillPathSegments.map((segment, index) => (
                            <React.Fragment key={`${index}-${segment}`}>
                              {segment}<wbr />
                            </React.Fragment>
                          ))}
                        </span>
                      </Tooltip>
                      <Tooltip content={tCommon('file.copyPath')} trigger="hover-focus">
                        <IconButton
                          variant="quiet"
                          size="sm"
                          icon={<Icon glyph={Copy} size="sm" />}
                          aria-label={tCommon('file.copyPath')}
                          onClick={() => void handleCopySkillPath(selectedInstalledSkill.path)}
                          data-testid="skills-detail-copy-path-btn"
                        />
                      </Tooltip>
                      {canRevealSkillPath ? (
                        <Tooltip content={t('list.item.openPathInExplorer')} trigger="hover-focus">
                          <IconButton
                            variant="quiet"
                            size="sm"
                            icon={<Icon glyph={FolderOpen} size="sm" />}
                            aria-label={t('list.item.openPathInExplorer')}
                            onClick={() => void handleRevealSkillPath(selectedInstalledSkill.path)}
                            data-testid="skills-detail-path-btn"
                          />
                        </Tooltip>
                      ) : null}
                    </dd>
                  </div>
                </>
              ) : null}
              {selectedMarketSkill?.source ? (
                <div className="skills-detail__field" data-testid="skill-detail-capabilities-section">
                  <dt>{t('list.columns.source')}</dt>
                  <dd>{selectedMarketSkill.source}</dd>
                </div>
              ) : null}
              {selectedMarketSkill ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.installsLabel')}</dt>
                  <dd>{formatNumber(selectedMarketSkill.installs ?? 0)}</dd>
                </div>
              ) : null}
              {selectedMarketSkill?.url ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.linkLabel')}</dt>
                  <dd>
                    <a
                      href={selectedMarketSkill.url}
                      target="_blank"
                      rel="noreferrer"
                      className="skills-detail__link"
                      data-testid="skills-detail-external-link"
                      onClick={(event) => {
                        // Tauri/ArkWeb WebView does not reliably open external
                        // URLs via a plain anchor click; route through the host
                        // shell so the link opens in the system default browser,
                        // mirroring the About dialog's "Light up Star" behavior.
                        event.preventDefault();
                        systemAPI.openExternal(selectedMarketSkill.url).catch(error => {
                          log.error('Failed to open skill market URL', { url: selectedMarketSkill.url, error });
                        });
                      }}
                    >
                      {selectedMarketSkill.url}
                    </a>
                  </dd>
                </div>
              ) : null}
              {selectedMatrixSkill?.repository ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.linkLabel')}</dt>
                  <dd>
                    <a
                      href={selectedMatrixSkill.repository}
                      target="_blank"
                      rel="noreferrer"
                      className="skills-detail__link"
                      data-testid="skills-detail-external-link"
                      onClick={(event) => {
                        event.preventDefault();
                        const repoUrl = selectedMatrixSkill.repository;
                        if (!repoUrl) {
                          return;
                        }
                        systemAPI.openExternal(repoUrl).catch(error => {
                          log.error('Failed to open Matrix skill repository', { url: repoUrl, error });
                        });
                      }}
                    >
                      {selectedMatrixSkill.repository}
                    </a>
                  </dd>
                </div>
              ) : null}
              {selectedMatrixSkill?.version ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.versionLabel')}</dt>
                  <dd>{selectedMatrixSkill.version}</dd>
                </div>
              ) : null}
              {selectedMatrixSkill?.organization?.name ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.orgLabel')}</dt>
                  <dd>{selectedMatrixSkill.organization.name}</dd>
                </div>
              ) : null}
              {selectedMatrixSkill && selectedMatrixSkill.tags && selectedMatrixSkill.tags.length > 0 ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.tagsLabel')}</dt>
                  <dd>{selectedMatrixSkill.tags.map((tag) => tag.name).join(', ')}</dd>
                </div>
              ) : null}
              {selectedMatrixSkill ? (
                <div className="skills-detail__field">
                  <dt>{t('market.detail.installsLabel')}</dt>
                  <dd>{formatNumber(selectedMatrixSkill.download ?? 0)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </DialogBody>
        {selectedInstalledSkill && canDeleteSkill(selectedInstalledSkill) ? (
          <DialogFooter separator>
            <Button
              variant="text"
              tone="danger"
              size="sm"
              onClick={() => {
                setDeleteTarget(selectedInstalledSkill);
                setSelectedDetail(null);
              }}
              leadingIcon={<Icon name="delete" size="sm" />}
            >
              {t('deleteModal.delete')}
            </Button>
          </DialogFooter>
        ) : selectedMarketSkill && !isSelectedMarketSkillInstalled ? (
          <DialogFooter separator>
            <div className="skills-detail__actions">
              {!market.isRemoteWorkspace && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void market.handleDownload(selectedMarketSkill, 'project')}
                  disabled={market.downloadingPackage === selectedMarketSkill.installId || !market.hasWorkspace}
                >
                  {t('market.item.downloadProject')}
                </Button>
              )}
              <Button
                variant={market.isRemoteWorkspace ? 'primary' : 'outline'}
                size="sm"
                onClick={() => void market.handleDownload(selectedMarketSkill, 'user')}
                disabled={market.downloadingPackage === selectedMarketSkill.installId}
              >
                {t('market.item.downloadUser')}
              </Button>
            </div>
          </DialogFooter>
        ) : selectedMatrixSkill && !installedMatrixEnNames.has(selectedMatrixSkill.enName) ? (
          <DialogFooter separator>
            <div className="skills-detail__actions">
              {!matrix.isRemoteWorkspace && (
                <Button
                  variant="fill"
                  size="sm"
                  onClick={() => void matrix.handleInstall(selectedMatrixSkill, 'project')}
                  disabled={matrix.installingEnName === selectedMatrixSkill.enName || !matrix.hasWorkspace}
                >
                  {matrix.installingEnName === selectedMatrixSkill.enName
                    ? t('matrix.item.installing')
                    : t('market.item.downloadProject')}
                </Button>
              )}
              <Button
                variant={matrix.isRemoteWorkspace ? 'fill' : 'outline'}
                size="sm"
                onClick={() => void matrix.handleInstall(selectedMatrixSkill, 'user')}
                disabled={matrix.installingEnName === selectedMatrixSkill.enName}
              >
                {matrix.installingEnName === selectedMatrixSkill.enName
                  ? t('matrix.item.installing')
                  : t('market.item.downloadUser')}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </Dialog>

      <Dialog
        open={desktopConfigAvailable && isAddFormOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            installed.resetForm();
            setAddFormOpen(false);
          }
        }}
        size="sm"
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('form.title')}</DialogTitle>
          </DialogHeading>
          <DialogClose />
        </DialogHeader>
        <DialogBody inset="none">
        <div className="bitfun-skills-scene__modal-form">
          <Field label={t('form.level.label')} controlWidth="fill">
            <Select
              options={[
                { label: t('form.level.user'), value: 'user' },
                {
                  label: `${t('form.level.project')}${installed.hasWorkspace && !installed.isRemoteWorkspace ? '' : t('form.level.projectDisabled')}`,
                  value: 'project',
                  disabled: !installed.hasWorkspace || installed.isRemoteWorkspace,
                },
              ]}
              value={installed.formLevel}
              onValueChange={(value) => installed.setFormLevel(value as SkillLevel)}
              size="md"
            />
          </Field>

          {installed.formLevel === 'project' && installed.hasWorkspace ? (
            <div className="bitfun-skills-scene__form-hint">
              {t('form.level.selectedProjectPath', { path: installed.workspacePath })}
            </div>
          ) : null}

          <div className="bitfun-skills-scene__path-input">
            <Field label={t('form.path.label')} controlWidth="fill">
              <Input
                placeholder={t('form.path.placeholder')}
                value={installed.formPath}
                onChange={(e) => installed.setFormPath(e.target.value)}
              />
            </Field>
            <IconButton
              size="md"
              onClick={installed.handleBrowse}
              aria-label={t('form.path.browseTooltip')}
              title={t('form.path.browseTooltip')}
              icon={<FolderOpen size={15} />}
            />
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
              variant="fill"
              size="sm"
              onClick={() => {
                installed.resetForm();
                setAddFormOpen(false);
              }}
            >
              {t('form.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddSkill}
              disabled={!installed.validationResult?.valid || installed.isAdding}
            >
              {installed.isAdding ? t('form.actions.adding') : t('form.actions.add')}
            </Button>
          </div>
        </div>
              </DialogBody>
      </Dialog>

      <ConfirmDialog
        open={desktopConfigAvailable && Boolean(deleteTarget)}
        onOpenChange={() => setDeleteTarget(null)}
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
