import { describe, expect, it, vi } from 'vitest';
import { createSidebarRegistry, selectedSidebarEntry, type SidebarContribution, type SidebarContext } from './sidebarRegistry';
import { sidebarRegistry } from './sidebarContributions';

const context: SidebarContext = { activeSceneId: 'skills', isDesktop: true, isPeer: false, surfaceId: 'local' };
const contribution: SidebarContribution = {
  id: 'example.page', labelKey: 'common:scenes.skills', icon: 'book-open',
  isActive: current => current.activeSceneId === 'skills', open: vi.fn(),
};

describe('sidebar contribution lifecycle', () => {
  it('publishes stable snapshots, rejects collisions, and supports unload/re-registration', () => {
    const registry = createSidebarRegistry();
    const changed = vi.fn();
    const stop = registry.subscribe(changed);
    const initial = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(initial);
    const dispose = registry.register(contribution);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(() => registry.register(contribution)).toThrow('duplicate');
    expect(selectedSidebarEntry(registry.getSnapshot(), ['example.page'], context)).toBe('example.page');
    dispose();
    expect(selectedSidebarEntry(registry.getSnapshot(), ['example.page'], context)).toBeUndefined();
    registry.register(contribution);
    dispose(); // An old disposer must not unregister a newer contribution.
    expect(registry.getSnapshot()).toHaveLength(1);
    stop();
  });

  it('selects the pinned destination on local and peer surfaces without enabling hidden pages', () => {
    const entries = sidebarRegistry.getSnapshot();
    const pins = ['builtin.todos', 'builtin.skills'];
    expect(selectedSidebarEntry(entries, pins, context)).toBe('builtin.skills');
    expect(selectedSidebarEntry(entries, pins, { ...context, activeSceneId: 'todos' })).toBe('builtin.todos');
    expect(selectedSidebarEntry(entries, pins, { ...context, isPeer: true, surfaceId: 'peer-a' })).toBe('builtin.skills');
    expect(entries.map(entry => entry.id)).not.toContain('builtin.pages');
    expect(selectedSidebarEntry(entries, ['extension.future'], context)).toBeUndefined();
  });
});
