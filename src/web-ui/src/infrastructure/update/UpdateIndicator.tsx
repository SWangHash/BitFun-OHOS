import { useHasAppUpdate } from './useHasAppUpdate';
import './UpdateIndicator.scss';

export function UpdateIndicator() {
  const visible = useHasAppUpdate();
  return visible ? <span className="bitfun-update-indicator" aria-hidden="true"
    data-testid="app-update-indicator" data-bitfun-component="update" data-bitfun-part="indicator" /> : null;
}