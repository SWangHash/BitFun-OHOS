import React from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Download, Loader2, Package, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  MatrixCategoryItem,
  MatrixSidebarItem,
  MatrixSkillSummary,
} from '@/infrastructure/api/service-api/MatrixSkillAPI';
import type { MatrixSection } from '../hooks/useMatrixSkillMarket';
import type { SkillLevel } from '@/infrastructure/config/types';
import SkillCard from './SkillCard';
import SkillsLoadMoreSentinel from './SkillsLoadMoreSentinel';

interface MatrixMarketViewProps {
  tags: { id: string; name: string; enName: string }[];
  tagsLoading: boolean;
  tagsError: string | null;
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  onClearTags: () => void;

  categories: MatrixCategoryItem[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  selectedCategoryId: string | null;
  onToggleCategory: (categoryId: string) => void;

  organizations: MatrixSidebarItem[];
  organizationsLoading: boolean;
  organizationsError: string | null;
  selectedOrgId: string | null;
  onToggleOrganization: (orgId: string) => void;

  activeSection: MatrixSection;
  onSelectSection: (section: MatrixSection) => void;

  skills: MatrixSkillSummary[];
  totalCount: number;
  skillsLoading: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  skillsError: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;

  installingEnName: string | null;
  installError: string | null;
  onInstall: (skill: MatrixSkillSummary, targetLevel?: SkillLevel) => Promise<void>;
  onOpenDetails: (skill: MatrixSkillSummary) => void;

  hasWorkspace: boolean;
  isRemoteWorkspace: boolean;
  isAssistantWorkspace: boolean;

  installedEnNames: Set<string>;
}

const SECTIONS: MatrixSection[] = ['feature', 'tag', 'cat', 'org'];

const MatrixMarketView: React.FC<MatrixMarketViewProps> = ({
  tags,
  tagsLoading,
  tagsError,
  selectedTagIds,
  onToggleTag,
  onClearTags,
  categories,
  categoriesLoading,
  categoriesError,
  selectedCategoryId,
  onToggleCategory,
  organizations,
  organizationsLoading,
  organizationsError,
  selectedOrgId,
  onToggleOrganization,
  activeSection,
  onSelectSection,
  skills,
  totalCount,
  skillsLoading,
  loadingMore,
  loadMoreError,
  skillsError,
  hasMore,
  onLoadMore,
  onRetryLoadMore,
  installingEnName,
  installError,
  onInstall,
  onOpenDetails,
  hasWorkspace,
  isRemoteWorkspace,
  isAssistantWorkspace,
  installedEnNames,
}) => {
  const { t, i18n } = useTranslation('scenes/skills');
  const isZh = i18n.language?.startsWith('zh');

  const [chipsExpanded, setChipsExpanded] = React.useState(false);
  const [chipsOverflowing, setChipsOverflowing] = React.useState(false);
  const chipsRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const chipsExpandedRef = React.useRef(false);
  chipsExpandedRef.current = chipsExpanded;

  React.useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeSection, selectedTagIds, selectedCategoryId, selectedOrgId]);

  const updateLayout = React.useCallback(() => {
    const measureEl = measureRef.current;
    const listEl = listRef.current;
    const scrollEl = chipsRef.current;
    if (!measureEl || !listEl || !scrollEl) {
      return;
    }
    setChipsOverflowing(measureEl.offsetWidth > listEl.clientWidth + 1);
    const children = Array.from(scrollEl.children) as HTMLElement[];
    if (chipsExpandedRef.current) {
      children.forEach((child) => {
        child.style.display = '';
      });
      return;
    }
    children.forEach((child) => {
      child.style.display = '';
    });
    const box = scrollEl.getBoundingClientRect();
    const rects = children.map((child) => child.getBoundingClientRect());
    children.forEach((child, index) => {
      child.style.display = rects[index].right <= box.right + 0.5 ? '' : 'none';
    });
  }, []);

  React.useLayoutEffect(() => {
    updateLayout();
  });

  React.useEffect(() => {
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, [updateLayout]);

  React.useEffect(() => {
    const listEl = listRef.current;
    const measureEl = measureRef.current;
    if (!listEl || !measureEl || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateLayout();
    });
    observer.observe(listEl);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, []);

  const sectionLabel = (section: MatrixSection): string => {
    switch (section) {
      case 'feature':
        return t('matrix.sections.featured');
      case 'tag':
        return t('matrix.sections.byTag');
      case 'cat':
        return t('matrix.sections.byCategory');
      case 'org':
        return t('matrix.sections.byOrganization');
      default:
        return '';
    }
  };

  const chipListTestId = activeSection === 'feature'
    ? 'matrix-featured-hint'
    : activeSection === 'tag'
      ? 'matrix-tags-bar'
      : activeSection === 'cat'
        ? 'matrix-categories-bar'
        : 'matrix-organizations-bar';

  const renderChips = () => {
    if (activeSection === 'feature') {
      return (
        <span className="skills-matrix__chip-hint">{t('matrix.featured.hint')}</span>
      );
    }

    if (activeSection === 'tag') {
      return (
        <>
          {tagsLoading && (
            <span className="skills-matrix__chip-loading">{t('matrix.tags.loading')}</span>
          )}
          {!tagsLoading && tagsError && (
            <span className="skills-matrix__chip-error">{tagsError}</span>
          )}
          {!tagsLoading && !tagsError && tags.length === 0 && (
            <span className="skills-matrix__chip-empty">{t('matrix.tags.empty')}</span>
          )}
          {!tagsLoading && !tagsError && tags.length > 0 && (
            <React.Fragment>
              {selectedTagIds.length > 0 && (
                <button
                  type="button"
                  className="skills-matrix__chip skills-matrix__chip--clear"
                  onClick={onClearTags}
                  aria-label={t('matrix.tags.clear')}
                >
                  {t('matrix.tags.clear')}
                </button>
              )}
              {tags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`skills-matrix__chip ${selected ? 'is-active' : ''}`}
                    onClick={() => onToggleTag(tag.id)}
                    aria-pressed={selected}
                    data-bf-scene="skills"
                    data-bf-part="matrixChip"
                  >
                    <span className="skills-matrix__chip-label" data-bf-scene="skills" data-bf-part="matrixChipLabel">{isZh ? tag.name : tag.enName}</span>
                  </button>
                );
              })}
            </React.Fragment>
          )}
        </>
      );
    }

    if (activeSection === 'cat') {
      return (
        <>
          {categoriesLoading && (
            <span className="skills-matrix__chip-loading">{t('matrix.categories.loading')}</span>
          )}
          {!categoriesLoading && categoriesError && (
            <span className="skills-matrix__chip-error">{categoriesError}</span>
          )}
          {!categoriesLoading && !categoriesError && categories.length === 0 && (
            <span className="skills-matrix__chip-empty">{t('matrix.categories.empty')}</span>
          )}
          {!categoriesLoading && !categoriesError && categories.length > 0 && (
            <React.Fragment>
              {selectedCategoryId && (
                <button
                  type="button"
                  className="skills-matrix__chip skills-matrix__chip--clear"
                  onClick={() => onToggleCategory(selectedCategoryId)}
                  aria-label={t('matrix.tags.clear')}
                >
                  {t('matrix.tags.clear')}
                </button>
              )}
              {categories.map((cat) => {
                const selected = selectedCategoryId === cat.id;
                const label = isZh ? cat.cnName : cat.enName;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`skills-matrix__chip ${selected ? 'is-active' : ''}`}
                    onClick={() => onToggleCategory(cat.id)}
                    aria-pressed={selected}
                    data-bf-scene="skills"
                    data-bf-part="matrixChip"
                  >
                    <span className="skills-matrix__chip-label" data-bf-scene="skills" data-bf-part="matrixChipLabel">{label}</span>
                    {typeof cat.count === 'number' && (
                      <span className="skills-matrix__chip-count" data-bf-scene="skills" data-bf-part="matrixChipCount">{cat.count}</span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          )}
        </>
      );
    }

    // org
    return (
        <>
          {organizationsLoading && (
            <span className="skills-matrix__chip-loading">{t('matrix.organizations.loading')}</span>
          )}
          {!organizationsLoading && organizationsError && (
            <span className="skills-matrix__chip-error">{organizationsError}</span>
          )}
          {!organizationsLoading && !organizationsError && organizations.length === 0 && (
            <span className="skills-matrix__chip-empty">{t('matrix.organizations.empty')}</span>
          )}
          {!organizationsLoading && !organizationsError && organizations.length > 0 && (
            <React.Fragment>
              {selectedOrgId && (
                <button
                  type="button"
                  className="skills-matrix__chip skills-matrix__chip--clear"
                  onClick={() => onToggleOrganization(selectedOrgId)}
                  aria-label={t('matrix.tags.clear')}
                >
                  {t('matrix.tags.clear')}
                </button>
              )}
              {organizations.map((org) => {
                const selected = selectedOrgId === org.id;
                const label = isZh ? org.name : org.enName;
                return (
                  <button
                    key={org.id}
                    type="button"
                    className={`skills-matrix__chip ${selected ? 'is-active' : ''}`}
                    onClick={() => onToggleOrganization(org.id)}
                    aria-pressed={selected}
                    data-bf-scene="skills"
                    data-bf-part="matrixChip"
                  >
                    <span className="skills-matrix__chip-label" data-bf-scene="skills" data-bf-part="matrixChipLabel">{label}</span>
                    {typeof org.count === 'number' && (
                      <span className="skills-matrix__chip-count" data-bf-scene="skills" data-bf-part="matrixChipCount">{org.count}</span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
        )}
      </>
    );
  };

  return (
    <div className="skills-discover skills-matrix" data-testid="matrix-market" data-bf-scene="skills" data-bf-part="matrix">
      <div className="skills-matrix__section-bar" role="tablist" data-testid="matrix-section-bar" data-bf-scene="skills" data-bf-part="matrixSectionBar">
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={activeSection === section}
            className={`skills-matrix__section-btn ${activeSection === section ? 'is-active' : ''}`}
            onClick={() => onSelectSection(section)}
            data-bf-scene="skills"
            data-bf-part="matrixSectionBtn"
          >
            {sectionLabel(section)}
          </button>
        ))}
      </div>

      <div className="skills-matrix__chip-row">
        <div
          ref={listRef}
          className="skills-matrix__chip-list"
          data-testid={chipListTestId}
          data-bf-scene="skills"
          data-bf-part="matrixChipList"
        >
          <div ref={measureRef} className="skills-matrix__chip-measure" aria-hidden="true">
            {renderChips()}
          </div>
          <div
            ref={chipsRef}
            className={`skills-matrix__chip-scroll${chipsExpanded ? ' is-expanded' : ''}`}
          >
            {renderChips()}
            {chipsExpanded && (
              <button
                type="button"
                className="skills-matrix__chip-expand skills-matrix__chip-expand--inline"
                onClick={() => setChipsExpanded(false)}
                aria-expanded="true"
                aria-label={t('matrix.tags.collapse')}
              >
                <ChevronUp size={14} />
              </button>
            )}
          </div>
          {chipsOverflowing && !chipsExpanded && (
            <button
              type="button"
              className="skills-matrix__chip-expand skills-matrix__chip-expand--outer"
              onClick={() => setChipsExpanded(true)}
              aria-expanded="false"
              aria-label={t('matrix.tags.expand')}
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
        <div className="skills-matrix__chip-meta">
          {totalCount > 0 && (
            <span className="skills-matrix__chip-total" data-bf-scene="skills" data-bf-part="resultsInfo">
              {t('totalSkills', { count: totalCount })}
            </span>
          )}
        </div>
      </div>

      <div ref={contentRef} className="skills-discover__content">
        {installError && (
          <div className="skills-discover__empty skills-discover__empty--error" data-testid="matrix-install-error">
            <Package size={28} strokeWidth={1.5} />
            <span>{installError}</span>
          </div>
        )}

        {skillsLoading && (
          <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={`mtx-sk-${i}`}
                className="skills-discover__skeleton-card"
                style={{ '--surface-stagger-index': i } as React.CSSProperties}
              />
            ))}
          </div>
        )}

        {!skillsLoading && skillsError && (
          <div className="skills-discover__empty skills-discover__empty--error">
            <Package size={28} strokeWidth={1.5} />
            <span>{t(skillsError)}</span>
          </div>
        )}

        {!skillsLoading && !skillsError && skills.length === 0 && (
          <div className="skills-discover__empty" data-testid="matrix-skill-list-empty">
            <Package size={28} strokeWidth={1.5} />
            <span>{t('matrix.empty.noSkills')}</span>
          </div>
        )}

        {!skillsLoading && !skillsError && skills.length > 0 && (
          <>
            <div className="skills-discover__grid" data-testid="matrix-skill-list">
              {skills.map((skill) => {
                const isInstalled = installedEnNames.has(skill.enName);
                const isInstalling = installingEnName === skill.enName;
                return (
                  <SkillCard
                    key={skill.id}
                    data-testid="matrix-market-card"
                    data-skill-id={skill.id}
                    data-skill-name={skill.enName}
                    data-skill-installed={isInstalled ? 'true' : 'false'}
                    name={skill.name || skill.enName}
                    description={skill.description ?? ''}
                    leftContent={(
                      <span className="skills-card__count">
                        <TrendingUp size={12} />
                        {skill.download ?? 0}
                      </span>
                    )}
                    rightAction={{
                      label: isInstalled ? t('matrix.item.installed') : t('installSkill'),
                      icon: isInstalled ? <CheckCircle2 size={13} /> : <Download size={13} />,
                      disabled:
                        isInstalling
                        || isInstalled
                        || !hasWorkspace
                        || isRemoteWorkspace
                        || isAssistantWorkspace,
                      onClick: () => void onInstall(skill, 'project'),
                    }}
                    onOpenDetails={() => onOpenDetails(skill)}
                  />
                );
              })}
             </div>

             <SkillsLoadMoreSentinel
               active={hasMore && !loadingMore && !skillsLoading && !loadMoreError}
               onLoad={onLoadMore}
             />
             {loadingMore && (
               <div className="skills-load-more-row">
                 <Loader2 className="skills-load-more-spinner" size={14} />
                 <span>{t('list.loading')}</span>
               </div>
             )}
             {loadMoreError && (
               <div className="skills-load-more-row">
                 <span>{t('list.loadMoreFailed')}</span>
                 <button
                   type="button"
                   className="skills-load-more-retry"
                   onClick={onRetryLoadMore}
                 >
                   {t('list.retry')}
                 </button>
               </div>
             )}
             {!loadingMore && !loadMoreError && !hasMore && (
               <div className="skills-load-more-row">
                 <span>{t('list.noMore')}</span>
               </div>
             )}
           </>
         )}
       </div>
     </div>
   );
 };

export default MatrixMarketView;
