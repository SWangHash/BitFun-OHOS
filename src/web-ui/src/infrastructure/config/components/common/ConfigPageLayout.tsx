import { FieldGroup, FormSection, ScrollArea, type FieldGroupFieldSurface } from '@bitfun/ui';
import React from 'react';
import { formatStandaloneUiCopy } from './standaloneUiCopy';
import './ConfigPageLayout.scss';

export interface ConfigPageLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
   
  children: React.ReactNode;
   
  className?: string;
}

 
export const ConfigPageLayout: React.FC<ConfigPageLayoutProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <ScrollArea className={`bitfun-config-page-layout ${className}`} data-bitfun-component="config" data-bitfun-part="root" {...props}>
      {children}
      {/* Real DOM spacer: keeps a guaranteed blank tail at the end of the scroll range. */}
      <div className="bitfun-config-page-layout__scroll-end-spacer" aria-hidden="true" />
    </ScrollArea>
  );
};

export interface ConfigPageContentProps extends React.HTMLAttributes<HTMLDivElement> {
   
  children: React.ReactNode;
   
  className?: string;
  id?: string;
}

 
export const ConfigPageContent: React.FC<ConfigPageContentProps> = ({
  children,
  className = '',
  id,
  ...props
}) => {
  return (
    <div id={id} className={`bitfun-config-page-content ${className}`} data-bitfun-component="config" data-bitfun-part="content" {...props}>
      <div className="bitfun-config-page-content__inner" data-bitfun-component="config" data-bitfun-part="contentInner">
        {children}
      </div>
    </div>
  );
};

export interface ConfigPageSectionStackProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Keeps the standard page-level spacing when sections need a shared wrapper
 * for state, test hooks, or adjacent page controls.
 */
export const ConfigPageSectionStack: React.FC<ConfigPageSectionStackProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <div
      {...props}
      className={`bitfun-config-page-section-stack ${className}`.trim()}
      data-bitfun-component="config"
      data-bitfun-part="sectionStack"
    >
      {children}
    </div>
  );
};

export interface ConfigPageSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: string;
  /** Renders inline after the title (e.g. status badge). */
  titleSuffix?: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Disable when children own the surface and the standard body background/radius should be removed. */
  bodySurface?: boolean;
  /** Controls whether nested design-system fields are opaque or reuse the section surface. */
  fieldSurface?: FieldGroupFieldSurface;
  /** Legacy mouse-glow surface toggle (retained for OHOS ConfigPage consumers). */
  mouseGlowSurface?: boolean;
}

export const ConfigPageSection: React.FC<ConfigPageSectionProps> = ({
  title,
  titleSuffix,
  description,
  extra,
  children,
  className = '',
  bodySurface = true,
  fieldSurface,
  ...props
}) => {
  const hasBody = children !== null && children !== undefined && children !== false;
  const bodyClassName = [
    'bitfun-config-page-section__body',
    !bodySurface && 'bitfun-config-page-section__body--flush',
  ].filter(Boolean).join(' ');

  return (
    <FormSection
      className={`bitfun-config-page-section ${className}`}
      data-bitfun-component="config"
      data-bitfun-part="section"
      headingAs="h3"
      title={(
        <span className="bitfun-config-page-section__title-row" data-bitfun-component="config" data-bitfun-part="sectionHeader">
          <span className="bitfun-config-page-section__title" data-bitfun-component="config" data-bitfun-part="sectionTitle">{title}</span>
          {titleSuffix}
        </span>
      )}
      description={description ? (
        <span className="bitfun-config-page-section__description" data-bitfun-component="config" data-bitfun-part="sectionDescription">{formatStandaloneUiCopy(description)}</span>
      ) : undefined}
      actions={extra ? (
        <div className="bitfun-config-page-section__extra">{extra}</div>
      ) : undefined}
      {...props}
    >
      {hasBody ? (
        <FieldGroup
          appearance={bodySurface ? 'subtle' : 'plain'}
          className={bodyClassName}
          data-bitfun-component="config"
          data-bitfun-part="sectionBody"
          dividers={false}
          fieldSurface={fieldSurface ?? (bodySurface ? 'ambient' : 'default')}
        >
          {children}
        </FieldGroup>
      ) : null}
    </FormSection>
  );
};

export interface ConfigPageRowProps {
  label: React.ReactNode;
  /** Marks the row label as required. The control still owns its native required or aria-required state. */
  required?: boolean;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'center';
  /** Stack label above control for multi-line editors (textarea, code blocks, etc.) */
  multiline?: boolean;
  /** Gives long-form or complex controls a 2/8 fill layout instead of the standard field width. */
  wide?: boolean;
  /**
   * ~40% label / ~60% control — middle ground between default (7:3) and wide (2:8).
   * Use for composite controls; ordinary single-line fields retain the shared field width.
   */
  balanced?: boolean;
}

export const ConfigPageRow: React.FC<ConfigPageRowProps> = ({
  label,
  required = false,
  description,
  children,
  className = '',
  align = 'start',
  multiline = false,
  wide = false,
  balanced = false,
}) => {
  const hasControl = children !== null && children !== undefined && children !== false;
  const cls = [
    'bitfun-config-page-row',
    `bitfun-config-page-row--${align}`,
    multiline && 'bitfun-config-page-row--multiline',
    wide && 'bitfun-config-page-row--wide',
    balanced && 'bitfun-config-page-row--balanced',
    !hasControl && 'bitfun-config-page-row--no-control',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      data-bitfun-component="config"
      data-bitfun-part="row"
      data-bitfun-align={align}
      data-bitfun-layout={wide ? 'wide' : balanced ? 'balanced' : multiline ? 'multiline' : 'default'}
      data-required={required ? 'true' : 'false'}
    >
      <div className="bitfun-config-page-row__meta">
        {/* div (not p): label may contain buttons; button-in-p freezes React event path */}
        <div className="bitfun-config-page-row__label" data-bitfun-component="config" data-bitfun-part="rowLabel">
          {label}
          {required ? (
            <span
              aria-hidden="true"
              className="bitfun-config-page-row__required"
              data-bitfun-component="config"
              data-bitfun-part="required"
            >
              *
            </span>
          ) : null}
        </div>
        {description ? (
          <div className="bitfun-config-page-row__description" data-bitfun-component="config" data-bitfun-part="rowDescription">{formatStandaloneUiCopy(description)}</div>
        ) : null}
      </div>
      {hasControl ? (
        <div className="bitfun-config-page-row__control" data-bitfun-component="config" data-bitfun-part="rowControl">
          {children}
        </div>
      ) : null}
    </div>
  );
};

export default ConfigPageLayout;
