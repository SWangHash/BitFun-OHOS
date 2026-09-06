/**
 * Input component
 */

import React, { forwardRef, useId } from 'react';
import './Input.scss';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  variant?: 'default' | 'filled' | 'outlined';
  inputSize?: 'small' | 'medium' | 'large';
  size?: 'small' | 'medium' | 'large';
  error?: boolean;
  errorMessage?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  label?: string;
  hint?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  variant = 'default',
  inputSize = 'medium',
  size,
  error = false,
  errorMessage,
  prefix,
  suffix,
  label,
  hint,
  className = '',
  disabled,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = props.id ?? `${generatedId}-input`;
  const supportId = `${generatedId}-support`;
  const resolvedInputSize = size ?? inputSize;
  const classNames = [
    'openbitfun-input-wrapper',
    `openbitfun-input-wrapper--${variant}`,
    `openbitfun-input-wrapper--${resolvedInputSize}`,
    error && 'openbitfun-input-wrapper--error',
    disabled && 'openbitfun-input-wrapper--disabled',
    className
  ]
    .filter(Boolean)
    .join(' ');
  const appearanceState = [error && 'error', disabled && 'disabled'].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      data-openbitfun-component="input"
      data-openbitfun-part="root"
      data-openbitfun-variant={variant}
      data-openbitfun-size={resolvedInputSize}
      data-openbitfun-state={appearanceState || undefined}
    >
      {label && <label className="openbitfun-input-label" htmlFor={inputId} data-openbitfun-component="input" data-openbitfun-part="label">{label}</label>}
      <div className="openbitfun-input-container" data-openbitfun-component="input" data-openbitfun-part="container">
        {prefix && <span className="openbitfun-input-prefix" data-openbitfun-component="input" data-openbitfun-part="prefix">{prefix}</span>}
        <input
          {...props}
          ref={ref}
          id={inputId}
          className="openbitfun-input"
          data-openbitfun-component="input"
          data-openbitfun-part="control"
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={(error && errorMessage) || (!error && hint) ? supportId : props['aria-describedby']}
        />
        {suffix && <span className="openbitfun-input-suffix" data-openbitfun-component="input" data-openbitfun-part="suffix">{suffix}</span>}
      </div>
      {!error && hint && (
        <span id={supportId} className="openbitfun-input-hint" data-openbitfun-component="input" data-openbitfun-part="message">{hint}</span>
      )}
      {error && errorMessage && (
        <span id={supportId} className="openbitfun-input-error-message" role="alert" data-openbitfun-component="input" data-openbitfun-part="message">{errorMessage}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';
