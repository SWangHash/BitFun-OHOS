import { describe, expect, it } from 'vitest';

import {
  clearHistoryNavigationSnapshot,
  resolveHistoryNavigationSnapshot,
  saveHistoryNavigationSnapshot,
  type HistoryNavigationSnapshotMap,
} from './historyNavigationSnapshot';

function makeSnapshots(): HistoryNavigationSnapshotMap {
  return new Map();
}

describe('historyNavigationSnapshot', () => {
  it('saves a snapshot only for an active browsing session', () => {
    const snapshots = makeSnapshots();

    saveHistoryNavigationSnapshot(snapshots, 'session-a', 2, 'my draft');
    expect(snapshots.get('session-a')).toEqual({ historyIndex: 2, savedDraft: 'my draft' });

    // Draft mode (-1) keeps no snapshot.
    saveHistoryNavigationSnapshot(snapshots, 'session-b', -1, 'whatever');
    expect(snapshots.has('session-b')).toBe(false);

    // Null/undefined session ids keep no snapshot.
    saveHistoryNavigationSnapshot(snapshots, null, 3, 'x');
    saveHistoryNavigationSnapshot(snapshots, undefined, 3, 'x');
    expect(snapshots.size).toBe(1);
  });

  it('restores the snapshot when the restored draft still matches the browsed entry', () => {
    const snapshots = makeSnapshots();
    const history = ['latest', 'middle', 'oldest'];

    saveHistoryNavigationSnapshot(snapshots, 'session-a', 1, 'my draft');

    const restored = resolveHistoryNavigationSnapshot(
      snapshots,
      'session-a',
      'middle', // draft value === inputHistory[1]
      history,
    );
    expect(restored).toEqual({ historyIndex: 1, savedDraft: 'my draft' });
    // The snapshot stays available for repeat switches.
    expect(snapshots.has('session-a')).toBe(true);
  });

  it('drops the snapshot when the restored draft no longer matches', () => {
    const snapshots = makeSnapshots();
    const history = ['latest', 'middle', 'oldest'];

    saveHistoryNavigationSnapshot(snapshots, 'session-a', 1, 'my draft');

    // The user edited the draft while away (or it was cleared).
    expect(resolveHistoryNavigationSnapshot(snapshots, 'session-a', 'edited text', history)).toBeNull();
    expect(snapshots.has('session-a')).toBe(false);

    // Out-of-bounds index (history shrank) is also invalid.
    saveHistoryNavigationSnapshot(snapshots, 'session-b', 5, 'd');
    expect(resolveHistoryNavigationSnapshot(snapshots, 'session-b', 'd', history)).toBeNull();
    expect(snapshots.has('session-b')).toBe(false);
  });

  it('returns null for sessions without a snapshot or with a null session id', () => {
    const snapshots = makeSnapshots();
    const history = ['latest'];

    expect(resolveHistoryNavigationSnapshot(snapshots, 'unknown', 'latest', history)).toBeNull();
    expect(resolveHistoryNavigationSnapshot(snapshots, null, 'latest', history)).toBeNull();
    expect(resolveHistoryNavigationSnapshot(snapshots, undefined, 'latest', history)).toBeNull();
  });

  it('clear removes the snapshot', () => {
    const snapshots = makeSnapshots();
    saveHistoryNavigationSnapshot(snapshots, 'session-a', 0, '');
    expect(snapshots.has('session-a')).toBe(true);

    clearHistoryNavigationSnapshot(snapshots, 'session-a');
    expect(snapshots.has('session-a')).toBe(false);

    // Clearing unknown/null ids is a no-op.
    clearHistoryNavigationSnapshot(snapshots, 'unknown');
    clearHistoryNavigationSnapshot(snapshots, null);
    expect(snapshots.size).toBe(0);
  });
});
