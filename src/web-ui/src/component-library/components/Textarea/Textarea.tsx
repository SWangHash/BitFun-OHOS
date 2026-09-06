import React, { forwardRef, useRef, useImperativeHandle, useCallback, useId } from 'react';
import './Textarea.scss';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: boolean;
  errorMessage?: string;
  hint?: string;
  autoResize?: boolean;
  showCount?: boolean;
  maxLength?: number;
  variant?: 'default' | 'filled' | 'outlined';
  className?: string;
  'data-openbitfun-component'?: string;
  'data-openbitfun-part'?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error = false,
      errorMessage,
      hint,
      autoResize = false,
      showCount = false,
      maxLength,
      variant = 'default',
      className = '',
      value,
      onChange,
      style,
      'data-openbitfun-component': rootAppearanceComponent = 'textarea',
      'data-openbitfun-part': rootAppearancePart = 'root',
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = props.id ?? `${generatedId}-textarea`;
    const supportId = `${generatedId}-support`;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [charCount, setCharCount] = React.useState(0);

    useImperativeHandle(ref, () => textareaRef.current!);

    const adjustHeight = useCallback(() => {
      if (autoResize && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, [autoResize]);

    React.useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    React.useEffect(() => {
      const count = typeof value === 'string' ? value.length : 0;
      setCharCount(count);
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setCharCount(newValue.length);
      adjustHeight();
      onChange?.(e);
    };

    const containerClass = [
      'openbitfun-textarea',
      `openbitfun-textarea--${variant}`,
      error && 'openbitfun-textarea--error',
      props.disabled && 'openbitfun-textarea--disabled',
      className
    ].filter(Boolean).join(' ');
    const rootAppearanceProps: Record<string, string> = {};
    rootAppearanceProps['data-openbitfun-component'] = rootAppearanceComponent;
    rootAppearanceProps['data-openbitfun-part'] = rootAppearancePart;

    return (
      <div className={containerClass} data-openbitfun-component="textarea" data-openbitfun-part="root" data-openbitfun-variant={variant} data-openbitfun-state={[error && 'error', props.disabled && 'disabled', autoResize && 'autoResize'].filter(Boolean).join(' ') || undefined} {...rootAppearanceProps}>
        {label && (
          <label className="openbitfun-textarea__label" data-openbitfun-component="textarea" data-openbitfun-part="label">
            {label}
            {props.required && <span className="openbitfun-textarea__required" data-openbitfun-component="textarea" data-openbitfun-part="required">*</span>}
          </label>
        )}
        <div className="openbitfun-textarea__wrapper" data-openbitfun-component="textarea" data-openbitfun-part="wrapper">
          <textarea
            {...props}
            ref={textareaRef}
            id={textareaId}
            className="openbitfun-textarea__field"
            value={value}
            onChange={handleChange}
            maxLength={maxLength}
            aria-invalid={error || undefined}
            aria-describedby={(error && errorMessage) || (!error && hint) || showCount
              ? supportId
              : props['aria-describedby']}
            style={style}
            data-openbitfun-component="textarea"
            data-openbitfun-part="field"
          />
        </div>
        {(hint || errorMessage || showCount) && (
          <div className="openbitfun-textarea__footer" data-openbitfun-component="textarea" data-openbitfun-part="footer">
            <div className="openbitfun-textarea__hint-wrapper">
              {error && errorMessage && (
                <span className="openbitfun-textarea__error-message" data-openbitfun-component="textarea" data-openbitfun-part="message">{errorMessage}</span>
              )}
              {!error && hint && (
                <span className="openbitfun-textarea__hint" data-openbitfun-component="textarea" data-openbitfun-part="message">{hint}</span>
              )}
            </div>
            {showCount && (
              <span className="openbitfun-textarea__count" data-openbitfun-component="textarea" data-openbitfun-part="count">
                {charCount}{maxLength && ` / ${maxLength}`}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
