import { pendingQueueManager } from '../services/flow-chat-manager/PendingQueueModule';
import type { QueuedMessage } from '../types/flow-chat';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { Button, IconButton, OverflowText, Tooltip } from '@bitfun/ui';
import { ArrowUp, ChevronDown, ChevronUp, Copy, Info, Pencil, RotateCw, X } from 'lucide-react';
import './HostPendingQueuePanel.scss';
import { HostDialogQueue, observeHostQueue, type QueueOutboxRecord, type QueueItem } from '../../../../shared/dialog-queue/HostDialogQueue';
import {
  ChatComposerQueue, ChatComposerQueueHeader, ChatComposerQueueTitle,
  ChatComposerQueueList, ChatComposerQueueItem, ChatComposerQueueItemContent, ChatComposerQueueItemActions,
} from '@bitfun/ui/flow-chat';

export function HostPendingQueuePanel({ queue, onRestore }: { queue: HostDialogQueue; onRestore: (item: QueuedMessage) => boolean }) {
  const { t } = useI18n('flow-chat');
  const view = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [expanded, setExpanded] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const listId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => observeHostQueue(queue), [queue]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const restoreDraft = async (saved: QueueOutboxRecord, knownItem?: QueueItem) => {
    if (saved.request.action !== 'submit') return;
    await queue.prepareRestore(saved);
    const message = saved.request.message;
    const item = knownItem ?? await queue.receipt(message.turnId, saved.request.queueEpoch);
    if (!item) throw new Error(t('hostQueue.unknown'));
    if (item.status !== 'cancelled') {
      const result = await queue.act(item, 'cancel');
      if (result.receipt?.status !== 'cancelled') throw new Error(t('hostQueue.unknown'));
    }
    const cache = saved.draft as Partial<QueuedMessage> | undefined;
    const restored = onRestore({ ...cache, id: item.turnId, sessionId: queue.sessionId,
      content: message.content, displayMessage: message.displayContent, agentType: message.agentType,
      timestamp: item.createdAtMs, status: 'queued', retryCount: cache?.retryCount ?? 0,
      userMessageMetadata: message.metadata });
    if (!restored) {
      // Preserve the complete draft if the composer changed during cancellation.
      pendingQueueManager.enqueue({ ...cache, sessionId: queue.sessionId,
        content: message.content, displayMessage: message.displayContent,
        agentType: message.agentType, userMessageMetadata: message.metadata,
        retryCount: 1, initialStatus: 'failed' });
    }
    await queue.dismiss(saved);
  };
  const items = view.snapshot?.items ?? [];
  const visibleError = error || (view.error?.includes('Session is not loaded') ? null : view.error);
  if (!items.length && !view.pending.length && !visibleError) return null;
  return <ChatComposerQueue data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="root" className="host-pending-queue" aria-label={t('hostQueue.title')}>
    <ChatComposerQueueHeader data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="header">
      <Button variant="text" size="xs" className="host-pending-queue__toggle" aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpanded(value => !value)} trailingIcon={expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}>
        <ChatComposerQueueTitle data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="title" count={items.length + view.pending.length}>{t('hostQueue.title')}</ChatComposerQueueTitle>
      </Button>
      <Tooltip content={t('hostQueue.about')}><IconButton size="xs" aria-label={t('hostQueue.about')} aria-expanded={showHelp}
        icon={<Info size={14} />} onClick={() => setShowHelp(value => !value)} /></Tooltip>
    </ChatComposerQueueHeader>
    {showHelp && <p data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="status" className="host-pending-queue__note">{t('hostQueue.memoryNotice')}</p>}
    {visibleError && <div data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="status" role="alert" className="host-pending-queue__error">{visibleError}<Button size="xs" variant="text" disabled={busy} onClick={() => void run(() => queue.refresh())}>{t('hostQueue.refresh')}</Button></div>}
    <ChatComposerQueueList data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="list" id={listId} hidden={!expanded}>
      {items.map(item => <ChatComposerQueueItem data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="item" key={item.turnId} state={item.status === 'blocked' ? 'failed' : item.status === 'steering_pending' ? 'sending' : 'default'}>
        <ChatComposerQueueItemContent data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="content">
          <OverflowText title={item.displayContent}>{item.displayContent || t('pendingQueue.emptyPlaceholder')}</OverflowText>
          {item.status !== 'queued' && <span className="host-pending-queue__status">{item.status === 'blocked' ? t('hostQueue.blocked') : t('hostQueue.steeringPending')}</span>}
          {item.attachmentCount > 0 && <span className="host-pending-queue__status">{t('hostQueue.attachments', { count: item.attachmentCount })}</span>}
          {item.reason && <OverflowText className="host-pending-queue__status" title={item.reason}>{item.reason}</OverflowText>}
        </ChatComposerQueueItemContent>
        <ChatComposerQueueItemActions data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="actions">
          <Tooltip content={t('hostQueue.edit')}><IconButton size="xs" aria-label={t('hostQueue.edit')} icon={<Pencil size={14} />} disabled={busy || !!view.error || item.status === 'steering_pending'} onClick={() => void run(async () => {
            const saved = await queue.savedDraft(item.turnId);
            if (!saved || saved.request.action !== 'submit') throw new Error(t('hostQueue.noDraft'));
            await restoreDraft(saved, item);
          })} /></Tooltip>
          <Tooltip content={t('hostQueue.sendNow')}><IconButton size="xs" aria-label={t('hostQueue.sendNow')} icon={<ArrowUp size={14} />} disabled={busy || !!view.error || item.status === 'steering_pending'} onClick={() => void run(() => queue.act(item, 'promote'))} /></Tooltip>
          <Tooltip content={t('hostQueue.cancel')}><IconButton size="xs" aria-label={t('hostQueue.cancel')} icon={<X size={14} />} disabled={busy || !!view.error || item.status === 'steering_pending'} onClick={() => void run(() => queue.act(item, 'cancel'))} /></Tooltip>
        </ChatComposerQueueItemActions>
      </ChatComposerQueueItem>)}
      {view.pending.map(record => <ChatComposerQueueItem data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="item" key={record.key} state="failed">
        <ChatComposerQueueItemContent data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="content"><OverflowText className="host-pending-queue__status" title={t('hostQueue.unknown')}>{t('hostQueue.unknown')}</OverflowText>
          {record.request.action === 'submit' && <OverflowText title={record.request.message.displayContent ?? record.request.message.content}>{record.request.message.displayContent ?? record.request.message.content}</OverflowText>}
        </ChatComposerQueueItemContent>
        <ChatComposerQueueItemActions data-bitfun-product-component="pending-queue-panel" data-bitfun-product-part="actions">
          {record.restoreIntent && record.request.action === 'submit'
            ? <IconButton size="xs" aria-label={t('hostQueue.edit')} title={t('hostQueue.edit')} icon={<Pencil size={14} />} disabled={busy} onClick={() => void run(() => restoreDraft(record))} />
            : <IconButton size="xs" aria-label={t('hostQueue.checkRetry')} title={t('hostQueue.checkRetry')} icon={<RotateCw size={14} />} disabled={busy} onClick={() => void run(() => queue.retry(record))} />}
          {record.request.action === 'submit' && <IconButton size="xs" aria-label={t('hostQueue.copyDraft')} title={t('hostQueue.copyDraft')} icon={<Copy size={14} />} disabled={busy} onClick={() => {
            if (record.request.action !== 'submit') return;
            const message = record.request.message;
            const cache = record.draft as Partial<QueuedMessage> | undefined;
            // Copy locally even after an owner restart. Keep the unresolved
            // receipt: copying is neither a cancellation nor a resend.
            onRestore({ ...cache, id: message.turnId, sessionId: queue.sessionId,
              content: message.content, displayMessage: message.displayContent,
              agentType: message.agentType, timestamp: cache?.timestamp ?? Date.now(),
              status: 'queued', retryCount: cache?.retryCount ?? 0,
              userMessageMetadata: message.metadata });
          }} />}
          <IconButton size="xs" aria-label={t('hostQueue.dismiss')} title={t('hostQueue.dismiss')} icon={<X size={14} />} disabled={busy} onClick={() => void run(() => queue.dismiss(record))} />
        </ChatComposerQueueItemActions>
      </ChatComposerQueueItem>)}
    </ChatComposerQueueList>
  </ChatComposerQueue>;
}
