/** Shorten the middle at directory boundaries, preserving the original separators. */
export function formatSkillDetailPath(path: string): string {
  const segments = [...path.matchAll(/[^\\/]+/g)];
  if (segments.length <= 5) return path;

  const leadingEnd = segments[3].index;
  const lastHiddenSegment = segments[segments.length - 3];
  const trailingStart = lastHiddenSegment.index + lastHiddenSegment[0].length;

  return `${path.slice(0, leadingEnd)}…${path.slice(trailingStart)}`;
}
