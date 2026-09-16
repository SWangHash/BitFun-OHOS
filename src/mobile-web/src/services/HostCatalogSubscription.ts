import { InvalidationSync } from '../../../shared/relay-transport/InvalidationSync';
import type { SessionEvent } from '../../../shared/relay-transport/SessionCipher';
import type { SessionStreamHandle } from '../../../shared/relay-transport/SessionStream';

export interface HostCatalogSource {
  subscribeSessionStream(
    id: string,
    onEvent: (event: SessionEvent) => void,
    onError: (error: unknown) => void,
    onCaughtUp?: () => void,
    onHistoryState?: undefined,
    onResumed?: () => void,
  ): Promise<SessionStreamHandle>;
}

/** One observer per selected runtime; revisions are invalidations, not clocks. */
export function subscribeHostCatalog(
  source: HostCatalogSource,
  read: () => Promise<void>,
  onError: (error: unknown) => void,
) {
  let stopped = false;
  let stream: SessionStreamHandle | undefined;
  let dirty = true;
  let connecting = false;
  const sync = new InvalidationSync(read);
  const fail = (error: unknown) => { if (!stopped) onError(error); };
  const refresh = () => {
    connect();
    return sync.invalidate().catch(fail);
  };
  const connect = () => {
    if (stopped || connecting || stream) return;
    connecting = true;
    void source.subscribeSessionStream('@host/catalog', (event) => {
      if (!stopped && event.event === 'host-catalog-changed') dirty = true;
    }, fail, () => {
      if (stopped || !dirty) return;
      dirty = false;
      void refresh();
    }, undefined, () => { if (!stopped) dirty = true; }).then((value) => {
      if (stopped) value.close();
      else stream = value;
    }).catch(fail).finally(() => { connecting = false; });
  };
  connect();
  return {
    refresh,
    close() { stopped = true; dirty = false; sync.stop(); stream?.close(); },
  };
}
