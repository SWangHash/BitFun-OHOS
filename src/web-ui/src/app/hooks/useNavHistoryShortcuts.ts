/**
 * Alt+Arrow back / forward for the NavBar buttons.
 *
 * Registered from a single always-mounted owner (AppLayout) rather than from
 * NavBar itself: the workbench renders two NavBar instances while the left panel
 * is collapsed, and two registrations of the same shortcut id replace each other,
 * which left the chord dead after the panel was expanded again.
 */

import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { useNavSceneStore } from '../stores/navSceneStore';

/**
 * On macOS Alt+Arrow is Monaco's word-wise cursor movement, so the navigation
 * shortcut declines the chord while an editor surface owns focus. Windows and
 * Linux put word-wise movement on Ctrl+Arrow, which leaves Alt+Arrow free.
 */
function editorOwnsAltArrow(event: KeyboardEvent): boolean {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  if (!isMac) return false;
  const target = event.target;
  return target instanceof Element && target.closest('.monaco-editor') !== null;
}

export function useNavHistoryShortcuts(): void {
  const showSceneNav = useNavSceneStore(state => state.showSceneNav);
  const navSceneId = useNavSceneStore(state => state.navSceneId);
  const goBack = useNavSceneStore(state => state.goBack);
  const goForward = useNavSceneStore(state => state.goForward);

  useShortcut(
    'nav.back',
    { key: 'ArrowLeft', alt: true, scope: 'app' },
    (event) => {
      if (editorOwnsAltArrow(event)) return false;
      goBack();
    },
    { enabled: showSceneNav && !!navSceneId, description: 'keyboard.shortcuts.nav.back' }
  );

  useShortcut(
    'nav.forward',
    { key: 'ArrowRight', alt: true, scope: 'app' },
    (event) => {
      if (editorOwnsAltArrow(event)) return false;
      goForward();
    },
    { enabled: !showSceneNav && !!navSceneId, description: 'keyboard.shortcuts.nav.forward' }
  );
}
