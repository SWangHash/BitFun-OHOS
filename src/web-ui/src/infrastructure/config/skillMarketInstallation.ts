import type { SkillInfo, SkillMarketItem } from './types';

function repositoryKey(source: string): string {
  return source.trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function installationKey(source: string, name: string): string {
  return `${repositoryKey(source)}@${name.trim()}`;
}

/** A display name alone cannot establish marketplace provenance. */
export function installedSkillMarketIds(skills: readonly SkillInfo[]): Set<string> {
  return new Set(skills.flatMap(skill => {
    const ids: string[] = [];
    // Primary: .market-source marker from native Rust installer (skills.sh + Matrix).
    // The marker stores the raw install_id (e.g. "anthropics/skills@pdf").
    // Normalize through installationKey so isSkillMarketItemInstalled matches.
    if (skill.marketInstallId?.trim()) {
      const trimmed = skill.marketInstallId.trim();
      const separator = trimmed.lastIndexOf('@');
      if (separator > 0) {
        ids.push(installationKey(trimmed.slice(0, separator), trimmed.slice(separator + 1)));
      }
    }
    // Fallback: legacy skills-lock.json provenance (including skillhub: sources).
    if (skill.installationSource?.trim()) {
      ids.push(skill.installationSource.startsWith('skillhub:')
        ? skill.installationSource
        : installationKey(skill.installationSource, skill.name));
    }
    return ids;
  }));
}

export function isSkillMarketItemInstalled(skill: SkillMarketItem, installedIds: ReadonlySet<string>): boolean {
  if (skill.installId.startsWith('skillhub:')) return installedIds.has(skill.installId);
  const installId = skill.installId.startsWith('skills-sh:') ? skill.installId.slice(skill.installId.indexOf('#') + 1) : skill.installId;
  const separator = installId.lastIndexOf('@');
  if (separator > 0) {
    return installedIds.has(installationKey(installId.slice(0, separator), installId.slice(separator + 1)));
  }
  return !!skill.source.trim() && installedIds.has(installationKey(skill.source, skill.name));
}

/**
 * Whether the installId represents a GitHub source (org/repo@subdir).
 * Non-GitHub sources (e.g. `modelscope.cn/name`) have no `/` before the first
 * `@` and are not supported by the native installer — the install button is
 * disabled and the user is guided to install manually via the link.
 */
export function isGithubInstallSource(installId: string): boolean {
  const atIdx = installId.indexOf('@');
  if (atIdx < 0) return false;
  return installId.slice(0, atIdx).includes('/');
}
