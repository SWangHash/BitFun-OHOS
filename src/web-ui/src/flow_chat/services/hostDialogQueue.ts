import { HostDialogQueue, type QueueAttachment } from '../../../../shared/dialog-queue/HostDialogQueue';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { getActiveSurfaceScope, isLocalSurface } from '@/infrastructure/peer-device/deviceSurface';
import { peerConnectionManager } from '@/infrastructure/peer-device/PeerConnectionManager';
import { accountIdentityService } from '@/infrastructure/account-identity/AccountIdentityService';
import { FlowChatStore } from '../store/FlowChatStore';
import { isAcpFlowSession } from '../utils/acpSession';
import { resolveSessionDriverId } from '../session-drivers/resolve';
import { translateAgentIdentityFields } from '../../../../shared/agent-harness/wire';

const clients = new Map<string, HostDialogQueue>();
function currentAccount(): string {
  const user = accountIdentityService.getSnapshot().me?.user;
  return String(user?.accountId || user?.githubId || 'local');
}
export function hostQueueSupported(sessionId: string): boolean {
  const session = FlowChatStore.getInstance().getState().sessions.get(sessionId);
  if (!session || isAcpFlowSession(session) || resolveSessionDriverId(sessionId, session) !== 'local') return false;
  const scope = getActiveSurfaceScope();
  return isLocalSurface(scope.surfaceId)
    || peerConnectionManager.get(scope.surfaceId)?.getState().capabilities.dialogQueueV1 === true;
}
export function hostDialogQueue(sessionId: string): HostDialogQueue {
  const scope = getActiveSurfaceScope();
  const account = currentAccount();
  const owner = JSON.stringify([account, scope.surfaceId, sessionId]);
  const key = JSON.stringify([owner, scope.epoch]);
  let client = clients.get(key);
  if (!client) {
    client = new HostDialogQueue(owner, sessionId, async request => {
      scope.assertCurrent('send queue operation');
      if (currentAccount() !== account) throw new Error('Queue account changed');
      const result = await api.invoke<import('../../../../shared/dialog-queue/HostDialogQueue').QueueSnapshot>(
        'manage_dialog_queue', { request: translateAgentIdentityFields(request, 'legacy') });
      scope.assertCurrent('apply queue operation');
      if (currentAccount() !== account) throw new Error('Queue account changed');
      return result;
    });
    clients.set(key, client);
  }
  return client;
}
export function queueImageAttachments(images?: unknown[]): QueueAttachment[] {
  return (images ?? []).map(value => {
    const image = value as { id: string; data_url?: string; image_path?: string; mime_type?: string; metadata?: unknown };
    return { kind: 'remote_image', id: image.id, metadata: {
      ...(image.data_url ? { dataUrl: image.data_url } : {}),
      ...(image.image_path ? { imagePath: image.image_path } : {}),
      mimeType: image.mime_type, metadata: image.metadata,
    } };
  });
}
