import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import cn from '@/locales/zh-CN/errors.json';
import {
  buildLaunchCleanupError,
  createDeepReviewLaunchError,
  getDeepReviewLaunchErrorMessage,
  isSessionMissingError,
  normalizeErrorMessage,
  type FailedDeepReviewCleanupResult,
} from './launchErrors';

describe('Deep Review launch errors', () => {
  it('normalizes empty and string errors', () => {
    expect(normalizeErrorMessage(' network down ')).toBe('network down');
    expect(normalizeErrorMessage(new Error(' model missing '))).toBe('model missing');
    expect(normalizeErrorMessage(null)).toBe('Review failed to start');
  });

  it('recognizes missing-session cleanup failures as non-fatal', () => {
    expect(isSessionMissingError(new Error('Session does not exist'))).toBe(true);
    expect(isSessionMissingError(new Error('session not found'))).toBe(true);
    expect(isSessionMissingError(new Error('permission denied'))).toBe(false);
    const wrapped = Object.assign(new Error('Host command failed'), {
      details: { originalError: 'session not found' },
    });
    expect(isSessionMissingError(wrapped)).toBe(false);
    expect(getDeepReviewLaunchErrorMessage(
      createDeepReviewLaunchError('create_child_session', wrapped), (key) => key,
    )).toBe('session not found');
  });

  it('preserves the cause while retaining recovery classification', () => {
    const error = createDeepReviewLaunchError(
      'send_start_message',
      new Error('SSE stream connection timeout'),
      'child-123',
      { cleanupCompleted: true, cleanupIssues: [] },
    );

    expect(error.message).toBe('SSE stream connection timeout');
    expect(error.launchErrorMessageKey).toBe('deepReviewActionBar.launchError.network');
    expect(error.launchErrorCategory).toBe('network');
    expect(error.childSessionId).toBe('child-123');
    expect(
      getDeepReviewLaunchErrorMessage(error, (key) => `translated:${key}`),
    ).toBe('SSE stream connection timeout');
  });

  it('localizes each cleanup failure and keeps the original cause', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { errors: cn } } });
    const cleanup = { cleanupCompleted: false, cleanupIssues: [
      'Failed to delete the backend Review session: EACCES',
      'Failed to remove the local Review session state: disk full',
    ] };
    const wrapped = buildLaunchCleanupError('open_aux_pane', 'child-123', new Error('socket closed'), cleanup);
    const error = createDeepReviewLaunchError('open_aux_pane', wrapped, 'child-123', cleanup);
    const message = getDeepReviewLaunchErrorMessage(error, i18n.t.bind(i18n));
    expect(message).toContain('socket closed');
    expect(message).toContain('child-123');
    expect(message).toContain('EACCES');
    expect(message).toContain('disk full');
    expect(message).not.toContain('Failed to');
    expect(message).not.toContain('preparing the Review session');
  });

  it('keeps original launch error when cleanup completed', () => {
    const original = new Error('Session preparation failed');
    const cleanupResult: FailedDeepReviewCleanupResult = {
      cleanupCompleted: true,
      cleanupIssues: [],
    };

    expect(buildLaunchCleanupError(
      'open_aux_pane',
      'child-123',
      original,
      cleanupResult,
    )).toBe(original);
  });

  it('adds cleanup context when cleanup is incomplete', () => {
    const cleanupResult: FailedDeepReviewCleanupResult = {
      cleanupCompleted: false,
      cleanupIssues: ['Failed to remove local state.'],
    };

    expect(buildLaunchCleanupError(
      'open_aux_pane',
      'child-123',
      new Error('Session preparation failed'),
      cleanupResult,
    ).message).toContain('The partially created Review session (child-123) may need manual cleanup.');
  });
});
