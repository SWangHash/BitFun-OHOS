import {
  forwardRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSwitch.module.css";

export type MobileSwitchAppearance = "plain" | "surface";

export interface MobileSwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "size" | "type"> {
  appearance?: MobileSwitchAppearance;
  checked?: boolean;
  defaultChecked?: boolean;
  description?: ReactNode;
  label: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

/** A settings row: the label and its explanation are the tap target, the switch is the control.
    The switch itself is the web Switch's track and thumb, so both entries read as one product. */
export const MobileSwitch = forwardRef<HTMLInputElement, MobileSwitchProps>(
  function MobileSwitch({
    appearance = "plain",
    checked,
    className,
    defaultChecked,
    description,
    disabled,
    label,
    onChange,
    onCheckedChange,
    ...props
  }, ref) {
    const [uncontrolled, setUncontrolled] = useState(defaultChecked ?? false);
    const controlled = checked !== undefined;
    const resolved = controlled ? checked : uncontrolled;
    /* Focus and press states belong to the hidden input, but the row is what changes. The Lab drives
       the row through a root attribute, so lift that hook off the input onto the label. */
    const previewState = (props as Record<string, unknown>)["data-bitfun-preview-state"];

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      if (!controlled) setUncontrolled(event.target.checked);
      onChange?.(event);
      onCheckedChange?.(event.target.checked);
    }

    return (
      <label
        className={classNames(styles.root, className)}
        data-appearance={appearance}
        data-checked={resolved ? "true" : "false"}
        data-disabled={disabled ? "true" : "false"}
        data-bitfun-component="mobile-switch"
        data-bitfun-preview-state={typeof previewState === "string" ? previewState : undefined}
      >
        <span className={styles.copy} data-bitfun-part="copy">
          <span className={styles.label} data-bitfun-part="label">{label}</span>
          {description !== undefined && description !== null && (
            <span className={styles.description} data-bitfun-part="description">{description}</span>
          )}
        </span>
        <span className={styles.control}>
          <input
            {...props}
            checked={resolved}
            className={styles.input}
            disabled={disabled}
            onChange={handleChange}
            ref={ref}
            role="switch"
            type="checkbox"
          />
          <span aria-hidden="true" className={styles.track} data-bitfun-part="track">
            <span className={styles.thumb} data-bitfun-part="thumb" />
          </span>
        </span>
      </label>
    );
  },
);
