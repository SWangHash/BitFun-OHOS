import {
  classifyRelayFailure,
  relayFailureAction,
  type RelayFailureAction,
} from '../../../shared/relay-transport/RelayFailure';

/** The banner sentence and next step for a relay/account failure. */
export interface DeviceFailurePresentation {
  /** i18n key of the banner sentence. */
  key: string;
  /** Next step the banner can offer; the sentence itself carries the instruction. */
  action: RelayFailureAction;
}

/**
 * Reduce a relay/account failure to mobile copy through the shared classifier.
 * HTTP status and exception text never reach the sentence: `fallbackKey` keeps
 * the caller's own context (load vs switch) for an unclassified failure and
 * `authKey` keeps the existing expired-session sentence.
 */
export function deviceFailurePresentation(
  value: unknown,
  fallbackKey: string,
  authKey: string,
): DeviceFailurePresentation {
  const kind = classifyRelayFailure(value);
  const action = relayFailureAction(kind);
  switch (kind) {
    case 'relay-version-retired':
      return { key: 'devices.failureRelayVersionRetired', action };
    case 'client-outdated':
      return { key: 'devices.failureClientOutdated', action };
    case 'network':
      return { key: 'devices.failureNetwork', action };
    case 'relay-unavailable':
      return { key: 'devices.failureRelayUnavailable', action };
    case 'auth':
      // The expired / absent account session keeps its existing sentence and flow.
      return { key: authKey, action };
    default:
      return { key: fallbackKey, action };
  }
}
