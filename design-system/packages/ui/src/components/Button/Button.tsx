import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "../../internal/classNames";
import { OverflowText } from "../../primitives/OverflowText";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Static labels inherit whitespace and line height without clipping, marquee, or overflow tooltips. */
  labelBehavior?: "overflow" | "static";
  leadingIcon?: ReactNode;
  loading?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  tone?: "danger" | "neutral";
  trailingIcon?: ReactNode;
  variant?: "fill" | "outline" | "primary" | "secondary" | "text";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  className,
  disabled,
  labelBehavior = "overflow",
  leadingIcon,
  loading = false,
  size = "md",
  tone = "neutral",
  trailingIcon,
  type = "button",
  variant = "outline",
  ...props
}, ref) {
  return (
    <button data-overflow-trigger
      {...props}
      aria-busy={loading || undefined}
      className={classNames(styles.button, className)}
      data-bitfun-component="button"
      data-bitfun-part="root"
      data-bitfun-tone={tone}
      data-bitfun-variant={variant}
      data-loading={loading ? "true" : "false"}
      data-label-behavior={labelBehavior}
      data-size={size}
      disabled={disabled || loading}
      ref={ref}
      type={type}
    >
      <span aria-hidden="true" className={styles.progress} data-bitfun-part="progress" />
      <span className={styles.content} data-bitfun-part="content">
        {leadingIcon && (
          <span aria-hidden="true" className={classNames(styles.icon, styles.leadingIcon)} data-bitfun-part="leading-icon">
            {leadingIcon}
          </span>
        )}
        {labelBehavior === "static" ? (
          <span className={classNames(styles.label, styles.staticLabel)} data-bitfun-part="label">{children}</span>
        ) : (
          <OverflowText className={styles.label} data-bitfun-part="label">{children}</OverflowText>
        )}
        {trailingIcon && (
          <span aria-hidden="true" className={classNames(styles.icon, styles.trailingIcon)} data-bitfun-part="trailing-icon">
            {trailingIcon}
          </span>
        )}
      </span>
    </button>
  );
});
