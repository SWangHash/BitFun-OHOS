import { describe, expect, it, vi } from 'vitest';
import {
  isLegacyEcosystemCompatibilityDestination,
  resolveSettingsDestination,
} from './settingsDestination';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_PAGE_MANIFESTS,
} from './settingsRegistry';
import { useSettingsStore } from './settingsStore';
import type { SettingsDestination } from './settingsTypes';

vi.mock('@/infrastructure/i18n/core/I18nService', () => ({
  i18nService: { loadNamespace: vi.fn(async () => undefined) },
}));

describe('settings information architecture', () => {
  it('uses five ownership categories and nineteen canonical pages', () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      'application',
      'ai',
      'development',
      'tools',
      'data',
    ]);
    expect(SETTINGS_PAGE_MANIFESTS).toHaveLength(19);
    expect(new Set(SETTINGS_PAGE_MANIFESTS.map((page) => page.id)).size).toBe(19);
  });

  it('keeps sessions and memory together and splits permissions from execution', () => {
    const sessionMemory = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'ai.session-memory');
    const permissions = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'ai.permissions');
    const execution = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'ai.execution');

    expect(sessionMemory?.categoryId).toBe('ai');
    expect(sessionMemory?.sections?.map((section) => section.id)).toEqual(['session', 'memory']);
    expect(permissions?.categoryId).toBe('ai');
    expect(permissions?.views).toBeUndefined();
    expect(permissions?.searchPhrases)
      .toContainEqual({ namespace: 'settings/runtime', key: 'permissionPolicy.sectionTitle' });
    expect(execution?.searchPhrases)
      .not.toContainEqual({ namespace: 'settings/runtime', key: 'permissionPolicy.sectionTitle' });
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id.includes('review'))).toBe(false);
    expect(execution?.searchPhrases)
      .toContainEqual({ namespace: 'settings/review-capacity', key: 'capacity.title' });
  });

  it('keeps browser and desktop control in one page', () => {
    const control = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'tools.desktop-control');

    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id === 'tools.device-control')).toBe(false);
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id === 'tools.browser-control')).toBe(false);
    expect(control?.labelKey).toBe('navigation.pages.browserDesktopControl.label');
    expect(control?.searchPhrases)
      .toContainEqual({ namespace: 'settings/runtime', key: 'computerUse.sectionTitle' });
    expect(control?.searchPhrases)
      .toContainEqual({ namespace: 'settings/runtime', key: 'browserControl.sectionTitle' });
    expect(resolveSettingsDestination('tools.device-control')).toEqual({ pageId: 'tools.desktop-control' });
    expect(resolveSettingsDestination('tools.browser-control')).toEqual({ pageId: 'tools.desktop-control' });
    expect(resolveSettingsDestination('review')).toEqual({ pageId: 'ai.execution' });
  });

  it('normalizes the retired browser-control page at the store boundary', () => {
    useSettingsStore.getState().openDestination({
      pageId: 'tools.browser-control',
    } as unknown as SettingsDestination);

    expect(useSettingsStore.getState().activePageId).toBe('tools.desktop-control');
    expect(useSettingsStore.getState().pageTransitionTarget).toBe('tools.desktop-control');
  });

  it('keeps Assistant ownership outside Settings and model preferences with network proxy', () => {
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id.includes('assistant'))).toBe(false);
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'ai.models')?.searchPhrases)
      .toEqual(expect.arrayContaining([
        { namespace: 'settings/default-model', key: 'sections.defaults' },
        { namespace: 'settings/default-model', key: 'sections.proxy' },
      ]));
  });

  it('keeps external-source governance outside Settings while retaining WebSearch, MCP, and external-agent owners', () => {
    expect(SETTINGS_CATEGORIES.find((category) => category.id === 'tools')?.pages.map((page) => page.id))
      .toEqual([
        'tools.web-search',
        'tools.desktop-control',
        'tools.mcp',
        'tools.external-agents',
        'tools.automation',
      ]);
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id === 'tools.integrations')).toBe(false);
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'tools.mcp')?.views).toBeUndefined();
    expect(SETTINGS_PAGE_MANIFESTS
      .find((page) => page.id === 'tools.external-agents')?.views?.map((view) => view.id))
      .toEqual(['local', 'ssh', 'json']);
  });

  it('keeps automation as a page with deep-linkable views', () => {
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'tools.automation')?.views?.map((view) => view.id))
      .toEqual(['quick-actions', 'hooks']);
  });

  it('composes voice input and keyboard shortcuts into the input page as sections', () => {
    const applicationPages = SETTINGS_CATEGORIES.find((category) => category.id === 'application')?.pages;
    const input = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'application.input');

    expect(applicationPages?.map((page) => page.id)).toEqual([
      'application.general',
      'application.appearance',
      'application.pet',
      'application.input',
    ]);
    expect(input?.sections?.map((section) => section.id)).toEqual(['voice', 'shortcuts']);
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id === 'application.voice')).toBe(false);
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => page.id === 'application.shortcuts')).toBe(false);
    expect(resolveSettingsDestination('application.voice')).toEqual({
      pageId: 'application.input',
      sectionId: 'voice',
    });
    expect(resolveSettingsDestination('voice-input')).toEqual({
      pageId: 'application.input',
      sectionId: 'voice',
    });
    expect(resolveSettingsDestination('shortcuts')).toEqual({
      pageId: 'application.input',
      sectionId: 'shortcuts',
    });
  });

  it('exposes terminal and editor as independent development pages', () => {
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'development.terminal')?.views)
      .toBeUndefined();
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'development.editor')?.views)
      .toBeUndefined();
    expect(resolveSettingsDestination('application.development')).toEqual({
      pageId: 'development.terminal',
    });
    expect(resolveSettingsDestination('terminal')).toEqual({ pageId: 'development.terminal' });
    expect(resolveSettingsDestination('editor')).toEqual({ pageId: 'development.editor' });
  });

  it('composes workspace search and worktrees into the workspace page as sections', () => {
    const workspace = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'development.workspace');

    expect(workspace?.categoryId).toBe('development');
    expect(workspace?.sections?.map((section) => section.id)).toEqual(['workspace-search', 'worktrees']);
    expect(resolveSettingsDestination('workspace.worktrees')).toEqual({
      pageId: 'development.workspace',
      sectionId: 'worktrees',
    });
    expect(resolveSettingsDestination('workspace.session')).toEqual({
      pageId: 'ai.session-memory',
      sectionId: 'session',
    });
    expect(resolveSettingsDestination('ai.memory')).toEqual({
      pageId: 'ai.session-memory',
      sectionId: 'memory',
    });
  });

  it('keeps appearance packages discoverable inside Appearance', () => {
    const appearance = SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'application.appearance');

    expect(appearance?.searchPhrases).toEqual(expect.arrayContaining([
      { namespace: 'settings/appearance', key: 'package.title' },
    ]));
    expect(SETTINGS_PAGE_MANIFESTS.some((page) => /motion|package/.test(page.id))).toBe(false);
  });

  it('exposes usage and archived sessions as separate second-level pages', () => {
    const dataPages = SETTINGS_CATEGORIES.find((category) => category.id === 'data')?.pages;

    expect(dataPages?.map((page) => page.id)).toEqual([
      'data.usage',
      'data.archived',
      'data.diagnostics',
    ]);
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'data.usage')?.views).toBeUndefined();
    expect(SETTINGS_PAGE_MANIFESTS.find((page) => page.id === 'data.archived')?.views).toBeUndefined();
  });

  it('contains old links at the upgrade boundary and emits canonical destinations', () => {
    expect(resolveSettingsDestination('hooks')).toEqual({
      pageId: 'tools.automation',
      viewId: 'hooks',
    });
    expect(resolveSettingsDestination('tools.execution')).toEqual({ pageId: 'ai.execution' });
    expect(resolveSettingsDestination({ pageId: 'tools.execution', viewId: 'common' })).toEqual({
      pageId: 'ai.permissions',
    });
    expect(resolveSettingsDestination({ pageId: 'tools.execution', viewId: 'advanced' })).toEqual({
      pageId: 'ai.execution',
    });
    expect(isLegacyEcosystemCompatibilityDestination('external-sources')).toBe(true);
    expect(isLegacyEcosystemCompatibilityDestination('tools.integrations')).toBe(true);
    expect(isLegacyEcosystemCompatibilityDestination({ pageId: 'tools.integrations' })).toBe(true);
    expect(resolveSettingsDestination('mcp-tools')).toEqual({ pageId: 'tools.mcp' });
    expect(resolveSettingsDestination('acp-agents')).toEqual({ pageId: 'tools.external-agents' });
    expect(resolveSettingsDestination('tools.acp')).toEqual({ pageId: 'tools.external-agents' });
    expect(resolveSettingsDestination('tools.webSearch')).toEqual({ pageId: 'tools.web-search' });
    expect(resolveSettingsDestination('ai.models')).toEqual({ pageId: 'ai.models' });
    expect(resolveSettingsDestination('usage-statistics')).toEqual({ pageId: 'data.usage' });
    expect(resolveSettingsDestination('archived-sessions')).toEqual({ pageId: 'data.archived' });
    expect(resolveSettingsDestination('data.history')).toEqual({ pageId: 'data.usage' });
  });
});
