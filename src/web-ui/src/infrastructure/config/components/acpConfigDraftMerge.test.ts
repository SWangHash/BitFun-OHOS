import { describe, expect, it } from 'vitest';
import { mergeAcpConfigDraft } from './acpConfigDraftMerge';

describe('ACP draft conflicts', () => {
  it('keeps a newer draft runtime and reports a concurrent setup conflict', () => {
    const result = mergeAcpConfigDraft(
      { acpClients: { codex: { localOverride: { command: 'old', args: ['old.js'] } } } },
      { acpClients: { codex: { localOverride: { command: 'user', args: ['user.js'] } } } },
      { acpClients: { codex: { localOverride: { command: 'setup', args: ['setup.js'] } } } },
    );
    expect(result.config.acpClients.codex.localOverride).toEqual({ command: 'user', args: ['user.js'] });
    expect(result.conflicted).toBe(true);
  });

  it('honors a draft deletion and an independently added managed client', () => {
    const result = mergeAcpConfigDraft<Record<string, unknown>>(
      { acpClients: { custom: { command: 'custom' } } },
      { acpClients: {} },
      { acpClients: { custom: { command: 'custom' }, codex: { command: 'codex' } } },
    );
    expect(result).toEqual({ config: { acpClients: { codex: { command: 'codex' } } }, conflicted: false });
  });
});
