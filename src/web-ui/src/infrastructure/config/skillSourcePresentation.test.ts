import { describe, expect, it } from 'vitest';
import type { ModeSkillInfo, SkillInfo } from './types';
import {
  buildSkillCoverageSourceMap,
  canDeleteSkill,
  isBitFunManagedSkill,
  findSkillByKey,
  formatSkillOrigin,
  getModeSkillRuntimeStatus,
  getSkillSourceLabel,
  getSkillSourceId,
  getSkillSourceLabelFromIdentity,
} from './skillSourcePresentation';

function skill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    key: 'project::bitfun::pdf',
    name: 'pdf',
    description: 'PDF workflow',
    path: '/workspace/.bitfun/skills/pdf',
    level: 'project',
    sourceSlot: 'bitfun',
    sourceId: 'bitfun',
    sourceLabel: 'BitFun',
    dirName: 'pdf',
    isBuiltin: false,
    ...overrides,
  };
}

function modeSkill(overrides: Partial<ModeSkillInfo> = {}): ModeSkillInfo {
  return {
    ...skill(),
    defaultEnabled: true,
    effectiveEnabled: true,
    disabledByMode: false,
    selectedForRuntime: true,
    stateReason: 'project_default_enabled',
    ...overrides,
  };
}

describe('skill source presentation', () => {
  it('keeps legacy native and imported copies while excluding external identities from native management', () => {
    expect(isBitFunManagedSkill(skill({ sourceId: undefined, sourceSlot: 'bitfun-user' }))).toBe(true);
    expect(isBitFunManagedSkill(skill({ installationSource: 'github:example/external-skill' }))).toBe(true);
    expect(isBitFunManagedSkill(skill({ sourceId: undefined, sourceSlot: 'home.codex' }))).toBe(false);
    expect(isBitFunManagedSkill(skill({ sourceId: 'claude-code', sourceLabel: 'BitFun' }))).toBe(false);
    expect(isBitFunManagedSkill(skill({ isBuiltin: true }))).toBe(true);
  });

  it('normalizes legacy discovery slots without using paths or display labels as group identity', () => {
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'home.codex' }))).toBe('codex');
    expect(getSkillSourceId(skill({ sourceId: 'claude' }))).toBe('claude-code');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'home.dsh' }))).toBe('deepseek-harness');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'home.pi' }))).toBe('pi');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'home.agents' }))).toBe('agent-skills');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'config.opencode.custom-root' }))).toBe('opencode');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: 'bitfun-system' }))).toBe('bitfun');
    expect(getSkillSourceId(skill({ sourceId: '', sourceSlot: '' }))).toBe('bitfun');
    expect(getSkillSourceId(skill({ sourceId: 'future-agent', sourceLabel: 'Codex' }))).toBe('future-agent');
  });

  it('uses the stable source label and falls back to source identity facts', () => {
    expect(getSkillSourceLabel(skill())).toBe('BitFun');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: 'codex' }))).toBe('Codex');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: 'deepseek-harness' }))).toBe('DeepSeek Harness');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: '', sourceSlot: 'home.pi' }))).toBe('PI');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: '', sourceSlot: 'home.codex' }))).toBe('Codex');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: '', sourceSlot: 'bitfun-system' }))).toBe('BitFun');
    expect(getSkillSourceLabel(skill({ sourceLabel: '', sourceId: '', sourceSlot: 'future' }), '其他来源')).toBe('其他来源');
    expect(getSkillSourceLabelFromIdentity('', '', 'home.codex')).toBe('Codex');
  });

  it('only allows BitFun-owned non-builtin skills to be deleted', () => {
    expect(canDeleteSkill(skill())).toBe(true);
    expect(canDeleteSkill(skill({ isBuiltin: true }))).toBe(false);
    expect(canDeleteSkill(skill({ sourceId: 'bitfun-system', isBuiltin: false }))).toBe(true);
    expect(canDeleteSkill(skill({ sourceId: 'opencode' }))).toBe(false);
    expect(canDeleteSkill(skill({ sourceId: '', sourceSlot: 'home.codex' }))).toBe(false);
    expect(canDeleteSkill(skill({ sourceId: '', sourceSlot: 'future' }))).toBe(false);
    expect(canDeleteSkill(skill({ sourceId: '', sourceSlot: '' }))).toBe(false);
  });

  it('formats source and scope with surface-localized labels', () => {
    expect(formatSkillOrigin(skill(), {
      fallbackSourceLabel: '其他来源',
      userLabel: '用户',
      projectLabel: '项目',
    })).toBe('BitFun · 项目');

    expect(formatSkillOrigin(skill(), {
      fallbackSourceLabel: 'Other source',
      userLabel: 'This device · User',
      projectLabel: 'Remote workspace · Project',
    })).toBe('BitFun · Remote workspace · Project');
  });

  it('explains a shadowed skill with the winner source instead of an internal key', () => {
    const winner = skill();
    const covered = skill({
      key: 'user::home.codex::pdf',
      level: 'user',
      sourceSlot: 'home.codex',
      sourceId: 'codex',
      sourceLabel: 'Codex',
      isShadowed: true,
      shadowedByKey: winner.key,
    });

    expect(buildSkillCoverageSourceMap([covered, winner]).get(covered.key)).toBe('BitFun');
    expect(buildSkillCoverageSourceMap([covered]).has(covered.key)).toBe(false);
  });

  it('distinguishes runtime selection from enabled and covered configuration', () => {
    const winner = modeSkill();
    const covered = modeSkill({
      key: 'user::home.codex::pdf',
      level: 'user',
      sourceSlot: 'home.codex',
      sourceId: 'codex',
      sourceLabel: 'Codex',
      selectedForRuntime: false,
      isShadowed: true,
      shadowedByKey: winner.key,
    });
    const coverage = buildSkillCoverageSourceMap([covered, winner]);

    expect(getModeSkillRuntimeStatus(winner, coverage)).toEqual({ kind: 'selected' });
    expect(getModeSkillRuntimeStatus(covered, coverage)).toEqual({
      kind: 'covered',
      sourceLabel: 'BitFun',
    });
    expect(getModeSkillRuntimeStatus(modeSkill({
      effectiveEnabled: false,
      selectedForRuntime: false,
    }), coverage)).toEqual({ kind: 'disabled' });
  });

  it('resolves installed detail data from the latest skill snapshot', () => {
    const previous = skill({ description: 'Old description', isShadowed: true });
    const current = skill({ description: 'Current description', isShadowed: false });

    expect(findSkillByKey([current], previous.key)).toBe(current);
    expect(findSkillByKey([], previous.key)).toBeNull();
  });

});
