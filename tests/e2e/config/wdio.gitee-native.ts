import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddedConfig } from './embedded-driver';

// The embedded driver is local even when public provider requests use a proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');

// Keep the isolated profile and evidence for inspection after a live failure.
const root = process.env.BITFUN_GITEE_E2E_ROOT
  ?? mkdtempSync(join(tmpdir(), 'bitfun-gitee-e2e-'));
Object.assign(process.env, {
  BITFUN_GITEE_E2E_ROOT: root,
  BITFUN_E2E_STORAGE_ROOT: root,
  BITFUN_E2E_USER_ROOT: join(root, 'user'),
  BITFUN_USER_ROOT: join(root, 'user'),
  BITFUN_E2E_HOME: join(root, 'home'),
  BITFUN_HOME: join(root, 'home'),
  BITFUN_E2E_LOG_DIR: join(root, 'logs'),
  BITFUN_E2E_STORAGE_GUARD: '1',
  BITFUN_E2E_PACKAGED_FRONTEND: '1',
  BITFUN_E2E_FRONTEND_DIR: resolve(fileURLToPath(new URL('../../../dist', import.meta.url))),
});
export const config = createEmbeddedConfig(['../specs/gitee-native.spec.ts'], 'Gitee native');
