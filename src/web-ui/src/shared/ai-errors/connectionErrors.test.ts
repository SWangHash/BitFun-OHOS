import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en-US/errors.json';
import cn from '@/locales/zh-CN/errors.json';
import tw from '@/locales/zh-TW/errors.json';
import { remoteConnectErrorMessage, sshErrorMessage } from './connectionErrors';

const resources = { 'en-US': { errors: en }, 'zh-CN': { errors: cn }, 'zh-TW': { errors: tw } };

describe('desktop connection error presentation', () => {
  it('preserves the distinct authored messages and parameters in each locale', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources, interpolation: { escapeValue: false } });
    for (const locale of Object.keys(resources)) {
      await i18n.changeLanguage(locale);
      for (const [domain, translate] of [['ssh', sshErrorMessage], ['remoteConnect', remoteConnectErrorMessage]] as const) {
        for (const [key, template] of Object.entries(en.connections[domain])) {
          const values: Record<string, string> = {};
          const message = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
            values[name] = `value-${name}`;
            return values[name];
          });
          expect(translate(message, i18n.t.bind(i18n)), `${locale}: ${domain}.${key}`)
            .toBe(i18n.t(`errors:connections.${domain}.${key}`, values));
        }
      }
    }
  });

  it('keeps credentials, missing connections, timeouts and routing transitions distinct', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources, interpolation: { escapeValue: false } });
    const t = i18n.t.bind(i18n);
    const messages = [
      'SSH password is required (no saved password for this connection)',
      'Not connected', 'Connection timeout', 'Connection failed',
    ].map(message => sshErrorMessage(new Error(message), t));
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages.every(message => !/[a-z]{4}/i.test(message.replace('SSH', '')))).toBe(true);
    expect(remoteConnectErrorMessage('account context changed', t)).toBe('账号上下文已变化');
    expect(remoteConnectErrorMessage('device routing changed', t)).toBe('设备路由已变化');
  });

  it('translates nested owned causes and preserves external diagnostics and paths', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources, interpolation: { escapeValue: false } });
    const t = i18n.t.bind(i18n);
    const cause = 'Telegram bot token not configured. Please set bot token first.';
    expect(remoteConnectErrorMessage({ message: 'Host command failed', details: {
      originalError: `start remote connect: ${cause}`,
    } }, t)).toBe('启动远控连接失败：尚未配置 Telegram 机器人令牌，请先设置令牌。');
    const external = 'SSH: channel 4: open failed: connect failed: Connection refused';
    expect(sshErrorMessage(external, t)).toBe(external);
    expect(sshErrorMessage(`Service error: Failed to read remote file 'C:/<repo>&a': ${external}`, t))
      .toBe(`服务错误：读取远程文件“C:/<repo>&a”失败：${external}`);
    expect(sshErrorMessage('target SSH handshake timed out after 20 seconds', t))
      .toBe('目标 的 SSH 握手在 20 秒后超时');
    expect(remoteConnectErrorMessage('session backup incomplete: uploaded 2 of 4; session-1: account sync cancelled', t))
      .toBe('会话备份未完成：已上传 2 个，共 4 个；session-1: 账号同步已取消');
  });
});
