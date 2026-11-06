import { forwardRef, useEffect, useRef, type HTMLAttributes } from "react";
import { classNames } from "../../internal/classNames";
import { createSpinnerAnimations } from "./spinnerMotion";
import styles from "./Spinner.module.css";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";
export type SpinnerVariant = "logo" | "bars" | "matrix";

export interface SpinnerProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: SpinnerSize;
  /** `matrix` is a compatibility alias for the logo presentation. */
  variant?: SpinnerVariant;
  active?: boolean;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner({
  "aria-label": ariaLabel,
  className,
  size = "md",
  variant = "logo",
  active = true,
  ...props
}, ref) {
  const presentation = variant === "matrix" ? "logo" : variant;
  const glyphRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const glyph = glyphRef.current;
    if (!active || presentation !== "logo" || !glyph) return;
    const document = glyph.ownerDocument;
    const window = document.defaultView;
    if (!window?.matchMedia || typeof glyph.animate !== "function") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forcedColors = window.matchMedia("(forced-colors: active)");
    let animations: Animation[] = [];
    let visible = true;
    const synchronize = () => {
      if (reducedMotion.matches || forcedColors.matches) {
        animations.forEach(animation => animation.cancel());
        animations = [];
      } else if (document.hidden || !visible) {
        animations.forEach(animation => animation.pause());
      } else if (animations.length === 0) {
        animations = createSpinnerAnimations(glyph);
      } else {
        animations.forEach(animation => animation.play());
      }
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      synchronize();
    });
    observer?.observe(glyph);
    synchronize();
    reducedMotion.addEventListener("change", synchronize);
    forcedColors.addEventListener("change", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      animations.forEach(animation => animation.cancel());
      observer?.disconnect();
      reducedMotion.removeEventListener("change", synchronize);
      forcedColors.removeEventListener("change", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [active, presentation]);
  return (
    <span
      {...props}
      aria-hidden={ariaLabel ? undefined : "true"}
      aria-label={ariaLabel}
      className={classNames(styles.root, className)}
      data-bitfun-component="spinner"
      data-size={size}
      data-variant={presentation}
      data-active={active}
      ref={ref}
      role={ariaLabel ? "status" : undefined}
    >
      {presentation === "logo" ? (
        <span aria-hidden="true" className={styles.glyph} ref={glyphRef}>
          <span className={styles.artwork} />
        </span>
      ) : Array.from({ length: 3 }, (_, index) => (
        <span aria-hidden="true" className={styles.cell} key={index} />
      ))}
    </span>
  );
});

export interface LoadingStateProps
  extends HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  function LoadingState({ children, className, size = "md", ...props }, ref) {
    return (
      <div
        {...props}
        className={classNames(styles.loadingState, className)}
        data-bitfun-component="loading-state"
        data-size={size}
        ref={ref}
      >
        <Spinner size={size} />
        {children ? <span className={styles.label} data-bitfun-part="label">{children}</span> : null}
      </div>
    );
  },
);
