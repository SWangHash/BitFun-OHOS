import React from 'react';
import { Icon, IconButton, OverflowText } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import './SkillCard.scss';

interface SkillCardAction {
  icon: React.ReactNode;
  label: string;
  title?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface SkillCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  name: string;
  description?: string;
  ariaLabel?: string;
  iconKind?: 'skill' | 'market';
  level?: 'user' | 'project';
  shadowed?: boolean;
  builtin?: boolean;
  globallyDisabled?: boolean;
  action?: SkillCardAction;
  onOpenDetails: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({
  name, description, ariaLabel, iconKind = 'skill', level, shadowed, builtin, globallyDisabled,
  action, onOpenDetails, className, ...rootProps
}) => {
  const { t } = useI18n('scenes/skills');
  return (
    <div
      {...rootProps}
      className={['skills-card', shadowed && 'is-shadowed', globallyDisabled && 'is-globally-disabled', className].filter(Boolean).join(' ')}
      role="listitem"
      data-bitfun-component="skill-card"
      data-bitfun-part="root"
      data-bitfun-variant={iconKind}
      data-bitfun-level={level}
      data-bitfun-state={[shadowed && 'shadowed', builtin && 'builtin'].filter(Boolean).join(' ') || undefined}
      data-overflow-trigger
    >
      <div className="skills-card__top" data-bitfun-component="skill-card" data-bitfun-part="header">
        <button
          type="button"
          className="skills-card__open"
          aria-label={ariaLabel ?? name}
          onClick={onOpenDetails}
          data-bitfun-component="skill-card"
          data-bitfun-part="open"
        />
        <div className="skills-card__icon" aria-hidden="true" data-bitfun-component="skill-card" data-bitfun-part="icon">
          <Icon name="book-open" size="sm" />
        </div>
        <div className="skills-card__info" data-bitfun-component="skill-card" data-bitfun-part="body">
          <div className="skills-card__title-row" data-bitfun-component="skill-card" data-bitfun-part="titleRow">
            <span className="skills-card__name" data-testid="skill-list-item-title" data-bitfun-component="skill-card" data-bitfun-part="name">
              <OverflowText behavior="marquee" title="">{name}</OverflowText>
            </span>
          </div>
          <OverflowText title="" className="skills-card__desc" data-testid="skill-list-item-description" data-bitfun-component="skill-card" data-bitfun-part="description">
            {description?.trim() || t('market.item.noDescription')}
          </OverflowText>
        </div>
      </div>
      <div className="skills-card__actions" data-bitfun-component="skill-card" data-bitfun-part="actions">
        <IconButton
          size="sm"
          variant="quiet"
          tabIndex={action ? undefined : -1}
          onClick={action?.onClick ?? onOpenDetails}
          aria-label={action?.label ?? t('list.item.detail')}
          title={action?.title ?? action?.label ?? t('list.item.detail')}
          disabled={action?.disabled}
          loading={action?.loading}
          icon={action?.icon ?? <Icon name="arrow-right" size="sm" />}
          data-testid={action ? 'skills-card-action' : undefined}
          data-skill-action={action ? 'download' : undefined}
          data-bitfun-component="skill-card"
          data-bitfun-part="action"
        />
      </div>
    </div>
  );
};

export default SkillCard;
