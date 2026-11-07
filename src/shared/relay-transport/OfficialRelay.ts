/**
 * Official Relay deployment contract shared by the Web UI and mobile web.
 *
 * `DEFAULT_RELAY_URL` in
 * `src/crates/contracts/product-domains/src/account.rs` is the single source of
 * truth: it selects the credential database, mints QR invitation bases, names
 * the static mobile-web prefix, and drives the retired-version decision. Both
 * frontends read the endpoint from this module instead of keeping their own
 * copy, and `officialRelay.contract.test.ts` fails when the two drift apart.
 *
 * An official deployment is identified by its origin plus a `/v/<semver>`
 * path, not by one exact version. Classification must accept every version on
 * that origin: a version rollover may not relabel a live public Relay as a LAN
 * connection, and a phone that opens an invitation minted by another build may
 * not be rejected as "not the official Relay". The current version still
 * supplies display defaults and the fallback endpoint.
 */
export const OFFICIAL_RELAY_ORIGIN = 'https://remote.openbitfun.com';
export const OFFICIAL_RELAY_VERSION = '1.0.2';
export const OFFICIAL_RELAY_URL = `${OFFICIAL_RELAY_ORIGIN}/v/${OFFICIAL_RELAY_VERSION}`;

const OFFICIAL_RELAY_PATH = /^\/v\/\d+\.\d+\.\d+$/;

/** True for any authenticated versioned endpoint on the official Relay origin. */
export function isOfficialRelayEndpoint(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    return url.origin === OFFICIAL_RELAY_ORIGIN
      && OFFICIAL_RELAY_PATH.test(url.pathname.replace(/\/+$/, ''));
  } catch {
    return false;
  }
}
