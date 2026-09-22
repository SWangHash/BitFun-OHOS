export interface ToolbarWindowSize {
  width: number;
  height: number;
}

export interface ToolbarWindowRect extends ToolbarWindowSize {
  x: number;
  y: number;
}

export interface ResolvedToolbarWindowGeometry extends ToolbarWindowRect {
  /** Physical min size for the resolved rect; never larger than the rect. */
  minWidth: number;
  minHeight: number;
}

interface PhysicalArea {
  position: {
    x: number;
    y: number;
  };
  size: ToolbarWindowSize;
}

export interface ToolbarMonitorGeometry extends PhysicalArea {
  scaleFactor?: number;
  workArea?: PhysicalArea;
}

interface ResolveToolbarWindowGeometryOptions {
  monitor: ToolbarMonitorGeometry | null | undefined;
  targetSize: ToolbarWindowSize;
  minSize: ToolbarWindowSize;
  /** Actual physical outer size after the native window applies the request. */
  actualSize?: ToolbarWindowSize;
  anchor?: ToolbarWindowRect | null;
  fallbackPosition?: {
    x: number;
    y: number;
  };
}

const TOOLBAR_WINDOW_EDGE_MARGIN = 20;

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
};

const resolveDimension = (target: number, min: number, available: number): number => {
  const usable = Math.max(1, available);
  const lowerBound = Math.min(Math.max(1, min), usable);
  return clamp(target, lowerBound, usable);
};

export const resolveToolbarWindowGeometry = ({
  monitor,
  targetSize,
  minSize,
  actualSize,
  anchor,
  fallbackPosition = { x: 100, y: 100 },
}: ResolveToolbarWindowGeometryOptions): ResolvedToolbarWindowGeometry => {
  // Sizes arrive in logical (CSS) pixels — the same unit the stylesheets and
  // TOOLBAR_WINDOW_EDGE_MARGIN are authored in — while the monitor work area
  // and the Tauri window APIs are physical. Convert once, here, so the window
  // is the same apparent size on HiDPI and 1x displays.
  const scaleFactor = monitor?.scaleFactor ?? 1;
  const toPhysical = (value: number) => Math.max(1, Math.round(value * scaleFactor));
  const target = {
    width: toPhysical(targetSize.width),
    height: toPhysical(targetSize.height),
  };
  const min = {
    width: toPhysical(minSize.width),
    height: toPhysical(minSize.height),
  };
  const requested = actualSize ?? target;

  if (!monitor) {
    return {
      ...fallbackPosition,
      ...requested,
      minWidth: Math.min(min.width, requested.width),
      minHeight: Math.min(min.height, requested.height),
    };
  }

  const workArea = monitor.workArea ?? {
    position: monitor.position,
    size: monitor.size,
  };
  const margin = Math.max(0, Math.round(TOOLBAR_WINDOW_EDGE_MARGIN * scaleFactor));
  const availableWidth = workArea.size.width - margin * 2;
  const availableHeight = workArea.size.height - margin * 2;
  const width = actualSize?.width ?? resolveDimension(target.width, min.width, availableWidth);
  const height = actualSize?.height ?? resolveDimension(target.height, min.height, availableHeight);
  if (actualSize && (width > workArea.size.width || height > workArea.size.height)) {
    throw new Error('Native toolbar window is larger than the monitor work area');
  }

  const desiredX = anchor
    ? anchor.x + anchor.width - width
    : workArea.position.x + workArea.size.width - width - margin;
  const desiredY = anchor
    ? anchor.y + anchor.height - height
    : workArea.position.y + workArea.size.height - height - margin;

  const minX = workArea.position.x + margin;
  const minY = workArea.position.y + margin;
  const maxX = workArea.position.x + workArea.size.width - width - margin;
  const maxY = workArea.position.y + workArea.size.height - height - margin;

  return {
    x: maxX >= minX ? clamp(desiredX, minX, maxX) : workArea.position.x,
    y: maxY >= minY ? clamp(desiredY, minY, maxY) : workArea.position.y,
    width,
    height,
    minWidth: Math.min(min.width, width),
    minHeight: Math.min(min.height, height),
  };
};
