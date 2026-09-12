import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChevronDown, Copy, Minus, Search, Square, X } from 'lucide-react';
import { themes } from '@openbitfun/theme-openbitfun';

// Pre-React chrome and native form decorations cannot mount React components.
// Generate their SVG from the same installed Lucide version as the application.
const check = process.argv.includes('--check');
const root = new URL('../', import.meta.url);
const glyphs = [Minus, Minus, Square, Copy, Square, Copy, X, X];

function svg(glyph, props = {}) {
  return renderToStaticMarkup(createElement(glyph, { 'aria-hidden': true, ...props }));
}

async function update(relative, transform) {
  const file = new URL(relative, root);
  const before = await readFile(file, 'utf8');
  const after = transform(before);
  if (before === after) return;
  if (check) throw new Error(`Lucide static icons are stale: ${fileURLToPath(file)}`);
  await writeFile(file, after);
}

await update('index.html', source => {
  let index = 0;
  const result = source.replace(/<svg\b[^>]*data-startup-window-control-platform=[\s\S]*?<\/svg>/g, original => {
    const opening = original.slice(0, original.indexOf('>'));
    const attrs = Object.fromEntries([...opening.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    const glyph = glyphs[index++];
    if (!glyph) throw new Error('Unexpected startup window icon');
    return svg(glyph, {
      width: attrs.width,
      height: attrs.height,
      'data-startup-window-control-platform': attrs['data-startup-window-control-platform'],
      ...(attrs['data-startup-window-control-state'] ? { 'data-startup-window-control-state': attrs['data-startup-window-control-state'] } : {}),
      ...(attrs.style ? { style: { display: 'none' } } : {}),
    });
  });
  if (index !== glyphs.length) throw new Error(`Expected ${glyphs.length} startup window icons, found ${index}`);
  return result;
});

await update('src/app/styles/components/forms.css', source => {
  const dataUrl = glyph => `url("data:image/svg+xml,${encodeURIComponent(glyph).replaceAll("'", '%27')}")`;
  // The legacy native select has a fixed decoration; source its color from the theme.
  // Search uses a mask and inherits the active theme at runtime.
  const chevron = dataUrl(svg(ChevronDown, { color: themes.light['color.content.muted'] }));
  const search = dataUrl(svg(Search));
  let count = 0;
  const result = source.replace(/url\("data:image\/svg\+xml[^\n]*?"\)/g, () => count++ === 0 ? chevron : search);
  if (count !== 3) throw new Error(`Expected three native form icon declarations, found ${count}`);
  return result;
});

console.log(`Lucide static icons ${check ? 'verified' : 'generated'}.`);
