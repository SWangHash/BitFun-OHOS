import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_RELAY_URL,
  isOfficialRelayEndpoint,
} from '../../../../shared/relay-transport/OfficialRelay';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

describe('official Relay endpoint single source', () => {
  const accountContract = read(
    '../../../../../src/crates/contracts/product-domains/src/account.rs',
  );

  it('pins the default Relay endpoint to the shared Rust contract', () => {
    // The Rust constant owns the deployment decision; the frontends only
    // project it. A version bump that misses one side fails here instead of
    // silently minting QR invitations for a retired prefix.
    expect(accountContract).toContain(
      `pub const DEFAULT_RELAY_URL: &str = "${OFFICIAL_RELAY_URL}";`,
    );
  });

  it('accepts every versioned deployment on the official origin', () => {
    for (const value of [
      OFFICIAL_RELAY_URL,
      'https://remote.openbitfun.com/v/1.0.1',
      'https://remote.openbitfun.com/v/2.3.4',
      'https://remote.openbitfun.com/v/2.3.4/',
    ]) {
      expect(isOfficialRelayEndpoint(value)).toBe(true);
    }
  });

  it('rejects non-official and ambiguous endpoints', () => {
    for (const value of [
      null,
      undefined,
      '',
      'not a url',
      'http://remote.openbitfun.com/v/1.0.2',
      'https://remote.openbitfun.com/',
      'https://remote.openbitfun.com/v/1.0',
      'https://remote.openbitfun.com/v/1.0.2/relay',
      'https://user@remote.openbitfun.com/v/1.0.2',
      'https://remote.openbitfun.com/v/1.0.2/?next=1',
      'https://remote.openbitfun.com/v/1.0.2/#/pair',
      'https://remote.openbitfun.com.evil.test/v/1.0.2',
      'https://remote.openbitfun.com@evil.test/v/1.0.2',
      'https://evil.test/v/1.0.2',
    ]) {
      expect(isOfficialRelayEndpoint(value)).toBe(false);
    }
  });
});
