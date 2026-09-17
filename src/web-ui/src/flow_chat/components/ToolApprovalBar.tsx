import { OverflowText } from '@bitfun/ui';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AcpPermissionActions } from '../tool-cards/AcpPermissionActions';
import { hasAcpPermissionOptions } from '../tool-cards/AcpPermissionActions.utils';
import type { FlowToolItem, ToolRejectOptions } from '../types/flow-chat';
import './ToolApprovalBar.scss';

interface ToolApprovalBarProps {
  toolItem: FlowToolItem;
  onConfirm?: (permissionOptionId?: string, approve?: boolean) => void;
  onReject?: (options?: ToolRejectOptions) => void;
}

export const ToolApprovalBar: React.FC<ToolApprovalBarProps> = ({
  toolItem,
  onConfirm,
  onReject,
}) => {
  const { t } = useTranslation('flow-chat');

  if (toolItem.status !== 'pending_confirmation' || !hasAcpPermissionOptions(toolItem)) {
    return null;
  }

  return (
    <div data-bitfun-component="tool-approval-bar" data-bitfun-part="root" className="tool-approval-bar" role="group" aria-label={t('toolCards.approval.ariaLabel')}>
      <div data-bitfun-component="tool-approval-bar" data-bitfun-part="main" className="tool-approval-bar__main">
        <OverflowText data-bitfun-component="tool-approval-bar" data-bitfun-part="message" className="tool-approval-bar__message">{t('toolCards.approval.waiting')}</OverflowText>
        <AcpPermissionActions
          toolItem={toolItem}
          presentation="text"
          className="tool-approval-bar__permission-actions"
          onConfirm={onConfirm}
          onReject={onReject}
        />
      </div>
    </div>
  );
};

export default ToolApprovalBar;
