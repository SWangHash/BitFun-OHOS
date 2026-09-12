import { Check as LucideCheck } from 'lucide-react';
export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <LucideCheck width={size} height={size} stroke="currentColor" aria-hidden="true" />
  );
}
