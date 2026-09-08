import {
  forwardRef,
  useId,
  useState,
  useEffect,
  type ButtonHTMLAttributes,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "../../internal/classNames";
import { OverflowText } from "../../primitives/OverflowText";
import { Icon } from "../Icon";
import styles from "./Disclosure.module.css";

type DisclosureTriggerProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-controls" | "aria-expanded" | "disabled" | "id" | "onClick" | "type">;

interface CustomDisclosureProps
  extends Omit<HTMLAttributes<HTMLElement>, "children" | "onToggle" | "title"> {
  presentation?: "custom";
  actions?: ReactNode;
  /** Compose a header with independent controls using the supplied toggle attributes. */
  renderHeader?: (triggerProps: DisclosureTriggerProps) => ReactNode;
  contentClassName?: string;
  contentInnerClassName?: string;
  unmountOnClose?: boolean;
  exitDurationMs?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  description?: ReactNode;
  disabled?: boolean;
  leading?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  summary: ReactNode;
}

interface NativeDisclosureProps
  extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "children" | "title"> {
  /** Preserve browser details/summary semantics, including native toggle events. */
  presentation: "native";
  children: ReactNode;
  summary: ReactNode;
}

export type DisclosureProps = CustomDisclosureProps | NativeDisclosureProps;

type InertContentAttributes = HTMLAttributes<HTMLDivElement> & { inert?: "" };

const CustomDisclosure = forwardRef<HTMLElement, CustomDisclosureProps>(
  function Disclosure({
    actions,
    renderHeader,
    contentClassName,
    contentInnerClassName,
    unmountOnClose = false,
    exitDurationMs = 180,
    children,
    className,
    defaultOpen = false,
    description,
    disabled = false,
    leading,
    onOpenChange,
    open,
    presentation: _presentation,
    summary,
    ...props
  }, ref) {
    const generatedId = useId();
    const triggerId = `bitfun-disclosure-${generatedId}-trigger`;
    const contentId = `bitfun-disclosure-${generatedId}-content`;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const resolvedOpen = open ?? uncontrolledOpen;
    const inertContentAttributes: InertContentAttributes = resolvedOpen ? {} : { inert: "" };

    const [retained, setRetained] = useState(resolvedOpen);
    useEffect(() => {
      if (resolvedOpen) { setRetained(true); return; }
      if (!retained) return;
      const timer = setTimeout(() => setRetained(false), Math.max(0, exitDurationMs));
      return () => clearTimeout(timer);
    }, [resolvedOpen, retained, exitDurationMs]);

    function toggle() {
      if (disabled) return;
      const nextOpen = !resolvedOpen;
      if (open === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    }

    return (
      <section
        {...props}
        className={classNames(styles.root, className)}
        data-bitfun-component="disclosure"
        data-disabled={disabled ? "true" : "false"}
        data-open={resolvedOpen ? "true" : "false"}
        ref={ref}
      >
        {renderHeader ? renderHeader({
          'aria-controls': contentId,
          'aria-expanded': resolvedOpen,
          disabled,
          id: triggerId,
          onClick: toggle,
          type: 'button',
        }) : <div className={styles.header} data-bitfun-part="header">
          <button data-overflow-trigger
            aria-controls={contentId}
            aria-expanded={resolvedOpen}
            className={styles.trigger}
            disabled={disabled}
            id={triggerId}
            onClick={toggle}
            type="button"
          >
            <span aria-hidden="true" className={styles.indicator} data-bitfun-part="indicator">
              <Icon name="chevron-right" size="sm" />
            </span>
            {leading !== undefined && leading !== null && (
              <span aria-hidden="true" className={styles.leading} data-bitfun-part="leading">
                {leading}
              </span>
            )}
            <span className={styles.heading} data-bitfun-part="heading">
              <OverflowText className={styles.summary} data-bitfun-part="summary">{summary}</OverflowText>
              {description !== undefined && description !== null && (
                <span className={styles.description} data-bitfun-part="description">
                  {description}
                </span>
              )}
            </span>
          </button>
          {actions !== undefined && actions !== null && (
            <span className={styles.actions} data-bitfun-part="actions">{actions}</span>
          )}
        </div>}
        {(!unmountOnClose || resolvedOpen || retained) && <div
          {...inertContentAttributes}
          aria-hidden={!resolvedOpen}
          aria-labelledby={triggerId}
          className={classNames(styles.content, contentClassName)}
          data-open={resolvedOpen ? "true" : "false"}
          data-bitfun-part="content"
          id={contentId}
          role="region"
        >
          <div className={classNames(styles.contentInner, contentInnerClassName)} data-bitfun-part="content-inner">
            {children}
          </div>
        </div>}
      </section>
    );
  },
);

export const Disclosure = forwardRef<HTMLElement, DisclosureProps>(
  function Disclosure(props, ref) {
    if (props.presentation === "native") {
      const { children, className, presentation, summary, ...detailsProps } = props;
      return (
        <details
          {...detailsProps}
          className={classNames(styles.native, className)}
          data-bitfun-component="disclosure"
          data-presentation={presentation}
          ref={(element) => {
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
        >
          <summary data-bitfun-part="summary">{summary}</summary>
          {children}
        </details>
      );
    }

    return <CustomDisclosure {...props} ref={ref} />;
  },
);
