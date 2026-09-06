import React, { forwardRef } from 'react';
import './Checkbox.scss';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Checkbox label */
  label?: React.ReactNode;
  /** Description text */
  description?: string;
  /** Size */
  size?: 'small' | 'medium' | 'large';
  /** Indeterminate state */
  indeterminate?: boolean;
  /** Error state */
  error?: boolean;
  /** Custom class name */
  className?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      size = 'medium',
      indeterminate = false,
      error = false,
      disabled = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const checkboxRef = React.useRef<HTMLInputElement>(null);
    
    React.useImperativeHandle(ref, () => checkboxRef.current!);

    React.useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const containerClass = [
      'openbitfun-checkbox',
      `openbitfun-checkbox--${size}`,
      error && 'openbitfun-checkbox--error',
      disabled && 'openbitfun-checkbox--disabled',
      className
    ].filter(Boolean).join(' ');

    return (
      <label className={containerClass} data-openbitfun-component="checkbox" data-openbitfun-part="root" data-openbitfun-size={size} data-openbitfun-state={[indeterminate && 'indeterminate', disabled && 'disabled', error && 'error'].filter(Boolean).join(' ') || undefined}>
        <div className="openbitfun-checkbox__wrapper" data-openbitfun-component="checkbox" data-openbitfun-part="wrapper">
          <input
            {...props}
            ref={checkboxRef}
            type="checkbox"
            className="openbitfun-checkbox__input"
            disabled={disabled}
            {...props}
            data-openbitfun-component="checkbox"
            data-openbitfun-part="input"
          />
          <span className="openbitfun-checkbox__box" data-openbitfun-component="checkbox" data-openbitfun-part="box">
            <svg
              className="openbitfun-checkbox__icon"
              data-openbitfun-component="checkbox"
              data-openbitfun-part="icon"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {indeterminate ? (
                <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path
                  d="M3 8L6.5 11.5L13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </span>
        </div>
        {(label || description || children) && (
          <div className="openbitfun-checkbox__content" data-openbitfun-component="checkbox" data-openbitfun-part="content">
            {label && <span className="openbitfun-checkbox__label" data-openbitfun-component="checkbox" data-openbitfun-part="label">{label}</span>}
            {description && <span className="openbitfun-checkbox__description" data-openbitfun-component="checkbox" data-openbitfun-part="description">{description}</span>}
            {children}
          </div>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
