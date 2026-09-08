import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "../../internal/classNames";
import styles from "./KeyHint.module.css";

export interface KeyHintProps extends HTMLAttributes<HTMLElement> {
  icon?: ReactNode;
}

export const KeyHint = forwardRef<HTMLElement, KeyHintProps>(function KeyHint({
  children,
  className,
  icon,
  ...props
}, ref) {
  return (
    <kbd
      {...props}
      className={classNames(styles.root, className)}
      data-bitfun-component="key-hint"
      ref={ref}
    >
      {icon !== undefined && icon !== null && (
        <span aria-hidden="true" className={styles.icon} data-bitfun-part="icon">
          {icon}
        </span>
      )}
      <span className={styles.label} data-bitfun-part="label">{children}</span>
    </kbd>
  );
});
