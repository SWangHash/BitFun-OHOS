import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(resolve(__dirname, 'FileSearchResults.tsx'), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const stylesheet = readFileSync(resolve(__dirname, 'FileSearchResults.scss'), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const filesPanelSource = readFileSync(
  resolve(__dirname, '../../../app/components/panels/FilesPanel.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('file search result presentation', () => {
  it('compresses the limit notice and result summary into one overflow-safe header', () => {
    expect(filesPanelSource).toContain('limitNotice={searchLimitNotice}');
    expect(filesPanelSource).toContain("t('search.limitReachedContentCompact'");
    expect(filesPanelSource).toContain("t('search.limitReachedFilesCompact'");
    expect(filesPanelSource).not.toContain('className="bitfun-files-panel__search-limit-notice"');
    expect(componentSource).toContain("t('search.resultsSummaryCompact'");
    expect(componentSource).toContain("t('search.resultsShowingCompact'");
    expect(componentSource).toContain("join(' · ')");
    expect(componentSource).toMatch(
      /<OverflowText[\s\S]*?behavior="fade"[\s\S]*?className="bitfun-search-results__count"[\s\S]*?\{headerText\}[\s\S]*?<\/OverflowText>/,
    );
    expect(componentSource).toContain('overflowStyle="ellipsis"');
    expect(componentSource).not.toContain('bitfun-search-results__limit-notice');
  });

  it('insets the divider below the results header evenly', () => {
    expect(stylesheet).toMatch(
      /\.bitfun-search-results__header\s*\{[^}]*position:\s*relative;[\s\S]*?&::after\s*\{[^}]*inset-inline:\s*var\(--bitfun-space-2\);[^}]*bottom:\s*0;[^}]*z-index:\s*var\(--bitfun-layer-decoration\);[^}]*height:\s*1px;[^}]*background:\s*var\(--bitfun-color-border-default\);/s,
    );
    expect(stylesheet).not.toMatch(
      /\.bitfun-search-results__header\s*\{[^}]*border-bottom:/s,
    );
  });

  it('uses the FlowChat cyan treatment and scopes marquees to the hovered text line', () => {
    expect(componentSource).toContain('behavior="marquee" marqueeTrigger="interaction"');
    expect(filesPanelSource).not.toMatch(/<div data-overflow-trigger\s+data-bitfun-component="files-panel"/);
    expect(componentSource).not.toMatch(/<button data-overflow-trigger[\s\S]*?className="bitfun-search-results__file-main"/);
    expect(componentSource).toMatch(
      /className="bitfun-search-results__file-name"\s+data-overflow-trigger/,
    );
    expect(componentSource).toMatch(
      /className="bitfun-search-results__file-path"\s+data-overflow-trigger\s+marqueeTrigger="interaction"/,
    );
    expect(stylesheet).toMatch(
      /\.bitfun-search-results__highlight\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--bitfun-component-conversation-excerpt-accent\) 30%, transparent\);[^}]*color:\s*var\(--bitfun-component-conversation-excerpt-accent\);/s,
    );
  });

  it('removes the generic inline-code container from match details', () => {
    expect(stylesheet).toMatch(
      /&-content\s*\{[\s\S]*?code\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s,
    );
  });

  it('places the match count before the disclosure chevron', () => {
    const toggleStart = componentSource.indexOf('className="bitfun-search-results__file-toggle"');
    const toggleEnd = componentSource.indexOf('</button>', toggleStart);
    const toggleSource = componentSource.slice(toggleStart, toggleEnd);

    expect(toggleSource.indexOf('bitfun-search-results__file-toggle-count')).toBeGreaterThan(-1);
    expect(toggleSource.indexOf('bitfun-search-results__file-toggle-count'))
      .toBeLessThan(toggleSource.indexOf("name=\"chevron-down\""));
  });
});
