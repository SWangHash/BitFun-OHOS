import { Checkbox, OverflowText } from '@openbitfun/ui';
import { forwardRef, type HTMLAttributes } from 'react';
import './AgentCapabilityOption.scss';

interface AgentCapabilityOptionProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'onChange'> {
  checked: boolean;
  disabled?: boolean;
  label: string;
  inputAriaLabel?: string;
  onCheckedChange: (checked: boolean) => void;
}

/** Capability selection shares one native checkbox interaction across Agent editors. */
export const AgentCapabilityOption = forwardRef<HTMLSpanElement, AgentCapabilityOptionProps>(
  function AgentCapabilityOption({
    checked,
    disabled,
    label,
    inputAriaLabel,
    'aria-describedby': describedBy,
    onCheckedChange,
    className,
    ...props
  }, ref) {
    return (
      <span
        {...props}
        ref={ref}
        className={['agent-capability-option', className].filter(Boolean).join(' ')}
        data-openbitfun-component="agent-capability-option"
        data-openbitfun-part="root"
        data-openbitfun-state={checked ? 'selected' : undefined}
        data-overflow-trigger
      >
        <Checkbox
          className="agent-capability-option__control"
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={inputAriaLabel ?? label}
          aria-describedby={describedBy}
          label={<OverflowText>{label}</OverflowText>}
        />
      </span>
    );
  },
);
