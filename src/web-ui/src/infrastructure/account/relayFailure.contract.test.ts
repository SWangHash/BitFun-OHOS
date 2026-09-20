import { describe, expect, it } from 'vitest';
import {
  RELAY_VERSION_RETIRED_CODE,
  classifyRelayFailure,
  isRetryableRelayFailure,
  relayFailureAction,
} from '../../../../shared/relay-transport/RelayFailure';

describe('relay failure classification', () => {
  it('separates a retired Relay version from a network fault', () => {
    // The retirement answer arrives before authentication, so a bare 410 on an
    // account route must never be explained as this device's network.
    const retired = Object.assign(new Error('List devices failed: HTTP 410'), { status: 410 });
    expect(classifyRelayFailure(retired)).toBe('relay-version-retired');
    expect(relayFailureAction('relay-version-retired')).toBe('check-updates');

    const offline = new TypeError('Failed to fetch');
    expect(classifyRelayFailure(offline)).toBe('network');
    expect(relayFailureAction('network')).toBe('retry');
  });

  it('treats a temporary Relay outage as retryable, not as a client problem', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      const failure = new Error(`List devices failed: HTTP ${status}`);
      expect(classifyRelayFailure(failure)).toBe('relay-unavailable');
      expect(isRetryableRelayFailure('relay-unavailable')).toBe(true);
    }
  });

  it('keeps authentication failures on the sign-in path', () => {
    expect(classifyRelayFailure(new Error('List devices failed: HTTP 401'))).toBe('auth');
    expect(classifyRelayFailure(new Error('Sign in with GitHub to continue'))).toBe('auth');
    expect(relayFailureAction('auth')).toBe('sign-in');
  });

  it('classifies a refused client build as an update, whatever it is reported by', () => {
    expect(classifyRelayFailure(new Error('relay_session_history_retired'))).toBe('client-outdated');
    expect(classifyRelayFailure(new Error('incompatible client build: remote control requires matching client versions'))).toBe('client-outdated');
    expect(classifyRelayFailure(new Error(`Relay error: ${RELAY_VERSION_RETIRED_CODE}`))).toBe('client-outdated');
  });

  it('never blames the user for an unrecognized failure', () => {
    expect(classifyRelayFailure(new Error('List devices failed: HTTP 404'))).toBe('unknown');
    expect(classifyRelayFailure('something else entirely')).toBe('unknown');
    expect(relayFailureAction('unknown')).toBe('retry');
  });

  it('accepts the shapes surfaces actually hold', () => {
    expect(classifyRelayFailure(Object.assign(new Error('x'), { status: 503 }))).toBe('relay-unavailable');
    expect(classifyRelayFailure({ message: 'WebSocket connection failed' })).toBe('network');
    expect(classifyRelayFailure(undefined)).toBe('unknown');
  });
});
