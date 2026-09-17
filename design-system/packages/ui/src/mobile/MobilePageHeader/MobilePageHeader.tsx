import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobilePageHeader.module.css";

export interface MobilePageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  centered?: boolean;
  leading?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}

export const MobilePageHeader = forwardRef<HTMLElement, MobilePageHeaderProps>(function MobilePageHeader({ actions, centered = false, className, leading, subtitle, title, ...props }, ref) {
  return (
    <header {...props} className={classNames(styles.root, className)} data-bitfun-component="mobile-page-header" data-centered={centered ? "true" : "false"} ref={ref}>
      <div className={styles.leading} data-bitfun-part="leading">{leading}</div>
      <div className={styles.copy} data-bitfun-part="copy">
        <h1 className={styles.title} data-bitfun-part="title">{title}</h1>
        {subtitle !== undefined && subtitle !== null && <div className={styles.subtitle} data-bitfun-part="subtitle">{subtitle}</div>}
      </div>
      <div className={styles.actions} data-bitfun-part="actions">{actions}</div>
    </header>
  );
});
