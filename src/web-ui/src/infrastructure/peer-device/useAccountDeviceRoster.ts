import { useDeviceDirectory, resolveDeviceNameFrom, isDeviceControllable } from '@/infrastructure/account/deviceDirectory';
import { useAccountIdentity } from '@/infrastructure/account-identity';
/**
 * Account device roster for the sidebar device switcher.
 *
 * A deliberately small read-only view of the account's devices: the account
 * dialog owns login, sync and device removal, this only needs "who can I hand
 * work to right now". Device routing is re-established by the host at startup,
 * so presence flows without opening the dialog.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { remoteConnectAPI, deviceDisplayName } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { createLogger } from '@/shared/utils/logger';
import { useAccountLoginState } from '@/infrastructure/account/useAccountLoginState';

const log = createLogger('AccountDeviceRoster');

const ROSTER_POLL_MS = 60_000;

export interface DeviceRosterEntry {
  deviceId: string;
  deviceName: string;
  online: boolean;
  isLocal: boolean;
  /** Relay-confirmed client compatibility; `false` blocks mutual control. */
  controllable: boolean;
}

export interface AccountDeviceRoster {
  loggedIn: boolean;
  localDeviceId: string | null;
  localDeviceName: string | null;
  /** Local device first, then online peers, then offline peers. */
  devices: DeviceRosterEntry[];
  refresh: () => void;
}

export function useAccountDeviceRoster(): AccountDeviceRoster {
  const identity = useAccountIdentity();
  const directory = useDeviceDirectory();
  const accountId = identity.me?.user.accountId ?? identity.me?.user.githubId;
  const { loggedIn, deviceName: localDeviceName } = useAccountLoginState();
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);
  const [peers, setPeers] = useState<DeviceRosterEntry[]>([]);
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    if (!loggedIn) {
      return;
    }
    const generation = ++generationRef.current;
    void (async () => {
      try {
        const [info, list] = await Promise.all([
          remoteConnectAPI.getDeviceInfo(),
          remoteConnectAPI.accountListDevices(),
        ]);
        if (generationRef.current !== generation) {
          return;
        }
        setLocalDeviceId(info.device_id);
        setPeers(
          list
            .filter(device => device.device_id !== info.device_id)
            .map(device => ({
              deviceId: device.device_id,
              deviceName: deviceDisplayName(device),
              online: device.online,
              isLocal: false,
              controllable: isDeviceControllable(device),
            })),
        );
      } catch (error) {
        // A transport hiccup is not evidence that devices went away; keep the
        // last roster until presence or the next poll corrects it.
        log.warn('Failed to refresh account device roster', error);
      }
    })();
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) {
      generationRef.current += 1;
      setLocalDeviceId(null);
      setPeers([]);
      return;
    }
    setPeers([]);
    setLocalDeviceId(null);
    refresh();
    const poll = setInterval(refresh, ROSTER_POLL_MS);
    return () => { generationRef.current += 1; clearInterval(poll); };
    // `accountId` belongs to the reset condition, not to the request itself:
    // switching accounts must drop the previous account's roster instead of
    // showing it until the next poll corrects it.
  }, [accountId, loggedIn, refresh]);

  useEffect(() => {
    if (!loggedIn) {
      return;
    }
    return api.listen('account://device-presence', refresh);
  }, [loggedIn, refresh]);

  const devices = useMemo<DeviceRosterEntry[]>(() => {
    const sortedPeers = peers.map(peer => ({ ...peer, deviceName: resolveDeviceNameFrom(directory.devices, peer.deviceId, peer.deviceName) })).sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1;
      }
      return a.deviceName.localeCompare(b.deviceName);
    });
    if (!localDeviceId) {
      return sortedPeers;
    }
    return [
      {
        deviceId: localDeviceId,
        deviceName: localDeviceName || localDeviceId,
        online: true,
        isLocal: true,
        controllable: true,
      },
      ...sortedPeers,
    ];
  }, [peers, localDeviceId, localDeviceName, directory]);

  return { loggedIn, localDeviceId, localDeviceName, devices, refresh };
}
