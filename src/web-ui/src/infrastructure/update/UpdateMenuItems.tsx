import { Icon, MenuItem, Spinner, Tooltip } from '@bitfun/ui';
import { Repeat } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system/services/NotificationService';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { canShowAppUpdateEntry } from './tauriEnv';
import { UpdateIndicator } from './UpdateIndicator';
import { selectHasUpdateAttention, useUpdateInstallStore } from './updateInstallStore';
import { formatUpdateInstallError } from './updateErrorMessage';

/** Manual discovery and deferred reminders stay in More, independently of About. */
export function UpdateMenuItems({ onCloseMenu }: { onCloseMenu: () => void }) {
  const { t } = useI18n('common');
  const state = useUpdateInstallStore();
  const { initialize } = state;
  const mounted = useRef(false);
  const [appGalleryChecking, setAppGalleryChecking] = useState(false);
  const supported = canShowAppUpdateEntry();
  // HarmonyOS never runs the staged desktop updater: `get_pending_update` and
  // `download_update` are not registered on that host, and AppGallery owns both
  // the check and the install. Opening More must not initialize the desktop
  // store, and an explicit check goes straight to the AppGallery bridge.
  const appGallery = isOpenHarmonyRuntime();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (supported && !appGallery) void initialize(); }, [supported, appGallery, initialize]);
  if (!supported) return null;

  const checking = appGallery ? appGalleryChecking : state.checkStatus === 'checking';
  const busy = appGallery ? appGalleryChecking
    : !state.initialized || checking || state.status === 'downloading' || state.status === 'installing';
  const reminder = selectHasUpdateAttention(state);
  const target = state.availableUpdate?.latestVersion ?? state.version;
  const checkLabel = checking ? t('update.checking') : t('update.checkForUpdates');
  const hint = reminder ? t('update.availableVersion', { version: state.downloadVersion ?? target })
    : checkLabel;
  const showNotice = () => { useUpdateInstallStore.getState().showNotice(); onCloseMenu(); };
  const checkAppGallery = async () => {
    setAppGalleryChecking(true);
    try {
      const result = await systemAPI.checkForUpdatesOhos();
      // An available update is presented and installed by the system dialog.
      if (result.error) notificationService.error(result.error, { title: t('update.checkFailed') });
      else if (!result.updateAvailable) notificationService.success(t('update.noUpdate'), { title: t('update.checkForUpdates') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notificationService.error(formatUpdateInstallError(message, t), { title: t('update.checkFailed') });
    } finally {
      if (mounted.current) {
        setAppGalleryChecking(false);
        onCloseMenu();
      }
    }
  };
  const activate = async () => {
    if (appGallery) {
      await checkAppGallery();
      return;
    }
    if (reminder) { showNotice(); return; }
    await state.checkForUpdates();
    const current = useUpdateInstallStore.getState();
    // Explicit checks report their result once, independently of the menu's lifetime.
    if (current.checkStatus === 'latest') {
      notificationService.success(t('update.noUpdate'), { title: t('update.checkForUpdates') });
    } else if (current.checkStatus === 'error' && current.checkError) {
      notificationService.error(formatUpdateInstallError(current.checkError, t), { title: t('update.checkFailed') });
    } else if (current.checkStatus === 'available' && current.availableUpdate?.latestVersion) {
      if (current.availableUpdate.latestVersion === current.version) {
        notificationService.info(t('update.readyVersion', { version: current.version }), { title: t('update.checkForUpdates') });
      } else {
        current.showNotice();
      }
    }
    if (mounted.current) onCloseMenu();
  };

  return <Tooltip content={hint} placement="right">
    <MenuItem data-testid="nav-check-updates" disabled={busy} aria-busy={checking}
      metadata={<UpdateIndicator />}
      leading={checking ? <Spinner size="sm" /> : <Icon glyph={Repeat} size="sm" />}
      onClick={() => void activate()}>
      {checkLabel}
    </MenuItem>
  </Tooltip>;
}
