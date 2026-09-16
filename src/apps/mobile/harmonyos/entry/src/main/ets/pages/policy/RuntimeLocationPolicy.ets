/** Paths belong to the serving runtime; the phone OS does not determine syntax. */
export class RuntimeLocationPolicy {
  static parent(path: string): string {
    if (/^[a-zA-Z]:[\\/]/.test(path)) {
      const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
      const parent = normalized.slice(0, normalized.lastIndexOf('/'));
      return parent.length > 2 ? parent : `${normalized.slice(0, 2)}/`;
    }
    if (path.startsWith('\\\\')) {
      const parts = path.replace(/\\/g, '/').split('/').filter((part: string): boolean => part.length > 0);
      if (parts.length > 2) parts.pop();
      return `//${parts.join('/')}`;
    }
    const normalized = path.replace(/\/+$/, '');
    return normalized.slice(0, normalized.lastIndexOf('/')) || '/';
  }
}
