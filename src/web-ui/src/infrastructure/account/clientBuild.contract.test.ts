import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_PROTOCOL_VERSION,
  CLIENT_VERSION,
} from '../../../../shared/relay-transport/ClientBuild';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

describe('client build contract single source', () => {
  // The Relay gates remote control on the reported protocol number, so the Rust
  // owner and the shared TS constant must agree. A bump that misses one side
  // fails here instead of silently mis-gating control between builds.
  const accountContract = read(
    '../../../../../src/crates/contracts/product-domains/src/account.rs',
  );

  it('pins the control protocol number to the shared Rust contract', () => {
    expect(accountContract).toContain(
      `pub const CLIENT_PROTOCOL_VERSION: u32 = ${CLIENT_PROTOCOL_VERSION};`,
    );
  });

  it('reports a well-formed diagnostic build string', () => {
    // Derived from the workspace package.json (which release-please bumps in
    // step with Cargo.toml), so it cannot silently rot. Pin only the shape the
    // Relay accepts: non-empty semver under its 64 UTF-8 byte cap.
    expect(CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(CLIENT_VERSION.length).toBeLessThanOrEqual(64);
  });

  it('reports the build on both the handshake and the login body', () => {
    const realtime = read('../../../../shared/relay-transport/AccountRealtime.ts');
    expect(realtime).toContain('clientVersion: CLIENT_VERSION');
    expect(realtime).toContain('clientProtocol: CLIENT_PROTOCOL_VERSION');

    const login = read('../../../../../src/mobile-web/src/services/CloudAccountClient.ts');
    expect(login).toContain('clientVersion: CLIENT_VERSION');
    expect(login).toContain('clientProtocol: CLIENT_PROTOCOL_VERSION');
  });
});
