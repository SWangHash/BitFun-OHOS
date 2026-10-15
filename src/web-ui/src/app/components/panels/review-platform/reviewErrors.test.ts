import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en-US/errors.json';
import cn from '@/locales/zh-CN/errors.json';
import common from '@/locales/zh-CN/common.json';
import tw from '@/locales/zh-TW/errors.json';
import { reviewPlatformErrorMessage, reviewAuthErrorMessage } from './reviewErrors';

describe('Review-platform specific failures', () => {
  it('keeps empty PR, missing revisions and missing diff failures distinct when switching languages', async () => {
    const i18n = createInstance();
    const resources = { 'en-US': { errors: en }, 'zh-CN': { errors: cn, common }, 'zh-TW': { errors: tw } };
    await i18n.init({ lng: 'en-US', resources });
    const messages = [
      'The pull request contains no reviewable changed files.',
      'The provider did not return immutable base and head revisions for this pull request.',
      'The provider did not return an exact diff for any changed file in this pull request.',
    ];
    for (const locale of Object.keys(resources)) {
      await i18n.changeLanguage(locale);
      const translated = messages.map(message => reviewPlatformErrorMessage(new Error(message), i18n.t.bind(i18n)));
      expect(new Set(translated).size).toBe(3);
      if (locale === 'en-US') expect(translated).toEqual(messages);
      else for (const message of translated) expect(message).toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('uses concrete backend details even when two errors have the same stable code', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { errors: cn, common } } });
    const t = i18n.t.bind(i18n);
    expect(reviewPlatformErrorMessage('review_platform_error:remoteNotFound: provider remote was not found', t))
      .toBe(t('errors:acpReview.legacyPlatformRemote'));
    expect(reviewPlatformErrorMessage('review_platform_error:networkFailed: provider network request failed', t))
      .toBe(t('errors:acpReview.legacyPlatformNetwork'));
    expect(reviewPlatformErrorMessage('review_platform_error:remoteNotFound: Remote not found: origin', t))
      .toBe('未找到远程仓库：origin');
    expect(reviewPlatformErrorMessage('review_platform_error:remoteNotFound: Remote not found: upstream', t))
      .toBe('未找到远程仓库：upstream');
    expect(reviewPlatformErrorMessage('Token is required.', t)).toBe(common.reviewPlatform.messages.tokenRequired);
    expect(reviewPlatformErrorMessage('This link is not a supported pull request URL.', t)).toBe(common.reviewPlatform.messages.unsupportedLink);
    expect(reviewPlatformErrorMessage('git_unavailable: Git is unavailable.', t)).toBe('Git 不可用。');
    expect(reviewPlatformErrorMessage('spawn git EACCES', t)).toBe('spawn git EACCES');
  });

  it('translates the auth challenge itself without replacing its cause by a platform summary', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { errors: cn, common } } });
    const challenge = { platform: 'gitlab', host: 'git.example', state: 'invalid', remoteId: 'origin', projectPath: 'example/repo' } as const;
    const message = 'Update GitLab token for git.example: the saved or environment token was rejected.';
    const translated = reviewAuthErrorMessage({ ...challenge, requiredScopes: [], message }, i18n.t.bind(i18n));
    expect(translated).toContain('GitLab');
    expect(translated).toContain('git.example');
    expect(translated).toMatch(/[\u3400-\u9fff]/);
    expect(translated).not.toBe(message);
  });
});
