import path from 'path-browserify';
import { isAbsolutePath } from './rehype-local-images';

/**
 * Candidate absolute paths for a clicked markdown link, most specific first.
 *
 * The document-relative resolution always leads (the markdown spec behaviour).
 * The workspace root follows as a fallback: authors frequently write
 * root-relative links like `src/xxx/xxx.md` from documents deep in the tree,
 * and the document-relative target then misses. A leading `#` fragment never
 * participates in file resolution; a pure in-page anchor yields no candidates.
 */
export function resolveMarkdownLinkCandidates(filePath: string, href: string, workspacePath?: string): string[] {
  const hrefPath = href.split('#')[0]?.trim() ?? '';
  if (!hrefPath) {
    return [];
  }
  // Absolute targets (drive-style or slash-rooted) are already file paths;
  // path-browserify is POSIX-flavoured and would glue a drive href onto the
  // document directory, so hand them back untouched (same rule as images).
  if (isAbsolutePath(hrefPath)) {
    return [hrefPath.replace(/^\/([A-Za-z]:)/, '$1')];
  }
  const documentRelative = path.resolve(path.dirname(filePath), hrefPath);
  const candidates = [documentRelative];
  if (workspacePath && !isAbsolutePath(hrefPath)) {
    const rootRelative = path.join(workspacePath, hrefPath.replace(/^\/+/, ''));
    if (!candidates.includes(rootRelative)) {
      candidates.push(rootRelative);
    }
  }
  return candidates;
}
