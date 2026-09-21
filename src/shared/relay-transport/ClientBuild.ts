import { version as PACKAGE_VERSION } from '../../../package.json';

/**
 * Identity of THIS client build, reported to the Relay at login and on every
 * realtime (re)connect so the Relay can gate remote control between devices.
 *
 * Compatibility is decided by the Relay alone from the two stored protocol
 * numbers; clients read the Relay-computed `compatible` flag on the device
 * directory instead of re-deriving the rule. The rule the Relay applies is:
 * two devices are mutually controllable only when BOTH report a number AND the
 * numbers are equal.
 *
 * Semantics of {@link CLIENT_PROTOCOL_VERSION}:
 *
 *  - legacy clients: report nothing (unreported, so the Relay judges them
 *    incompatible, never "legacy-compatible");
 *  - this build: `2`;
 *  - increment only on a breaking change to the client control contract.
 *
 * Kept numerically identical to
 * `bitfun_product_domains::account::CLIENT_PROTOCOL_VERSION` in
 * `src/crates/contracts/product-domains/src/account.rs`; `clientBuild.contract.test.ts`
 * pins the two together so one side can never drift.
 */
export const CLIENT_PROTOCOL_VERSION = 2;

/**
 * Product build string reported next to {@link CLIENT_PROTOCOL_VERSION} for
 * diagnostics only; the Relay gates control on the protocol number, never on
 * this string. Sourced from the workspace `package.json` — the release version
 * release-please bumps together with `Cargo.toml` — so it is a single source and
 * never a hand-maintained literal. This is where web-ui and mobile both read it
 * from rather than each keeping a copy.
 */
export const CLIENT_VERSION: string = PACKAGE_VERSION;
