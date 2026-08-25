import React from 'react';
import { CheckCircle2, Download, Package, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Search } from '@/component-library';
import type {
  MatrixCategoryItem,
  MatrixSidebarItem,
  MatrixSkillSummary,
} from '@/infrastructure/api/service-api/MatrixSkillAPI';
import type { MatrixSection } from '../hooks/useMatrixSkillMarket';
import SkillCard from './SkillCard';

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

  keyword: string;
  onKeywordChange: (value: string) => void;
  onKeywordSubmit: () => void;

  skills: MatrixSkillSummary[];
  totalCount: number;
  skillsLoading: boolean;
  skillsError: string | null;

  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  onPrevPage: () => void;
  onNextPage: () => Promise<void>;

  installingEnName: string | null;
  installError: string | null;
  onInstall: (skill: MatrixSkillSummary) => Promise<void>;
  onOpenDetails: (skill: MatrixSkillSummary) => void;

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
  keyword,
  onKeywordChange,
  onKeywordSubmit,
  skills,
  totalCount,
  skillsLoading,
  skillsError,
  currentPage,
  totalPages,
  hasMore,
  onPrevPage,
  onNextPage,
  installingEnName,
  installError,
  onInstall,
  onOpenDetails,
  installedEnNames,
}) => {
  const { t, i18n } = useTranslation('scenes/skills');
  const isZh = i18n.language?.startsWith('zh');

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

  const renderChips = () => {
    if (activeSection === 'feature') {
      return (
        <div className="skills-matrix__chip-list" data-testid="matrix-featured-hint">
          <span className="skills-matrix__chip-hint">{t('matrix.featured.hint')}</span>
        </div>
      );
    }

    if (activeSection === 'tag') {
      return (
        <div className="skills-matrix__chip-list" data-testid="matrix-tags-bar">
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
                  >
                    {isZh ? tag.name : tag.enName}
                  </button>
                );
              })}
            </React.Fragment>
          )}
        </div>
      );
    }

    if (activeSection === 'cat') {
      return (
        <div className="skills-matrix__chip-list" data-testid="matrix-categories-bar">
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
                  >
                    <span className="skills-matrix__chip-label">{label}</span>
                    {typeof cat.count === 'number' && (
                      <span className="skills-matrix__chip-count">{cat.count}</span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          )}
        </div>
      );
    }

    // org
    return (
      <div className="skills-matrix__chip-list" data-testid="matrix-organizations-bar">
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
                >
                  <span className="skills-matrix__chip-label">{label}</span>
                  {typeof org.count === 'number' && (
                    <span className="skills-matrix__chip-count">{org.count}</span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        )}
      </div>
    );
  };

  return (
    <div className="skills-discover skills-matrix" data-testid="matrix-market">
      <div className="skills-discover__hero">
        <div className="skills-discover__hero-content">
          <h1 className="skills-discover__title">{t('matrix.title')}</h1>
          <p className="skills-discover__subtitle">{t('matrix.subtitle')}</p>
          <div className="skills-discover__search-wrapper">
            <Search
              className="skills-discover__search"
              value={keyword}
              onChange={onKeywordChange}
              onSearch={onKeywordSubmit}
              onClear={onKeywordSubmit}
              placeholder={t('matrix.searchPlaceholder')}
              size="medium"
              clearable
              enterToSearch
            />
          </div>
        </div>
      </div>

      <div className="skills-matrix__section-bar" role="tablist" data-testid="matrix-section-bar">
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={activeSection === section}
            className={`skills-matrix__section-btn ${activeSection === section ? 'is-active' : ''}`}
            onClick={() => onSelectSection(section)}
          >
            {sectionLabel(section)}
          </button>
        ))}
      </div>

      {renderChips()}

      <div className="skills-discover__content">
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
            <span>{skillsError}</span>
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
            <div className="skills-discover__results-info">
              <span>{t('matrix.resultsInfo', { count: totalCount })}</span>
            </div>

            <div className="skills-discover__grid" data-testid="matrix-skill-list">
              {skills.map((skill, index) => {
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
                    index={index}
                    accentSeed={skill.id}
                    iconKind="market"
                    badges={isInstalled ? (
                      <Badge variant="success">
                        <CheckCircle2 size={11} />
                        {t('market.item.installed')}
                      </Badge>
                    ) : null}
                    meta={(
                      <span className="bitfun-skills-scene__market-meta">
                        <TrendingUp size={12} />
                        {skill.download ?? 0}
                      </span>
                    )}
                    actions={[
                      {
                        id: 'install',
                        icon: isInstalled ? <CheckCircle2 size={13} /> : <Download size={13} />,
                        ariaLabel: isInstalled
                          ? t('matrix.item.installed')
                          : t('matrix.item.install'),
                        title: isInstalling
                          ? t('matrix.item.installing')
                          : (isInstalled ? t('matrix.item.installedTooltip') : t('matrix.item.install')),
                        disabled: isInstalling || isInstalled,
                        tone: isInstalled ? 'success' : 'primary',
                        onClick: () => void onInstall(skill),
                      },
                    ]}
                    onOpenDetails={() => onOpenDetails(skill)}
                  />
                );
              })}
            </div>

            {(totalPages > 1 || hasMore) && (
              <div className="skills-discover__pagination">
                <button
                  type="button"
                  className="skills-discover__page-btn"
                  onClick={onPrevPage}
                  disabled={currentPage === 0 || skillsLoading}
                  aria-label={t('market.pagination.prev')}
                >
                  <span aria-hidden>‹</span>
                </button>
                <span className="skills-discover__page-info">
                  {hasMore
                    ? t('market.pagination.infoMore', { current: currentPage + 1 })
                    : t('market.pagination.info', { current: currentPage + 1, total: totalPages })}
                </span>
                <button
                  type="button"
                  className="skills-discover__page-btn"
                  onClick={() => void onNextPage()}
                  disabled={(!hasMore && currentPage >= totalPages - 1) || skillsLoading}
                  aria-label={t('market.pagination.next')}
                >
                  <span aria-hidden>›</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MatrixMarketView;
