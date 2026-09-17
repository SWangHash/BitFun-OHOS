/** Account login and authenticated device connections. */

import { OverflowText, Alert, Avatar, Button, Icon, IconButton, ScrollArea, StatusPill } from '@bitfun/ui';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import {
  confirmDanger,
} from '@/infrastructure/confirm-dialog';
import { LogIn, Monitor } from 'lucide-react';
import { remoteConnectAPI } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import type {
  AccountDeviceInfo,
  OnlineDeviceInfo,
} from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { accountIdentityService, useAccountIdentity } from '@/infrastructure/account-identity';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { usePeerDeviceMode } from '@/infrastructure/peer-device/peerDeviceContextState';
import {
  isAccountAuthFailure,
  isRelayUnreachable,
} from '@/infrastructure/account/accountErrorUtils';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { ensureAccountSession } from './ensureAccountSession';
import './AccountPanel.scss';

const log = createLogger('AccountPanel');

const DEVICE_POLL_FALLBACK_MS = 30_000;
const DEVICE_CONNECT_MAX_ATTEMPTS = 5;
const DEVICE_CONNECT_RECOVERY_INTERVAL_MS = 30_000;
const DEVICE_LIST_FAILURE_THRESHOLD = 3;

async function connectDevicesWithRetry(
  isCurrent: () => boolean,
): Promise<OnlineDeviceInfo[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DEVICE_CONNECT_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) {
      throw new Error('account context changed');
    }
    try {
      return await remoteConnectAPI.accountConnectDevices();
    } catch (error) {
      lastError = error;
      if (isAccountAuthFailure(error)
        || !isRelayUnreachable(error)
        || attempt === DEVICE_CONNECT_MAX_ATTEMPTS) {
        throw error;
      }
      const delayMs = 500 * (2 ** (attempt - 1));
      log.warn(
        `Device connection attempt ${attempt}/${DEVICE_CONNECT_MAX_ATTEMPTS} failed; retrying`,
        error,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

interface AccountPanelProps {
  /** Close the whole Remote Connect dialog (used when entering peer mode). */
  onCloseDialog: () => void;
}

type View = 'login' | 'devices';

export const AccountPanel: React.FC<AccountPanelProps> = ({
  onCloseDialog,
}) => {
  const { t, formatRelativeTime } = useI18n('common');
  const { success } = useNotification();
  const { peerMode, switchToDevice, switchToLocal } = usePeerDeviceMode();
  const identity = useAccountIdentity();
  const githubId = (identity.me?.user.accountId ?? identity.me?.user.githubId);
  const username = identity.me?.email ?? identity.me?.user.login ?? '';
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('login');

  const [devices, setDevices] = useState<AccountDeviceInfo[]>([]);
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);
  // Device discovery updates presentation, not the account lifecycle. Keep
  // refresh callbacks stable so adopting an ID cannot restart initialization.
  const deviceInfoRequestRef = useRef(0);
  const localDeviceIdRef = useRef(localDeviceId);
  localDeviceIdRef.current = localDeviceId;
  /** True after either device presence or a list_devices response is available. */
  const [devicesReady, setDevicesReady] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  /** Account epoch whose presence events may update the device list. */
  const [activeAccountEpoch, setActiveAccountEpoch] = useState<number | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Reject late responses after unmount or an account login/logout transition. */
  const mountedRef = useRef(false);
  const accountEpochRef = useRef(0);
  const refreshRequestRef = useRef(0);
  /** Allow at most one list_devices request per account epoch. */
  const refreshInFlightRef = useRef<{ epoch: number; requestId: number } | null>(null);
  /** A working device-routing WS is independent evidence that Relay is reachable. */
  const deviceRoutingReadyRef = useRef(false);
  const deviceListFailureCountRef = useRef(0);
  /** Coalesce manual and background recovery so they never replace each other's WS. */
  const deviceReconnectInFlightRef = useRef<number | null>(null);
  const invalidateAccountRequests = useCallback(() => {
    accountEpochRef.current += 1;
    refreshRequestRef.current += 1;
    refreshInFlightRef.current = null;
    deviceRoutingReadyRef.current = false;
    deviceListFailureCountRef.current = 0;
    setActiveAccountEpoch(null);
    return accountEpochRef.current;
  }, []);

  const isAccountEpochCurrent = useCallback((epoch: number) => (
    mountedRef.current && accountEpochRef.current === epoch
  ), []);

  const refreshLocalDeviceId = useCallback((epoch: number) => {
    const requestId = ++deviceInfoRequestRef.current;
    void remoteConnectAPI.getDeviceInfo().then(info => {
      if (isAccountEpochCurrent(epoch) && deviceInfoRequestRef.current === requestId) {
        setLocalDeviceId(info.device_id);
      }
    }).catch(error => { log.warn('getDeviceInfo failed', error); });
  }, [isAccountEpochCurrent]);

  const sortedDevices = useMemo(() => [...devices].sort((left, right) => {
    const leftLocal = left.device_id === localDeviceId;
    const rightLocal = right.device_id === localDeviceId;
    if (leftLocal !== rightLocal) return leftLocal ? -1 : 1;
    if (left.online !== right.online) return left.online ? -1 : 1;
    return (left.device_name || left.device_id).localeCompare(right.device_name || right.device_id);
  }), [devices, localDeviceId]);

  const resetState = useCallback(() => {
    setActiveAccountEpoch(null);
    setDevices([]);
    setLocalDeviceId(null);
    setDevicesReady(false);
    setRelayError(null);
    refreshInFlightRef.current = null;
    deviceRoutingReadyRef.current = false;
    deviceListFailureCountRef.current = 0;
    if (refreshTimer.current) { clearInterval(refreshTimer.current); refreshTimer.current = null; }
  }, []);

  const handleSessionExpired = useCallback(async (_error: unknown, expectedEpoch: number) => {
    if (!isAccountEpochCurrent(expectedEpoch)) return;
    const nextEpoch = invalidateAccountRequests();
    // Authenticated backend commands invalidate only the generation/token that
    // produced their 401. Do not issue a second unconditional logout here: a
    // late frontend response must never clear a newer login.
    resetState();
    setView(githubId !== undefined ? 'devices' : 'login');
    if (githubId !== undefined) {
      setActiveAccountEpoch(nextEpoch);
      setRelayError(t('accountLogin.sessionExpired'));
      void accountIdentityService.refresh().catch(() => undefined);
    } else {
      setError(t('accountLogin.sessionExpired'));
    }
  }, [githubId, invalidateAccountRequests, isAccountEpochCurrent, resetState, t]);

  const markRelayUnreachable = useCallback(() => {
    setDevicesReady(false);
    setRelayError(t('accountLogin.relayUnreachable'));
  }, [t]);

  const refreshDevices = useCallback(async () => {
    const epoch = accountEpochRef.current;
    if (refreshInFlightRef.current?.epoch === epoch) {
      log.debug('Device list refresh already in flight; coalescing duplicate request');
      return;
    }
    const requestId = ++refreshRequestRef.current;
    refreshInFlightRef.current = { epoch, requestId };
    const isCurrent = () => (
      isAccountEpochCurrent(epoch) && refreshRequestRef.current === requestId
    );
    try {
      let list = await remoteConnectAPI.accountListDevices();
      if (!isCurrent()) return;
      const currentLocalDeviceId = localDeviceIdRef.current;
      const localOffline = list.some(d => d.device_id === currentLocalDeviceId && !d.online);
      if (localOffline && currentLocalDeviceId) {
        await new Promise(r => setTimeout(r, 1500));
        if (!isCurrent()) return;
        list = await remoteConnectAPI.accountListDevices();
        if (!isCurrent()) return;
      }
      setDevices(list);
      setDevicesReady(true);
      setRelayError(null);
      deviceListFailureCountRef.current = 0;
    } catch (e) {
      if (!isCurrent()) return;
      log.warn('refreshDevices failed', e);
      if (isAccountAuthFailure(e)) {
        await handleSessionExpired(e, epoch);
      } else {
        deviceListFailureCountRef.current += 1;
        // list_devices is an HTTP snapshot while account device routing uses
        // WebSocket. Keep the last/presence-derived list when WS is healthy;
        // one failed snapshot must not be reported as a total Relay outage.
        if (!deviceRoutingReadyRef.current
          && deviceListFailureCountRef.current >= DEVICE_LIST_FAILURE_THRESHOLD) {
          markRelayUnreachable();
        }
      }
    } finally {
      if (refreshInFlightRef.current?.epoch === epoch
        && refreshInFlightRef.current.requestId === requestId) {
        refreshInFlightRef.current = null;
      }
    }
  }, [handleSessionExpired, isAccountEpochCurrent, markRelayUnreachable]);

  const applyPresenceOnline = useCallback((onlineDevices: Array<{ device_id: string; device_name: string }>) => {
    const onlineIds = new Set(onlineDevices.map(d => d.device_id));
    setDevices(prev => {
      const byId = new Map(prev.map(d => [d.device_id, d]));
      for (const d of onlineDevices) {
        const existing = byId.get(d.device_id);
        if (existing) {
          byId.set(d.device_id, { ...existing, online: true, device_name: d.device_name || existing.device_name });
        } else {
          byId.set(d.device_id, {
            device_id: d.device_id,
            device_name: d.device_name,
            online: true,
            last_seen_at: Math.floor(Date.now() / 1000),
          });
        }
      }
      for (const [id, device] of byId) {
        if (!onlineIds.has(id) && device.online) {
          byId.set(id, { ...device, online: false });
        }
      }
      return Array.from(byId.values());
    });
  }, []);

  /** Latest refreshDevices for the polling interval (avoids stale closures). */
  const refreshDevicesRef = useRef(refreshDevices);
  refreshDevicesRef.current = refreshDevices;

  const startDevicePolling = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
    }
    refreshTimer.current = setInterval(
      () => { void refreshDevicesRef.current(); },
      DEVICE_POLL_FALLBACK_MS,
    );
  }, []);

  const attemptDeviceReconnect = useCallback(async (showLoading: boolean) => {
    const epoch = accountEpochRef.current;
    if (deviceReconnectInFlightRef.current === epoch) {
      log.debug('Device routing recovery already in flight; coalescing duplicate request');
      return;
    }
    deviceReconnectInFlightRef.current = epoch;
    if (showLoading) {
      setLoading(true);
      setRelayError(null);
    }
    try {
      if (githubId === undefined) return;
      if (!await ensureAccountSession(remoteConnectAPI, () => isAccountEpochCurrent(epoch), githubId)) return;
      const onlineDevices = await connectDevicesWithRetry(
        () => isAccountEpochCurrent(epoch),
      );
      if (!isAccountEpochCurrent(epoch)) return;
      deviceRoutingReadyRef.current = true;
      deviceListFailureCountRef.current = 0;
      applyPresenceOnline(onlineDevices);
      setDevicesReady(true);
      setRelayError(null);
      refreshLocalDeviceId(epoch);
      if (!isAccountEpochCurrent(epoch)) return;
      await refreshDevices();
      if (!isAccountEpochCurrent(epoch)) return;
      startDevicePolling();
    } catch (err) {
      log.warn(
        showLoading ? 'manual device reconnect failed' : 'background device reconnect failed',
        err,
      );
      if (!isAccountEpochCurrent(epoch)) return;
      if (isAccountAuthFailure(err)) {
        await handleSessionExpired(err, epoch);
        return;
      }
      markRelayUnreachable();
    } finally {
      if (deviceReconnectInFlightRef.current === epoch) deviceReconnectInFlightRef.current = null;
      if (showLoading && isAccountEpochCurrent(epoch)) setLoading(false);
    }
  }, [
    githubId,
    applyPresenceOnline,
    handleSessionExpired,
    isAccountEpochCurrent,
    markRelayUnreachable,
    refreshDevices,
    refreshLocalDeviceId,
    startDevicePolling,
  ]);

  const handleRetryConnect = useCallback(() => {
    void attemptDeviceReconnect(true);
  }, [attemptDeviceReconnect]);

  // Initial dial failures have no RelayClient instance to run its built-in
  // reconnect loop. Keep recovering in the background while this account view
  // is active; once a socket succeeds, RelayClient owns subsequent reconnects.
  useEffect(() => {
    if (activeAccountEpoch === null || !relayError) return undefined;
    const timer = setInterval(
      () => { void attemptDeviceReconnect(false); },
      DEVICE_CONNECT_RECOVERY_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [activeAccountEpoch, attemptDeviceReconnect, relayError]);

  /** Connect presence + load the device list for an active account session. */
  const initializeDevices = useCallback(async () => {
    const epoch = accountEpochRef.current;
    try {
      const onlineDevices = await connectDevicesWithRetry(
        () => isAccountEpochCurrent(epoch),
      );
      if (!isAccountEpochCurrent(epoch)) return;
      deviceRoutingReadyRef.current = true;
      deviceListFailureCountRef.current = 0;
      applyPresenceOnline(onlineDevices);
      setDevicesReady(true);
      setRelayError(null);
      // Re-read after AuthOk may have adopted the account-bound device_id.
      refreshLocalDeviceId(epoch);
    } catch (err) {
      if (!isAccountEpochCurrent(epoch)) return;
      log.warn('accountConnectDevices failed', err);
      if (isAccountAuthFailure(err)) {
        await handleSessionExpired(err, epoch);
        return;
      }
      markRelayUnreachable();
      return;
    }
    if (!isAccountEpochCurrent(epoch)) return;
    void refreshDevices();
    startDevicePolling();
  }, [
    applyPresenceOnline,
    handleSessionExpired,
    isAccountEpochCurrent,
    markRelayUnreachable,
    refreshDevices,
    refreshLocalDeviceId,
    startDevicePolling,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      accountEpochRef.current += 1;
      refreshRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!identity.resolved || identity.status === 'authorizing') return;
    const epoch = invalidateAccountRequests();
    resetState();
    setLoading(false);
    setError(null);
    if (githubId === undefined) {
      setView('login');
      return;
    }
    // Identity is shared with both markets. A missing Relay session is a
    // connection setup step, never a second GitHub login prompt.
    setView('devices');
    setActiveAccountEpoch(epoch);
    refreshLocalDeviceId(epoch);
    ensureAccountSession(remoteConnectAPI, () => isAccountEpochCurrent(epoch), githubId).then(async (ready) => {
      if (ready && isAccountEpochCurrent(epoch)) await initializeDevices();
    }).catch((e) => {
      if (!isAccountEpochCurrent(epoch)) return;
      log.warn('account connection initialization failed', e);
      markRelayUnreachable();
    });

    return () => {
      invalidateAccountRequests();
      if (refreshTimer.current) { clearInterval(refreshTimer.current); refreshTimer.current = null; }
    };
  }, [
    identity.resolved,
    identity.status,
    githubId,
    initializeDevices,
    invalidateAccountRequests,
    isAccountEpochCurrent,
    markRelayUnreachable,
    refreshLocalDeviceId,
    resetState,
  ]);

  // Subscribe only while a specific account epoch is active. The callback
  // captures that epoch; invalidation flips the ref synchronously, so an old
  // listener cannot update the next account before React runs its cleanup.
  useEffect(() => {
    if (activeAccountEpoch === null) return undefined;
    const subscribedEpoch = activeAccountEpoch;
    const unlistenPresence = api.listen<{
      devices: Array<{ device_id: string; device_name: string }>;
    }>(
      'account://device-presence',
      (payload) => {
        if (isAccountEpochCurrent(subscribedEpoch) && payload?.devices) {
          deviceRoutingReadyRef.current = payload.devices.length > 0;
          if (deviceRoutingReadyRef.current) {
            deviceListFailureCountRef.current = 0;
            setDevicesReady(true);
            setRelayError(null);
          } else {
            // Start a fresh debounce window after routing loss; HTTP failures
            // observed while WS was healthy must not count against it.
            deviceListFailureCountRef.current = 0;
          }
          applyPresenceOnline(payload.devices);
        }
      },
    );
    return unlistenPresence;
  }, [activeAccountEpoch, applyPresenceOnline, isAccountEpochCurrent]);

  const handleLogin = useCallback(async () => {
    if (identity.status === 'authorizing') {
      try { await accountIdentityService.reopenSignIn(); }
      catch (e: unknown) { if (mountedRef.current) setError(e instanceof Error ? e.message : String(e)); }
      return;
    }
    setLoading(true); setError(null);
    try {
      const me = await accountIdentityService.signIn();
      if (mountedRef.current) success(t('accountLogin.loginSuccess', { user_id: me.email ?? me.user.login }));
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [identity.status, success, t]);

  const handleLogout = useCallback(async () => {
    const epoch = invalidateAccountRequests();
    setLoading(true);
    try {
      await accountIdentityService.logout();
      if (!isAccountEpochCurrent(epoch)) return;
      resetState();
      setView('login');
    } catch (e: unknown) {
      if (!isAccountEpochCurrent(epoch)) return;
      // Logout failed before the backend changed the account; resume presence
      // delivery for the still-current frontend epoch.
      setActiveAccountEpoch(epoch);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isAccountEpochCurrent(epoch)) setLoading(false);
    }
  }, [invalidateAccountRequests, isAccountEpochCurrent, resetState]);

  const handleDeleteDevice = useCallback(async (deviceId: string, deviceName: string) => {
    const isLocal = localDeviceId === deviceId;
    const confirmation = isLocal
      ? t('accountLogin.confirmRemoveCurrentDevice', { name: deviceName })
      : t('accountLogin.confirmRemoveDevice', { name: deviceName });
    const confirmed = await confirmDanger(
      isLocal
        ? t('accountLogin.removeCurrentDevice')
        : t('accountLogin.removeDevice'),
      confirmation,
      {
        confirmText: isLocal
          ? t('accountLogin.removeCurrentDevice')
          : t('accountLogin.removeDevice'),
        cancelText: t('accountLogin.cancel'),
      },
    );
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    const epoch = isLocal ? invalidateAccountRequests() : accountEpochRef.current;
    try {
      await remoteConnectAPI.accountDeleteDevice(deviceId);
      if (!isAccountEpochCurrent(epoch)) return;
      if (isLocal) {
        success(t('accountLogin.currentDeviceRemoved'));
        resetState();
        setView('login');
      } else {
        success(t('accountLogin.deviceRemoved', { name: deviceName }));
        void refreshDevices();
      }
    } catch (e: unknown) {
      if (!isAccountEpochCurrent(epoch)) return;
      if (isAccountAuthFailure(e)) {
        await handleSessionExpired(e, epoch);
      } else {
        const message = e instanceof Error ? e.message : String(e);
        if (isLocal) setActiveAccountEpoch(epoch);
        setError(message);
      }
    } finally {
      if (isAccountEpochCurrent(epoch)) setLoading(false);
    }
  }, [
    handleSessionExpired,
    invalidateAccountRequests,
    isAccountEpochCurrent,
    localDeviceId,
    refreshDevices,
    resetState,
    success,
    t,
  ]);

  const selectDevice = useCallback(async (device: AccountDeviceInfo) => {
    if (!device.online) return;
    // Picking this machine is a normal surface switch back, not a no-op: the
    // window may currently be rendering a peer.
    const isLocalDevice = Boolean(localDeviceId) && device.device_id === localDeviceId;
    setLoading(true);
    setError(null);
    try {
      let outcome: 'activated' | 'superseded';
      if (isLocalDevice) {
        outcome = await switchToLocal();
        if (outcome === 'activated') {
          success(t('accountLogin.deviceSwitcher.switchedLocal'));
        }
      } else {
        outcome = await switchToDevice(device.device_id, device.device_name);
        if (outcome === 'activated') {
          success(t('accountLogin.enteredPeerMode', { name: device.device_name }));
        }
      }
      if (outcome === 'activated') {
        onCloseDialog();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    localDeviceId,
    onCloseDialog,
    success,
    switchToDevice,
    switchToLocal,
    t,
  ]);

  return (
    <>
      <div data-bitfun-component="remote-account-panel" data-bitfun-part="root" data-bitfun-view={view} className="account-panel">
        {error && (
          <div className="account-panel__error-banner" data-bitfun-component="remote-account-panel" data-bitfun-part="error">
            <Alert tone="error" message={error} closable onClose={() => setError(null)} />
          </div>
        )}

        {loading && view === 'devices' && (
          <div className="account-panel__loading-overlay" data-bitfun-component="remote-account-panel" data-bitfun-part="loading">
            <Icon name="refresh" size="lg" className="spinning" style={{ width: 20, height: 20 }} />
            <span>{t('accountLogin.processing')}</span>
          </div>
        )}

        {view === 'login' && (
          <ScrollArea className="account-panel__scroll" data-bitfun-component="remote-account-panel" data-bitfun-part="scroll">
            <div className="account-panel__login-card" data-bitfun-component="remote-account-panel" data-bitfun-part="form">
              <span className="account-panel__login-icon" aria-hidden="true"><Icon name="user" size="lg" /></span>
              <p className="account-panel__value-prop">{t('accountLogin.loginValueProp')}</p>
              <p className="account-panel__security-note">{t('accountLogin.securityNote')}</p>
              <div className="account-panel__actions" data-bitfun-component="remote-account-panel" data-bitfun-part="actions">
                <Button variant="primary" size="sm" leadingIcon={<LogIn />} onClick={handleLogin} loading={loading && identity.status !== 'authorizing'}>
                  {identity.status === 'authorizing' ? t('accountLogin.reopen') : loading ? t('accountLogin.processing') : t('accountLogin.login')}
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {view === 'devices' && (
          <ScrollArea className="account-panel__scroll" data-bitfun-component="remote-account-panel" data-bitfun-part="scroll">
            <div className="account-panel__identity-line">
              <Avatar key={username} size="md" src={identity.me?.user.avatarUrl} alt={username} aria-label={username}>
                {username.trim().charAt(0).toUpperCase() || <Icon name="user" />}
              </Avatar>
              <span className="account-panel__identity-copy">
                <span className="account-panel__identity-label">{t('accountLogin.signedInAccount')}</span>
                <OverflowText className="account-panel__identity-name" title={username}>{username.trim()}</OverflowText>
              </span>
              <Button variant="text" size="sm" onClick={handleLogout} disabled={loading}>
                {t('accountLogin.logout')}
              </Button>
            </div>
            <div className="account-panel__section-heading">
              <h3>{t('accountLogin.linkedDevices')}</h3>
              <Button variant="text" size="sm" leadingIcon={<Icon name="refresh" size="sm" />}
                onClick={relayError ? handleRetryConnect : refreshDevices} disabled={loading}>
                {t(relayError ? 'accountLogin.retryConnect' : 'accountLogin.refreshDevices')}
              </Button>
            </div>
            <div className="account-panel__devices-card">
              {relayError && (
                <div className="account-panel__error-banner" data-bitfun-component="remote-account-panel" data-bitfun-part="error">
                  <Alert
                    tone="error"
                    message={relayError}
                  />
                </div>
              )}
              <div className="account-panel__device-list" data-bitfun-component="remote-account-panel" data-bitfun-part="deviceList">
                {!relayError && devicesReady && devices.length === 0 && (
                  <div className="account-panel__empty">{t('accountLogin.noDevices')}</div>
                )}
                {!relayError && !devicesReady && (
                  <div className="account-panel__empty account-panel__empty--loading" role="status">
                    <Icon name="refresh" size="sm" className="spinning" />
                    {t('accountLogin.loadingDevices')}
                  </div>
                )}
                {!relayError && sortedDevices.map((d) => {
                  const isLocal = localDeviceId === d.device_id;
                  // This machine is selectable while the window renders a peer,
                  // so the dialog can bring the UI back without disconnecting.
                  const isSelectable = isLocal
                    ? peerMode.active
                    : d.online;
                  const removeLabel = isLocal
                    ? t('accountLogin.removeCurrentDevice')
                    : t('accountLogin.removeDevice');
                  const displayName = d.device_name || t('accountLogin.unknownDevice');
                  const DeviceEntry = isSelectable ? 'button' : 'div';
                  return (
                  <div data-bitfun-component="remote-account-panel" data-bitfun-part="deviceCard" key={d.device_id}
                    data-bitfun-state={[
                      !d.online && 'offline',
                      isLocal && 'current',
                    ].filter(Boolean).join(' ') || undefined}
                    className={`account-panel__device-card ${isSelectable ? 'selectable' : ''} ${d.online ? '' : 'offline'} ${isLocal ? 'current' : ''}`}>
                    <DeviceEntry
                      className="account-panel__device-select"
                      {...(isSelectable ? {
                        type: 'button' as const,
                        onClick: () => void selectDevice(d),
                        disabled: loading,
                        'aria-label': t('accountLogin.openDevice', { name: displayName }),
                      } : {})}
                    >
                      <Monitor size={16} />
                      <span className="account-panel__device-info">
                        <span className="account-panel__device-name">
                          <OverflowText title={displayName}>{displayName}</OverflowText>
                          {isLocal && <StatusPill tone="neutral" className="account-panel__device-badge">{t('accountLogin.thisDevice')}</StatusPill>}
                        </span>
                        <span className="account-panel__device-meta">
                          <span className="account-panel__device-status">
                            {d.online
                              ? t('accountLogin.online')
                              : d.last_seen_at
                                ? t('accountLogin.lastSeen', {
                                  time: formatRelativeTime(d.last_seen_at * 1000),
                                })
                                : t('accountLogin.offline')}
                          </span>
                        </span>
                      </span>
                      {isSelectable && <Icon name="chevron-right" size="sm" />}
                    </DeviceEntry>
                    <IconButton
                      aria-label={`${removeLabel}: ${displayName}`}
                      disabled={loading}
                      icon={<Icon name="delete" size="sm" />}
                      onClick={(e) => { e.stopPropagation(); handleDeleteDevice(d.device_id, displayName); }}
                      size="sm"
                      title={removeLabel}
                      variant="quiet"
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        )}
      </div>


    </>
  );
};

export default AccountPanel;
