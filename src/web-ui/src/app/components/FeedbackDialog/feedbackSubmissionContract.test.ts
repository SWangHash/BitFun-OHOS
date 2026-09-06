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
    expect(footer).toContain("systemAPI.openExternal('https://gitcode.com/OpenBitFun/openbitfun_ade/issues')");
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

  it('counts the privacy checkbox as draft state and freezes close while submitting', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const layout = readSource('../../layout/AppLayout.tsx');

    expect(dialog).toContain('category || content || includeCorrelation || privacyChecked');
    expect(dialog).toContain('if (submitting || replyState.sending) return;');
    expect(dialog).toContain('<DialogClose disabled={submitting || replyState.sending} />');
    expect(dialog).toContain('closeOnPointerOutside={!submitting && !replyState.sending}');
    expect(dialog).toContain('registerCriticalOperationExitGuard');
    expect(layout).toContain('await confirmCriticalOperationExit()');
  });

  it('opens the read-only privacy statement from inline consent copy', () => {
    const dialog = readSource('./FeedbackDialog.tsx');
    const privacySection = dialog.slice(
      dialog.indexOf('className="openbitfun-feedback__privacy"'),
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
      dialog.indexOf('className="openbitfun-feedback__complete"'),
      dialog.indexOf(') : (\n          <div ref={containerRef}'),
    );
    const completeStyles = styles.slice(
      styles.indexOf('.openbitfun-feedback__complete {'),
      styles.indexOf('.openbitfun-feedback__inbox-layout {'),
    );

    expect(completeView).toContain("t('shared:statuses.done')");
    expect(completeView).not.toContain('openGitCode');
    expect(completeView).not.toContain('feedback-submit');
    expect(dialog).toContain('maxWidth: completed ? 560 : 960');
    expect(completeStyles).not.toContain('min-height:');
    expect(completeStyles).not.toContain('flex: 1;');
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

  it('limits feedback paste before replacing the controlled value', () => {
    const dialog = readSource('./FeedbackDialog.tsx');

    expect(dialog).toContain('onPaste={handleContentPaste}');
    expect(dialog).toContain('onBeforeInput={handleContentBeforeInput}');
    expect(dialog).toContain('textarea.setRangeText(acceptedText, start, end, \'end\')');
    expect(dialog).toContain('feedbackInsertText(currentValue, start, end, insertedText)');
    expect(dialog).toContain('start === end && feedbackContentLength(currentValue) >= FEEDBACK_CONTENT_MAX_CHARS');
    expect(dialog).toContain('maxLength={contentNativeMaxLength}');
    expect(dialog).toContain("nativeEvent.inputType.startsWith('insert')");
    expect(dialog).toContain('armRejectedInsertionCaret(textarea)');
    expect(dialog).toContain("/^\\s/.test(value) && value.replace(/^\\s+/, '') === content");
    expect(dialog).toContain("document.execCommand('undo')");
  });

  it('keeps the dialog below the host window controls at every supported size', () => {
    const stylesheetPath = fileURLToPath(new URL('./FeedbackDialog.scss', import.meta.url));
    const dialog = readSource('./FeedbackDialog.tsx');
    const styles = readSource('./FeedbackDialog.scss');
    const builtStyles = compile(stylesheetPath).css;
    const actionStyles = styles.slice(
      styles.indexOf('.openbitfun-feedback__actions {'),
      styles.indexOf('.openbitfun-feedback__complete {'),
    );

    expect(styles).toContain('padding: 48px clamp(12px, 5.882vw, 40px) 32px;');
    expect(styles).toContain('padding: 22px clamp(18px, 3.824vw, 26px) 24px;');
    expect(dialog).toContain('dimensions={{');
    expect(dialog).toContain("width: '100%'");
    expect(dialog).toContain('maxWidth: completed ? 560 : 960');
    expect(dialog).toContain("maxHeight: 'var(--openbitfun-feedback-modal-max-height)'");
    expect(styles).toContain('--openbitfun-feedback-modal-max-height: calc(100vh - 80px);');
    expect(styles).toContain('height: calc(100vh - 114px);');
    expect(styles).toContain('max-height: 620px;');
    expect(styles).toContain('.openbitfun-feedback__root {\n  width: 100%;');
    expect(styles).not.toContain('.openbitfun-feedback__overlay > .modal');
    expect(styles).not.toContain('min(960px, calc(100vw - 80px))');
    expect(styles).not.toContain('min(620px, calc(100vh - 114px))');
    expect(builtStyles).toContain('padding: 48px clamp(12px, 5.882vw, 40px) 32px;');
    expect(builtStyles).toContain('height: calc(100vh - 114px);');
    expect(builtStyles).not.toContain('min(960px, 100vw - 80px)');
    expect(builtStyles).not.toContain('min(620px, 100vh - 114px)');
    expect(styles).toContain('@media (max-width: 680px) {');
    expect(styles).toContain('@media (max-height: 540px) {');
    expect(styles).toContain('--openbitfun-feedback-modal-max-height: calc(100vh - 56px);');
    expect(styles).toContain('padding-top: 44px;');
    expect(styles).toContain('padding-bottom: 12px;');
    expect(dialog).toContain('<div className="openbitfun-feedback__primary-actions">');
    expect(dialog).not.toContain('openbitfun-feedback__action-spacer');
    expect(actionStyles).toContain('display: flex;');
    expect(actionStyles).toContain('flex-wrap: wrap;');
    expect(actionStyles).toContain('width: 100%;');
    expect(actionStyles).toContain('min-width: 0;');
    expect(actionStyles).toContain('.openbitfun-feedback__primary-actions {');
    expect(actionStyles).toContain('flex-shrink: 0;');
    expect(actionStyles).toContain('margin-left: auto;');
    expect(actionStyles).not.toContain('grid-template-columns:');
    expect(styles).not.toContain('@media (max-width: 460px)');
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
