import { describe, expect, it } from 'vitest';

import { acpAgentTypeFromMetadata, acpAgentTypeFromSession, isAcpFlowSession } from './acpSession';

describe('acpSession utilities', () => {
  it('uses an explicit persisted ACP binding only when no ACP agent type remains', () => {
    expect(acpAgentTypeFromMetadata({
      agentType: 'acp:opencode',
      customMetadata: { provider: 'acp', acpClientId: 'codex' },
    })).toBe('acp:opencode');
    expect(acpAgentTypeFromMetadata({
      agentType: 'Standard',
      customMetadata: { provider: 'acp', acpClientId: 'codex' },
    })).toBe('acp:codex');
    expect(acpAgentTypeFromMetadata({
      agentType: 'Standard',
      customMetadata: { acpClientId: 'codex' },
    })).toBeNull();
    expect(acpAgentTypeFromMetadata({
      agentType: 'Standard',
      customMetadata: { provider: 'acp' },
    })).toBeNull();
  });

  it('resolves ACP agent type from session config first', () => {
    expect(
      acpAgentTypeFromSession({
        config: { agentType: 'acp:opencode' },
        mode: 'Standard',
      } as any)
    ).toBe('acp:opencode');
  });

  it('falls back to ACP mode for older or partial session state', () => {
    expect(
      acpAgentTypeFromSession({
        config: { agentType: 'Standard' },
        mode: 'acp:codex',
      } as any)
    ).toBe('acp:codex');
  });

  it('does not classify normal sessions as ACP sessions', () => {
    const session = {
      config: { agentType: 'Standard' },
      mode: 'Plan',
    } as any;

    expect(acpAgentTypeFromSession(session)).toBeNull();
    expect(isAcpFlowSession(session)).toBe(false);
  });
});
