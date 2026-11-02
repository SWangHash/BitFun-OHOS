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
  // Document-relative resolution must anchor on the CURRENT FILE's directory.
  // A workspace-relative filePath joined against the browser's cwd would
  // produce a bogus document directory and silently push every lookup onto
  // the workspace-root fallback (issue #460).
  const absoluteFilePath = isAbsolutePath(filePath)
    ? filePath
    : (workspacePath ? path.join(workspacePath, filePath) : '');
  if (!absoluteFilePath) {
    return [];
  }
  const documentRelative = path.resolve(path.dirname(absoluteFilePath), hrefPath);
  const candidates = [documentRelative];
  if (workspacePath) {
    const rootRelative = path.join(workspacePath, hrefPath.replace(/^\/+/, ''));
    if (!candidates.includes(rootRelative)) {
      candidates.push(rootRelative);
    }
  }
  return candidates;
}
