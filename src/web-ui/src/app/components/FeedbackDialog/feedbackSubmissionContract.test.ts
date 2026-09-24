import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(/\r\n?/g, '\n');

describe('OpenHarmony feedback submission contract', () => {
  it('keeps other platforms on the external GitCode route', () => {
    const footer = readSource('../NavPanel/components/PersistentFooterActions.tsx');

    expect(footer).toContain("systemInfo.platform === 'openharmony'");
    expect(footer).toContain('setShowFeedback(true)');
    expect(footer).toContain("systemAPI.openExternal('https://gitcode.com/BitFun/bitfun_ade/issues')");
  });

  it('shows unread attention only for conversations that can be opened and acknowledged', () => {
    const footer = readSource('../NavPanel/components/PersistentFooterActions.tsx');
    const inbox = readSource('./FeedbackInboxView.tsx');
    const store = readSource('./feedbackInboxStore.ts');

    expect(store).toContain('export function hasActionableUnreadReply');
    expect(store).toContain('record.canOpen && record.hasNewReply');
    expect(footer).toContain('state.records.some(hasActionableUnreadReply)');
    expect(inbox).toContain('hasActionableUnreadReply(record)');
  });

  it('resets the feedback Inbox display window when the dialog closes', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const inbox = readSource('./FeedbackInboxView.tsx');
    const reset = dialog.slice(
      dialog.indexOf('const reset = useCallback'),
      dialog.indexOf('const closeImmediately'),
    );

    expect(dialog).toContain('useState(FEEDBACK_INBOX_PAGE_SIZE)');
    expect(reset).toContain('setInboxVisibleCount(FEEDBACK_INBOX_PAGE_SIZE)');
    expect(inbox).toContain('records.slice(0, visibleCount)');
    expect(inbox).toContain('hasHiddenLoadedRecords || hasMore');
  });

  it('requires total consent before a feedback request in not-accepted mode', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const preparePosition = dialog.indexOf('await feedbackAPI.prepareSubmission({');
    const acceptPosition = dialog.indexOf('await accept({');
    const submitPosition = dialog.indexOf('await submitPreparedFeedback();');

    expect(preparePosition).toBeGreaterThan(0);
    expect(acceptPosition).toBeGreaterThan(preparePosition);
    expect(acceptPosition).toBeGreaterThan(0);
    expect(submitPosition).toBeGreaterThan(acceptPosition);
    expect(dialog).toContain("setSubmitError('PRIVACY_SAVE_FAILED')");
    expect(dialog).toContain('return;');
  });

  it('protects modal draft close without registering ordinary drafts as a host-exit guard', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const layout = readSource('../../layout/AppLayout.tsx');
    const requestClose = dialog.slice(
      dialog.indexOf('const requestClose'),
      dialog.indexOf('const handleContentChange'),
    );
    const exitGuard = dialog.slice(
      dialog.indexOf('useEffect(() => {'),
      dialog.indexOf('if (retryWaitSeconds <= 0)'),
    );

    expect(dialog).toContain('category || content || includeCorrelation || privacyChecked');
    expect(dialog).toContain('if (submitting || replyState.sending) return;');
    expect(dialog).toContain('<DialogClose disabled={submitting || replyState.sending} />');
    expect(dialog).toContain('closeOnPointerOutside={!submitting && !replyState.sending}');
    expect(dialog).toContain('registerCriticalOperationExitGuard');
    expect(layout).toContain('await confirmCriticalOperationExit()');
    expect(layout).toContain('setMainWindowCloseRequestInProgress(true)');
    expect(layout).toContain('setMainWindowCloseRequestInProgress(false)');
    expect(requestClose).toContain('if (isMainWindowCloseRequestInProgress()) return;');
    expect(requestClose.indexOf('isMainWindowCloseRequestInProgress')).toBeLessThan(
      requestClose.indexOf('setShowDiscardConfirm(true)'),
    );
    expect(requestClose).toContain('setShowDiscardConfirm(true)');
    expect(dialog).toContain('subscribeMainWindowCloseRequest(inProgress => {');
    expect(dialog).toContain('setShowDiscardConfirm(false)');
    expect(dialog).toContain('setPendingReplyExit(null)');
    expect(dialog).toContain("t('feedback.discard.title')");
    expect(exitGuard).toContain('if (!submitting && !replyState.sending) return;');
    expect(exitGuard).not.toContain('hasDraft');
  });

  it('opens the read-only privacy statement from inline consent copy', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const privacySection = dialog.slice(
      dialog.indexOf('className="bitfun-feedback__privacy"'),
      dialog.indexOf('{submitError ?'),
    );

    expect(privacySection).toContain('<PrivacyStatementLink');
    expect(privacySection).toContain("t('feedback.privacyConsentPrefix')");
    expect(privacySection).toContain("t('feedback.privacyConsentSuffix')");
    expect(privacySection).not.toContain('feedback.viewPrivacy');
    expect(dialog).toContain('variant="readonly"');
  });

  it('shows a single completion action after capability-backed success', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const styles = readSource('./FeedbackDialog.scss');
    const completeView = dialog.slice(
      dialog.indexOf('className="bitfun-feedback__complete"'),
      dialog.indexOf(') : (\n          <div ref={containerRef}'),
    );
    const completeStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__complete {'),
      styles.indexOf('.bitfun-feedback__inbox-layout {'),
    );

    expect(completeView).toContain("t('shared:statuses.done')");
    expect(completeView).not.toContain('openGitCode');
    expect(completeView).not.toContain('feedback-submit');
    expect(dialog).toContain("size={completed ? 'sm' : '2xl'}");
    expect(dialog).toContain("completed ? ' is-complete' : ''");
    expect(styles).toContain('&.is-complete {');
    expect(styles).toContain('height: auto;');
    expect(completeStyles).not.toContain('min-height:');
    expect(completeStyles).not.toContain('flex: 1;');
  });

  it('makes the active view and session-correlation hierarchy explicit', () => {
    const styles = readSource('./FeedbackDialog.scss');
    const viewSwitch = styles.slice(
      styles.indexOf('.bitfun-feedback__view-switch {'),
      styles.indexOf('.bitfun-feedback__form {'),
    );
    const correlation = styles.slice(
      styles.indexOf('.bitfun-feedback__correlation-control {'),
      styles.indexOf('.bitfun-feedback__privacy {'),
    );

    expect(viewSwitch).toContain('&.is-active {');
    expect(viewSwitch).toContain('border-color: var(--bitfun-color-accent-border);');
    expect(viewSwitch).toContain('background: var(--bitfun-color-accent-surface);');
    expect(viewSwitch).toContain('color: var(--bitfun-color-accent-default);');
    expect(viewSwitch).toContain('font-weight: var(--bitfun-type-label-selected-font-weight);');
    expect(viewSwitch).toContain('&::after {');
    expect(correlation).toContain('gap: 14px;');
    expect(correlation).toContain('font-family: var(--bitfun-type-body-sm-font-family);');
    expect(correlation).toContain('flex-direction: column;');
    expect(correlation).toContain('gap: 4px;');
    expect(correlation).toContain('font-family: var(--bitfun-type-label-md-font-family);');
    expect(correlation).toContain('font-family: var(--bitfun-type-support-font-family);');
  });

  it('does not present an invalid zero-second quota retry', () => {
    const dialog = readSource('./FeedbackDialog.tsx');

    expect(dialog).toContain("feedbackError.retryAfterSeconds > 0");
    expect(dialog).toContain("error.code === 'FEEDBACK_QUOTA_EXCEEDED'");
    expect(dialog).toContain("t('feedback.errors.quotaExceeded')");
    expect(dialog).toContain('submissionRetryUntilMs = Date.now()');
    expect(dialog).toContain('submissionRetrySecondsRemaining');
    expect(dialog).toContain('const submitErrorMessage = retryWaitSeconds > 0');
    expect(dialog).toContain('if (next === 0)');
    expect(dialog).not.toContain('setQuotaBlocked(true)');
    expect(dialog).not.toContain('error.retryAfterSeconds || 0');
  });

  it('renders submission failures with the design-system error alert', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const styles = readSource('./FeedbackDialog.scss');
    const errorStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__error {'),
      styles.indexOf('.bitfun-feedback__actions {'),
    );

    expect(dialog).toContain('Alert,');
    expect(dialog.match(/className="bitfun-feedback__error"/g)).toHaveLength(2);
    expect(dialog.match(/tone="error"/g)).toHaveLength(2);
    expect(dialog.match(/showIcon/g)).toHaveLength(2);
    expect(styles).toContain('.bitfun-feedback__error {\n  flex-shrink: 0;\n  width: 100%;');
    expect(errorStyles).not.toContain(
      'border-left: 3px solid var(--bf-appearance-token-color-error);',
    );
  });

  it('uses the feedback container width for the 840px layout threshold', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const styles = readSource('./FeedbackDialog.scss');

    expect(dialog).toContain('new ResizeObserver');
    expect(dialog).toContain('setWideLayout(width >= 840)');
    expect(styles).toContain('&.is-wide');
    expect(styles).toContain('grid-template-columns: minmax(300px, 36%) minmax(0, 1fr)');
  });

  it('matches the main workspace list scrollbar treatment', () => {
    const styles = readSource('./FeedbackDialog.scss');

    expect(styles).not.toContain('feedback-scroll-container');
    expect(styles).not.toContain('scrollbar-gutter: stable;');
    expect(styles).toContain('overflow-x: hidden;');
    expect(styles).toContain('overflow-y: auto;');
    expect(styles).toContain('width: 3px;');
    expect(styles).toContain('background: var(--bf-appearance-token-border-subtle);');
    expect(styles).toContain('border-radius: 2px;');
  });

  it('preserves pasted whitespace rendering and prevents Inbox text selection', () => {
    const styles = readSource('./FeedbackDialog.scss');
    const contentInput = styles.slice(
      styles.indexOf(".bitfun-feedback__content-input [data-bitfun-part='input'] {"),
      styles.indexOf('.bitfun-feedback__content-meta {'),
    );
    const inboxList = styles.slice(
      styles.indexOf('.bitfun-feedback__inbox-list {'),
      styles.indexOf('.bitfun-feedback__inbox-header,'),
    );
    const replyInput = styles.slice(
      styles.indexOf(".bitfun-feedback__reply-input [data-bitfun-part='input'] {"),
      styles.indexOf('.bitfun-feedback__reply-meta {'),
    );

    expect(contentInput).toContain('overflow-wrap: anywhere;');
    expect(contentInput).toContain('white-space: break-spaces;');
    expect(inboxList).toContain('user-select: none;');
    expect(replyInput).toContain('overflow-wrap: anywhere;');
    expect(replyInput).toContain('white-space: break-spaces;');
    expect(styles.match(/white-space: break-spaces;/g)).toHaveLength(2);
  });

  it('limits feedback paste before replacing the controlled value', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const pasteHandler = dialog.slice(
      dialog.indexOf('const handleContentPaste'),
      dialog.indexOf('const handleContentKeyDown'),
    );

    expect(dialog).toContain('onPaste={handleContentPaste}');
    expect(dialog).toContain('onBeforeInput={handleContentBeforeInput}');
    expect(pasteHandler).toContain('planFeedbackPaste(');
    expect(pasteHandler).toContain('if (!plan.acceptedText && insertedText)');
    expect(pasteHandler).toContain('if (plan.useNativePaste)');
    expect(pasteHandler.indexOf('if (!plan.acceptedText && insertedText)')).toBeLessThan(
      pasteHandler.indexOf('if (plan.useNativePaste)'),
    );
    expect(pasteHandler.slice(
      pasteHandler.indexOf('if (!plan.acceptedText && insertedText)'),
      pasteHandler.indexOf('if (plan.useNativePaste)'),
    )).toContain('event.preventDefault()');
    expect(pasteHandler).toContain('textarea.maxLength = plan.nativeMaxLength');
    expect(pasteHandler).toContain("textarea.removeAttribute('maxlength')");
    expect(pasteHandler).toContain('nativePasteTruncatedRef.current = plan.acceptedText !== insertedText');
    expect(pasteHandler).toContain('setWasTruncated(true)');
    expect(dialog).toContain('const nativePasteTruncated = nativePasteTruncatedRef.current');
    expect(dialog).toContain('nativePasteTruncated\n      || Array.from');
    expect(dialog).toContain('textarea.setRangeText(acceptedText, start, end, \'end\')');
    expect(dialog).toContain('feedbackInsertText(currentValue, start, end, insertedText)');
    expect(dialog).toContain('start === end && feedbackContentLength(currentValue) >= FEEDBACK_CONTENT_MAX_CHARS');
    expect(dialog).toContain('maxLength={contentNativeMaxLength}');
    expect(dialog).toContain("nativeEvent.inputType.startsWith('insert')");
    expect(dialog).toContain('armRejectedInsertionCaret(textarea)');
    expect(dialog).toContain("/^\\s/.test(value) && value.replace(/^\\s+/, '') === content");
    expect(dialog).toContain("document.execCommand('undo')");
  });

  it('matches privacy dialog height and keeps the normal-height form on one non-scrolling page', () => {
    const stylesheetPath = fileURLToPath(new URL('./FeedbackDialog.scss', import.meta.url));
    const dialog = readSource('./FeedbackDialog.tsx');
    const styles = readSource('./FeedbackDialog.scss');
    const privacyStyles = readSource('../Privacy/Privacy.scss');
    const builtStyles = compile(stylesheetPath).css;
    const modalStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__modal-content {'),
      styles.indexOf('.bitfun-feedback__root {'),
    );
    const formStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__form {'),
      styles.indexOf('.bitfun-feedback__field {'),
    );
    const contentStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__content-field {'),
      styles.indexOf('.bitfun-feedback__correlation-control {'),
    );
    const actionStyles = styles.slice(
      styles.indexOf('.bitfun-feedback__actions {'),
      styles.indexOf('.bitfun-feedback__complete {'),
    );

    expect(styles).toContain('padding: 48px clamp(12px, 5.882vw, 40px) 32px;');
    expect(dialog).toContain("size={completed ? 'sm' : '2xl'}");
    expect(dialog).toContain('className="bitfun-feedback__content-input"');
    expect(dialog).toContain('layout="fill"');
    expect(dialog).toContain('resize="none"');
    expect(dialog).toContain('rows={8}');
    expect(modalStyles).toContain('height: 82vh;');
    expect(modalStyles).toContain('min-height: min(72vh, 680px);');
    expect(modalStyles).toContain('max-height: 82vh;');
    expect(privacyStyles).toContain('.bitfun-privacy-dialog {');
    expect(privacyStyles).toContain('height: 82vh;');
    expect(formStyles).toContain('overflow: hidden;');
    expect(formStyles).not.toContain('overflow-y: auto;');
    expect(styles).toContain(".bitfun-feedback__content-input [data-bitfun-part='input'] {");
    expect(contentStyles).toContain('flex: 1 1 0;');
    expect(contentStyles).toContain('overflow: hidden;');
    expect(contentStyles).toContain('height: auto;');
    expect(contentStyles).toContain('min-height: 0;');
    expect(contentStyles).toContain('flex-shrink: 0;');
    expect(contentStyles).not.toContain('height: 100%;');
    expect(contentStyles).not.toContain('min-height: clamp(');
    expect(styles).toContain('.bitfun-feedback__correlation {\n  flex-shrink: 0;');
    expect(styles).toContain('.bitfun-feedback__privacy {\n  display: flex;\n  flex-shrink: 0;');
    expect(styles).toContain('.bitfun-feedback__actions {\n  display: flex;\n  flex-shrink: 0;');
    expect(styles).toContain('--bitfun-feedback-modal-max-height: calc(100vh - 80px);');
    expect(styles).toContain('.bitfun-feedback__root {\n  display: flex;');
    expect(styles).not.toContain('.bitfun-feedback__overlay > .modal');
    expect(styles).not.toContain('min(960px, calc(100vw - 80px))');
    expect(styles).not.toContain('min(620px, calc(100vh - 114px))');
    expect(builtStyles).toContain('padding: 48px clamp(12px, 5.882vw, 40px) 32px;');
    expect(builtStyles).toContain('height: 82vh;');
    expect(builtStyles).not.toContain('min(960px, 100vw - 80px)');
    expect(builtStyles).not.toContain('min(620px, 100vh - 114px)');
    expect(styles).toContain('@media (max-width: 680px) {');
    expect(styles).toContain('@media (max-height: 700px) {');
    expect(styles).toContain('@media (max-height: 600px) {');
    expect(styles).toContain('@media (max-height: 540px) {');
    expect(styles).toContain('--bitfun-feedback-modal-max-height: calc(100vh - 56px);');
    expect(styles).toContain('padding-top: 44px;');
    expect(styles).toContain('padding-bottom: 12px;');
    expect(dialog).toContain('<div className="bitfun-feedback__primary-actions">');
    expect(dialog).not.toContain('bitfun-feedback__action-spacer');
    expect(actionStyles).toContain('display: flex;');
    expect(actionStyles).toContain('flex-wrap: wrap;');
    expect(actionStyles).toContain('width: 100%;');
    expect(actionStyles).toContain('min-width: 0;');
    expect(actionStyles).toContain('.bitfun-feedback__primary-actions {');
    expect(actionStyles).toContain('flex-shrink: 0;');
    expect(actionStyles).toContain('margin-left: auto;');
    expect(actionStyles).not.toContain('grid-template-columns:');
    expect(styles).not.toContain('@media (max-width: 460px)');
  });

  it('uses scrolling instead of overlapping controls when height is constrained', () => {
    const styles = readSource('./FeedbackDialog.scss');
    const compact = styles.slice(
      styles.indexOf('@media (max-height: 600px) {'),
      styles.indexOf('@media (max-height: 540px) {'),
    );

    expect(compact).toContain('overflow-y: auto;');
    expect(compact).toContain('overscroll-behavior: contain;');
    expect(compact).toContain('flex: 0 0 150px;');
    expect(compact).toContain('min-height: 150px;');
    expect(compact).toContain('min-height: 104px;');
    expect(compact).toContain('width: 3px;');
  });

  it('keeps Mock request logs limited to a fixed stage and request id', () => {
    const mock = readSource('../../../../../../scripts/feedback-mock-server.mjs');

    expect(mock).toContain('logRequestStage(requestStage(request.method, url.pathname), requestId);');
    expect(mock).toContain("return method === 'GET' ? 'message_history' : method === 'POST' ? 'reply' : 'unknown';");
    expect(mock).toContain('process.stdout.write(`${JSON.stringify({ stage, requestId })}\\n`);');
    expect(mock).not.toContain('JSON.stringify({ stage, requestId, url');
    expect(mock).not.toContain('JSON.stringify({ stage, requestId, body');
  });
});
