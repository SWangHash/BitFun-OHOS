import { canCheckForAppUpdates } from './tauriEnv';
import { selectHasUpdateAttention, useUpdateInstallStore } from './updateInstallStore';
import './UpdateIndicator.scss';

export function useHasAppUpdate(): boolean {
  const attention = useUpdateInstallStore(selectHasUpdateAttention);
  return canCheckForAppUpdates() && attention;
}

export function UpdateIndicator() {
  const visible = useHasAppUpdate();
  return visible ? <span className="bitfun-update-indicator" aria-hidden="true"
    data-testid="app-update-indicator" data-bitfun-component="update" data-bitfun-part="indicator" /> : null;
}