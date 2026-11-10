import { useCallback, useSyncExternalStore } from 'react';
import { flowChatStore } from '../store/FlowChatStore';
import { selectActiveTurnStartTime } from '../utils/turnActivity';

/**
 * Live start timestamp of a session's running turn, or null once it settles.
 *
 * Any session may be projected here (main transcript, subagent, btw), so an
 * unknown or idle session simply reports null.
 */
export function useActiveTurnStartTime(sessionId: string | null | undefined): number | null {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!sessionId) return () => {};
    return flowChatStore.subscribeSelector(
      state => selectActiveTurnStartTime(state.sessions.get(sessionId)),
      onStoreChange,
    );
  }, [sessionId]);

  const getSnapshot = useCallback(() => (
    sessionId ? selectActiveTurnStartTime(flowChatStore.getState().sessions.get(sessionId)) : null
  ), [sessionId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
