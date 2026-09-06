import React, { forwardRef } from 'react';
import './Switch.scss';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  description?: string;
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  checkedText?: string;
  uncheckedText?: string;
  className?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      label,
      description,
      size = 'medium',
      loading = false,
      checkedText,
      uncheckedText,
      disabled = false,
      className = '',
      checked,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const containerClass = [
      'openbitfun-switch',
      `openbitfun-switch--${size}`,
      isDisabled && 'openbitfun-switch--disabled',
      loading && 'openbitfun-switch--loading',
      className
    ].filter(Boolean).join(' ');

    const switchClass = [
      'openbitfun-switch__track',
      checked && 'openbitfun-switch__track--checked'
    ].filter(Boolean).join(' ');

    return (
      <label className={containerClass} data-openbitfun-component="switch" data-openbitfun-part="root" data-openbitfun-size={size} data-openbitfun-state={[checked && 'checked', isDisabled && 'disabled', loading && 'loading'].filter(Boolean).join(' ') || undefined}>
        <div className="openbitfun-switch__wrapper" data-openbitfun-component="switch" data-openbitfun-part="wrapper">
          <input
            {...props}
            ref={ref}
            type="checkbox"
            className="openbitfun-switch__input"
            disabled={isDisabled}
            checked={checked}
            {...props}
            data-openbitfun-component="switch"
            data-openbitfun-part="input"
          />
          <span className={switchClass} data-openbitfun-component="switch" data-openbitfun-part="track" data-openbitfun-state={checked ? 'checked' : undefined}>
            {(checkedText || uncheckedText) && (
              <span className="openbitfun-switch__text" data-openbitfun-component="switch" data-openbitfun-part="text">
                {checked ? checkedText : uncheckedText}
              </span>
            )}
            <span className="openbitfun-switch__thumb" data-openbitfun-component="switch" data-openbitfun-part="thumb">
              {loading && (
                <svg className="openbitfun-switch__loading" data-openbitfun-component="switch" data-openbitfun-part="loading" viewBox="0 0 16 16">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="31.4"
                    strokeDashoffset="10"
                  />
                </svg>
              )}
            </span>
          </span>
        </div>
        {(label || description || children) && (
          <div className="openbitfun-switch__content" data-openbitfun-component="switch" data-openbitfun-part="content">
            {label && <span className="openbitfun-switch__label" data-openbitfun-component="switch" data-openbitfun-part="label">{label}</span>}
            {description && <span className="openbitfun-switch__description" data-openbitfun-component="switch" data-openbitfun-part="description">{description}</span>}
            {children}
          </div>
        )}
      </label>
    );
  }
);

Switch.displayName = 'Switch';
