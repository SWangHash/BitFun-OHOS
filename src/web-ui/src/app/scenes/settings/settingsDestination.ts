import migrations from './settingsDestinationMigrations.json';
import { DEFAULT_SETTINGS_PAGE_ID, getSettingsPageManifest, isSettingsPageId } from './settingsRegistry';
import type { SettingsDestination } from './settingsTypes';

const LEGACY_ECOSYSTEM_COMPATIBILITY_IDS = new Set([
  'external-sources',
  'tools.integrations',
]);

/** Old Settings links now redirect to the owning product surface. */
export function isLegacyEcosystemCompatibilityDestination(value: unknown): boolean {
  if (typeof value === 'string') {
    return LEGACY_ECOSYSTEM_COMPATIBILITY_IDS.has(value);
  }
  if (!value || typeof value !== 'object' || !('pageId' in value)) return false;
  return typeof value.pageId === 'string'
    && LEGACY_ECOSYSTEM_COMPATIBILITY_IDS.has(value.pageId);
}

export interface SettingsDestinationInput {
  pageId: string;
  viewId?: string;
  sectionId?: string;
}

/**
 * Upgrade boundary for links emitted by older installs, extensions, and peers.
 * Product code must use canonical SettingsDestination values directly; legacy
 * identifiers are contained in settingsDestinationMigrations.json so the
 * compatibility table stays readable and auditable.
 */
const LEGACY_DESTINATION_MIGRATIONS: Readonly<Record<string, SettingsDestinationInput>> = migrations.pages;
const LEGACY_VIEW_MIGRATIONS: Readonly<
  Record<string, Readonly<Record<string, SettingsDestinationInput>>>
> = migrations.views;

/** Normalize old page ids, old tab links, and current destinations before use. */
export function resolveSettingsDestination(
  value: string | SettingsDestinationInput,
): SettingsDestination {
  const input: SettingsDestinationInput = typeof value === 'string' ? { pageId: value } : value;
  const migrated = (input.viewId
    ? LEGACY_VIEW_MIGRATIONS[input.pageId]?.[input.viewId]
    : undefined)
    ?? LEGACY_DESTINATION_MIGRATIONS[input.pageId];
  const pageId = migrated?.pageId ?? input.pageId;
  if (!isSettingsPageId(pageId)) return { pageId: DEFAULT_SETTINGS_PAGE_ID };

  const manifest = getSettingsPageManifest(pageId);
  const requestedSectionId = input.sectionId ?? migrated?.sectionId;
  const section = requestedSectionId
    ? manifest.sections?.find((candidate) => candidate.id === requestedSectionId)
    : undefined;
  const requestedViewId = input.viewId ?? migrated?.viewId;
  const view = requestedViewId
    ? manifest.views?.find((candidate) => candidate.id === requestedViewId)
    : undefined;

  return {
    pageId,
    ...(section ? { sectionId: section.id } : {}),
    ...(view ? { viewId: view.id } : {}),
  };
}
