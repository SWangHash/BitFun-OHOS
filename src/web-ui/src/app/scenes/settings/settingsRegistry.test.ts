import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveSettingsDestination } from './settingsDestination';
import { SETTINGS_CATEGORIES, SETTINGS_PAGE_MANIFESTS } from './settingsRegistry';
import { useSettingsStore } from './settingsStore';
import { projectSettingsCapabilityDestination } from '@/app/global-search/settingsCapabilityDestination';
import type { SettingsDestination } from './settingsTypes';

vi.mock('@/infrastructure/i18n/core/I18nService', () => ({
  i18nService: { loadNamespace: vi.fn(async () => undefined) },
}));

describe('settings information architecture', () => {
  it('keeps browser settings reachable on HarmonyOS without advertising desktop control', async () => {
    vi.stubGlobal('navigator', { userAgent: 'HarmonyOS', platform: 'OHOS' });
    vi.resetModules();
    const { SETTINGS_PAGE_MANIFESTS: pages } = await import('./settingsRegistry');
    const page = pages.find(item => item.id === 'tools.desktop-control')!;
    expect(page.labelKey).toBe('navigation.pages.browserControl.label');
    expect(page.keywords).toContain('cdp');
    expect(page.keywords).not.toContain('desktop');
    expect(page.searchPhrases.some(phrase => phrase.key.startsWith('computerUse.'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('has five ownership categories and unique canonical pages', () => {
    expect(SETTINGS_CATEGORIES.map(category => category.id)).toEqual(['application', 'ai', 'development', 'tools', 'data']);
    expect(SETTINGS_PAGE_MANIFESTS).toHaveLength(20);
    expect(new Set(SETTINGS_PAGE_MANIFESTS.map(page => page.id)).size).toBe(20);
    expect(SETTINGS_CATEGORIES.flatMap(category => category.pages)).toHaveLength(20);
  });

  it('separates permissions, combines session and memory, and retains existing platform owners', () => {
    const page = (id: string) => SETTINGS_PAGE_MANIFESTS.find(item => item.id === id);
    expect(page('ai.session-memory')?.sections?.map(section => section.id)).toEqual(['session', 'memory']);
    expect(page('ai.permissions')?.searchPhrases).toContainEqual({ namespace: 'settings/runtime', key: 'permissionPolicy.sectionTitle' });
    expect(page('ai.execution')?.searchPhrases).toContainEqual({ namespace: 'settings/review-capacity', key: 'capacity.title' });
    expect(page('tools.desktop-control')?.searchPhrases).toContainEqual({ namespace: 'settings/runtime', key: 'browserControl.sectionTitle' });
    expect(page('tools.external-agents')?.views?.map(view => view.id)).toEqual(['local', 'ssh', 'json']);
    expect(page('tools.automation')?.sections?.map(section => section.id)).toEqual(['quick-actions', 'hooks']);
    expect(page('application.input')?.sections?.map(section => section.id)).toEqual(['message-sending', 'text-selection', 'shortcuts']);
    expect(page('application.appearance')?.sections?.map(section => section.id)).toEqual(['sidebar-navigation']);
    expect(page('application.pet')?.categoryId).toBe('application');
    expect(page('tools.external-import')).toBeDefined();
    expect(page('development.editor')?.categoryId).toBe('development');
    expect(page('development.terminal')?.categoryId).toBe('development');
  });

  it.each([
    ['ai.memory', { pageId: 'ai.session-memory', sectionId: 'memory' }],
    ['workspace.session', { pageId: 'ai.session-memory', sectionId: 'session' }],
    ['application.editor', { pageId: 'development.editor' }],
    ['application.terminal', { pageId: 'development.terminal' }],
    ['workspace.worktrees', { pageId: 'development.workspace', sectionId: 'worktrees' }],
    ['tools.execution', { pageId: 'ai.execution' }],
    ['session-permissions', { pageId: 'ai.permissions' }],
    ['shortcuts', { pageId: 'application.input', sectionId: 'shortcuts' }],
    ['voice-input', { pageId: 'application.input' }],
    ['tools.webSearch', { pageId: 'tools.web-search' }],
    ['tools.acp', { pageId: 'tools.external-agents' }],
    ['tools.integrations', { pageId: 'tools.external-import' }],
    ['external-sources', { pageId: 'tools.external-import' }],
    ['hooks', { pageId: 'tools.automation', sectionId: 'hooks' }],
    ['quick-actions', { pageId: 'tools.automation', sectionId: 'quick-actions' }],
    ['tools.browser-control', { pageId: 'tools.desktop-control' }],
    ['data.history', { pageId: 'data.usage' }],
  ])('resolves the legacy destination %s', (legacy, expected) => {
    expect(resolveSettingsDestination(legacy as string)).toEqual(expected);
  });

  it('migrates old views and keeps ACP views valid', () => {
    expect(resolveSettingsDestination({ pageId: 'tools.execution', viewId: 'common' })).toEqual({ pageId: 'ai.permissions' });
    expect(resolveSettingsDestination({ pageId: 'tools.execution', viewId: 'advanced' })).toEqual({ pageId: 'ai.execution' });
    expect(resolveSettingsDestination({ pageId: 'tools.automation', viewId: 'hooks' })).toEqual({ pageId: 'tools.automation', sectionId: 'hooks' });
    expect(resolveSettingsDestination({ pageId: 'tools.acp', viewId: 'ssh' })).toEqual({ pageId: 'tools.external-agents', viewId: 'ssh' });
    expect(resolveSettingsDestination({ pageId: 'ai.models', sectionId: 'hooks' })).toEqual({ pageId: 'ai.models' });
  });

  it('normalizes old destinations at the store boundary', () => {
    useSettingsStore.getState().openDestination({ pageId: 'tools.browser-control' } as unknown as SettingsDestination);
    expect(useSettingsStore.getState().activePageId).toBe('tools.desktop-control');
    expect(useSettingsStore.getState().pageTransitionTarget).toBe('tools.desktop-control');
  });

  it('keeps capability identifiers stable while relocating individual settings', () => {
    expect(projectSettingsCapabilityDestination('setting.application.appearance', { kind: 'settings', pageId: 'application.appearance' }, 'language'))
      .toEqual({ kind: 'settings', pageId: 'application.general' });
    expect(projectSettingsCapabilityDestination('setting.workspace.session', { kind: 'settings', pageId: 'workspace.session' as never }, 'search-index'))
      .toEqual({ kind: 'settings', pageId: 'development.workspace', sectionId: 'workspace-search' });
  });

  it.each(['en-US', 'zh-CN', 'zh-TW'])('provides copy for every navigation label and search phrase in %s', locale => {
    const resources = new Map<string, Record<string, unknown>>();
    const lookup = (namespace: string, key: string) => {
      if (!resources.has(namespace)) resources.set(namespace, JSON.parse(readFileSync(new URL(`../../../locales/${locale}/${namespace}.json`, import.meta.url), 'utf8')));
      return key.split('.').reduce<unknown>((value, segment) => (value as Record<string, unknown> | undefined)?.[segment], resources.get(namespace));
    };
    for (const category of SETTINGS_CATEGORIES) expect(lookup('settings', category.labelKey), category.labelKey).toBeTypeOf('string');
    for (const page of SETTINGS_PAGE_MANIFESTS) {
      for (const key of [page.labelKey, page.descriptionKey]) if (key) expect(lookup('settings', key), key).toBeTypeOf('string');
      for (const phrase of [...page.searchPhrases, ...(page.sections ?? []).flatMap(section => section.searchPhrases ?? [])]) {
        expect(lookup(phrase.namespace, phrase.key), `${phrase.namespace}:${phrase.key}`).toBeTypeOf('string');
      }
    }
  });
});
