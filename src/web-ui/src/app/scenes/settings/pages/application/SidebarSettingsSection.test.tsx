// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sidebarPreferences, createSidebarPreferences } from '@/app/navigation/sidebarPreferences';
import SidebarSettingsSection from './SidebarSettingsSection';

vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({
  t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key,
}) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  sidebarPreferences.setState({ pinnedIds: ['builtin.todos'], storageIssue: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<SidebarSettingsSection />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('pins, reorders, removes and resets the same persisted navigation list', () => {
  const click = (label: string) => act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  click('sidebar.addEntry:common:nav.items.agents');
  expect(sidebarPreferences.getState().pinnedIds).toEqual(['builtin.todos', 'builtin.agents']);
  click('sidebar.moveUp:common:nav.items.agents');
  expect(createSidebarPreferences(window.localStorage).getState().pinnedIds).toEqual(['builtin.agents', 'builtin.todos']);
  click('sidebar.remove:common:nav.items.agents');
  expect(sidebarPreferences.getState().pinnedIds).toEqual(['builtin.todos']);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('sidebar.addEntry:common:nav.items.agents');
  click('sidebar.remove:common:nav.items.todos');
  expect(createSidebarPreferences(window.localStorage).getState().pinnedIds).toEqual([]);
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'sidebar.reset')!.click());
  expect(sidebarPreferences.getState().pinnedIds).toEqual(['builtin.todos']);
  expect(host.textContent).toContain('nav.items.assistant');
  expect(host.textContent).toContain('nav.items.miniApps');
});
