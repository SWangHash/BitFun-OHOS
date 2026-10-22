import { describe, expect, it } from 'vitest';
import {
  chatInputPermissionMode,
  effectiveTurnPermissionMode,
  needsFullAccessConfirmation,
  permissionModeFromConfig,
  permissionModeToConfig,
  replacedSessionPermissionMode,
  sessionPermissionMode,
} from './permissionMode';
import type { ToolPermissionConfig } from '@/infrastructure/config/types';

function config(
  preset: ToolPermissionConfig['policy']['preset'],
  autoApproveAsk: boolean,
): ToolPermissionConfig {
  return {
    policy: { preset, rules: [] },
    interaction: { auto_approve_ask: autoApproveAsk },
  };
}

describe('permissionMode', () => {
  it('maps between the control naming and the backend naming', () => {
    expect(chatInputPermissionMode('ask')).toBe('ask');
    expect(chatInputPermissionMode('auto_approve')).toBe('auto');
    expect(chatInputPermissionMode('full_access')).toBe('full_access');

    expect(sessionPermissionMode('ask')).toBe('ask');
    expect(sessionPermissionMode('auto')).toBe('auto_approve');
    expect(sessionPermissionMode('full_access')).toBe('full_access');
  });

  it('round trips every mode through the control naming', () => {
    for (const mode of ['ask', 'auto_approve', 'full_access'] as const) {
      expect(sessionPermissionMode(chatInputPermissionMode(mode))).toBe(mode);
    }
  });

  it('derives the mode a stored configuration represents', () => {
    expect(permissionModeFromConfig(config('ask', false))).toBe('ask');
    expect(permissionModeFromConfig(config('ask', true))).toBe('auto_approve');
    // Full access already resolves every ask, so it outranks auto approval.
    expect(permissionModeFromConfig(config('full_access', true))).toBe('full_access');
  });

  it('projects a mode back onto both configuration knobs', () => {
    const base = config('ask', true);

    expect(permissionModeToConfig(base, 'ask')).toMatchObject({
      policy: { preset: 'ask' },
      interaction: { auto_approve_ask: false },
    });
    expect(permissionModeToConfig(base, 'auto_approve')).toMatchObject({
      policy: { preset: 'ask' },
      interaction: { auto_approve_ask: true },
    });
    expect(permissionModeToConfig(base, 'full_access')).toMatchObject({
      policy: { preset: 'full_access' },
      interaction: { auto_approve_ask: false },
    });
  });

  it('round trips a configuration through the mode it represents', () => {
    for (const stored of [config('ask', false), config('ask', true), config('full_access', false)]) {
      const mode = permissionModeFromConfig(stored);
      expect(permissionModeFromConfig(permissionModeToConfig(stored, mode))).toBe(mode);
    }
  });

  it('only warns when a scope actually gains full access', () => {
    expect(needsFullAccessConfirmation('full_access', 'ask')).toBe(true);
    expect(needsFullAccessConfirmation('full_access', 'auto')).toBe(true);
    // The mode is unresolved and falls back to the global default, which the
    // caller reports as the scope's current mode.
    expect(needsFullAccessConfirmation('full_access', null)).toBe(true);

    // Re-selecting the row that is already in force must not re-ask; a user who
    // confirmed full access once should not be interrupted for picking it again.
    expect(needsFullAccessConfirmation('full_access', 'full_access')).toBe(false);
    expect(needsFullAccessConfirmation('ask', 'full_access')).toBe(false);
    expect(needsFullAccessConfirmation('auto', null)).toBe(false);
  });

  it('replaces the mode a session pick actually clears', () => {
    // A narrower one-off turn override is cleared by the same write, so narrowing
    // -> full access on the session row still widens the running turn.
    expect(replacedSessionPermissionMode('full_access', 'auto_approve')).toBe('auto');
    expect(
      needsFullAccessConfirmation(
        'full_access',
        replacedSessionPermissionMode('full_access', 'auto_approve'),
      ),
    ).toBe(true);

    // Widening the session itself is the case the warning exists for.
    expect(
      needsFullAccessConfirmation(
        'full_access',
        replacedSessionPermissionMode('ask', null),
      ),
    ).toBe(true);

    // Already full access with no narrower override: the pick changes nothing.
    expect(replacedSessionPermissionMode('full_access', null)).toBe('full_access');
    expect(
      needsFullAccessConfirmation(
        'full_access',
        replacedSessionPermissionMode('full_access', null),
      ),
    ).toBe(false);
    // A full-access override is not "narrower", so it does not stand in for the
    // session mode either.
    expect(replacedSessionPermissionMode('auto', 'full_access')).toBe('auto');
    expect(
      needsFullAccessConfirmation(
        'full_access',
        replacedSessionPermissionMode('auto', 'full_access'),
      ),
    ).toBe(true);
  });

  it('arms a turn override on top of the mode that turn runs', () => {
    expect(effectiveTurnPermissionMode(null, 'ask')).toBe('ask');
    expect(effectiveTurnPermissionMode('auto_approve', 'ask')).toBe('auto');

    // Arming full access on a narrower turn is a real escalation.
    expect(
      needsFullAccessConfirmation(
        'full_access',
        effectiveTurnPermissionMode('auto_approve', 'ask'),
      ),
    ).toBe(true);
    // The turn already runs full access through its own override.
    expect(
      needsFullAccessConfirmation(
        'full_access',
        effectiveTurnPermissionMode('full_access', 'ask'),
      ),
    ).toBe(false);
    // ... or through the session mode it inherits.
    expect(
      needsFullAccessConfirmation(
        'full_access',
        effectiveTurnPermissionMode(null, 'full_access'),
      ),
    ).toBe(false);
  });
});
