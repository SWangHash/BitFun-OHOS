import { InvalidationSync } from '../../../shared/relay-transport/InvalidationSync';
import {
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  Monitor as LucideMonitor,
  RefreshCw as LucideRefreshCw,
  UserRoundSearch as LucideUserRoundSearch,
} from 'lucide-react';
/**
 * Devices Page — list same-account devices and pick the control target.
 *
 * The mobile stays a limited companion surface: switching only retargets
 * RelayHttpClient.targetDeviceId (device RPC data plane) and resets the
 * per-device UI state. Workspace/Session/Chat then talk to the new peer
 * through the same limited command set.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MobileBadge,
  MobileBanner,
  MobileButton,
  MobileCard,
  MobileIconButton,
  MobileListRow,
  MobilePageHeader,
  MobileStatus,
} from '@bitfun/ui/mobile';
import {
  RelayHttpClient,
  isAccountIdentityChangedError,
} from '../services/RelayHttpClient';
import { useI18n } from '../i18n';
import { useMobileStore } from '../services/store';
import { selectAccountDevice } from '../services/accountDeviceSelection';

interface DeviceInfo {
  device_id: string;
  device_name: string;
  online: boolean;
  last_seen_at?: number | null;
}


interface Props {
  client: RelayHttpClient;
  onBack: () => void;
  onDeviceSelected?: () => void;
  accountLanding?: boolean;
  autoSelect?: boolean;
  onSignOut?: () => void;
  preferredDeviceId?: string;
}

const BackIcon = () => (
  <LucideChevronLeft width="20" height="20" stroke="currentColor" aria-hidden="true" />
);

const RefreshIcon = () => (
  <LucideRefreshCw width="16" height="16" stroke="currentColor" aria-hidden="true" />
);

const DeviceIcon = () => (
  <LucideMonitor width="20" height="20" stroke="currentColor" aria-hidden="true" />
);

const NoIdentityIcon = () => (
  <LucideUserRoundSearch width="40" height="40" stroke="currentColor" aria-hidden="true" />
);

const DevicesPage: React.FC<Props> = ({ client, onBack, onDeviceSelected = onBack, accountLanding = false, autoSelect = true, onSignOut, preferredDeviceId }) => {
  const { t, formatRelativeTime } = useI18n();
  const { connectionHealth, setControlTarget, resetForDeviceSwitch } = useMobileStore();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [identityReady, setIdentityReady] = useState(client.hasAccountIdentity);
  const [identityChecking, setIdentityChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const identityRequestRef = useRef(0);
  const devicesRequestRef = useRef(0);
  const switchRequestRef = useRef(0);
  const automaticSelectionAttemptedRef = useRef(false);
  const sortedDevices = useMemo(() => {
    const listedDevices = devices.filter((device) => (
    device.device_id !== client.controllerDeviceId
  )).sort((left, right) => {
    const leftCurrent = left.device_id === client.targetDeviceId;
    const rightCurrent = right.device_id === client.targetDeviceId;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    if (left.online !== right.online) return left.online ? -1 : 1;
    return (left.device_name || left.device_id).localeCompare(right.device_name || right.device_id);
    });
    return listedDevices;
  }, [client, client.controllerDeviceId, client.targetDeviceId, connectionHealth, devices]);

  const friendlyError = useCallback((value: unknown, fallbackKey: string) => {
    const message = String((value as { message?: string })?.message || value);
    if (message.includes('HTTP 401') || message.includes('Sign in with GitHub')) {
      return t(accountLanding ? 'pairing.accountSessionExpired' : 'devices.authorizationExpired');
    }
    if (message.includes('HTTP 404')) return t('devices.deviceUnavailable');
    if (message.includes('HTTP 503') || message.includes('HTTP 504')) {
      return t('devices.deviceUnavailable');
    }
    return t(fallbackKey);
  }, [accountLanding, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      identityRequestRef.current += 1;
      devicesRequestRef.current += 1;
      switchRequestRef.current += 1;
    };
  }, []);

  const readDevices = useCallback(async () => {
    if (!client.hasAccountIdentity) return;
    const requestId = ++devicesRequestRef.current;
    const isCurrent = () => (
      mountedRef.current
      && devicesRequestRef.current === requestId
    );
    try {
      const list = await client.listDevices();
      if (!isCurrent()) return;
      setDevices(list);
      setDirectoryLoaded(true);
      setError(null);
      setIdentityReady(true);
    } catch (e: unknown) {
      if (!isCurrent()) return;
      // RelayHttpClient fences every response against its committed identity.
      // A concurrent account refresh therefore makes this request stale rather
      // than user-visible, while a successful 401 refresh + retry remains valid.
      if (isAccountIdentityChangedError(e)) return;
      const message = String((e as { message?: string })?.message || e);
      if (message.includes('Sign in with GitHub')) {
        setIdentityReady(false);
        setDevices([]);
      } else {
        setError(friendlyError(e, 'devices.loadFailed'));
      }
    }
  }, [client, friendlyError]);

  const directorySyncRef = useRef<InvalidationSync | null>(null);
  const refreshDevices = useCallback(() => directorySyncRef.current?.invalidate() ?? Promise.resolve(), []);
  useEffect(() => {
    let cancelled = false;
    const directorySync = new InvalidationSync(readDevices);
    directorySyncRef.current = directorySync;
    const refresh = () => { if (document.visibilityState === 'visible') void refreshDevices(); };
    const stopPresence = client.onDeviceDirectoryChanged(refresh);
    document.addEventListener('visibilitychange', refresh);
    setLoading(true);
    void refreshDevices().finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      directorySync.stop();
      if (directorySyncRef.current === directorySync) directorySyncRef.current = null;
      stopPresence();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [client, readDevices, refreshDevices]);

  const handleManualRefresh = useCallback(async () => {
    if (loading || switchingId) return;

    setLoading(true);
    await refreshDevices();
    if (mountedRef.current) setLoading(false);
  }, [loading, refreshDevices, switchingId]);

  const selectDevice = useCallback(async (d: DeviceInfo, probe = true) => {
    if (!d.online || switchingId) return;
    if (client.targetDeviceId === d.device_id) return;
    const requestId = ++switchRequestRef.current;
    const accountEpoch = client.accountEpoch;
    let expectedTargetEpoch = client.controlTargetEpoch;
    const isCurrent = () => (
      mountedRef.current
      && switchRequestRef.current === requestId
      && client.accountEpoch === accountEpoch
      && client.controlTargetEpoch === expectedTargetEpoch
    );
    setSwitchingId(d.device_id);
    setError(null);
    try {
      // Keep the existing probe for explicit device switches. Initial account
      // selection historically needed only the directory's online flag; do not
      // impose a new peer-mode command requirement on older desktops.
      if (probe) {
        const ping = await client.sendDeviceRpc<{ resp?: string; ok?: boolean; error?: string }>(d.device_id, {
          cmd: 'host_invoke',
          command: 'peer_mode_ping',
          args: {},
        }, { retryable: true });
        if (!isCurrent()) return;
        if (ping.resp === 'host_invoke_result' && ping.ok === false) {
          throw new Error(ping.error || t('devices.switchFailed'));
        }
      }
      client.setTargetDeviceId(d.device_id);
      expectedTargetEpoch = client.controlTargetEpoch;
      resetForDeviceSwitch();
      setControlTarget({
        deviceId: d.device_id,
        deviceName: d.device_name,
      });
      onDeviceSelected();
    } catch (e: unknown) {
      if (!isCurrent()) return;
      if (isAccountIdentityChangedError(e)) return;
      const message = String((e as { message?: string })?.message || e);
      if (message.includes('Sign in with GitHub')) {
        setIdentityReady(false);
        setDevices([]);
      } else {
        setError(friendlyError(e, 'devices.switchFailed'));
      }
    } finally {
      if (mountedRef.current && switchRequestRef.current === requestId) {
        setSwitchingId(null);
      }
    }
  }, [client, friendlyError, onDeviceSelected, resetForDeviceSwitch, setControlTarget, switchingId, t]);

  // Keep the online/scanned-device shortcut after account UI entry, without
  // making discovery failures undo authentication or retry in a render loop.
  useEffect(() => {
    if (!accountLanding || !autoSelect || !identityReady || identityChecking || loading
      || switchingId || automaticSelectionAttemptedRef.current) return;
    const target = selectAccountDevice(devices, client.controllerDeviceId, preferredDeviceId);
    if (!target) return;
    automaticSelectionAttemptedRef.current = true;
    void selectDevice(target, false);
  }, [accountLanding, autoSelect, client, devices, identityChecking, identityReady, loading, preferredDeviceId, selectDevice, switchingId]);

  const renderDeviceList = () => (
      <div className="devices-page__list">
        {sortedDevices.map((d) => {
          const isCurrent = client.targetDeviceId === d.device_id;
          const isSwitching = switchingId === d.device_id;
          const clickable = d.online && !isCurrent && !switchingId;
          return (
            <MobileListRow
              key={d.device_id}
              appearance="surface"
              className={[
                'devices-page__device',
                d.online ? 'is-online' : 'is-offline',
                isCurrent ? 'is-current' : '',
                isSwitching ? 'is-switching' : '',
              ].filter(Boolean).join(' ')}
              disabled={!clickable}
              onClick={() => clickable && selectDevice(d)}
              leading={<span className="devices-page__device-icon"><DeviceIcon /></span>}
              label={(
                <span className="devices-page__device-name-row">
                  <span className="devices-page__device-name">
                    {d.device_name || t('devices.unknownDevice')}
                  </span>
                  {isCurrent && (
                    <MobileBadge className="devices-page__badge devices-page__badge--current" tone="success">
                      {t('devices.current')}
                    </MobileBadge>
                  )}

                </span>
              )}
              supportingText={(
                <span className="devices-page__device-meta">
                  <span className={`devices-page__status-dot ${d.online ? 'is-online' : 'is-offline'}`} />
                  {d.online
                    ? t('devices.online')
                    : d.last_seen_at
                      ? t('devices.lastSeen', { time: formatRelativeTime(d.last_seen_at * 1000) })
                      : t('devices.offline')}
                </span>
              )}
              trailing={isSwitching ? (
                <span className="devices-page__device-spinner spinner" />
              ) : (
                clickable && (
                  <LucideChevronRight width="16" height="16" stroke="currentColor" aria-hidden="true" />
                )
              )}
              selected={isCurrent}
            />
          );
        })}
      </div>
  );

  const renderBody = () => {
    if (identityChecking) {
      return (
        <>
          {sortedDevices.length > 0 && renderDeviceList()}
          <MobileStatus className="devices-page__loading" loading title={t('devices.loading')} />
        </>
      );
    }

    if (!identityReady) {
      return (
        <>
          {sortedDevices.length > 0 && renderDeviceList()}
          <MobileCard appearance="elevated" className="devices-page__empty-card">
            <MobileStatus
              action={<MobileButton className="devices-page__retry-btn" onClick={handleManualRefresh}>{t('devices.retry')}</MobileButton>}
              description={t('devices.authorizationExpired')}
              icon={<NoIdentityIcon />}
            />
          </MobileCard>
        </>
      );
    }

    if (loading && !directoryLoaded && sortedDevices.length === 0) {
      return (
        <MobileStatus className="devices-page__loading" loading title={t('devices.loading')} />
      );
    }

    if (sortedDevices.length === 0) {
      // A failed directory request is not evidence that the account is empty.
      if (error) return null;
      return <section className="devices-page__onboarding" aria-labelledby="devices-empty-title">
        <div className="devices-page__onboarding-icon"><LucideMonitor size={28} aria-hidden="true" /></div>
        <h2 id="devices-empty-title">{t('devices.emptyTitle')}</h2>
        <p className="devices-page__onboarding-intro">{t('devices.emptyDescription')}</p>
        <ol className="devices-page__steps">
          <li><span aria-hidden="true">1</span><div><strong>{t('devices.emptyStepOne')}</strong><p>{t('devices.emptyStepOneDetail')}</p></div></li>
          <li><span aria-hidden="true">2</span><div><strong>{t('devices.emptyStepTwo')}</strong><p>{t('devices.emptyStepTwoDetail')}</p></div></li>
        </ol>
        <MobileButton appearance="secondary" block leading={<RefreshIcon />} loading={loading} onClick={handleManualRefresh}>{t('devices.refresh')}</MobileButton>
        <p className="devices-page__onboarding-note">{t('devices.emptyAutoRefresh')}</p>
      </section>;
    }

    return renderDeviceList();
  };

  return (
    <div className={`devices-page${identityReady && directoryLoaded && sortedDevices.length === 0 && !error ? ' devices-page--empty' : ''}`}>
      <MobilePageHeader
        className={`devices-page__header${accountLanding ? ' devices-page__header--account' : ''}`}
        leading={accountLanding ? undefined : <MobileIconButton
          appearance="floating"
          className="devices-page__back-btn"
          icon={<BackIcon />}
          onClick={onBack}
          aria-label={t('common.back')}
        />}
        title={t('devices.title')}
        actions={<>
          {(accountLanding || onSignOut) && <MobileButton appearance="plain" size="sm" onClick={accountLanding ? onBack : onSignOut}>{t('devices.signOut')}</MobileButton>}
          {(sortedDevices.length > 0 || error || !identityReady) && <MobileIconButton
          appearance="plain"
          className="devices-page__refresh-btn"
          icon={<RefreshIcon />}
          loading={loading || identityChecking}
          onClick={handleManualRefresh}
          disabled={!!switchingId}
          aria-label={t('devices.refresh')}
          title={t('devices.refresh')}
        />}</>}
      />

      {accountLanding && sortedDevices.length > 0 && <p className="devices-page__description">{t('devices.accountReady')}</p>}
      {error && <MobileBanner className="devices-page__error" tone="danger">{error}</MobileBanner>}

      <div className="devices-page__body">
        {renderBody()}
      </div>
    </div>
  );
};

export default DevicesPage;
