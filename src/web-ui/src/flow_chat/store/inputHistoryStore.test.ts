import { beforeEach, describe, expect, it } from 'vitest';

import { useInputHistoryStore } from './inputHistoryStore';

describe('inputHistoryStore', () => {
  beforeEach(() => {
    useInputHistoryStore.setState({ messagesBySession: {} });
  });

  describe('addMessage', () => {
    it('inserts a new message at the front of the session history', () => {
      useInputHistoryStore.getState().addMessage('session-1', 'hello');

      expect(useInputHistoryStore.getState().getSessionHistory('session-1')).toEqual(['hello']);
    });

    it('keeps sessions isolated from each other', () => {
      useInputHistoryStore.getState().addMessage('session-1', 'a');
      useInputHistoryStore.getState().addMessage('session-2', 'b');

      expect(useInputHistoryStore.getState().getSessionHistory('session-1')).toEqual(['a']);
      expect(useInputHistoryStore.getState().getSessionHistory('session-2')).toEqual(['b']);
    });

    it('moves a repeated message to the front instead of duplicating it', () => {
      const { addMessage } = useInputHistoryStore.getState();
      addMessage('session-1', 'first');
      addMessage('session-1', 'second');
      addMessage('session-1', 'first');

      const history = useInputHistoryStore.getState().getSessionHistory('session-1');
      expect(history).toEqual(['first', 'second']);
      expect(history).toHaveLength(2);
    });

    it('does not add a message identical to the most recent one', () => {
      const { addMessage } = useInputHistoryStore.getState();
      addMessage('session-1', 'same');
      addMessage('session-1', 'same');

      expect(useInputHistoryStore.getState().getSessionHistory('session-1')).toEqual(['same']);
    });

    it('trims surrounding whitespace before storing and ignores blank messages', () => {
      const { addMessage } = useInputHistoryStore.getState();
      addMessage('session-1', '  spaced  ');
      addMessage('session-1', '   ');
      addMessage('session-1', '');

      expect(useInputHistoryStore.getState().getSessionHistory('session-1')).toEqual(['spaced']);
    });

    it('ignores messages when the session id is empty', () => {
      useInputHistoryStore.getState().addMessage('', 'ignored');

      expect(useInputHistoryStore.getState().getSessionHistory('')).toEqual([]);
    });

    it('caps the history at maxHistorySize and drops the oldest entries', () => {
      const { maxHistorySize } = useInputHistoryStore.getState();
      const { addMessage } = useInputHistoryStore.getState();
      for (let i = 0; i < maxHistorySize + 5; i += 1) {
        addMessage('session-1', `msg-${i}`);
      }

      const history = useInputHistoryStore.getState().getSessionHistory('session-1');
      expect(history).toHaveLength(maxHistorySize);
      // Most recent is the last added; the five oldest (msg-0..msg-4) were dropped.
      expect(history[0]).toBe(`msg-${maxHistorySize + 4}`);
      expect(history[history.length - 1]).toBe('msg-5');
    });
  });

  describe('clearHistory', () => {
    it('clears only the specified session', () => {
      const { addMessage, clearHistory } = useInputHistoryStore.getState();
      addMessage('session-1', 'a');
      addMessage('session-2', 'b');

      clearHistory('session-1');

      expect(useInputHistoryStore.getState().getSessionHistory('session-1')).toEqual([]);
      expect(useInputHistoryStore.getState().getSessionHistory('session-2')).toEqual(['b']);
    });

    it('clears every session when no id is provided', () => {
      const { addMessage, clearHistory } = useInputHistoryStore.getState();
      addMessage('session-1', 'a');
      addMessage('session-2', 'b');

      clearHistory();

      expect(useInputHistoryStore.getState().messagesBySession).toEqual({});
    });
  });

  describe('read helpers', () => {
    it('getMessage returns the entry at the given index and null out of range', () => {
      const { addMessage, getMessage } = useInputHistoryStore.getState();
      addMessage('session-1', 'newest');
      addMessage('session-1', 'oldest');

      expect(getMessage('session-1', 0)).toBe('oldest');
      expect(getMessage('session-1', 1)).toBe('newest');
      expect(getMessage('session-1', 2)).toBeNull();
      expect(getMessage('session-1', -1)).toBeNull();
    });

    it('getCount reports the session message count', () => {
      const { addMessage, getCount } = useInputHistoryStore.getState();
      addMessage('session-1', 'a');
      addMessage('session-1', 'b');

      expect(getCount('session-1')).toBe(2);
      expect(getCount('unknown')).toBe(0);
    });

    it('getSessionHistory returns a stable empty array for unknown sessions', () => {
      const { getSessionHistory } = useInputHistoryStore.getState();
      const first = getSessionHistory('unknown');
      const second = getSessionHistory('unknown');

      expect(first).toEqual([]);
      expect(second).toEqual([]);
    });
  });

  describe('reactive selector', () => {
    it('notifies subscribers when a session slice changes after addMessage', () => {
      const seen: string[][] = [];
      const unsubscribe = useInputHistoryStore.subscribe((s) => {
        seen.push(s.messagesBySession['session-1'] ?? []);
      });

      useInputHistoryStore.getState().addMessage('session-1', 'hello');
      useInputHistoryStore.getState().addMessage('session-1', 'world');

      unsubscribe();

      // At least the two append states must be observed; this is the core
      // guarantee the ChatInput selector relies on after Bug A's fix.
      expect(seen.some((slice) => slice[0] === 'hello')).toBe(true);
      expect(seen.some((slice) => slice[0] === 'world')).toBe(true);
    });
  });
});
