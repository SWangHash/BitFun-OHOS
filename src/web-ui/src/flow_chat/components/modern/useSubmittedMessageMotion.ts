import { useLayoutEffect, useRef, type RefObject } from 'react';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import {
  consumeSubmittedMessageArrival,
  type SubmittedMessageArrival,
} from '../../services/submittedMessagePresentation';

const PARTS = [
  { selector: '.user-message-item', distance: 4, opacity: 0.4, delay: 0, duration: 220 },
  { selector: '.user-message-item__timestamp', distance: 2, opacity: 0, delay: 60, duration: 180 },
  { selector: '.user-message-item__actions', distance: 2, opacity: 0, delay: 100, duration: 180 },
] as const;

/** Explicit send feedback, never a row-mount animation or a viewport writer. */
export function useSubmittedMessageMotion(
  shellRef: RefObject<HTMLDivElement>,
  sessionId: string | undefined,
  turnId: string,
  messageId: string | undefined,
  disabled: boolean,
): void {
  const scope = getActiveSurfaceScope();
  const key = scope.key('submitted-message-motion', scope.epoch, sessionId, turnId, messageId);
  // Retain the claim across StrictMode's effect rehearsal, not across real remounts.
  const claim = useRef<{ key: string; arrival?: SubmittedMessageArrival }>();

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !sessionId || !messageId) return;
    if (claim.current?.key !== key) {
      claim.current = { key, arrival: consumeSubmittedMessageArrival(sessionId, turnId, messageId) };
    }
    const owner = claim.current;
    const arrival = owner.arrival;
    if (!arrival) return;

    const view = shell.ownerDocument.defaultView;
    const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (disabled || !view || media?.matches || shell.ownerDocument.hidden
      || !arrival.scope.isCurrent() || view.getComputedStyle(shell).visibility !== 'visible'
      || shell.contains(shell.ownerDocument.activeElement)) {
      owner.arrival = undefined;
      return;
    }

    const elapsed = Math.max(0, performance.now() - arrival.startedAt);
    const animations: Animation[] = [];
    for (const part of PARTS) {
      const element = shell.querySelector<HTMLElement>(part.selector);
      if (!element?.animate || elapsed >= part.delay + part.duration) continue;
      const animation = element.animate([
        { opacity: part.opacity, transform: `translateY(${part.distance}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], {
        delay: part.delay,
        duration: part.duration,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'backwards',
      });
      animation.currentTime = elapsed;
      animations.push(animation);
    }
    if (!animations.length) {
      owner.arrival = undefined;
      return;
    }

    const listeners = new AbortController();
    const cleanup = () => {
      for (const animation of animations) animation.cancel();
      listeners.abort();
    };
    const settle = () => {
      owner.arrival = undefined;
      cleanup();
    };
    const onPreference = () => { if (media?.matches) settle(); };
    const onVisibility = () => { if (shell.ownerDocument.hidden) settle(); };
    const options = { signal: listeners.signal };
    shell.addEventListener('focusin', settle, options);
    shell.addEventListener('pointerdown', settle, options);
    media?.addEventListener('change', onPreference, options);
    shell.ownerDocument.addEventListener('visibilitychange', onVisibility, options);
    arrival.scope.signal.addEventListener('abort', settle, options);
    // Cancelling during unmount rejects finished; it must not consume a StrictMode rehearsal.
    void Promise.all(animations.map(animation => animation.finished)).then(settle, () => {});
    return cleanup;
  }, [shellRef, sessionId, turnId, messageId, key, disabled]);
}
