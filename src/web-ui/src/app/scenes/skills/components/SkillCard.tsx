import React from 'react';
import './SkillCard.scss';

export interface SkillCardAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface SkillCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  name: string;
  description?: string;
  letter?: string;
  headerRight?: React.ReactNode;
  leftContent?: React.ReactNode;
  rightAction?: SkillCardAction;
  afterAction?: React.ReactNode;
  onOpenDetails?: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({
  name,
  description,
  letter,
  headerRight,
  leftContent,
  rightAction,
  afterAction,
  onOpenDetails,
  className,
  style,
  ...rootProps
}) => {
  const avatarLetter = letter ?? name.charAt(0).toUpperCase();
  const openDetails = () => onOpenDetails?.();

  return (
    <div
      data-bf-component="skill-card"
      data-bf-part="root"
      {...rootProps}
      className={['skill-card', className].filter(Boolean).join(' ')}
      style={style}
      onClick={openDetails}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetails();
        }
      }}
      aria-label={name}
    >
      {/* Header: avatar + name */}
      <div className="skill-card__header" data-bf-component="skill-card" data-bf-part="header">
        <div className="skill-card__avatar" data-bf-component="skill-card" data-bf-part="avatar">
          {avatarLetter}
        </div>
        <span className="skill-card__name" data-bf-component="skill-card" data-bf-part="name">
          {name}
        </span>
        {headerRight && (
          <div className="skill-card__header-right" data-bf-component="skill-card" data-bf-part="headerRight">
            {headerRight}
          </div>
        )}
      </div>

      {/* Body: description */}
      {description?.trim() && (
        <p className="skill-card__desc" data-bf-component="skill-card" data-bf-part="description">
          {description.trim()}
        </p>
      )}

      {/* Footer: left content + right action */}
      <div className="skill-card__footer" data-bf-component="skill-card" data-bf-part="footer">
        {leftContent && (
          <div className="skill-card__left" data-bf-component="skill-card" data-bf-part="leftContent">
            {leftContent}
          </div>
        )}
        {rightAction && (
          <button
            type="button"
            className="skill-card__action"
            onClick={(e) => {
              e.stopPropagation();
              rightAction.onClick();
            }}
            disabled={rightAction.disabled}
            aria-label={rightAction.label}
            data-testid="skill-card-action"
            data-bf-component="skill-card"
            data-bf-part="action"
          >
            {rightAction.icon}
            <span>{rightAction.label}</span>
          </button>
        )}
        {afterAction && (
          <div className="skill-card__after-action" data-bf-component="skill-card" data-bf-part="afterAction">
            {afterAction}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillCard;
