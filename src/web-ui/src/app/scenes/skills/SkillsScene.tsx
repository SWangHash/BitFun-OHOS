import {
  Button,
  ConfirmDialog,
  Field,
  Icon,
  IconButton,
  Input,
  NavigationPanelItem,
  OverflowText,
  ScrollArea,
  SearchField,
  Select,
  StatusPill,
  Switch,
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
} from '@openbitfun/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Layers, Loader2, Package, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';

import { GalleryDetailModal, GalleryPageHeader } from '@/app/components';
import type { SkillInfo, SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import { installedSkillMarketIds, isSkillMarketItemInstalled } from '@/infrastructure/config/skillMarketInstallation';
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
import SkillGroupsView from './components/SkillGroupsView';
import { useUserSkillGroups } from '@/features/skill-groups/useUserSkillGroups';
import { resolveSkillGroups } from '@/features/skill-groups/skillGroups';
import SkillsLoadMoreSentinel from './components/SkillsLoadMoreSentinel';
import MatrixMarketView from './components/MatrixMarketView';
import type { MatrixSkillSummary } from '@/infrastructure/api/service-api/MatrixSkillAPI';
import './SkillsScene.scss';
import { useSkillsSceneStore, type SkillsView } from './skillsSceneStore';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';

const log = createLogger('SkillsScene');

type SkillTab = 'installed' | 'discover' | 'matrix';

interface CategoryInfo {
  id: SkillsView;
  icon: React.ReactNode;
  labelKey: string;
  titleKey: string;
  descKey: string;
  sourceLabel?: string;
}

const CATEGORIES: CategoryInfo[] = [
  {
    id: 'all',
    icon: <Layers size={15} strokeWidth={1.6} />,
    labelKey: 'filters.all',
    titleKey: 'installed.titleListAll',
    descKey: 'categories.all',
  },
  {
    id: 'builtin',
    icon: <ShieldCheck size={15} strokeWidth={1.6} />,
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
    icon: <FolderOpen size={15} strokeWidth={1.6} />,
    labelKey: 'filters.project',
    titleKey: 'installed.titleProject',
    descKey: 'categories.project',
  },
  {
    id: 'groups',
    icon: <Layers size={15} strokeWidth={1.6} />,
    labelKey: 'filters.groups',
    titleKey: 'groups.title',
    descKey: 'categories.groups',
  },
];

const SkillsScene: React.FC = () => {
  const { t } = useTranslation('scenes/skills');
  const { t: tComponents, formatNumber } = useI18n('components');
  const notification = useNotification();
  const peerDevice = usePeerDeviceModeOptional();
  const remoteConnectionActive = peerDevice?.peerMode.active === true;
  const desktopConfigAvailable = isTauriRuntime() && !remoteConnectionActive;
  const {
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

  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [deleteTarget, setDeleteTarget] = useState<SkillInfo | null>(null);
  const [installedSearch, setInstalledSearch] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<
    | { type: 'installed'; skillKey: string }
    | { type: 'market'; skill: SkillMarketItem }
    | { type: 'matrix'; skill: MatrixSkillSummary }
    | null
  >(null);

  const installed = useInstalledSkills({
    searchQuery: installedSearch,
    activeFilter: installedView === 'groups' ? 'all' : installedView,
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
    setActiveTab('installed');
    setAddFormOpen(false);
    setDeleteTarget(null);
    setSelectedDetail(null);
  }, [desktopConfigAvailable, setAddFormOpen]);

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
    await Promise.all([installed.loadSkills(true), market.refresh(), skillGroups.reload()]);
  }, [installed, market, skillGroups]);

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

  const installedCategories: CategoryInfo[] = [
    ...CATEGORIES,
    ...installed.sourceGroups.map((group) => ({
      id: group.id,
      icon: <Icon name="extension" size="sm" />,
      labelKey: 'filters.source',
      titleKey: 'installed.titleSource',
      descKey: 'categories.source',
      sourceLabel: group.label,
    })),
  ];
  const activeInstalledCategory = installedCategories.find((category) => category.id === installedView)
    ?? CATEGORIES[0];

  useEffect(() => {
    if (!installed.loading && !installed.error && installedView.startsWith('source:')
      && !installed.sourceGroups.some((group) => group.id === installedView)) {
      setInstalledView('all');
    }
  }, [installed.loading, installed.error, installed.sourceGroups, installedView, setInstalledView]);

  return (
    <div className="openbitfun-skills-scene" data-testid="agent-skill-panel" data-openbitfun-scene="skills" data-openbitfun-part="root" data-openbitfun-tab={activeTab}>
<GalleryPageHeader
        title={t('nav.title')}
        subtitle={t('page.subtitle')}
        actions={desktopConfigAvailable && activeTab === 'installed' ? (
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Icon name="plus" size="sm" />}
            onClick={toggleAddForm}
            data-testid="skills-add-skill-btn"
          >
            {t('toolbar.addTooltip')}
          </Button>
        ) : undefined}
      />
      <div className="skills-tabs-bar" data-testid="skills-tabs" data-openbitfun-scene="skills" data-openbitfun-part="header" data-openbitfun-tab={activeTab}>
        <div className="skills-tabs-bar__tabs" data-openbitfun-scene="skills" data-openbitfun-part="tabs">
          <Button
            size="sm"
            variant={activeTab === 'installed' ? 'fill' : 'text'}
            className="skills-tabs-bar__tab"
            aria-pressed={activeTab === 'installed'}
            onClick={() => setActiveTab('installed')}
            data-openbitfun-scene="skills"
            data-openbitfun-part="tab"
            data-openbitfun-tab="installed"
            data-openbitfun-state={activeTab === 'installed' ? 'active' : undefined}
          ><span>{t('installed.titleAll')}</span></Button>
          <span className="skills-tabs-bar__divider" data-openbitfun-scene="skills" data-openbitfun-part="tabDivider" />
          <Button
            size="sm"
            variant={activeTab === 'discover' ? 'fill' : 'text'}
            className="skills-tabs-bar__tab"
            aria-pressed={activeTab === 'discover'}
            disabled={!desktopConfigAvailable}
            onClick={() => setActiveTab('discover')}
            data-openbitfun-scene="skills"
            data-openbitfun-part="tab"
            data-openbitfun-tab="discover"
            data-openbitfun-state={activeTab === 'discover' ? 'active' : undefined}
          ><span>{t('market.title')}</span></Button>
          <span className="skills-tabs-bar__divider" data-openbitfun-scene="skills" data-openbitfun-part="tabDivider" />
          <Button
            size="sm"
            variant={activeTab === 'matrix' ? 'fill' : 'text'}
            className="skills-tabs-bar__tab"
            aria-pressed={activeTab === 'matrix'}
            disabled={!desktopConfigAvailable}
            onClick={() => setActiveTab('matrix')}
            data-openbitfun-scene="skills"
            data-openbitfun-part="tab"
            data-openbitfun-tab="matrix"
            data-openbitfun-state={activeTab === 'matrix' ? 'active' : undefined}
          ><span>{t('matrix.tabLabel')}</span></Button>
        </div>
      </div>

      <div className="skills-page" data-openbitfun-scene="skills" data-openbitfun-part="content" data-openbitfun-tab={activeTab}>

        {activeTab === 'installed' && (
          <div className="skills-installed" data-openbitfun-scene="skills" data-openbitfun-part="installed">
            {desktopConfigAvailable && <ScrollArea className="skills-sidebar" data-openbitfun-scene="skills" data-openbitfun-part="sidebar">
              <div className="skills-sidebar__header" data-openbitfun-scene="skills" data-openbitfun-part="sidebarHeader">
                <h2 className="skills-sidebar__title" data-openbitfun-scene="skills" data-openbitfun-part="sidebarTitle">{t('installed.titleAll')}</h2>
              </div>
<nav className="skills-sidebar__nav" aria-label={t('installed.titleAll')} data-openbitfun-scene="skills" data-openbitfun-part="sidebarNav">
                {installedCategories.map((cat) => {
                  const count = cat.id === 'groups' ? skillGroupCount : installed.counts[cat.id] ?? 0;
                  const isEmpty = count === 0;
                  return (
                    <div
                      key={cat.id}
                      className="skills-sidebar__item"
                      data-openbitfun-scene="skills"
                      data-openbitfun-part="sidebarItem"
                      data-openbitfun-category={cat.id}
                      data-openbitfun-state={[
                        installedView === cat.id && 'active',
                        isEmpty && 'empty',
                      ].filter(Boolean).join(' ') || undefined}
                    >
<NavigationPanelItem
                        selected={installedView === cat.id}
                        onClick={() => setInstalledView(cat.id)}
                        title={t(cat.descKey, { source: cat.sourceLabel })}
                        leading={<span data-openbitfun-scene="skills" data-openbitfun-part="sidebarItemIcon">{cat.icon}</span>}
                        metadata={(
                          <span className="skills-sidebar__item-count" data-openbitfun-scene="skills" data-openbitfun-part="sidebarItemCount">
                            {formatNumber(count)}
                          </span>
                        )}
                      >
                        <span data-openbitfun-scene="skills" data-openbitfun-part="sidebarItemLabel">{t(cat.labelKey, { source: cat.sourceLabel })}</span>
                      </NavigationPanelItem>
                    </div>
                  );
                })}
              </nav>
              <div className="skills-sidebar__footer" data-openbitfun-scene="skills" data-openbitfun-part="sidebarFooter">
                <p className="skills-sidebar__hint" data-openbitfun-scene="skills" data-openbitfun-part="sidebarHint">
                  {t(activeInstalledCategory.descKey, { source: activeInstalledCategory.sourceLabel })}
                </p>
              </div>
            </ScrollArea>}

            <div className="skills-main" data-openbitfun-scene="skills" data-openbitfun-part="main">
              {!desktopConfigAvailable ? (
                <div className="skills-main__empty" data-testid="skills-management-unavailable" data-openbitfun-scene="skills" data-openbitfun-part="empty">
                  <Package size={28} strokeWidth={1.2} />
                  <span>{t(remoteConnectionActive ? 'list.remoteUnavailable' : 'list.desktopUnavailable')}</span>
                </div>
              ) : installedView === 'groups' ? (
                <SkillGroupsView
                  key={installed.catalogContextKey}
                  skills={groupSkills}
                  collection={skillGroups}
                  catalogReady={installed.catalogReady}
                  catalogLoading={installed.loading}
                  catalogIncomplete={installed.diagnostics.length > 0 || !installed.diagnosticsAvailable}
                  onRefresh={() => { void installed.loadSkills(true); void skillGroups.reload(); }}
                />
              ) : (
                <>
                  <div className="skills-main__toolbar" data-openbitfun-scene="skills" data-openbitfun-part="toolbar">
                    <SearchField
                      className="skills-main__toolbar-search"
                      value={installedSearch}
                      onValueChange={setInstalledSearch}
                      leadingIcon={<Icon name="search" size="sm" aria-hidden />}
                      placeholder={t('toolbar.searchPlaceholder')}
                      aria-label={t('toolbar.searchPlaceholder')}
                      size="sm"
                      clearLabel={installedSearch ? tComponents('search.clear') : undefined}
                      onClear={installedSearch ? () => setInstalledSearch('') : undefined}
                    />
                    <button
                      type="button"
                      className={`skills-main__chip-btn${hideDuplicates ? ' is-active' : ''}`}
                      onClick={() => setHideDuplicates(!hideDuplicates)}
                      data-openbitfun-scene="skills"
                      data-openbitfun-part="filterAction"
                      data-openbitfun-state={hideDuplicates ? 'active' : undefined}
                    >
                      <Icon name="filter" size="xs" />
                      <span>{t('toolbar.hideDuplicates')}</span>
                    </button>
                    <Button
                      variant="fill"
                      size="sm"
                      leadingIcon={<Icon name="plus" size="xs" />}
                      onClick={toggleAddForm}
                      data-testid="skills-add-skill-btn"
                    >
                      {t('toolbar.addTooltip')}
                    </Button>
                  </div>

                  <div className="skills-main__list-shell">
                    <div
                      className="skills-main__list-header"
                      data-openbitfun-scene="skills"
                      data-openbitfun-part="installedListHeader"
                    >
                      <div className="skills-main__list-heading">
                        <span data-openbitfun-scene="skills" data-openbitfun-part="installedListTitle">
                          {t(activeInstalledCategory.titleKey, { source: activeInstalledCategory.sourceLabel })}
                        </span>
                        <span
                          className="skills-main__list-count"
                          data-openbitfun-scene="skills"
                          data-openbitfun-part="installedListCount"
                        >
                          {installedFiltered.length}
                        </span>
                      </div>
                      <span className="skills-main__column-label skills-main__column-label--source">
                        {t('list.columns.source')}
                      </span>
                      <span className="skills-main__column-label skills-main__column-label--level">
                        {t('list.columns.level')}
                      </span>
                      <span className="skills-main__column-label skills-main__column-label--status">
                        {t('list.columns.status')}
                      </span>
                      <span className="skills-main__column-label skills-main__column-label--actions">
                        {t('list.columns.actions')}
                      </span>
                    </div>

                    {installed.loading && (
                      <ScrollArea className="skills-main__loading" aria-busy="true" aria-label={t('list.loading')}>
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div
                            key={`ins-sk-${i}`}
                            className="skills-card-skeleton"
                            style={{ '--surface-stagger-index': i } as React.CSSProperties}
                            data-openbitfun-scene="skills"
                            data-openbitfun-part="skeleton"
                          />
                        ))}
                      </ScrollArea>
                    )}

                    {!installed.loading && installed.error && (
                      <div className="skills-main__empty skills-main__empty--error" data-openbitfun-scene="skills" data-openbitfun-part="error">
                        <Package size={28} strokeWidth={1.2} />
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
                      <div className="skills-main__empty" data-testid="skill-list-empty" data-openbitfun-scene="skills" data-openbitfun-part="empty">
                        <Package size={28} strokeWidth={1.2} />
                        <span>
                          {installed.skills.length === 0
                            ? t('list.empty.noSkills')
                            : t('list.empty.noMatch')}
                        </span>
                      </div>
                    )}

                    {!installed.loading && !installed.error && installedFiltered.length > 0 && (
                      <ScrollArea
                        className="skills-main__grid"
                        data-testid="skill-list"
                        data-openbitfun-scene="skills"
                        data-openbitfun-part="list"
                      >
                        {installedFiltered.map((skill, index) => (
                          <div
                            key={skill.key}
                            className={[
                              'skills-card',
                              skill.isShadowed && 'is-shadowed',
                              skill.level === 'user'
                                && installed.globallyDisabledSkillKeys.has(skill.key)
                                && 'is-globally-disabled',
                            ].filter(Boolean).join(' ')}
                            style={{ '--surface-stagger-index': index } as React.CSSProperties}
                            onClick={() => setSelectedDetail({ type: 'installed', skillKey: skill.key })}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedDetail({ type: 'installed', skillKey: skill.key });
                              }
                            }}
                            aria-label={installedSkillAriaLabel(skill)}
                            data-testid="skill-list-item"
                            data-skill-key={skill.key}
                            data-skill-id={skill.key}
                            data-skill-name={skill.name}
                            data-skill-level={skill.level}
                            data-skill-builtin={skill.isBuiltin ? 'true' : 'false'}
                            data-openbitfun-scene="skills"
                            data-openbitfun-part="installedCard"
                            data-openbitfun-level={skill.level}
                            data-openbitfun-state={[
                              skill.isShadowed && 'shadowed',
                              skill.isBuiltin && 'builtin',
                            ].filter(Boolean).join(' ') || undefined}
                          >
                            <div className="skills-card__top" data-openbitfun-scene="skills" data-openbitfun-part="installedCardTop">
                              <div className="skills-card__icon" data-openbitfun-scene="skills" data-openbitfun-part="installedCardIcon">
                                <Icon name="extension" size="md" />
                              </div>
                              <div className="skills-card__info" data-openbitfun-scene="skills" data-openbitfun-part="installedCardInfo">
                                <span className="skills-card__name" data-testid="skill-list-item-title" data-openbitfun-scene="skills" data-openbitfun-part="installedCardName">
                                  <OverflowText behavior="marquee" title="">{skill.name}</OverflowText>
                                </span>
                                {skill.description?.trim() && (
                                  <OverflowText lines={2} title="" className="skills-card__desc" data-testid="skill-list-item-description" data-openbitfun-scene="skills" data-openbitfun-part="installedCardDescription">{skill.description}</OverflowText>
                                )}
                                <div className="skills-card__status-badges">
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
                                </div>
                              </div>
                            </div>

                            <div
                              className="skills-card__meta"
                              data-openbitfun-scene="skills"
                              data-openbitfun-part="installedCardMeta"
                            >
                              <span
                                className="skills-card__source"
                                data-openbitfun-scene="skills"
                                data-openbitfun-part="installedCardSource"
                              >
                                <StatusPill className="skills-card__source-pill" tone="neutral">
                                  {getSkillSourceLabel(skill, t('list.item.unknownSource'))}
                                </StatusPill>
                              </span>
                            </div>

                            <div
                              className="skills-card__level"
                              data-openbitfun-scene="skills"
                              data-openbitfun-part="installedCardLevel"
                            >
                              {skill.level === 'user'
                                ? <Icon name="user" size="xs" />
                                : <Icon glyph={FolderOpen} size="xs" />}
                              <OverflowText title="">
                                {market.isRemoteWorkspace
                                  ? skill.level === 'user'
                                    ? t('list.item.localUser')
                                    : t('list.item.remoteProject')
                                  : skill.level === 'user'
                                    ? t('list.item.user')
                                    : t('list.item.project')}
                              </OverflowText>
                            </div>

                            <div
                              className="skills-card__global-toggle"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              data-openbitfun-scene="skills"
                              data-openbitfun-part="installedCardStatus"
                            >
                              {skill.level === 'user' ? (
                                <Switch
                                  checked={!installed.globallyDisabledSkillKeys.has(skill.key)}
                                  disabled={installed.savingGlobalSkillKey !== null}
                                  aria-busy={installed.savingGlobalSkillKey === skill.key}
                                  aria-label={t('list.item.globalToggleLabel', { name: skill.name })}
                                  onChange={(event) => {
                                    void installed.handleGlobalSkillToggle(skill, event.target.checked);
                                  }}
                                />
                              ) : (
                                <span className="skills-card__status-unavailable" aria-hidden="true">—</span>
                              )}
                            </div>

                            <div
                              className="skills-card__actions"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              data-openbitfun-scene="skills"
                              data-openbitfun-part="installedCardActions"
                            >
                              <IconButton
                                size="sm"
                                onClick={() => setSelectedDetail({ type: 'installed', skillKey: skill.key })}
                                aria-label={t('list.item.detail')}
                                title={t('list.item.detail')}
                                data-openbitfun-scene="skills"
                                data-openbitfun-part="installedCardDetails"
                                icon={<Icon name="arrow-right" size="sm" />}
                              />
                              {canDeleteSkill(skill) && (
                                <IconButton
                                  size="sm"
                                  tone="danger"
                                  onClick={() => setDeleteTarget(skill)}
                                  aria-label={t('list.item.deleteTooltip')}
                                  title={t('list.item.deleteTooltip')}
                                  data-openbitfun-scene="skills"
                                  data-openbitfun-part="installedCardDelete"
                                  icon={<Icon name="delete" size="lg" style={{ width: 13, height: 13 }} />}
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </ScrollArea>
                    )}
                  </div>

                </>
              )}
            </div>
          </div>
        )}

        {desktopConfigAvailable && activeTab === 'discover' && (
          <div className="skills-discover" data-openbitfun-scene="skills" data-openbitfun-part="discover">
            <div className="skills-discover__hero" data-openbitfun-scene="skills" data-openbitfun-part="discoverHero">
              <div className="skills-discover__hero-content" data-openbitfun-scene="skills" data-openbitfun-part="discoverHeroContent">
                <h1 className="skills-discover__title" data-openbitfun-scene="skills" data-openbitfun-part="discoverTitle">{t('market.title')}</h1>
                <p className="skills-discover__subtitle" data-openbitfun-scene="skills" data-openbitfun-part="discoverSubtitle">
                  {t('market.subtitle')}
                </p>
                <div className="skills-discover__search-wrapper" data-openbitfun-scene="skills" data-openbitfun-part="discoverSearch">
                  <SearchField
                    className="skills-discover__search"
                    value={searchDraft}
                    onValueChange={setSearchDraft}
                    onSearch={submitMarketQuery}
                    leadingIcon={<Icon name="search" size="sm" aria-hidden />}
                    placeholder={t('market.searchPlaceholder')}
                    aria-label={t('market.searchPlaceholder')}
                    size="md"
                    clearLabel={searchDraft ? tComponents('search.clear') : undefined}
                    onClear={searchDraft ? () => {
                      setSearchDraft('');
                      submitMarketQuery();
                    } : undefined}
                  />
                </div>
              </div>
            </div>

            <ScrollArea className="skills-discover__content">
              {market.marketLoading && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')} data-openbitfun-scene="skills" data-openbitfun-part="loading">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`mkt-sk-${i}`}
                      className="skills-discover__skeleton-card"
                      style={{ '--surface-stagger-index': i } as React.CSSProperties}
                      data-openbitfun-scene="skills"
                      data-openbitfun-part="skeleton"
                    />
                  ))}
                </div>
              )}

              {!market.marketLoading && market.marketError && (
                <div className="skills-discover__empty skills-discover__empty--error" data-openbitfun-scene="skills" data-openbitfun-part="error">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{market.marketError}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.loadingMore && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')} data-openbitfun-scene="skills" data-openbitfun-part="loading">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`mkt-page-sk-${i}`}
                      className="skills-discover__skeleton-card"
                      style={{ '--surface-stagger-index': i } as React.CSSProperties}
                      data-openbitfun-scene="skills"
                      data-openbitfun-part="skeleton"
                    />
                  ))}
                </div>
              )}

              {!market.marketLoading && !market.marketError && !market.loadingMore && market.marketSkills.length === 0 && (
                <div className="skills-discover__empty" data-testid="skill-list-empty" data-openbitfun-scene="skills" data-openbitfun-part="empty">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{marketQuery ? t('market.empty.noMatch') : t('market.empty.noSkills')}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && !market.loadingMore && market.marketSkills.length > 0 && (
                <>
                  {marketQuery && (
                    <div className="skills-discover__results-info" data-openbitfun-scene="skills" data-openbitfun-part="resultsInfo">
                      <span>
                        {t('market.resultsInfo', { query: marketQuery, count: market.totalLoaded })}
                      </span>
                    </div>
                  )}

                  <div className="skills-discover__grid" data-testid="skill-list" data-openbitfun-scene="skills" data-openbitfun-part="list">
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
                            <span className="openbitfun-skills-scene__market-meta">
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
                                : (isInstalled ? t('market.item.installedTooltip') : t('market.item.downloadProject')),
                              disabled:
                                isDownloading
                                || !market.hasWorkspace
                                || market.isRemoteWorkspace
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

        {desktopConfigAvailable && activeTab === 'matrix' && (
          <div className="skills-discover" data-openbitfun-scene="skills" data-openbitfun-part="discover">
            <div className="skills-discover__hero" data-openbitfun-scene="skills" data-openbitfun-part="discoverHero">
              <div className="skills-discover__hero-content" data-openbitfun-scene="skills" data-openbitfun-part="discoverHeroContent">
                <h1 className="skills-discover__title" data-openbitfun-scene="skills" data-openbitfun-part="discoverTitle">{t('matrix.title')}</h1>
                <p className="skills-discover__subtitle" data-openbitfun-scene="skills" data-openbitfun-part="discoverSubtitle">
                  {t('matrix.subtitle')}
                </p>
                <div className="skills-discover__search-wrapper" data-openbitfun-scene="skills" data-openbitfun-part="discoverSearch">
                  <SearchField
                    className="skills-discover__search"
                    value={matrix.keyword}
                    onValueChange={matrix.setKeyword}
                    onSearch={matrix.submitKeyword}
                    leadingIcon={<Icon name="search" size="sm" aria-hidden />}
                    placeholder={t('matrix.searchPlaceholder')}
                    aria-label={t('matrix.searchPlaceholder')}
                    size="md"
                    clearLabel={matrix.keyword ? tComponents('search.clear') : undefined}
                    onClear={matrix.keyword ? () => {
                      matrix.setKeyword('');
                      matrix.submitKeyword();
                    } : undefined}
                  />
                </div>
              </div>
            </div>

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

      <GalleryDetailModal
        isOpen={desktopConfigAvailable && Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        icon={selectedMarketSkill || selectedMatrixSkill ? <Package size={24} strokeWidth={1.6} /> : <Icon name="extension" size="lg" />}
        iconGradient={getCardGradient(
          selectedInstalledSkill?.name
          ?? selectedMarketSkill?.installId
          ?? selectedMarketSkill?.name
          ?? selectedMatrixSkill?.enName
          ?? 'skill'
        )}
        title={selectedInstalledSkill?.name ?? selectedMarketSkill?.name ?? selectedMatrixSkill?.name ?? ''}
        badges={selectedInstalledSkill ? (
          <>
            {selectedInstalledSkill.isShadowed && (
              <span title={t('list.item.shadowedTooltip', {
                source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                  ?? t('list.item.unknownSource'),
              })}>
                <StatusPill tone="warning" leading={<ShieldAlert size={11} />}>
                  {t('list.item.shadowed')}
                </StatusPill>
              </span>
            )}
            <StatusPill tone="neutral">
              {getSkillSourceLabel(selectedInstalledSkill, t('list.item.unknownSource'))}
            </StatusPill>
            <StatusPill tone={selectedInstalledSkill.isBuiltin ? 'accent' : 'success'}>
              {selectedInstalledSkill.isBuiltin ? t('list.item.builtin') : t('list.item.userInstalled')}
            </StatusPill>
            <StatusPill tone={selectedInstalledSkill.level === 'user' ? 'info' : 'accent'}>
              {market.isRemoteWorkspace
                ? selectedInstalledSkill.level === 'user'
                  ? t('list.item.localUser')
                  : t('list.item.remoteProject')
                : selectedInstalledSkill.level === 'user'
                  ? t('list.item.user')
                  : t('list.item.project')}
            </StatusPill>
          </>

        ) : selectedMarketSkill && isSkillMarketItemInstalled(selectedMarketSkill, installedMarketIds) ? (
          <StatusPill tone="success" leading={<Icon name="check-circle" size="2xs" />}>
            {t('market.item.installed')}
          </StatusPill>
        ) : selectedMatrixSkill && installedMatrixEnNames.has(selectedMatrixSkill.enName) ? (
          <StatusPill tone="success" leading={<Icon name="check-circle" size="2xs" />}>
            {t('matrix.item.installed')}
          </StatusPill>
        ) : null}
        description={selectedInstalledSkill?.description ?? selectedMarketSkill?.description ?? selectedMatrixSkill?.description}
        testId="skill-detail-panel"
        titleTestId="skill-detail-title"
        descriptionTestId="skill-detail-description"
        closeButtonTestId="skill-detail-close"
        meta={selectedMarketSkill ? (
          <span className="openbitfun-skills-scene__market-meta">
            <TrendingUp size={12} />
            {selectedMarketSkill.installs ?? 0}
          </span>
        ) : selectedMatrixSkill ? (
          <span className="openbitfun-skills-scene__market-meta">
            <TrendingUp size={12} />
            {selectedMatrixSkill.download ?? 0}
          </span>
        ) : null}
        actions={selectedInstalledSkill && canDeleteSkill(selectedInstalledSkill) ? (
          <Button
            variant="fill"
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
        ) : selectedMarketSkill ? (
          <>
            {isSkillMarketItemInstalled(selectedMarketSkill, installedMarketIds) ? (
              <Button variant="outline" size="sm" disabled>
                {t('market.item.installed')}
              </Button>
            ) : (
              <>
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
              </>
            )}
          </>
        ) : selectedMatrixSkill ? (
          <>
            {installedMatrixEnNames.has(selectedMatrixSkill.enName) ? (
              <Button variant="outline" size="sm" disabled>
                {t('matrix.item.installed')}
              </Button>
            ) : (
              <>
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
              </>
            )}
          </>
        ) : null}
      >
        {selectedInstalledSkill ? (
          <>
            <div className="openbitfun-skills-scene__detail-row">
              <span className="openbitfun-skills-scene__detail-label">{t('list.item.sourceLabel')}</span>
              <span className="openbitfun-skills-scene__detail-value">
                {getSkillSourceLabel(selectedInstalledSkill, t('list.item.unknownSource'))}
              </span>
            </div>
            {selectedInstalledSkill.isShadowed && (
              <div className="openbitfun-skills-scene__detail-row">
                <span className="openbitfun-skills-scene__detail-label">{t('list.item.shadowedLabel')}</span>
                <span className="openbitfun-skills-scene__detail-value">
                  {t('list.item.shadowedDetail', {
                    source: coverageSourceBySkillKey.get(selectedInstalledSkill.key)
                      ?? t('list.item.unknownSource'),
                  })}
                </span>
              </div>
            )}
            <div className="openbitfun-skills-scene__detail-row" data-testid="skill-detail-capabilities-section">
              <span className="openbitfun-skills-scene__detail-label">{t('list.item.pathLabel')}</span>
              {canRevealSkillPath ? (
                <button
                  type="button"
                  className="openbitfun-skills-scene__detail-path-btn"
                  title={t('list.item.openPathInExplorer')}
                  onClick={() => void handleRevealSkillPath(selectedInstalledSkill.path)}
                  data-testid="skills-detail-path-btn"
                >
                  {selectedInstalledSkill.path}
                </button>
              ) : (
                <code className="openbitfun-skills-scene__detail-value">{selectedInstalledSkill.path}</code>
              )}
            </div>
          </>
        ) : null}

        {selectedMarketSkill?.source ? (
          <div className="openbitfun-skills-scene__detail-row" data-testid="skill-detail-capabilities-section">
            <span className="openbitfun-skills-scene__detail-label">{t('market.item.sourceLabel')}</span>
            <span className="openbitfun-skills-scene__detail-value">{selectedMarketSkill.source}</span>
          </div>
        ) : null}

        {selectedMarketSkill ? (
          <div className="openbitfun-skills-scene__detail-row">
            <span className="openbitfun-skills-scene__detail-label">{t('market.detail.installsLabel')}</span>
            <span className="openbitfun-skills-scene__detail-value">{selectedMarketSkill.installs ?? 0}</span>
          </div>
        ) : null}

        {selectedMarketSkill?.url ? (
          <div className="openbitfun-skills-scene__detail-row">
            <span className="openbitfun-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
            <a
              href={selectedMarketSkill.url}
              target="_blank"
              rel="noreferrer"
              className="openbitfun-skills-scene__detail-link"
              data-testid="skills-detail-external-link"
            >
              {selectedMarketSkill.url}
            </a>
          </div>
        ) : null}

        {selectedMatrixSkill ? (
          <>
            {selectedMatrixSkill.repository ? (
              <div className="openbitfun-skills-scene__detail-row">
                <span className="openbitfun-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
                <a
                  href={selectedMatrixSkill.repository}
                  target="_blank"
                  rel="noreferrer"
                  className="openbitfun-skills-scene__detail-link"
                >
                  {selectedMatrixSkill.repository}
                </a>
              </div>
            ) : null}
            {selectedMatrixSkill.version ? (
              <div className="openbitfun-skills-scene__detail-row">
                <span className="openbitfun-skills-scene__detail-label">{t('market.detail.versionLabel')}</span>
                <span className="openbitfun-skills-scene__detail-value">{selectedMatrixSkill.version}</span>
              </div>
            ) : null}
            {selectedMatrixSkill.organization?.name ? (
              <div className="openbitfun-skills-scene__detail-row">
                <span className="openbitfun-skills-scene__detail-label">{t('market.detail.orgLabel')}</span>
                <span className="openbitfun-skills-scene__detail-value">{selectedMatrixSkill.organization.name}</span>
              </div>
            ) : null}
            {selectedMatrixSkill.tags && selectedMatrixSkill.tags.length > 0 ? (
              <div className="openbitfun-skills-scene__detail-row">
                <span className="openbitfun-skills-scene__detail-label">{t('market.detail.tagsLabel')}</span>
                <span className="openbitfun-skills-scene__detail-value">
                  {selectedMatrixSkill.tags.map((tag) => tag.name).join(', ')}
                </span>
              </div>
            ) : null}
            <div className="openbitfun-skills-scene__detail-row">
              <span className="openbitfun-skills-scene__detail-label">{t('market.detail.installsLabel')}</span>
              <span className="openbitfun-skills-scene__detail-value">{selectedMatrixSkill.download ?? 0}</span>
            </div>
          </>
        ) : null}
      </GalleryDetailModal>

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
        <div className="openbitfun-skills-scene__modal-form">
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
            <div className="openbitfun-skills-scene__form-hint">
              {t('form.level.selectedProjectPath', { path: installed.workspacePath })}
            </div>
          ) : null}

          <div className="openbitfun-skills-scene__path-input">
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
          <div className="openbitfun-skills-scene__path-hint">
            {t('form.path.hint')}
          </div>

          {installed.isValidating ? (
            <div className="openbitfun-skills-scene__validating">{t('form.validating')}</div>
          ) : null}

          {installed.validationResult ? (
            <div
              className={[
                'openbitfun-skills-scene__validation',
                installed.validationResult.valid ? 'is-valid' : 'is-invalid',
              ].filter(Boolean).join(' ')}
            >
              {installed.validationResult.valid ? (
                <>
                  <div className="openbitfun-skills-scene__validation-name">
                    {installed.validationResult.name}
                  </div>
                  <div className="openbitfun-skills-scene__validation-desc">
                    {installed.validationResult.description}
                  </div>
                </>
              ) : (
                <div className="openbitfun-skills-scene__validation-error">
                  {installed.validationResult.error}
                </div>
              )}
            </div>
          ) : null}

          <div className="openbitfun-skills-scene__modal-form-actions">
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
