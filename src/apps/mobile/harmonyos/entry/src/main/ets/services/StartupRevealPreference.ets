import { preferences } from '@kit.ArkData';
import { RemoteLogger } from './RemoteLogger';

/** Installation-local presentation state, independent of accounts and app versions. */
export class StartupRevealPreference {
  private static claimed: boolean = false;

  static claim(context: Context): boolean {
    if (StartupRevealPreference.claimed) return false;
    StartupRevealPreference.claimed = true;
    try {
      const store = preferences.getPreferencesSync(context, { name: 'startup_presentation' });
      if (store.getSync('brand_reveal_shown', false) === true) return false;
      // Persist before playback so interrupted launches do not replay the reveal.
      store.putSync('brand_reveal_shown', true);
      store.flush().catch(() => RemoteLogger.warn('Startup reveal preference could not be persisted.'));
      return true;
    } catch (_err) {
      RemoteLogger.warn('Startup reveal preference unavailable; skipping reveal.');
      return false;
    }
  }
}
