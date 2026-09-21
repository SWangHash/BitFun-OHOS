/**
 * Local declarations for the semver function subpath imports used by the
 * updater. The installed semver build does not ship resolvable types for
 * `semver/functions/*` under this project's module resolution.
 */
declare module 'semver/functions/gt' {
  function gt(left: string, right: string): boolean;
  export default gt;
}

declare module 'semver/functions/valid' {
  function valid(version: string | null | undefined): string | null;
  export default valid;
}
