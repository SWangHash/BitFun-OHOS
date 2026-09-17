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
      'bitfun-switch',
      `bitfun-switch--${size}`,
      isDisabled && 'bitfun-switch--disabled',
      loading && 'bitfun-switch--loading',
      className
    ].filter(Boolean).join(' ');

    const switchClass = [
      'bitfun-switch__track',
      checked && 'bitfun-switch__track--checked'
    ].filter(Boolean).join(' ');

    return (
      <label className={containerClass} data-bitfun-component="switch" data-bitfun-part="root" data-bitfun-size={size} data-bitfun-state={[checked && 'checked', isDisabled && 'disabled', loading && 'loading'].filter(Boolean).join(' ') || undefined}>
        <div className="bitfun-switch__wrapper" data-bitfun-component="switch" data-bitfun-part="wrapper">
          <input
            {...props}
            ref={ref}
            type="checkbox"
            className="bitfun-switch__input"
            disabled={isDisabled}
            checked={checked}
            {...props}
            data-bitfun-component="switch"
            data-bitfun-part="input"
          />
          <span className={switchClass} data-bitfun-component="switch" data-bitfun-part="track" data-bitfun-state={checked ? 'checked' : undefined}>
            {(checkedText || uncheckedText) && (
              <span className="bitfun-switch__text" data-bitfun-component="switch" data-bitfun-part="text">
                {checked ? checkedText : uncheckedText}
              </span>
            )}
            <span className="bitfun-switch__thumb" data-bitfun-component="switch" data-bitfun-part="thumb">
              {loading && (
                <svg className="bitfun-switch__loading" data-bitfun-component="switch" data-bitfun-part="loading" viewBox="0 0 16 16">
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
          <div className="bitfun-switch__content" data-bitfun-component="switch" data-bitfun-part="content">
            {label && <span className="bitfun-switch__label" data-bitfun-component="switch" data-bitfun-part="label">{label}</span>}
            {description && <span className="bitfun-switch__description" data-bitfun-component="switch" data-bitfun-part="description">{description}</span>}
            {children}
          </div>
        )}
      </label>
    );
  }
);

Switch.displayName = 'Switch';
