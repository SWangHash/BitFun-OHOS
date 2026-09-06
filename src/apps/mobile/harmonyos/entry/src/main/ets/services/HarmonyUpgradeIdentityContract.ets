/**
 * Stable HarmonyOS package and storage identifiers retained across the
 * product-name change.
 *
 * These values are not display branding. Changing any of them strands data
 * written by an installed release (and changing the bundle id prevents an
 * in-place upgrade altogether), so all compatibility-only identifiers live at
 * this single boundary instead of leaking through product code.
 */
export class HarmonyUpgradeIdentityContract {
  static readonly APP_BUNDLE: string = 'com.openbitfun.app';
  static readonly REMOTE_IDENTITY_STORE: string = 'openbitfun_remote_identity';
  static readonly CLOUD_ACCOUNT_STORE: string = 'openbitfun_cloud_account';
  static readonly CLOUD_ACCOUNT_HUKS_ALIAS: string = 'openbitfun_cloud_account_session';
  static readonly APP_LOCALE_STORE: string = 'openbitfun_app_locale';
  static readonly REMOTE_CHAT_DATABASE: string = 'openbitfun_remote_chat.db';
  static readonly REMOTE_SESSIONS_DATABASE: string = 'openbitfun_remote_sessions.db';
  static readonly GENERAL_CHAT_CONFIG_STORE: string = 'openbitfun_general_chat_config';
  static readonly GENERAL_CHAT_HUKS_ALIAS: string = 'openbitfun_general_chat_api_key';
  static readonly GENERAL_CHAT_DATABASE: string = 'openbitfun_general_chat.db';
  static readonly WATCH_HANDOFF_STORE: string = 'openbitfun_harmony_handoff_s1';
  static readonly WATCH_PROVISION_REQUEST_KEY: string = 'openbitfun.account.provision.request';
  static readonly WATCH_PROVISION_RESPONSE_KEY: string = 'openbitfun.account.provision.response';
}
