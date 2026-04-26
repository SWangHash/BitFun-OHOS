import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useReviewActionBarStore } from './deepReviewActionBarStore';

vi.mock('../services/ReviewActionBarPersistenceService', () => ({
  persistReviewActionState: vi.fn().mockResolvedValue(undefined),
  clearPersistedReviewState: vi.fn().mockResolvedValue(undefined),
  loadPersistedReviewState: vi.fn().mockResolvedValue(null),
}));

describe('deepReviewActionBarStore', () => {
  beforeEach(() => {
    useReviewActionBarStore.getState().reset();
  });

  afterEach(() => {
    useReviewActionBarStore.getState().reset();
    vi.clearAllMocks();
  });

  describe('showActionBar', () => {
    it('initializes with default selected remediation IDs', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1', 'Fix issue 2'],
        },
      });

      expect(store.childSessionId).toBe('child-1');
      expect(store.phase).toBe('review_completed');
      expect(store.selectedRemediationIds.size).toBeGreaterThan(0);
      expect(store.completedRemediationIds.size).toBe(0);
      expect(store.minimized).toBe(false);
    });

    it('preserves completedRemediationIds when re-showing for same session', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1', 'Fix issue 2'],
        },
        completedRemediationIds: new Set(['remediation-0']),
      });

      expect(store.completedRemediationIds.has('remediation-0')).toBe(true);
      // Completed items should not be in selected by default
      expect(store.selectedRemediationIds.has('remediation-0')).toBe(false);
    });

    it('filters out completed IDs that no longer exist in new review data', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 2'],
        },
        completedRemediationIds: new Set(['remediation-0', 'remediation-1']),
      });

      // remediation-0 does not exist in new data with only 1 item
      expect(store.completedRemediationIds.has('remediation-0')).toBe(false);
    });
  });

  describe('minimize and restore', () => {
    it('minimizes the action bar', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1'],
        },
      });

      store.minimize();
      expect(store.minimized).toBe(true);
      expect(store.phase).toBe('review_completed');
    });

    it('restores the action bar from minimized state', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1'],
        },
      });

      store.minimize();
      store.restore();
      expect(store.minimized).toBe(false);
    });
  });

  describe('fix lifecycle', () => {
    it('snapshots selected IDs when starting fix', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1', 'Fix issue 2'],
        },
      });

      // Select first item
      store.toggleRemediation('remediation-0');
      store.setActiveAction('fix');

      expect(store.fixingRemediationIds.has('remediation-0')).toBe(true);
    });

    it('moves fixing IDs to completed when fix completes', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1', 'Fix issue 2'],
        },
      });

      store.toggleRemediation('remediation-0');
      store.setActiveAction('fix');
      store.updatePhase('fix_running');
      store.updatePhase('fix_completed');

      expect(store.completedRemediationIds.has('remediation-0')).toBe(true);
      expect(store.fixingRemediationIds.size).toBe(0);
      expect(store.phase).toBe('fix_completed');
    });

    it('does not mark items as completed on fix_failed', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1'],
        },
      });

      store.toggleRemediation('remediation-0');
      store.setActiveAction('fix');
      store.updatePhase('fix_running');
      store.updatePhase('fix_failed', 'Something went wrong');

      expect(store.completedRemediationIds.has('remediation-0')).toBe(false);
      expect(store.phase).toBe('fix_failed');
      expect(store.errorMessage).toBe('Something went wrong');
    });
  });

  describe('skipRemainingFixes', () => {
    it('returns to review_completed and clears remaining fix IDs', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1'],
        },
        phase: 'fix_interrupted',
      });

      store.skipRemainingFixes();

      expect(store.phase).toBe('review_completed');
      expect(store.remainingFixIds).toEqual([]);
      expect(store.activeAction).toBeNull();
    });
  });

  describe('toggleRemediation with completed items', () => {
    it('does not allow toggling completed items', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1', 'Fix issue 2'],
        },
        completedRemediationIds: new Set(['remediation-0']),
      });

      // Completed item should not be selected by default
      expect(store.selectedRemediationIds.has('remediation-0')).toBe(false);

      // Toggle should work on non-completed items
      store.toggleRemediation('remediation-1');
      expect(store.selectedRemediationIds.has('remediation-1')).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears all state back to initial', () => {
      const store = useReviewActionBarStore.getState();
      store.showActionBar({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        reviewData: {
          summary: { recommended_action: 'request_changes' },
          remediation_plan: ['Fix issue 1'],
        },
      });

      store.minimize();
      store.reset();

      expect(store.phase).toBe('idle');
      expect(store.childSessionId).toBeNull();
      expect(store.minimized).toBe(false);
      expect(store.completedRemediationIds.size).toBe(0);
    });
  });
});
