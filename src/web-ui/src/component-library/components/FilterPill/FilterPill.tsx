/**
 * FilterPill Component
 * Filter button for configuration pages
 */

import React from 'react';
import './FilterPill.scss';

export interface FilterPillProps {
  /** Label text */
  label: string;
  /** Count (optional) */
  count?: string | number;
  /** Whether active */
  active?: boolean;
  /** Click callback */
  onClick?: () => void;
  /** Custom class name */
  className?: string;
  /** Whether disabled */
  disabled?: boolean;
}

export const FilterPill: React.FC<FilterPillProps> = ({
  label,
  count,
  active = false,
  onClick,
  className = '',
  disabled = false,
}) => {
  const classNames = [
    'v-filter-pill',
    active && 'v-filter-pill--active',
    disabled && 'v-filter-pill--disabled',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classNames}
      data-openbitfun-component="filter-pill"
      data-openbitfun-part="root"
      data-openbitfun-state={[active && 'active', disabled && 'disabled'].filter(Boolean).join(' ') || undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="v-filter-pill__label" data-openbitfun-component="filter-pill" data-openbitfun-part="label">{label}</span>
      {count !== undefined && (
        <span className="v-filter-pill__count" data-openbitfun-component="filter-pill" data-openbitfun-part="count">{count}</span>
      )}
    </button>
  );
};

export interface FilterPillGroupProps {
  /** Child elements */
  children: React.ReactNode;
  /** Custom class name */
  className?: string;
}

export const FilterPillGroup: React.FC<FilterPillGroupProps> = ({
  children,
  className = '',
}) => {
  return (
    <div className={`v-filter-pill-group ${className}`} data-openbitfun-component="filter-pill" data-openbitfun-part="group">
      {children}
    </div>
  );
};
