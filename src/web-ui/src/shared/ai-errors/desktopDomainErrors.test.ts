import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en-US/errors.json';
import cn from '@/locales/zh-CN/errors.json';
import tw from '@/locales/zh-TW/errors.json';
import { desktopDomainErrorMessage } from './desktopDomainErrors';

async function translator(language = 'zh-CN') {
  const i18n = createInstance();
  await i18n.init({ lng: language, resources: { 'en-US': { errors: en }, 'zh-CN': { errors: cn }, 'zh-TW': { errors: tw } }, interpolation: { escapeValue: false } });
  return i18n.t.bind(i18n);
}

describe('desktop domain error presentation', () => {
  it('keeps different visible Review and ACP causes distinct', async () => {
    const t = await translator();
    expect(desktopDomainErrorMessage('There are no workspace changes to review.', t))
      .toBe(t('errors:desktopDomains.reviewEmptyWorkspace'));
    expect(desktopDomainErrorMessage('The requested files or directories contain no workspace changes.', t))
      .toBe(t('errors:desktopDomains.reviewScopeEmpty'));
    const timeout = desktopDomainErrorMessage("Failed to install remote ACP agent CLI 'agent-code': command timed out", t);
    const cancelled = desktopDomainErrorMessage("Failed to install remote ACP agent CLI 'agent-code': command was cancelled", t);
    expect(timeout).toBe(t('errors:desktopDomains.acpRemoteCliInstallTimeout', { package: 'agent-code' }));
    expect(cancelled).toBe(t('errors:desktopDomains.acpRemoteCliInstallCancelled', { package: 'agent-code' }));
    expect(timeout).not.toBe(cancelled);
  });

  it('translates BitFun wrappers without changing external diagnostics or path parameters', async () => {
    const t = await translator();
    const external = 'SSH: channel 4: open failed: connect failed: Connection refused';
    expect(desktopDomainErrorMessage(external, t)).toBe(external);
    const nested = desktopDomainErrorMessage('Service error: start remote connect: Relay connection failed: ' + external, t);
    expect(nested).toContain(external);
    expect(nested).not.toContain('Service error:');
    expect(nested).not.toContain('start remote connect:');
    expect(nested).not.toContain('Relay connection failed:');
    const path = 'C:/work/<project>&repo/There are no workspace changes to review.';
    const original = "Failed to open remote file '" + path + "': EACCES";
    const localized = desktopDomainErrorMessage(original, t);
    expect(localized).toContain(path);
    expect(localized).toContain('EACCES');
    expect(localized).not.toBe(original);
  });

  it('leaves unknown envelopes and withdrawn internal diagnostics unchanged', async () => {
    const t = await translator();
    for (const original of [
      '', '  provider policy denied this request  ', 'expected object',
      'ACP client timed out after 30s',
      "Timed out restoring ACP session options for client-1",
      'Review platform authentication is required.',
      'review_platform_error:networkFailed: Network error: ECONNRESET',
      'deep_review_resume_blocked',
      'base64 decode ssh vault entry',
      'ssh vault entry too short',
      'utf8 decode ssh vault password',
      'Reverse port forwarding is not supported yet',
    ]) {
      expect(desktopDomainErrorMessage(original, t)).toBe(original);
    }
  });

  it('preserves every retained message in English, including parameter values', async () => {
    const t = await translator('en-US');
    for (const template of Object.values(en.desktopDomains)) {
      const original = template.replace(/\{\{(\w+)\}\}/g, (_, parameter: string) =>
        parameter === 'step' ? 'creating the Review session' : 'external-value/<id>&path');
      expect(desktopDomainErrorMessage(original, t)).toBe(original);
    }
    const traditional = await translator('zh-TW');
    expect(desktopDomainErrorMessage('There are no workspace changes to review.', traditional))
      .toBe(traditional('errors:desktopDomains.reviewEmptyWorkspace'));
  });
});
