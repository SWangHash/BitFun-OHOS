import english from '@/locales/en-US/errors.json';

export type ErrorTranslate = (key: string, options?: Record<string, unknown>) => string;

// These are the original BitFun messages carried by existing hosts and saved
// sessions. Match complete messages, including their parameters, rather than
// inferring a user-facing message from an error category or operation.
const templates = Object.entries(english.desktopDomains);
const exact = new Map(templates.filter(([, value]) => !value.includes('{{')).map(([key, value]) => [value, key]));
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parameterPattern = /\{\{(\w+)\}\}/g;
const patterns = templates.filter(([, value]) => value.includes('{{')).map(([key, value]) => {
  const parameters: string[] = [];
  let cursor = 0;
  let source = '';
  for (const match of value.matchAll(parameterPattern)) {
    source += escapeRegex(value.slice(cursor, match.index));
    source += '([\\s\\S]*?)';
    parameters.push(match[1]);
    cursor = match.index! + match[0].length;
  }
  source += escapeRegex(value.slice(cursor));
  return {
    key, parameters, expression: new RegExp(`^${source}$`),
    prefix: value.slice(0, value.indexOf('{{')),
    specificity: value.replace(parameterPattern, '').length,
  };
}).sort((left, right) => right.specificity - left.specificity);

// Only prose/cause parameters are translated recursively. Identifiers, paths,
// commands and provider output parameters retain their original values.
const proseParameters = new Set(['detail', 'details', 'error', 'e', 'msg', 'issues', 'warnings', 'nodeDetail', 'npmDetail']);
const parameterLabels = new Map(Object.entries(english.desktopDomainParameters).map(([key, value]) => [value, key]));

/**
 * Translate a display copy of known product text. Unknown errors keep the
 * original UI representation; this helper does not normalize execution errors.
 */
export function desktopDomainErrorMessage(message: string, t: ErrorTranslate): string {
  const translate = (message: string): string => {
    const key = exact.get(message);
    if (key) return t('errors:desktopDomains.' + key);
    for (const pattern of patterns) {
      if (!message.startsWith(pattern.prefix)) continue;
      const match = pattern.expression.exec(message);
      if (!match) continue;
      const values: Record<string, string> = {};
      pattern.parameters.forEach((parameter, index) => {
        const value = match[index + 1];
        const label = parameter === 'step' ? parameterLabels.get(value) : undefined;
        values[parameter] = label ? t('errors:desktopDomainParameters.' + label)
          : parameter === 'warnings' ? value.split('; ').map(part => translate(part)).join('; ')
          : proseParameters.has(parameter) && value !== message ? translate(value) : value;
      });
      return t('errors:desktopDomains.' + pattern.key, values);
    }
    return message;
  };
  return translate(message);
}
