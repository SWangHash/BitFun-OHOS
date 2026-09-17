import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./ScrollArea.module.css";

export type ScrollAreaOrientation = "vertical" | "horizontal" | "both";
export type ScrollbarVisibility = "auto" | "always" | "hidden";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  "data-bitfun-component"?: string;
  "data-bitfun-part"?: string;
  orientation?: ScrollAreaOrientation;
  /** Auto reveals on viewport hover or keyboard focus; touch remains visible. */
  scrollbarVisibility?: ScrollbarVisibility;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea({
    className,
    "data-bitfun-component": component = "scroll-area",
    "data-bitfun-part": part = "viewport",
    orientation = "vertical",
    scrollbarVisibility = "auto",
    ...props
  }, ref) {
    return (
      <div
        {...props}
        className={classNames(styles.root, className)}
        data-bitfun-component={component}
        data-bitfun-orientation={orientation}
        data-bitfun-part={part}
        data-bitfun-scrollbar-visibility={scrollbarVisibility}
        ref={ref}
      />
    );
  },
);
