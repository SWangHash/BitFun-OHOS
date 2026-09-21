export interface AccountDevice {
  device_id: string;
  device_name: string;
  online: boolean;
  /** Client build the device reported to the Relay. Absent on older Relays. */
  client_version?: string | null;
  /** Client wire protocol the device reported. Absent on older Relays. */
  client_protocol?: number | null;
  /**
   * Relay-computed mutual-control compatibility of this device with this one.
   *
   * `false` means confirmed incompatible: either a client build/protocol
   * mismatch or a peer that reported no version information (an older client).
   * Absent only on an older Relay that does not gate at all, which must be
   * treated as "unknown but usable", never as incompatible.
   */
  compatible?: boolean;
}

/**
 * The single gate every mobile control entry point must reuse.
 *
 * The Relay computes `compatible` from *both* clients' reported build/protocol.
 * It returns `false` for a version mismatch and also for a peer that reported
 * no version information at all (an older client), so a `false` flag always
 * means "this peer is not mutually controllable" regardless of the reason.
 *
 * `compatible` is absent only on an older Relay that does not gate at all; that
 * is "unknown but usable" and must never block control.
 */
export function isDeviceControllable(device: Pick<AccountDevice, 'compatible'>): boolean {
  return device.compatible !== false;
}

/** Device availability is not an authentication condition. A scanned target
 * must never silently fall back to an unrelated device on the same account,
 * nor to a device the Relay confirmed is incompatible. */
export function selectAccountDevice(
  devices: readonly AccountDevice[],
  controllerDeviceId: string | null,
  preferredDeviceId?: string | null,
): AccountDevice | null {
  const preferred = preferredDeviceId?.trim();
  return devices.find((device) => device.device_id !== controllerDeviceId
    && device.online
    && isDeviceControllable(device)
    && (!preferred || device.device_id === preferred)) ?? null;
}
