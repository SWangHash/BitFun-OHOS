import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, RefreshCw, Send } from 'lucide-react';
import { Button, ConfirmDialog, IconButton, Textarea } from '@openbitfun/ui';
import { usePrivacy } from '@/app/components/Privacy/PrivacyContext';
import { PrivacyStatementDialog } from '@/app/components/Privacy/PrivacyStatementDialog';
import { useImeOwnedKeyGuard } from '@/flow_chat/hooks/useImeOwnedKeyGuard';
import {
  feedbackAPI,
  FeedbackApiError,
  FEEDBACK_CONTENT_MAX_CHARS,
  feedbackInsertText,
  type FeedbackMessage,
  type FeedbackRecordSummary,
  feedbackContentLength,
  truncateFeedbackContent,
} from '@/infrastructure/api';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { PrivacyStatementLink } from './PrivacyStatementLink';
import { useFeedbackInboxStore } from './feedbackInboxStore';
import { useRejectedInsertionCaret } from './useRejectedInsertionCaret';

interface FeedbackConversationViewProps {
  record: FeedbackRecordSummary;
  resetDraftVersion: number;
  onInteractionStateChange: (state: { hasDraft: boolean; sending: boolean }) => void;
}

type ReplyError = FeedbackApiError | 'PRIVACY_SAVE_FAILED' | null;

