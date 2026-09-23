import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INDUSTRY_AGENT_IDS } from './agentVisibility';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

function rustStringList(source: string, constName: string): string[] {
  const body = source.split(`const ${constName}: &[&str] = &[`)[1]?.split('];')[0];
  if (body === undefined) {
    return [];
  }
  return Array.from(body.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
}

/**
 * The agents scene renders an industry agent only when the runtime registry
 * exposes it, and the registry for a delivery profile is built from the product
 * assembly plan's agent list. An id the UI groups as an industry agent but the
 * plan never registers renders an empty zone with no error anywhere, so pin the
 * two lists together here.
 */
describe('industry agent product registration contract', () => {
  const productCapabilities = read(
    '../../../../../crates/assembly/product-capabilities/src/lib.rs',
  );
  const codeAgentIds = rustStringList(productCapabilities, 'CODE_AGENT_IDS');

  it('reads the product code-agent list', () => {
    expect(codeAgentIds).toContain('BitFun');
  });

  it('registers every industry agent in the product code-agent list', () => {
    for (const agentId of INDUSTRY_AGENT_IDS) {
      expect(codeAgentIds).toContain(agentId);
    }
  });
});
