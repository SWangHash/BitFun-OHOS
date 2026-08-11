import React from 'react';
import { CheckCircle2, Download, Package, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Search } from '@/component-library';
import type { MatrixSkillSummary } from '@/infrastructure/api/service-api/MatrixSkillAPI';
import SkillCard from './SkillCard';

interface MatrixMarketViewProps {
  tags: { id: string; name: string; enName: string }[];
  tagsLoading: boolean;
  tagsError: string | null;
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  onClearTags: () => void;

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
  onInstall: (skill: MatrixSkillSummary) => Promise<void>;

  installedEnNames: Set<string>;
}

const MatrixMarketView: React.FC<MatrixMarketViewProps> = ({
  tags,
  tagsLoading,
  tagsError,
  selectedTagIds,
  onToggleTag,
  onClearTags,
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
  onInstall,
  installedEnNames,
}) => {
  const { t } = useTranslation('scenes/skills');

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

      <div className="skills-matrix__tags-bar" data-testid="matrix-tags-bar">
        {tagsLoading && (
          <span className="skills-matrix__tags-loading">
            {t('matrix.tags.loading')}
          </span>
        )}
        {!tagsLoading && tagsError && (
          <span className="skills-matrix__tags-error">{tagsError}</span>
        )}
        {!tagsLoading && !tagsError && tags.length === 0 && (
          <span className="skills-matrix__tags-empty">{t('matrix.tags.empty')}</span>
        )}
        {!tagsLoading && !tagsError && tags.length > 0 && (
          <>
            {selectedTagIds.length > 0 && (
              <button
                type="button"
                className="skills-matrix__tag-chip skills-matrix__tag-chip--clear"
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
                  className={`skills-matrix__tag-chip ${selected ? 'is-active' : ''}`}
                  onClick={() => onToggleTag(tag.id)}
                  aria-pressed={selected}
                >
                  {tag.name}
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className="skills-discover__content">
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
                    onOpenDetails={() => {
                      // No-op: details modal not yet wired for Matrix cards in this iteration
                    }}
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
