// Merge persisted setup changes into a live draft. Arrays are edited as a whole;
// independent object fields can be kept from both sides.
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
  }
  return false;
}

export function mergeAcpConfigDraft<T>(baseline: T, draft: T, persisted: T): {
  config: T;
  conflicted: boolean;
} {
  let conflicted = false;
  const merge = (base: unknown, local: unknown, remote: unknown): unknown => {
    if (equal(local, base)) return remote;
    if (equal(remote, base) || equal(local, remote)) return local;
    if (isRecord(local) && isRecord(remote) && (base === undefined || isRecord(base))) {
      const previous = isRecord(base) ? base : {};
      const entries = new Set([...Object.keys(previous), ...Object.keys(local), ...Object.keys(remote)]);
      return Object.fromEntries(Array.from(entries).flatMap(key => {
        const value = merge(previous[key], local[key], remote[key]);
        return value === undefined ? [] : [[key, value]];
      }));
    }
    conflicted = true;
    return local;
  };
  const config = merge(baseline, draft, persisted) as T;
  return { config, conflicted };
}
