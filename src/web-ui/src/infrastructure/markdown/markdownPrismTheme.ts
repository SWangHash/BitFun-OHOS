import type { CSSProperties } from 'react';
import { buildSharedPrismStyle } from '@/shared/prism/prismTheme';

export function buildMarkdownPrismStyle(isLight: boolean): Record<string, CSSProperties> {
  return buildSharedPrismStyle(isLight, {
    pre: {
      margin: 0,
      fontSize: 'var(--bitfun-type-code-md-font-size)',
      lineHeight: 'var(--bitfun-type-code-md-line-height)',
      fontFamily: 'var(--bitfun-type-code-md-font-family)',
      fontWeight: 'var(--bitfun-type-code-md-font-weight)',
    },
    code: {
      fontSize: 'var(--bitfun-type-code-md-font-size)',
      lineHeight: 'var(--bitfun-type-code-md-line-height)',
      fontFamily: 'var(--bitfun-type-code-md-font-family)',
      fontWeight: 'var(--bitfun-type-code-md-font-weight)',
    },
  });
}
