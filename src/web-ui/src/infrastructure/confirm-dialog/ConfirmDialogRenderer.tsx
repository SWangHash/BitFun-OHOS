import { useCallback } from 'react';
import { ConfirmDialog, type ConfirmDialogCloseReason } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { useConfirmDialogStore } from './confirmDialogService';

export function ConfirmDialogRenderer() {
  const { t } = useI18n('components');
  const { cancel, confirm, dismiss, isOpen, options, secondary } = useConfirmDialogStore();

  // Only the cancel button is an explicit "cancel" decision. Mask clicks,
  // Escape and the close button dismiss the surface without choosing an action.
  const handleOpenChange = useCallback((_open: false, reason: ConfirmDialogCloseReason) => {
    if (reason === 'cancel-button') cancel();
    else dismiss();
  }, [cancel, dismiss]);

  if (!options) return null;

  return (
    <ConfirmDialog
      cancelText={options.cancelText ?? t('dialog.confirm.cancel')}
      confirmDanger={options.confirmDanger}
      confirmText={options.confirmText ?? t('dialog.confirm.ok')}
      open={isOpen}
      message={options.message}
      onOpenChange={handleOpenChange}
      onConfirm={confirm}
      onSecondary={secondary}
      preview={options.preview}
      secondaryText={options.secondaryText}
      showCancel={options.showCancel}
      title={options.title}
      type={options.type}
    />
  );
}
