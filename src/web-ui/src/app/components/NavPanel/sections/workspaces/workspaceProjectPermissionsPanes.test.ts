import { describe, expect, it } from 'vitest';
import { distributePaneHeights } from './workspaceProjectPermissionsPanes';

describe('project permissions pane heights', () => {
  it('gives a short pane only its content height and the rest to the long one', () => {
    // 2000px of memory grants next to an empty rules pane: the empty pane must
    // not reserve a proportional slice of empty space.
    expect(distributePaneHeights([2000, 102], 400)).toEqual([298, 102]);
  });

  it('keeps both panes at their natural height when everything fits', () => {
    expect(distributePaneHeights([300, 200], 900)).toEqual([300, 200]);
  });

  it('splits the height by content share when both panes overflow', () => {
    expect(distributePaneHeights([2000, 1500], 500)).toEqual([285, 214]);
  });

  it('still splits by content share when both panes hold a full list', () => {
    // 30 grants next to 8 rules: the rules pane is too tall to keep for free.
    expect(distributePaneHeights([1246, 462], 668)).toEqual([487, 180]);
  });

  it('never drops a scrolling pane below one readable header plus a row', () => {
    expect(distributePaneHeights([600, 600], 100)).toEqual([88, 88]);
  });
});
