import type { CSSProperties } from 'react';
import { Monitor } from 'lucide-react';
import type { IconSize } from '@bitfun/ui';
import type { DeviceOverviewDevice } from '../deviceInterconnectionOverview';
import { getDeviceArtworkKind } from './deviceArtworkKind';
import { DEVICE_MARK_BY_ARTWORK, DEVICE_SYSTEM_MARKS } from './deviceSystemMarks';

type DeviceSystemFacts = Pick<DeviceOverviewDevice, 'kind' | 'name' | 'os' | 'hostKind'>;

const ICON_TOKEN_SIZE: Record<IconSize, string> = {
  '2xs': 'var(--bitfun-control-icon-size2xs)',
  xs: 'var(--bitfun-control-icon-size-xs)',
  sm: 'var(--bitfun-control-icon-size-sm)',
  md: 'var(--bitfun-control-icon-size-md)',
  lg: 'var(--bitfun-control-icon-size-lg)',
};

/**
 * The size a mark is drawn at, as a CSS length. A token stays a token so the
 * slot keeps following the design system; a caller's pixel count is written out.
 *
 * It is applied as a declaration and never as an SVG `width`/`height`
 * presentation attribute. A token is a `var()` reference, and an attribute an
 * engine cannot parse is not a smaller mark but no size at all: the mark then
 * keeps only its view box and fills the box it was put in. Reported from the
 * HarmonyOS device, where the footer mark grew to the full height of the
 * sidebar footer and pushed the device name out of the row. A declaration
 * resolves the same token on every engine this product ships.
 */
function resolveMarkSize(size: number | IconSize): string {
  return typeof size === 'number' ? `${size}px` : ICON_TOKEN_SIZE[size];
}

/**
 * The mark a device row shows in front of its name: the system the device
 * reported, the server silhouette for a CLI host, and the neutral monitor this
 * list always drew for a device whose system cannot be placed.
 *
 * An inline path rather than a masked asset file, because a mask whose asset
 * does not resolve paints the element as a solid block instead of falling back
 * to no mark, and the inline form needs no mask, size, or colour rules.
 *
 * Size is a pixel count or an icon-size token, so a caller can put the mark in
 * the same slot as the icons it stands beside.
 *
 * A mark also carries its own optical correction (see `deviceSystemMarks`), and
 * states it with the individual `translate` property so a caller's own
 * `transform` still applies instead of replacing it. It is expressed in `em`
 * against the mark's font size, which is the rendered size here, so one number
 * holds at every slot size.
 */
export function DeviceSystemGlyph({
  device,
  size = 16,
}: {
  device: DeviceSystemFacts;
  size?: number | IconSize;
}) {
  const resolvedSize = resolveMarkSize(size);
  const box: CSSProperties = { width: resolvedSize, height: resolvedSize };
  const key = DEVICE_MARK_BY_ARTWORK[getDeviceArtworkKind(device)];
  if (!key) return <Monitor aria-hidden="true" focusable="false" style={box} />;
  const mark = DEVICE_SYSTEM_MARKS[key];
  return (
    <svg
      aria-hidden="true"
      data-system={key}
      focusable="false"
      viewBox={mark.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      style={mark.opticalShift === 0
        ? box
        : { ...box, fontSize: resolvedSize, translate: `0 ${mark.opticalShift}em` }}
    >
      <path fill="currentColor" d={mark.path} />
    </svg>
  );
}
