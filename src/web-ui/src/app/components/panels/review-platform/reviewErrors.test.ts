import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import en from '@/locales/en-US/common.json';
import zh from '@/locales/zh-CN/common.json';
import tw from '@/locales/zh-TW/common.json';
import flowChatZh from '@/locales/zh-CN/flow-chat.json';
import { reviewPlatformErrorMessage } from './reviewErrors';
import { reviewErrorText, reviewAuthErrorMessage } from './reviewErrors';

describe('Pull Requests missing Git message', () => {
  it('uses the selected locale and updates an existing error after language changes', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'zh-CN',
      fallbackLng: 'en-US',
      resources: {
        'zh-CN': { common: zh },
        'en-US': { common: en },
        'zh-TW': { common: tw },
      },
    });
    const error = createTauriCommandError(
      'review_platform_get_workspace_snapshot',
      'git_unavailable: Git is unavailable.',
    );
    const translate = (key: string) => i18n.t(key);

    expect(reviewPlatformErrorMessage(error, translate)).toBe(
      'Git 不可用。请在运行此工作区的环境中安装 Git 并将其加入 PATH，然后重试。',
    );
    await i18n.changeLanguage('en-US');
    expect(reviewPlatformErrorMessage(error, translate)).toBe(en.reviewPlatform.errors.gitUnavailable);
    await i18n.changeLanguage('zh-TW');
    expect(reviewPlatformErrorMessage(error, translate)).toBe(tw.reviewPlatform.errors.gitUnavailable);
  });

  it('retains the stable error through Peer and JSON-RPC wrappers used by workspace loading', () => {
    const code = 'git_unavailable: Git is unavailable.';
    // Echo the key: a fixed translation would pass even if the code were misread.
    const translate = (key: string) => key;
    for (const originalError of [
      { message: 'Host command failed', details: { originalError: code } },
      Object.assign(new Error('Invalid params'), { code: -32602, data: code }),
    ]) {
      const error = createTauriCommandError('review_platform_get_workspace_context', originalError);
      expect(reviewPlatformErrorMessage(error, translate)).toBe('common:reviewPlatform.errors.gitUnavailable');
    }
  });

  it('keeps other failures distinct from missing Git and localizes the unknown-error fallback', () => {
    const translate = (key: string) => key;
    for (const message of [
      'Invalid repository path: No such file or directory',
      'Failed to execute git command: Permission denied',
    ]) {
      expect(reviewPlatformErrorMessage(new Error(message), translate))
        .toBe('common:reviewPlatform.errors.loadFailed');
    }
    expect(reviewPlatformErrorMessage({}, translate)).toBe('common:reviewPlatform.errors.loadFailed');
  });

  it('keeps the specific cause of a Review launch failure instead of the generic fallback', () => {
    const launchError = Object.assign(new Error('Failed to create review session.'), {
      launchErrorMessageKey: 'deepReviewActionBar.launchError.modelConfig',
    });
    const translate = (key: string, options?: Record<string, unknown>) =>
      key === 'flow-chat:deepReviewActionBar.launchError.modelConfig'
        ? flowChatZh.deepReviewActionBar.launchError.modelConfig
        : String(options?.defaultValue ?? key);

    expect(reviewPlatformErrorMessage(launchError, translate, 'reviewFailed'))
      .toBe(flowChatZh.deepReviewActionBar.launchError.modelConfig);
    // A translator without the flow-chat namespace still yields the readable default.
    expect(reviewPlatformErrorMessage(launchError, (_key, options) => String(options?.defaultValue), 'reviewFailed'))
      .toBe('Failed to create review session.');
  });
});

describe('Review-platform user-visible failures', () => {
  it('localizes each backend failure code through wrapped transports', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { common: zh } } });
    const t = (key: string) => i18n.t(key);
    for (const [code, translated] of Object.entries(zh.reviewPlatform.errors)) {
      if (['gitUnavailable', 'repositoryUntrusted', 'loadFailed'].includes(code)) continue;
      const error = createTauriCommandError('review_platform_get_pull_request_detail_page', {
        message: 'Host command failed',
        details: { originalError: 'review_platform_error:' + code + ': internal English diagnostic' },
      });
      expect(reviewPlatformErrorMessage(error, t)).toBe(translated);
    }
    expect(reviewPlatformErrorMessage(new Error('secret internal diagnostic'), t, 'saveTokenFailed'))
      .toBe(zh.reviewPlatform.messages.saveTokenFailed);
  });

  it('keeps validation messages specific in English and translates only failure messages while preserving ordinary status text', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { common: en }, 'zh-CN': { common: zh } } });
    const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
    expect(reviewPlatformErrorMessage('Token is required.', t, 'saveTokenFailed')).toBe('Token is required.');
    await i18n.changeLanguage('zh-CN');
    for (const key of ['headUnavailable', 'noActionsJob', 'reviewResultUnavailable'] as const) {
      expect(reviewErrorText(en.reviewPlatform.messages[key], t)).toBe(zh.reviewPlatform.messages[key]);
    }
    const challenge = { platform: 'gitlab', host: 'git.example', state: 'insufficient_scope' } as const;
    expect(reviewAuthErrorMessage({ ...challenge, remoteId: 'origin', projectPath: 'example/repo', message: 'English backend text', requiredScopes: [] }, t))
      .toBe(zh.reviewPlatform.auth.insufficientScope.replace('{{host}}', 'git.example'));
    expect(reviewErrorText('Provider-authored job description', t)).toBe('Provider-authored job description');
    expect(reviewErrorText('Review complete · 2 findings · high · limited coverage', t))
      .toBe('Review complete · 2 findings · high · limited coverage');
    expect(reviewErrorText('Review complete · 0 findings · limited coverage', t))
      .toBe('Review complete · 0 findings · limited coverage');
  });
});
