import { useLayoutEffect, useRef } from 'react';
import { Dialog, type DialogProps } from '@bitfun/ui';

/** Keep the last committed content throughout the design system's exit animation. */
export function EcosystemDialog({ children, open, ...props }: DialogProps) {
  const retained = useRef(children);
  useLayoutEffect(() => { if (open) retained.current = children; }, [children, open]);
  return <Dialog {...props} open={open}>{open ? children : retained.current}</Dialog>;
}
