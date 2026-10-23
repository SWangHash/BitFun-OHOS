import { describe, expect, it } from 'vitest';
import {
  buildReviewRemediationItems,
  buildSelectedReviewRemediationPrompt,
  getDefaultSelectedRemediationIds,
  type CodeReviewRemediationData,
} from './codeReviewRemediation';

describe('buildReviewRemediationItems', () => {
  it('builds items from remediation_plan', () => {
    const result = buildReviewRemediationItems({
      summary: { recommended_action: 'request_changes' },
      remediation_plan: ['Fix issue 1', 'Fix issue 2'],
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('remediation-0');
    expect(result[0].plan).toBe('Fix issue 1');
    expect(result[1].id).toBe('remediation-1');
    expect(result[1].plan).toBe('Fix issue 2');
  });

  it('ignores non-string remediation_plan entries from untrusted tool results', () => {
    const reviewData = {
      summary: { recommended_action: 'request_changes' },
      remediation_plan: [
        { plan: 'Object-shaped legacy entry' },
        '  Fix the valid issue  ',
        7,
        null,
      ],
    } as unknown as CodeReviewRemediationData;

    expect(() => buildReviewRemediationItems(reviewData)).not.toThrow();
    expect(buildReviewRemediationItems(reviewData)).toEqual([
      expect.objectContaining({
        id: 'remediation-1',
        plan: 'Fix the valid issue',
      }),
    ]);
  });

  it('treats a non-array remediation_plan as empty', () => {
    const reviewData = {
      remediation_plan: { plan: 'Invalid container' },
    } as unknown as CodeReviewRemediationData;

    expect(() => buildReviewRemediationItems(reviewData)).not.toThrow();
    expect(buildReviewRemediationItems(reviewData)).toEqual([]);
  });

  it('builds items from structured remediation groups', () => {
    const result = buildReviewRemediationItems({
      summary: { recommended_action: 'request_changes' },
      report_sections: {
        remediation_groups: {
          must_fix: ['Critical fix 1'],
          should_improve: ['Improvement 1'],
          needs_decision: ['Decision needed'],
          verification: ['Verify fix'],
        },
      },
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.groupId === 'must_fix')).toBe(true);
    expect(result.some((item) => item.groupId === 'should_improve')).toBe(true);
  });

  it('ignores malformed structured remediation entries', () => {
    const reviewData = {
      report_sections: {
        remediation_groups: {
          must_fix: [{ plan: 'Invalid object in a string-only group' }, 'Valid fix'],
          needs_decision: [
            { question: 'Choose a strategy', plan: 'Use the safe strategy', options: ['Safe', 7] },
            { question: 'Missing a string plan', plan: 7 },
          ],
        },
      },
    } as unknown as CodeReviewRemediationData;

    expect(() => buildReviewRemediationItems(reviewData)).not.toThrow();
    expect(buildReviewRemediationItems(reviewData).map((item) => item.plan)).toEqual([
      'Valid fix',
      'Use the safe strategy',
    ]);
  });

  it('ignores a non-array structured remediation group', () => {
    const reviewData = {
      report_sections: {
        remediation_groups: {
          must_fix: { plan: 'Invalid container' },
        },
      },
    } as unknown as CodeReviewRemediationData;

    expect(() => buildReviewRemediationItems(reviewData)).not.toThrow();
    expect(buildReviewRemediationItems(reviewData)).toEqual([]);
  });

  it('normalizes non-string issue titles before matching remediation items', () => {
    const reviewData = {
      issues: [{ title: { text: 'Object-shaped title' } }],
      report_sections: {
        remediation_groups: {
          must_fix: ['Add the missing guard'],
        },
      },
    } as unknown as CodeReviewRemediationData;

    expect(() => buildReviewRemediationItems(reviewData)).not.toThrow();
    expect(buildReviewRemediationItems(reviewData)).toEqual([
      expect.objectContaining({
        plan: 'Add the missing guard',
        issueIndex: 0,
      }),
    ]);
  });

  it('marks must_fix items as default selected', () => {
    const result = buildReviewRemediationItems({
      summary: { recommended_action: 'request_changes' },
      report_sections: {
        remediation_groups: {
          must_fix: ['Critical fix 1'],
          should_improve: ['Improvement 1'],
        },
      },
    });

    const mustFixItems = result.filter((item) => item.groupId === 'must_fix');
    const shouldImproveItems = result.filter((item) => item.groupId === 'should_improve');

    expect(mustFixItems.every((item) => item.defaultSelected)).toBe(true);
    expect(shouldImproveItems.every((item) => !item.defaultSelected)).toBe(true);
  });
});

describe('getDefaultSelectedRemediationIds', () => {
  it('returns IDs of default selected items', () => {
    const items = buildReviewRemediationItems({
      summary: { recommended_action: 'request_changes' },
      remediation_plan: ['Fix issue 1', 'Fix issue 2'],
      issues: [
        { severity: 'high', title: 'Issue 1' },
        { severity: 'low', title: 'Issue 2' },
      ],
    });

    const selectedIds = getDefaultSelectedRemediationIds(items);
    expect(selectedIds.length).toBeGreaterThan(0);
    expect(selectedIds).toContain('remediation-0');
  });
});

describe('buildSelectedReviewRemediationPrompt', () => {
  const decision = {
    question: 'Which migration strategy should we use?',
    plan: 'Use the fast path or the staged path after deciding.',
    options: ['Migrate all records now', 'Migrate records in stages'],
    tradeoffs: 'Immediate migration is faster; staged migration limits disruption.',
    recommendation: 0,
  };

  it.each([
    ['legacy text', 'Choose a migration strategy', undefined],
    ['missing options', { question: decision.question, plan: decision.plan }, undefined],
    ['empty options', { ...decision, options: [] }, 0],
    ['no user selection', decision, undefined],
    ['a stale option index', decision, 2],
  ])('does not authorize remediation with %s', (_name, entry, selection) => {
    const reviewData = {
      report_sections: { remediation_groups: { needs_decision: [entry] } },
    } as CodeReviewRemediationData;
    const [item] = buildReviewRemediationItems(reviewData);

    expect(buildSelectedReviewRemediationPrompt({
      reviewData,
      selectedIds: new Set([item.id]),
      reviewMode: 'standard',
      decisionSelections: selection == null ? {} : { [item.id]: selection as number },
    })).toBe('');
  });

  it.each(['standard', 'deep'] as const)('uses only the chosen option as the executable %s plan', (reviewMode) => {
    const reviewData = {
      report_sections: { remediation_groups: { needs_decision: [decision] } },
    };
    const [item] = buildReviewRemediationItems(reviewData);
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData,
      selectedIds: new Set([item.id]),
      reviewMode,
      decisionSelections: { [item.id]: 1 },
    });

    expect(prompt).toContain('## Selected Remediation Plan\n1. Migrate records in stages');
    expect(prompt).toContain(`Decision: ${decision.question}`);
    expect(prompt).toContain('User chose option 2: Migrate records in stages');
    expect(prompt).toContain('do not substitute another option');
    expect(prompt).not.toContain(decision.plan);
    expect(prompt).not.toContain(decision.options[0]);
    expect(prompt).not.toContain('Recommended option');
  });

  it('requires a choice for every selected decision while ignoring unselected decisions', () => {
    const reviewData = {
      report_sections: {
        remediation_groups: {
          must_fix: ['Fix the confirmed defect'],
          needs_decision: [decision, { question: 'Another decision', plan: 'Decide first' }],
        },
      },
    };
    const [fix, chosen, unresolved] = buildReviewRemediationItems(reviewData);
    const params = {
      reviewData,
      reviewMode: 'standard' as const,
      decisionSelections: { [chosen.id]: 1 },
    };

    expect(buildSelectedReviewRemediationPrompt({
      ...params,
      selectedIds: new Set([fix.id, chosen.id, unresolved.id]),
    })).toBe('');
    const prompt = buildSelectedReviewRemediationPrompt({
      ...params,
      selectedIds: new Set([fix.id, chosen.id]),
    });
    expect(prompt).toContain('Fix the confirmed defect');
    expect(prompt).toContain(decision.options[1]);
    expect(prompt).not.toContain('Another decision');
  });

  it('returns empty string when no items selected', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1'],
      },
      selectedIds: new Set(),
      reviewMode: 'deep',
    });

    expect(prompt).toBe('');
  });

  it('builds prompt with selected items for strict review', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1'],
      },
      selectedIds: new Set(['remediation-0']),
      reviewMode: 'deep',
    });

    expect(prompt).toContain('Review: Strict findings only');
    expect(prompt).toContain('Fix issue 1');
    expect(prompt).toContain('Selected Remediation Plan');
  });

  it('builds prompt with standard review mode', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1'],
      },
      selectedIds: new Set(['remediation-0']),
      reviewMode: 'standard',
    });

    expect(prompt).toContain('Review findings only');
  });

  it('appends continuation context when completedItems provided', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1', 'Fix issue 2', 'Fix issue 3'],
      },
      selectedIds: new Set(['remediation-0', 'remediation-1', 'remediation-2']),
      reviewMode: 'deep',
      completedItems: ['remediation-0'],
    });

    expect(prompt).toContain('Continuation Context');
    expect(prompt).toContain('Already completed items (DO NOT re-fix)');
    expect(prompt).toContain('Fix issue 1');
    expect(prompt).toContain('Please focus only on the remaining items');
    expect(prompt.split('## Selected Remediation Plan')[1]).not.toContain('Fix issue 1');
  });

  it('does not require a current decision selection for an already completed item', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        report_sections: { remediation_groups: {
          must_fix: ['Fix the remaining issue'],
          needs_decision: [{
            question: 'Which migration?',
            plan: 'Completed migration',
            options: ['Fast path', 'Staged path'],
          }],
        } },
      },
      selectedIds: new Set(['remediation-must_fix-0', 'remediation-needs_decision-1']),
      reviewMode: 'deep',
      completedItems: ['remediation-needs_decision-1'],
    });

    expect(prompt).toContain('Already completed items (DO NOT re-fix)');
    expect(prompt).toContain('Completed migration');
    expect(prompt.split('## Selected Remediation Plan')[1]).toContain('Fix the remaining issue');
    expect(prompt.split('## Selected Remediation Plan')[1]).not.toContain('Completed migration');
    expect(prompt).not.toContain('User chose option');
  });

  it('does not append continuation context when completedItems is empty', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1'],
      },
      selectedIds: new Set(['remediation-0']),
      reviewMode: 'deep',
      completedItems: [],
    });

    expect(prompt).not.toContain('Continuation Context');
  });

  it('does not append continuation context when completedItems not provided', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1'],
      },
      selectedIds: new Set(['remediation-0']),
      reviewMode: 'deep',
    });

    expect(prompt).not.toContain('Continuation Context');
  });

  it('only includes completed items that exist in review data', () => {
    const prompt = buildSelectedReviewRemediationPrompt({
      reviewData: {
        summary: { recommended_action: 'request_changes' },
        remediation_plan: ['Fix issue 1', 'Fix issue 2'],
      },
      selectedIds: new Set(['remediation-1']),
      reviewMode: 'deep',
      completedItems: ['remediation-0', 'non-existent-id'],
    });

    expect(prompt).toContain('Fix issue 1');
    expect(prompt).not.toContain('non-existent-id');
  });
});
