import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSibling(filename: string): string {
  return readFileSync(
    fileURLToPath(new URL(filename, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

describe('Skills scene presentation', () => {
  it('keeps the installed collection in one continuous scroll region', () => {
    const source = readSibling('./SkillsScene.tsx');

    expect(source).toContain('{installedFiltered.map((skill, index) => (');
    expect(source).toMatch(/className="skills-discover__grid skills-discover__grid--installed"/);
    expect(source).not.toContain('INSTALLED_PAGE_SIZE');
    expect(source).not.toContain('skills-installed__pagination');
  });

  it('lets short lists end with their final row and constrains long lists to the scene', () => {
    const stylesheet = readSibling('./SkillsScene.scss');
    const listStylesheet = readSibling('./components/_SkillsList.scss');
    const shellStart = stylesheet.indexOf('.skills-main__list-shell {');
    const shellEnd = stylesheet.indexOf('.skills-main__list-header {', shellStart);

    expect(stylesheet.slice(shellStart, shellEnd)).toContain('overflow: hidden;');
    expect(stylesheet.slice(shellStart, shellEnd)).toContain('padding: var(--bitfun-space-2) var(--bitfun-space-6) var(--bitfun-space-6);');
    expect(stylesheet).toContain('.skills-discover__grid--installed {');
    expect(listStylesheet).toContain('min-block-size: 88px;');
  });

  it('uses the ecosystem navigation width and shared content typography', () => {
    const stylesheet = readSibling('./SkillsScene.scss');

    expect(stylesheet).toContain('$skills-sidebar-width: 264px;');
    expect(stylesheet).toContain('min-height: 32px;');
    expect(stylesheet).toContain('font-size: var(--bitfun-type-heading-dialog-font-size);');
  });

  it('presents add skill as a compact primary action in the installed content header', () => {
    const source = readSibling('./SkillsScene.tsx');
    const headerStart = source.indexOf('<header className="skills-content-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);

    expect(headerStart).toBeGreaterThan(-1);
    expect(header).toContain('variant="primary"');
    expect(header).toContain('size="sm"');
    expect(header).toContain('leadingIcon={<Icon name="plus" size="sm" />}');
    expect(header).toContain('data-testid="skills-add-skill-btn"');
    expect(header).toContain("{t('toolbar.addTooltip')}");
  });

  it('lets the skills page inherit the surrounding scene surface', () => {
    const stylesheet = readSibling('./SkillsScene.scss');
    const listStylesheet = readSibling('./components/_SkillsList.scss');
    const surfaceStart = listStylesheet.indexOf('@mixin surface {');
    const surfaceEnd = listStylesheet.indexOf('\n}', surfaceStart);
    const headerStart = stylesheet.indexOf('.skills-content-header {');
    const headerEnd = stylesheet.indexOf('\n}', headerStart);

    expect(stylesheet).not.toContain('background: var(--bitfun-color-surface-canvas);');
    expect(listStylesheet.slice(surfaceStart, surfaceEnd)).toContain('background: transparent;');
    expect(stylesheet.slice(headerStart, headerEnd)).not.toContain('background:');
  });

  it('keeps the group scrollbar on the scene edge without moving its content', () => {
    const stylesheet = readSibling('./components/SkillGroupsView.scss');
    expect(stylesheet).toContain('--skill-groups-inline-inset: var(--bitfun-space-6);');
    expect(stylesheet).toContain(
      'padding-inline: var(--skill-groups-inline-inset) calc(var(--skill-groups-inline-inset) + var(--bitfun-space-1));',
    );
  });

  it('renders installed skills through the shared SkillCard component with detail and delete actions', () => {
    const source = readSibling('./SkillsScene.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    expect(source).toContain('<SkillCard');
    expect(source).toMatch(/data-bitfun-part="installedCard"/);
    expect(source).toContain("id: 'detail'");
    expect(source).toContain("id: 'delete'");
    expect(source).toContain('toggleSlot=');
    expect(source).not.toContain('className="skills-card__actions"');
    expect(source).not.toContain('data-bitfun-part="installedCardDetails"');
    expect(source).not.toContain('data-bitfun-part="installedCardDelete"');
    expect(stylesheet).not.toContain('$skills-installed-columns');
    expect(stylesheet).not.toContain('.skills-card__actions {');
  });

  it('uses the matrix-view container instead of nesting inside skills-discover', () => {
    const source = readSibling('./SkillsScene.tsx');
    const matrixViewSource = readSibling('./components/MatrixMarketView.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    const matrixSectionStart = source.indexOf('{desktopConfigAvailable && isMatrixView && (');
    const matrixSectionEnd = source.indexOf('</div>', source.indexOf('<MatrixMarketView', matrixSectionStart));
    const matrixSection = source.slice(matrixSectionStart, matrixSectionEnd);

    expect(matrixSectionStart).toBeGreaterThan(-1);
    expect(source).toContain('className="skills-matrix-view"');
    expect(matrixSection).toContain('data-bitfun-part="matrixView"');
    expect(matrixSection).not.toContain('data-bitfun-part="discover"');
    expect(matrixViewSource).not.toContain('className="skills-discover skills-matrix"');
    expect(stylesheet).toContain('.skills-matrix-view {');
    expect(stylesheet).not.toContain('.skills-matrix-page {');
    expect(stylesheet).not.toContain('.skills-matrix > .skills-discover__content {');
  });

  it('navigates between the library, sources, and both markets through the sidebar', () => {
    const source = readSibling('./SkillsScene.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    expect(source).toContain('className="skills-sidebar"');
    expect(source).toContain("title={t('nav.categories.installed')}");
    expect(source).toContain("title={t('list.columns.source')}");
    expect(source).toContain("title={t('nav.categories.discover')}");
    expect(source).toContain('sourceCategories.map(renderSidebarItem)');
    expect(source).toContain("onClick={() => setInstalledView('market')}");
    expect(source).toContain("onClick={() => setInstalledView('matrix')}");
    expect(source).not.toContain('skills-tabs-bar');
    expect(source).not.toContain('<GalleryPageHeader');
    expect(source).not.toContain('marketSettingsAction');
    expect(source).not.toContain('market.settings.action');
    expect(stylesheet).toContain('.bitfun-skills-scene {');
    expect(stylesheet).not.toContain('.skills-tabs-bar {');
  });

  it('filters duplicates through a checkbox in the installed toolbar', () => {
    const source = readSibling('./SkillsScene.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    const toolbarStart = source.indexOf('data-bitfun-part="toolbar"');
    const toolbarEnd = source.indexOf('</div>', source.indexOf('<Checkbox', toolbarStart));
    const toolbar = source.slice(toolbarStart, toolbarEnd);

    expect(toolbar).toContain('<Checkbox');
    expect(toolbar).toContain('checked={hideDuplicates}');
    expect(toolbar).toContain('onCheckedChange={setHideDuplicates}');
    expect(toolbar).toContain("{t('toolbar.hideDuplicates')}");
    expect(toolbar).toContain('skills-main__filter');
    expect(source).not.toContain('skills-main__chip-btn');
    expect(stylesheet).toContain('.skills-main__filter {');
    expect(stylesheet).not.toContain('.skills-main__chip-btn');
  });

  it('opens skill details in a 2.0.0-style dialog with copy and reveal path actions', () => {
    const source = readSibling('./SkillsScene.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    const detailStart = source.indexOf('data-testid="skill-detail-panel"');
    const detailEnd = source.indexOf('data-testid="skill-detail-panel"', source.indexOf('</Dialog>', detailStart));
    const detail = source.slice(source.lastIndexOf('<Dialog', detailStart), detailEnd);

    expect(source).not.toContain('<GalleryDetailModal');
    expect(detail).toContain('skills-detail__fields');
    expect(detail).toContain('skills-detail__badges');
    expect(detail).toContain('skills-detail__location');
    expect(detail).toContain('data-testid="skills-detail-copy-path-btn"');
    expect(detail).toContain('data-testid="skills-detail-path-btn"');
    expect(detail).toContain('handleCopySkillPath');
    expect(detail).toContain('handleRevealSkillPath');
    expect(detail).toContain('DialogFooter');
    expect(source).toContain('systemAPI.setClipboard');
    expect(source).toContain('formatSkillDetailPath');
    expect(stylesheet).toContain('.skills-detail {');
    expect(stylesheet).toContain('&__fields {');
    expect(stylesheet).toContain('&__location {');
  });

  it('binds the sidebar search to the active view', () => {
    const source = readSibling('./SkillsScene.tsx');

    expect(source).toContain('const sidebarSearch = isMarketView');
    expect(source).toContain('onSearch: () => submitMarketQuery()');
    expect(source).toContain('onSearch: () => matrix.submitKeyword()');
    expect(source).toContain("placeholder: t('market.searchPlaceholder')");
    expect(source).toContain("placeholder: t('matrix.searchPlaceholder')");
    expect(source).toContain("placeholder: t('toolbar.searchPlaceholder')");
  });

  it('anchors the market load-more sentinel to the real ScrollArea root', () => {
    const source = readSibling('./SkillsScene.tsx');
    const sentinelSource = readSibling('./components/SkillsLoadMoreSentinel.tsx');

    // ScrollArea owns the scroll viewport; its ref feeds the sentinel so
    // IntersectionObserver judges intersection against the real scroll bounds
    // instead of the browser viewport (which is unreliable in nested
    // ScrollArea setups and caused the "can't load more / one page then
    // empty" regression on ArkWeb).
    expect(source).toContain('setMarketScrollRoot');
    expect(source).toContain('ref={setMarketScrollRoot}');
    expect(source).toContain('root={marketScrollRoot}');
    expect(sentinelSource).toContain('root?: Element | null');
    expect(sentinelSource).toContain('root: root ?? null');
    expect(sentinelSource).toContain("rootMargin: '200px'");
  });

  it('does not refresh the skill market list on scene re-entry', () => {
    const source = readSibling('./SkillsScene.tsx');

    // useGallerySceneAutoRefresh calls refetchSkillsScene on tab re-entry and
    // window visibility regain. Previously it invoked market.refresh(), which
    // flipped marketLoading and replaced the existing list with a skeleton
    // grid (the "whole page refreshes" regression). The market is now
    // intentionally excluded from re-entry refresh; only installed skills and
    // skill groups are reloaded.
    const refetchStart = source.indexOf('const refetchSkillsScene');
    const refetchEnd = source.indexOf('}, [', refetchStart);
    const refetchBody = source.slice(refetchStart, refetchEnd);

    expect(refetchBody).toContain('installed.loadSkills(true)');
    expect(refetchBody).toContain('skillGroups.reload()');
    expect(refetchBody).not.toContain('market.refresh()');
  });

  it('keeps the existing market grid visible during load-more and refresh', () => {
    const source = readSibling('./SkillsScene.tsx');

    // The skeleton grid must only replace the list on a true first load
    // (empty list). When data already exists, the grid stays mounted and a
    // non-blocking refresh row surfaces progress, avoiding the flash.
    expect(source).toContain('market.marketLoading && market.marketSkills.length === 0');
    // The list render condition no longer hides the grid while loadingMore.
    const listBlockStart = source.indexOf('!market.marketLoading && !market.marketError && market.marketSkills.length > 0');
    expect(listBlockStart).toBeGreaterThan(-1);
    const listBlockEnd = source.indexOf('<SkillsLoadMoreSentinel', listBlockStart);
    const listBlock = source.slice(listBlockStart, listBlockEnd);
    expect(listBlock).not.toContain('!market.loadingMore && market.marketSkills.length > 0');
  });
});
