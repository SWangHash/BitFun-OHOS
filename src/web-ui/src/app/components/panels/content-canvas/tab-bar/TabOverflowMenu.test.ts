import { describe, expect, it } from 'vitest';
import { getTabOverflowTriggerAction } from './TabOverflowMenu';

describe('TabOverflowMenu trigger action', () => {
  it('opens mission control directly when tabs overflow', () => {
    expect(getTabOverflowTriggerAction(true, true)).toBe('mission-control');
  });

  it('uses the dropdown only when mission control is unavailable', () => {
    expect(getTabOverflowTriggerAction(false, true)).toBe('overflow-menu');
    expect(getTabOverflowTriggerAction(false, false)).toBe('none');
  });
});
