/**
 * Root-package declarations for the semver functions used by the updater.
 * Imported from the package root because `semver/functions/*` deep subpaths
 * stopped resolving under semver 7.6+ exports maps and pnpm layouts.
 */
declare module 'semver' {
  export function gt(left: string, right: string): boolean;
  export function valid(version: string | null | undefined): string | null;
}
