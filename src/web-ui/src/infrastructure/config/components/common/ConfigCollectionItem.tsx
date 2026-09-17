import React, { useId, useState } from 'react';
import { Disclosure, OverflowText, Icon, IconButton } from '@bitfun/ui';
import './ConfigCollectionItem.scss';

export interface ConfigCollectionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  badge?: React.ReactNode;
  badgePlacement?: 'inline' | 'below';
  control: React.ReactNode;
  details?: React.ReactNode;
  disabled?: boolean;
  /** Separates details interaction from the item's disabled appearance. */
  detailsDisabled?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Lets non-interactive row space toggle details while preserving nested controls. */
  toggleOnRowClick?: boolean;
  className?: string;
}

export const ConfigCollectionItem: React.FC<ConfigCollectionItemProps> = ({
  label,
  badge,
  badgePlacement = 'inline',
  control,
  details,
  disabled = false,
  detailsDisabled = disabled,
  expanded: expandedProp,
  onToggle,
  toggleOnRowClick = false,
  className = '',
  ...rootProps
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = expandedProp !== undefined;
  const isExpanded = isControlled ? expandedProp : internalExpanded;
  const hasDetails = Boolean(details);
  const labelId = useId();

  const toggleDetails = () => {
    if (!hasDetails || detailsDisabled) return;
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!toggleOnRowClick || !hasDetails || detailsDisabled) return;
    const target = event.target;
    if (
      target instanceof Element
      && target.closest('a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [contenteditable="true"]')
    ) {
      return;
    }
    toggleDetails();
  };

  return (
    <div
      className={`bitfun-collection-item ${isExpanded ? 'is-expanded' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      data-bitfun-component="config"
      data-bitfun-part="collectionItem"
      {...rootProps}
    >
      <Disclosure
        className="bitfun-collection-item__disclosure"
        summary={label}
        open={hasDetails && isExpanded}
        disabled={!hasDetails || detailsDisabled}
        onOpenChange={toggleDetails}
        unmountOnClose
        exitDurationMs={180}
        contentClassName="bitfun-collection-item__details-collapse"
        contentInnerClassName="bitfun-collection-item__details-clip"
        renderHeader={(triggerProps) => (
          <div data-overflow-trigger
            className={`bitfun-config-page-row bitfun-config-page-row--center bitfun-collection-item__row ${
              toggleOnRowClick && hasDetails && !detailsDisabled ? 'bitfun-collection-item__row--toggleable' : ''
            }`}
            data-bitfun-component="config"
            data-bitfun-part="collectionRow"
            onClick={handleRowClick}
          >
            <div className="bitfun-config-page-row__meta" data-bitfun-component="config" data-bitfun-part="collectionMeta">
              <div
                className={`bitfun-config-page-row__label bitfun-collection-item__label ${
                  badgePlacement === 'below' ? 'bitfun-collection-item__label--stacked' : ''
                }`}
              >
                <OverflowText id={labelId} className="bitfun-collection-item__name" data-bitfun-component="config" data-bitfun-part="collectionName">{label}</OverflowText>
                {badge && (
                  <span
                    className={`bitfun-collection-item__badges ${
                      badgePlacement === 'below'
                        ? 'bitfun-collection-item__badges--stacked'
                        : 'bitfun-collection-item__badges--inline'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </div>
            </div>
            <div className="bitfun-config-page-row__control" data-bitfun-component="config" data-bitfun-part="collectionControl">
              <div className="bitfun-collection-item__control">
                {control}
                {hasDetails ? (
                  <IconButton
                    type="button"
                    className="bitfun-collection-btn bitfun-collection-item__details-toggle"
                    disabled={detailsDisabled}
                    aria-label={typeof label === 'string' ? label : ''}
                    aria-labelledby={labelId}
                    {...triggerProps}
                    icon={<Icon name="chevron-down" size="sm" aria-hidden="true" />}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      >
        <div className="bitfun-collection-item__details" data-bitfun-component="config" data-bitfun-part="collectionDetails">{details}</div>
      </Disclosure>
    </div>
  );
};

export default ConfigCollectionItem;
