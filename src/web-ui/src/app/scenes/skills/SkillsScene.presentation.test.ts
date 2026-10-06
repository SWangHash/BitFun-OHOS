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

  it('presents add skill as a compact primary action in the gallery page header', () => {
    const source = readSibling('./SkillsScene.tsx');
    const actionStart = source.indexOf('<GalleryPageHeader');
    const actionEnd = source.indexOf('</GalleryPageHeader>', actionStart);
    const action = source.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(action).toContain('variant="primary"');
    expect(action).toContain('size="sm"');
    expect(action).toContain('leadingIcon={<Icon name="plus" size="sm" />}');
    expect(action).toContain("{t('toolbar.addTooltip')}");
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

  it('uses the matrix-page container instead of nesting inside skills-discover', () => {
    const source = readSibling('./SkillsScene.tsx');
    const matrixViewSource = readSibling('./components/MatrixMarketView.tsx');
    const stylesheet = readSibling('./SkillsScene.scss');

    const matrixSectionStart = source.indexOf("activeTab === 'matrix' && (");
    const matrixSectionEnd = source.indexOf('</div>', source.indexOf('<MatrixMarketView', matrixSectionStart));
    const matrixSection = source.slice(matrixSectionStart, matrixSectionEnd);

    expect(matrixSectionStart).toBeGreaterThan(-1);
    expect(source).toContain('className="skills-matrix-page"');
    expect(matrixSection).toContain('data-bitfun-part="matrix"');
    expect(matrixSection).not.toContain('data-bitfun-part="discover"');
    expect(matrixViewSource).not.toContain('className="skills-discover skills-matrix"');
    expect(stylesheet).toContain('.skills-matrix-page {');
    expect(stylesheet).not.toContain('.skills-matrix > .skills-discover__content {');
  });
});
