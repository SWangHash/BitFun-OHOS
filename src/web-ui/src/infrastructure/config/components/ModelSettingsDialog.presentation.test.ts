import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ModelSettingsPage.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('./ModelSettingsPage.scss', import.meta.url)),
  'utf8',
);

const dialogStyles = readFileSync(
  fileURLToPath(new URL('../../../../../../design-system/packages/ui/src/components/Dialog/Dialog.module.css', import.meta.url)),
  'utf8',
);

describe('ModelSettingsPage dialog presentation', () => {
  it('keeps model configuration editors at a moderate responsive size', () => {
    const editorDialogStart = source.indexOf('open={isEditing && !!editingConfig}');
    const editorDialog = source.slice(editorDialogStart, source.indexOf('<ConfirmDialog', editorDialogStart));
    const editingFormStart = source.indexOf('const renderEditingForm = () => {');
    const editingForm = source.slice(
      editingFormStart,
      source.indexOf('const renderModelCollectionItem', editingFormStart),
    );

    expect(editorDialogStart).toBeGreaterThan(-1);
    expect(editingFormStart).toBeGreaterThan(-1);
    expect(editorDialog).toContain('className="bitfun-model-settings__editor-dialog"');
    expect(editorDialog).toContain('preset="panel"');
    expect(editorDialog).not.toContain('size="2xl"');
    expect(editorDialog).toMatch(
      /\{!reasoningPanelDraft && \(\s*<DialogFooter appearance="floating">/,
    );
    expect(editorDialog).toContain('appearance="floating"');
    expect(editorDialog).toContain(
      '<Button variant="fill" size="sm" onClick={modelPanelDraft ? cancelModelPanel : requestCloseEditingModal} disabled={isEditorSaving}>',
    );
    expect(editorDialog).toMatch(
      /<Button\s+data-testid="settings-model-save-btn"\s+variant="primary"\s+size="sm"/,
    );
    expect(editorDialog).toContain('<DialogClose disabled={isEditorSaving} />');
    expect(editorDialog).toContain('loading={isEditorSaving}');
    expect(editingForm.match(/fieldSurface="filled"/g)).toHaveLength(4);
    expect(editingForm).not.toContain('<ScrollArea');
    expect(editingForm).toContain('className="bitfun-model-settings__form-content"');
    expect(editorDialog).not.toContain('bitfun-model-settings__editor-dialog-footer');
    expect(editorDialog).not.toContain('bitfun-model-settings__editor-dialog-cancel');
    expect(dialogStyles).toMatch(
      /\.surface\[data-preset="panel"\]\s*{[\s\S]*?block-size:\s*min\([\s\S]*?var\(--bitfun-overlay-dialog-panel-block-size\),[\s\S]*?var\(--bitfun-viewport-host-chrome-inset-block-start\)/,
    );
    expect(styles).not.toContain('&__editor-dialog-footer');
    expect(styles).not.toContain('&__editor-dialog-cancel');
    expect(editingForm).toContain('className="bitfun-model-settings__single-model-fields"');
    expect(editingForm).toContain('<Capsule');
  });

  it('keeps unsaved editor state behind an explicit draft decision', () => {
    expect(source).toContain('if (editingModalHasUnsavedChanges) {');
    expect(source).toContain('setDraftCloseConfirmOpen(true);');
    expect(source).toContain('onConfirm={preserveEditingDraftAndClose}');
    expect(source).toContain('onSecondary={closeEditingModal}');
    expect(source).toContain("confirmText={t('draftClose.keepAndClose')}");
    expect(source).toContain("cancelText={t('draftClose.continueEditing')}");
    expect(source).toContain("statusMessage={t('draftClose.retainedHint')}");
  });

  it('protects a retained draft when another editor target is requested', () => {
    expect(source).toContain('pendingEditorOpenRef.current = { open };');
    expect(source).toContain('onConfirm={continueEditingCurrentDraft}');
    expect(source).toContain('onSecondary={discardDraftBeforeOpeningPendingEditor}');
  });

  it('offers atomic provider deletion with provider-specific confirmation', () => {
    expect(source).toContain("aria-label={`${t('actions.deleteProvider')}: ${group.providerName}`}");
    expect(source).toContain('onClick={() => void requestProviderDelete(group)}');
    expect(source).toContain("kind: 'provider',");
    expect(source).toContain('removeProviderModelConfigs(current, request.groupKey)');
    expect(source).toContain("? 'providerDeleteConfirm.title'");
    expect(source).toContain("? 'providerDeleteConfirm.confirm'");
  });
});
