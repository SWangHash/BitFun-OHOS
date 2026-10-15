import english from '@/locales/en-US/errors.json';
import { acpReviewErrorMessage, acpReviewErrorText, type ErrorTranslate } from './acpReviewErrors';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function catalog(namespace: string, messages: Record<string, string>) {
  return Object.entries(messages).map(([key, template]) => {
    const parameters: string[] = [];
    let cursor = 0;
    let source = '';
    for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) {
      source += escapeRegex(template.slice(cursor, match.index));
      source += '([\\s\\S]*?)';
      parameters.push(match[1]);
      cursor = match.index! + match[0].length;
    }
    source += escapeRegex(template.slice(cursor));
    return {
      key: `errors:connections.${namespace}.${key}`,
      expression: new RegExp(`^${source}$`), parameters,
      specificity: template.replace(/\{\{\w+\}\}/g, '').length,
    };
  }).sort((a, b) => b.specificity - a.specificity);
}

const ssh = catalog('ssh', english.connections.ssh);
const remoteConnect = catalog('remoteConnect', english.connections.remoteConnect);
type Catalog = ReturnType<typeof catalog>;
const commonWrappers = Object.entries(english.acpReview)
  .filter(([key]) => ['serviceError', 'configurationError', 'otherError', 'ioError',
    'serializationError', 'deserializationError', 'timeout', 'cancelled', 'errorPrefix'].includes(key))
  .map(([key, template]) => ({ key: `errors:acpReview.${key}`, prefix: template.slice(0, template.indexOf('{{')) }));

function translateConnectionError(error: unknown, t: ErrorTranslate, catalogs: Catalog[]): string {
  const translate = (message: string): string => {
    for (const entries of catalogs) {
      for (const entry of entries) {
        const match = entry.expression.exec(message);
        if (!match) continue;
        const values: Record<string, string> = {};
        entry.parameters.forEach((name, index) => {
          const value = match[index + 1];
          // Only authored reasons are translated recursively. Provider output,
          // command names, identities and paths retain their original bytes.
          values[name] = name === 'detail' || name === 'reason' ? translate(value) : value;
          // This context carries the first upload error as "session_id: cause".
          // The identifier is retained; only the authored cause is translated.
          if (name === 'detail' && message.startsWith('session backup incomplete: uploaded ')) {
            const separator = value.indexOf(': ');
            if (separator >= 0) values[name] = value.slice(0, separator + 2) + translate(value.slice(separator + 2));
          }
          if (name === 'stage') {
            const stage = Object.entries(english.connections.sshStages).find(([, label]) => label === value);
            const jump = /^jump-(\d+)$/.exec(value);
            if (stage) values[name] = t(`errors:connections.sshStages.${stage[0]}`);
            else if (jump) values[name] = t('errors:connections.sshStages.jump', { index: jump[1] });
          }
        });
        return t(entry.key, values);
      }
    }
    // anyhow contexts may append a lower-level cause to an exact authored
    // context. Preserve that cause, including all of its external diagnostics.
    for (const entries of catalogs) {
      for (const entry of entries) {
        if (entry.parameters.length) continue;
        const separator = message.indexOf(': ');
        if (separator < 0 || !entry.expression.test(message.slice(0, separator))) continue;
        return `${t(entry.key)}: ${translate(message.slice(separator + 2))}`;
      }
    }
    for (const { prefix, key } of commonWrappers) {
      if (!message.startsWith(prefix)) continue;
      const detail = message.slice(prefix.length);
      const localized = translate(detail);
      if (localized !== detail) {
        return t(key, { detail: localized });
      }
    }
    return acpReviewErrorMessage(message, t);
  };
  return translate(acpReviewErrorText(error));
}

export function sshErrorMessage(error: unknown, t: ErrorTranslate): string {
  return translateConnectionError(error, t, [ssh]);
}

export function remoteConnectErrorMessage(error: unknown, t: ErrorTranslate): string {
  // Account device provisioning can carry an SSH-owned error from its target.
  return translateConnectionError(error, t, [remoteConnect, ssh]);
}
