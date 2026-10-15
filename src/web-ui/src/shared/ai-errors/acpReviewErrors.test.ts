import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en-US/errors.json';
import cn from '@/locales/zh-CN/errors.json';
import tw from '@/locales/zh-TW/errors.json';
import { acpReviewErrorMessage, acpReviewErrorText } from './acpReviewErrors';

const resources = { 'en-US': { errors: en }, 'zh-CN': { errors: cn }, 'zh-TW': { errors: tw } };

describe('ACP and Review error presentation', () => {
  it('preserves every authored message and its parameters across all supported locales', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources, interpolation: { escapeValue: false } });
    for (const locale of Object.keys(resources)) {
      await i18n.changeLanguage(locale);
      for (const [key, template] of Object.entries(en.acpReview)) {
        const values: Record<string, string> = {};
        const original = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
          values[name] = name === 'httpStatus' ? '503' : `value-${name}`;
          return values[name];
        });
        expect(acpReviewErrorMessage(original, i18n.t.bind(i18n)), `${locale}: ${key}`)
          .toBe(i18n.t(`errors:acpReview.${key}`, values));
      }
    }
  });

  it('keeps nested external diagnostics and literal paths intact', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources, interpolation: { escapeValue: false } });
    const t = i18n.t.bind(i18n);
    expect(acpReviewErrorMessage('Service error: Failed to execute git command: spawn git EACCES', t))
      .toBe('服务错误：执行 Git 命令失败：spawn git EACCES');
    const path = 'C:/work/<project>&repo';
    expect(acpReviewErrorMessage(`git_repository_untrusted: ${path}`, t))
      .toBe(`仓库目录的所有权尚未受信任：${path}`);
    const external = 'SSH: channel 4: open failed: connect failed: Connection refused';
    expect(acpReviewErrorMessage(external, t)).toBe(external);
    expect(acpReviewErrorMessage(`review_platform_error:networkFailed: Network error: ${external}`, t))
      .toBe(`网络错误：${external}`);
  });

  it('reads original failures through local, Peer and JSON-RPC envelopes', () => {
    const original = 'The pull request contains no reviewable changed files.';
    for (const error of [
      new Error(original),
      { message: 'Host command failed', details: { originalError: original } },
      { message: 'Invalid params', code: -32602, data: { message: original } },
      { message: 'Unknown error', context: { originalError: { message: original } } },
      { message: 'Review failed to start', originalMessage: original },
    ]) expect(acpReviewErrorText(error)).toBe(original);
  });
});
