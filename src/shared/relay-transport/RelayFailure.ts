/**
 * One vocabulary for "the account Relay could not be used", shared by every
 * surface (desktop, mobile web, and the mirrored Rust classifier in
 * `bitfun_services_integrations::remote_connect::relay_failure`).
 *
 * Surfaces must explain a failure the same way and offer the same next step;
 * the raw transport detail stays in the log. The classification is deliberately
 * conservative: an unknown failure is reported as retryable rather than blamed
 * on the user's network or on the client build.
 */
export type RelayFailureKind =
  /** No usable transport at all: offline, DNS, refused connection, TLS. */
  | 'network'
  /** Reachable but temporarily unable to serve: 408/425/429/5xx. */
  | 'relay-unavailable'
  /** This Relay version has been retired; only a client update can help. */
  | 'relay-version-retired'
  /** The Relay refused this build: mutual control or an old interface needs a newer client. */
  | 'client-outdated'
  /** The account session must be established again. */
  | 'auth'
  | 'unknown';

/** The next step a surface can offer for a failure. */
export type RelayFailureAction = 'retry' | 'check-updates' | 'sign-in';

/**
 * Machine-readable reason of a retired Relay version. Mirrors the Relay's own
 * answer (`relay_version_retired` in the relay-service `retired_version`
 * module) and the `nginx-retired-version.conf` snippet; `410` on an account
 * route is that answer, because route-level retirement reuses the same status.
 */
export const RELAY_VERSION_RETIRED_CODE = 'relay_version_retired';

/** Substrings of Relay refusals that mean "this build is too old to be served". */
const OUTDATED_MARKERS = [
  RELAY_VERSION_RETIRED_CODE,
  'relay_session_history_retired',
  'incompatible client build',
  'requires matching client versions',
  'update the controlling app',
  'update bitfun on every device',
];

/** Substrings that mean the account session must be re-established. */
const AUTH_MARKERS = [
  'sign in',
  'unauthorized',
  'invalid or expired token',
  'expired token',
  'relay auth error',
  'http 401',
  'http 403',
];

/**
 * Transport failures with no HTTP status. Kept as substrings of the messages
 * emitted by `fetch` and by the platform socket stacks.
 */
const NETWORK_MARKERS = [
  'failed to fetch',
  'networkerror',
  'network error',
  'network unavailable',
  'load failed',
  'fetch failed',
  'econnrefused',
  'econnreset',
  'enotfound',
  'eai_again',
  'getaddrinfo',
  'connection refused',
  'connection closed',
  'connection reset',
  'socket hang up',
  'websocket connection failed',
  'timed out',
  'timeout',
  'certificate',
  'tls',
  'dns',
];

function messageOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  const candidate = (value as { message?: unknown } | null | undefined)?.message;
  return typeof candidate === 'string' ? candidate : '';
}

/** HTTP status carried by the error itself or embedded in its message. */
function statusOf(value: unknown): number | null {
  const explicit = (value as { status?: unknown } | null | undefined)?.status;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const match = /\bHTTP\s+(\d{3})\b/i.exec(messageOf(value));
  return match ? Number(match[1]) : null;
}

/**
 * Classify a relay/account failure. Accepts anything a surface may hold: an
 * `Error`, a transport rejection, or a plain message string.
 */
export function classifyRelayFailure(value: unknown): RelayFailureKind {
  const message = messageOf(value).toLowerCase();
  const status = statusOf(value);

  if (OUTDATED_MARKERS.some(marker => message.includes(marker))) return 'client-outdated';
  if (status === 401 || status === 403) return 'auth';
  if (AUTH_MARKERS.some(marker => message.includes(marker))) return 'auth';
  // Retired versions answer 410 before authentication, so a 410 on an account
  // route is always "this Relay version is gone", never a stale device.
  if (status === 410) return 'relay-version-retired';
  if (status === 408 || status === 425 || status === 429 || (status !== null && status >= 500)) {
    return 'relay-unavailable';
  }
  if (NETWORK_MARKERS.some(marker => message.includes(marker))) return 'network';
  return 'unknown';
}

/** The next step to offer for a kind. */
export function relayFailureAction(kind: RelayFailureKind): RelayFailureAction {
  switch (kind) {
    case 'relay-version-retired':
    case 'client-outdated':
      return 'check-updates';
    case 'auth':
      return 'sign-in';
    default:
      return 'retry';
  }
}

/** Whether a failure is worth retrying on its own, without user action. */
export function isRetryableRelayFailure(kind: RelayFailureKind): boolean {
  return relayFailureAction(kind) === 'retry';
}
