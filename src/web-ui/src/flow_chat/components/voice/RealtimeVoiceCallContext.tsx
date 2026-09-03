import { createContext, useContext, type PropsWithChildren } from 'react';
import {
  useRealtimeVoiceCallController,
  type RealtimeVoiceCallController,
} from './useRealtimeVoiceCall';

const RealtimeVoiceCallContext = createContext<RealtimeVoiceCallController | null>(null);

/**
 * Owns one realtime voice call for the whole client. Keeping this above the
 * scene/workspace views lets a call and its Agent task survive navigation and
 * workspace switches.
 */
export function RealtimeVoiceCallProvider({ children }: PropsWithChildren) {
  const controller = useRealtimeVoiceCallController();
  return (
    <RealtimeVoiceCallContext.Provider value={controller}>
      {children}
    </RealtimeVoiceCallContext.Provider>
  );
}

export function useRealtimeVoiceCall(): RealtimeVoiceCallController {
  const controller = useContext(RealtimeVoiceCallContext);
  if (!controller) {
    throw new Error('useRealtimeVoiceCall must be used inside RealtimeVoiceCallProvider');
  }
  return controller;
}

/**
 * Optional variant for shell-level affordances.  The voice launcher can be
 * mounted while the app shell is being recovered (or in an isolated preview)
 * before the provider has been attached; that should not take down the whole
 * scene.  The normal application tree always supplies the provider.
 */
export function useOptionalRealtimeVoiceCall(): RealtimeVoiceCallController | null {
  return useContext(RealtimeVoiceCallContext);
}

/** Tests and isolated composer previews may render without the client shell. */
export function useRealtimeVoiceCallActive(): boolean {
  const controller = useContext(RealtimeVoiceCallContext);
  return Boolean(controller && controller.phase !== 'idle');
}
