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
/**
 * Candidate absolute paths for a clicked markdown link. Resolution is
 * document-relative ONLY — relative to the CURRENT FILE's directory (issue
 * #460: workspace-root-relative lookups were wrong). A workspace-relative
 * filePath is anchored on the workspace root first so the document directory
 * never degenerates to the browser's cwd. Absolute hrefs (drive-style or
 * slash-rooted) are returned untouched; a pure in-page anchor yields no
 * candidates.
 */
export function resolveMarkdownLinkCandidates(filePath: string, href: string, workspacePath?: string): string[] {
  const hrefPath = href.split('#')[0]?.trim() ?? '';
  if (!hrefPath) {
    return [];
  }
  if (isAbsolutePath(hrefPath)) {
    return [hrefPath.replace(/^\/([A-Za-z]:)/, '$1')];
  }
  const absoluteFilePath = isAbsolutePath(filePath)
    ? filePath
    : (workspacePath ? path.join(workspacePath, filePath) : '');
  if (!absoluteFilePath) {
    return [];
  }
  return [path.resolve(path.dirname(absoluteFilePath), hrefPath)];
}