export const FeedbackConversationView: React.FC<FeedbackConversationViewProps> = ({
  record,
  resetDraftVersion,
  onInteractionStateChange,
}) => {
  const { t, formatDate } = useI18n('common');
  const { status, accept } = usePrivacy();
  const {
    isImeOwnedKey: isImeEnter,
    handleCompositionStart,
    handleCompositionEnd,
  } = useImeOwnedKeyGuard();
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<FeedbackApiError | null>(null);
  const [ackError, setAckError] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftTruncated, setDraftTruncated] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<ReplyError>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { armRejectedInsertionCaret, restoreRejectedInsertionCaret } = useRejectedInsertionCaret();
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const visibleAdminTimesRef = useRef(new Set<string>());
  const lastReadThroughRef = useRef<string | null>(null);
  const queuedReadThroughRef = useRef<string | null>(null);
  const ackInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const recordHasNewReplyRef = useRef(record.hasNewReply);
  const refreshedReconciledUnreadRef = useRef(false);
  recordHasNewReplyRef.current = record.hasNewReply;
  const applyServerStatus = useFeedbackInboxStore(state => state.applyServerStatus);
  const markInaccessible = useFeedbackInboxStore(state => state.markInaccessible);
  const refreshInbox = useFeedbackInboxStore(state => state.refresh);
  const draftLength = feedbackContentLength(draft);
  const draftNativeMaxLength = draftLength >= FEEDBACK_CONTENT_MAX_CHARS
    ? draft.length
    : undefined;
  const canReply = Boolean(draft.trim()) && !sending && record.status !== 'resolved';

  useEffect(() => {
    onInteractionStateChange({ hasDraft: Boolean(draft.trim()), sending });
  }, [draft, onInteractionStateChange, sending]);

  useEffect(() => () => {
    onInteractionStateChange({ hasDraft: false, sending: false });
  }, [onInteractionStateChange]);

  useEffect(() => {
    setDraft('');
    setDraftTruncated(false);
    setReplyError(null);
    setShowConsent(false);
  }, [resetDraftVersion]);

  const handleConversationError = useCallback((caught: unknown) => {
    const normalized = caught instanceof FeedbackApiError
      ? caught
      : new FeedbackApiError('SERVICE_UNAVAILABLE', 'Feedback service is unavailable', true);
    if (isConversationAccessError(normalized.code)) {
      markInaccessible(record.feedbackId);
      return;
    }
    setError(normalized);
  }, [markInaccessible, record.feedbackId]);

  const loadLatest = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    if (!manual) setError(null);
    try {
      const page = await feedbackAPI.openConversation({ feedbackId: record.feedbackId });
      if (!mountedRef.current) return;
      setMessages(current => manual ? mergeMessages(current, page.messages) : page.messages);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(page.syncError ?? null);
      if (
        recordHasNewReplyRef.current
        && !page.syncError
        && !refreshedReconciledUnreadRef.current
      ) {
        refreshedReconciledUnreadRef.current = true;
        void refreshInbox(true);
      }
      // Refresh can append newly arrived messages to the existing list. Wait
      // for the merged list to render, then keep the conversation at its tail.
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    } catch (caught) {
      if (mountedRef.current) handleConversationError(caught);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [handleConversationError, record.feedbackId, refreshInbox]);

  const loadEarlier = useCallback(async () => {
    const container = scrollRef.current;
    if (!container || !hasMore || !nextCursor || loadingEarlier || refreshing) return;
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    setLoadingEarlier(true);
    setError(null);
    try {
      const page = await feedbackAPI.openConversation({
        feedbackId: record.feedbackId,
        cursor: nextCursor,
      });
      if (!mountedRef.current) return;
      setMessages(current => mergeMessages(page.messages, current));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      requestAnimationFrame(() => {
        const current = scrollRef.current;
        if (current) current.scrollTop = previousTop + current.scrollHeight - previousHeight;
      });
    } catch (caught) {
      if (mountedRef.current) handleConversationError(caught);
    } finally {
      if (mountedRef.current) setLoadingEarlier(false);
    }
  }, [handleConversationError, hasMore, loadingEarlier, nextCursor, record.feedbackId, refreshing]);

  const flushReadAcknowledgement = useCallback(async () => {
    if (ackInFlightRef.current || document.visibilityState !== 'visible') return;
    ackInFlightRef.current = true;
    try {
      while (queuedReadThroughRef.current) {
        const requested = queuedReadThroughRef.current;
        queuedReadThroughRef.current = null;
        try {
          const result = await feedbackAPI.acknowledgeFeedback(record.feedbackId, requested);
          if (!mountedRef.current) return;
          lastReadThroughRef.current = laterTimestamp(
            lastReadThroughRef.current,
            result.readThrough,
          );
          applyServerStatus(record.feedbackId, result.feedbackStatus);
          setAckError(false);
          await refreshInbox(true);
        } catch (caught) {
          if (!mountedRef.current) return;
          const normalized = caught instanceof FeedbackApiError ? caught : null;
          if (normalized && isConversationAccessError(normalized.code)) {
            markInaccessible(record.feedbackId);
          } else {
            setAckError(true);
          }
          queuedReadThroughRef.current = null;
          break;
        }
      }
    } finally {
      ackInFlightRef.current = false;
    }
  }, [applyServerStatus, markInaccessible, record.feedbackId, refreshInbox]);

  const queueVisibleAcknowledgement = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const latestVisible = [...visibleAdminTimesRef.current].reduce<string | null>(
      (latest, value) => laterTimestamp(latest, value),
      null,
    );
    if (!latestVisible || !isLaterTimestamp(latestVisible, lastReadThroughRef.current)) return;
    queuedReadThroughRef.current = laterTimestamp(
      queuedReadThroughRef.current,
      latestVisible,
    );
    void flushReadAcknowledgement();
  }, [flushReadAcknowledgement]);

  const executeReply = useCallback(async (content: string) => {
    try {
      const result = await feedbackAPI.replyFeedback(record.feedbackId, content);
      if (!mountedRef.current) return;
      setMessages(current => mergeMessages(current, [result.message]));
      setDraft('');
      setDraftTruncated(false);
      setReplyError(null);
      applyServerStatus(record.feedbackId, result.feedbackStatus);
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    } catch (caught) {
      if (!mountedRef.current) return;
      const normalized = caught instanceof FeedbackApiError
        ? caught
        : new FeedbackApiError('SERVICE_UNAVAILABLE', 'Feedback service is unavailable', true);
      if (isConversationAccessError(normalized.code)) {
        markInaccessible(record.feedbackId);
      }
      setReplyError(normalized);
    }
  }, [applyServerStatus, markInaccessible, record.feedbackId]);

  const sendReply = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || record.status === 'resolved') return;
    setSending(true);
    setReplyError(null);
    await executeReply(content);
    if (mountedRef.current) setSending(false);
  }, [draft, executeReply, record.status, sending]);

  const requestReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canReply) return;
    if (status?.effectiveMode !== 'full') {
      setShowConsent(true);
      return;
    }
    void sendReply();
  };

  const handleReplyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && (
        event.key.length === 1
        || event.key === 'Process'
        || event.nativeEvent.keyCode === 229
      )
    ) {
      const textarea = event.currentTarget;
      if (
        textarea.selectionStart === textarea.selectionEnd
        && feedbackContentLength(textarea.value) >= FEEDBACK_CONTENT_MAX_CHARS
      ) {
        armRejectedInsertionCaret(textarea);
      }
    }
    if (event.key !== 'Enter' || isImeEnter(event)) return;
    if (event.ctrlKey) {
      const textarea = event.currentTarget;
      if (
        textarea.selectionStart === textarea.selectionEnd
        && feedbackContentLength(textarea.value) >= FEEDBACK_CONTENT_MAX_CHARS
      ) {
        armRejectedInsertionCaret(textarea);
        // Let native maxLength reject the newline without touching undo state.
        return;
      }
      event.preventDefault();
      applyFeedbackInsertion(event.currentTarget, '\n');
      return;
    }
    // Enter sends the reply; Ctrl+Enter inserts a newline.
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const acceptAndSend = async () => {
    const content = draft.trim();
    if (!content || sending || !status?.policy) return;
    setSending(true);
    setReplyError(null);
    try {
      await accept({
        policyUpdatedAt: status.policy.updatedAt,
        consentVersion: status.policy.consentVersion,
        documentSha256: status.policy.documentSha256,
        locale: status.policy.locale,
      });
    } catch {
      if (mountedRef.current) {
        setReplyError('PRIVACY_SAVE_FAILED');
        setSending(false);
      }
      return;
    }
    if (mountedRef.current) setShowConsent(false);
    await executeReply(content);
    if (mountedRef.current) setSending(false);
  };

  const handleDraftChange = (textarea: HTMLTextAreaElement) => {
    const value = textarea.value;
    if (/^\s/.test(value) && value.replace(/^\s+/, '') === draft) {
      document.execCommand('undo');
      return;
    }
    const truncated = truncateFeedbackContent(value);
    setDraftTruncated(Array.from(value.replace(/^\s+/, '')).length > FEEDBACK_CONTENT_MAX_CHARS);
    setDraft(truncated);
    setReplyError(null);
  };

  const applyFeedbackInsertion = (textarea: HTMLTextAreaElement, insertedText: string) => {
    const currentValue = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end && feedbackContentLength(currentValue) >= FEEDBACK_CONTENT_MAX_CHARS) {
      return;
    }
    const acceptedText = feedbackInsertText(currentValue, start, end, insertedText);
    if (acceptedText && document.execCommand('insertText', false, acceptedText)) {
      // execCommand preserves the browser's native undo transaction for a
      // paste, unlike replacing the controlled value in onChange.
    } else {
      textarea.setRangeText(acceptedText, start, end, 'end');
    }
    const candidate = currentValue.slice(0, start) + insertedText + currentValue.slice(end);
    setDraftTruncated(feedbackContentLength(candidate.replace(/^\s+/, '')) > FEEDBACK_CONTENT_MAX_CHARS);
  };

  const handleDraftPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    if (
      textarea.selectionStart === textarea.selectionEnd
      && feedbackContentLength(textarea.value) >= FEEDBACK_CONTENT_MAX_CHARS
    ) {
      armRejectedInsertionCaret(textarea);
      // Let the native maxLength gate reject the paste without creating a
      // JavaScript edit boundary in the browser's undo history.
      return;
    }
    event.preventDefault();
    applyFeedbackInsertion(textarea, event.clipboardData.getData('text/plain'));
  };

  const handleDraftBeforeInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    const textarea = event.currentTarget;
    if (
      nativeEvent.inputType.startsWith('insert')
      && textarea.selectionStart === textarea.selectionEnd
      && feedbackContentLength(textarea.value) >= FEEDBACK_CONTENT_MAX_CHARS
    ) {
      armRejectedInsertionCaret(textarea);
      return;
    }
    if (
      textarea.selectionStart === textarea.selectionEnd
      && feedbackContentLength(textarea.value) >= FEEDBACK_CONTENT_MAX_CHARS
    ) {
      // Native maxLength owns full-input rejection so the browser does not
      // create a JavaScript edit boundary that consumes the next undo.
      return;
    }
    const insertedText = nativeEvent.inputType === 'insertLineBreak'
      || nativeEvent.inputType === 'insertParagraph'
      ? '\n'
      : nativeEvent.data;
    if (
      !['insertText', 'insertLineBreak', 'insertParagraph'].includes(nativeEvent.inputType)
      || nativeEvent.isComposing
      || insertedText == null
    ) {
      return;
    }
    const acceptedText = feedbackInsertText(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      insertedText,
    );
    if (acceptedText === insertedText) return;
    event.preventDefault();
    applyFeedbackInsertion(textarea, insertedText);
  };

  useEffect(() => {
    mountedRef.current = true;
    setMessages([]);
    setNextCursor(undefined);
    setHasMore(false);
    setError(null);
    setAckError(false);
    visibleAdminTimesRef.current.clear();
    lastReadThroughRef.current = null;
    queuedReadThroughRef.current = null;
    refreshedReconciledUnreadRef.current = false;
    void loadLatest(false);
    return () => {
      mountedRef.current = false;
    };
  }, [loadLatest, record.feedbackId]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadEarlier();
    }, { root, threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadEarlier, messages.length]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const elements = Array.from(
      root.querySelectorAll<HTMLElement>('[data-admin-created-at]'),
    );
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const createdAt = (entry.target as HTMLElement).dataset.adminCreatedAt;
        if (!createdAt) continue;
        if (entry.isIntersecting) visibleAdminTimesRef.current.add(createdAt);
        else visibleAdminTimesRef.current.delete(createdAt);
      }
      queueVisibleAcknowledgement();
    }, { root, threshold: 0.6 });
    elements.forEach(element => observer.observe(element));
    const onVisibilityChange = () => queueVisibleAcknowledgement();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [messages, queueVisibleAcknowledgement]);

  return (
    <div className="openbitfun-feedback__conversation">
      <div className="openbitfun-feedback__conversation-toolbar">
        <span>{t('feedback.conversation.messages')}</span>
        <IconButton
          type="button"
          variant="quiet"
          size="sm"
          aria-label={t('feedback.conversation.refresh')}
          disabled={loading || refreshing || loadingEarlier || sending}
          loading={refreshing}
          icon={<RefreshCw size={15} aria-hidden="true" />}
          onClick={() => void loadLatest(true)}
        />
      </div>
      {error || ackError ? (
        <div className="openbitfun-feedback__conversation-notices">
          {error ? (
            <div className="openbitfun-feedback__message-error" role="alert">
              <span>{conversationErrorText(error.code, t)}</span>
              <Button
                type="button"
                variant="text"
                size="sm"
                disabled={sending}
                onClick={() => void loadLatest(true)}
              >
                {t('feedback.actions.retry')}
              </Button>
            </div>
          ) : null}
          {ackError ? (
            <div className="openbitfun-feedback__message-notice" role="status">
              {t('feedback.conversation.ackFailed')}
            </div>
          ) : null}
        </div>
      ) : null}
      <div ref={scrollRef} className="openbitfun-feedback__messages" aria-live="polite">
        <div ref={topSentinelRef} className="openbitfun-feedback__message-sentinel" aria-hidden="true" />
        {loading || loadingEarlier ? (
          <div className="openbitfun-feedback__message-state" role="status">
            {loadingEarlier
              ? t('feedback.conversation.loadingEarlier')
              : t('feedback.conversation.loading')}
          </div>
        ) : null}
        {!loading && !refreshing && messages.length === 0 && !error ? (
          <div className="openbitfun-feedback__message-empty">
            {t('feedback.conversation.empty')}
          </div>
        ) : null}
        {messages.map(message => (
          <article
            key={message.messageId}
            className={`openbitfun-feedback__message is-${message.sender}${message.contentDeleted ? ' is-content-deleted' : ''}`}
            data-content-deleted={message.contentDeleted ? 'true' : undefined}
            data-admin-created-at={message.sender === 'admin' ? message.createdAt : undefined}
          >
            <header>
              <strong>{message.sender === 'admin'
                ? t('feedback.conversation.admin')
                : t('feedback.conversation.you')}</strong>
              <time dateTime={message.createdAt}>
                {formatMessageDate(message.createdAt, formatDate)}
              </time>
            </header>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
      {record.status === 'resolved' ? (
        <div className="openbitfun-feedback__resolved-notice">
          <LockKeyhole size={14} aria-hidden="true" />
          {t('feedback.conversation.resolvedReadonly')}
        </div>
      ) : (
        <form className="openbitfun-feedback__reply" onSubmit={requestReply}>
          <Textarea
            value={draft}
            maxLength={draftNativeMaxLength}
            rows={3}
            disabled={sending}
            aria-label={t('feedback.reply.input')}
            placeholder={t('feedback.reply.placeholder')}
            onKeyDown={handleReplyKeyDown}
            onKeyUp={event => restoreRejectedInsertionCaret(event.currentTarget)}
            onInput={event => restoreRejectedInsertionCaret(event.currentTarget)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={event => {
              handleCompositionEnd();
              restoreRejectedInsertionCaret(event.currentTarget);
            }}
            onPaste={handleDraftPaste}
            onBeforeInput={handleDraftBeforeInput}
            onChange={event => handleDraftChange(event.target)}
          />
          <div className="openbitfun-feedback__reply-meta" aria-live="polite">
            <span>{draftTruncated ? t('feedback.contentTruncated') : ''}</span>
            <span>{draftLength}/2000</span>
          </div>
          {replyError ? (
            <div className="openbitfun-feedback__reply-error" role="alert">
              {replyErrorText(replyError, t)}
            </div>
          ) : null}
          <div className="openbitfun-feedback__reply-actions">
            <Button
              type="submit"
              disabled={!canReply}
              loading={sending}
              variant="primary"
              leadingIcon={<Send size={15} aria-hidden="true" />}
            >
              {replyError instanceof FeedbackApiError && replyError.retryable
                ? t('feedback.reply.retry')
                : t('feedback.reply.send')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={showConsent}
        onOpenChange={() => {
          if (!sending) setShowConsent(false);
        }}
        onConfirm={() => void acceptAndSend()}
        title={t('feedback.reply.consentTitle')}
        message={(
          <div className="openbitfun-feedback__consent-message">
            {replyError === 'PRIVACY_SAVE_FAILED' ? (
              <span>{t('feedback.reply.consentSaveFailed')}</span>
            ) : null}
            <span>
              {t('feedback.reply.consentPrefix')}
              <PrivacyStatementLink
                disabled={sending}
                onClick={() => setShowPrivacy(true)}
              />
              {t('feedback.reply.consentSuffix')}
            </span>
          </div>
        )}
        confirmText={t('feedback.reply.consentConfirm')}
        cancelText={t('feedback.actions.cancel')}
        pendingAction={sending ? 'confirm' : null}
      />
      <PrivacyStatementDialog
        isOpen={showPrivacy}
        onClose={() => setShowPrivacy(false)}
        variant="readonly"
      />
    </div>
  );
};

function mergeMessages(first: FeedbackMessage[], second: FeedbackMessage[]): FeedbackMessage[] {
  const merged = new Map<string, FeedbackMessage>();
  [...first, ...second].forEach(message => merged.set(message.messageId, message));
  return [...merged.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
      || left.messageId.localeCompare(right.messageId));
}

function laterTimestamp(left: string | null, right: string): string {
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function isLaterTimestamp(value: string, current: string | null): boolean {
  return !current || Date.parse(value) > Date.parse(current);
}

function isConversationAccessError(code: string): boolean {
  return [
    'CAPABILITY_UNAVAILABLE',
    'CAPABILITY_INVALID',
    'CAPABILITY_EXPIRED',
    'CAPABILITY_REVOKED',
    'CAPABILITY_REQUIRED',
    'FEEDBACK_ACCESS_DENIED',
    'FEEDBACK_ACCESS_UNAVAILABLE',
    'FEEDBACK_ACCESS_EXPIRED',
    'FEEDBACK_NOT_FOUND',
  ].includes(code);
}

function conversationErrorText(code: string, t: (key: string) => string): string {
  if (code === 'CACHE_SAVE_FAILED' || code === 'CACHE_RESET_FAILED') {
    return t('feedback.conversation.cacheFailed');
  }
  return t('feedback.conversation.syncFailed');
}

function replyErrorText(error: ReplyError, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (!error) return '';
  if (error === 'PRIVACY_SAVE_FAILED') return t('feedback.reply.privacySaveFailed');
  if (error.code === 'FEEDBACK_ALREADY_RESOLVED') return t('feedback.reply.resolved');
  if (error.code === 'RATE_LIMITED' || error.code === 'FEEDBACK_QUOTA_EXCEEDED') {
    return t('feedback.reply.rateLimited', { seconds: error.retryAfterSeconds ?? 0 });
  }
  if (error.code === 'REQUEST_TIMEOUT') return t('feedback.reply.timeout');
  if (error.code === 'NETWORK_ERROR' || error.code === 'SERVICE_UNAVAILABLE') {
    return t('feedback.reply.network');
  }
  return t('feedback.reply.failed', { code: error.code });
}

function formatMessageDate(
  value: string,
  formatDate: (date: Date | number, options?: Intl.DateTimeFormatOptions) => string,
): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return formatDate(timestamp, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
