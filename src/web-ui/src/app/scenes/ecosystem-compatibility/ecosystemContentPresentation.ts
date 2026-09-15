import type { ExternalMcpImportDispositionV1 } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import type { EcosystemImportItem } from './ecosystemCompatibilityModel';

export type ContentUsageState = 'available' | 'approvalRequired' | 'disabled' | 'conflict'
  | 'blocked' | 'runtimeUnavailable' | 'runtimeFailed' | 'configurationChanged' | 'unknown';

/** Translate owner facts for display only. Missing/new host states never imply usability. */
export function contentUsageState(state?: string): ContentUsageState {
  switch (state) {
    case 'active': case 'available': return 'available';
    case 'approval_required': return 'approvalRequired';
    case 'disabled': case 'declined': return 'disabled';
    case 'conflict': return 'conflict';
    case 'invalid': case 'restricted': case 'blocked': case 'unsupported': return 'blocked';
    case 'unavailable': case 'runtime_unavailable': return 'runtimeUnavailable';
    case 'load_failed': return 'runtimeFailed';
    case 'configuration_changed': return 'configurationChanged';
    default: return 'unknown';
  }
}

export type ContentState = ContentUsageState | 'checking' | 'discoveryDisabled'
  | 'discoveryUnavailable' | 'notDetected' | 'discoveryUnsupported' | 'discovered'
  | 'importUnsupported' | 'unsupportedContext' | 'ready' | 'readyRename' | 'review'
  | 'imported' | 'unavailable';

interface ContentFacts {
  item: EcosystemImportItem;
  discoveryState: 'checking' | 'discoveryDisabled' | 'discoveryUnavailable' | 'notDetected';
  catalogFailed: boolean;
  imported: boolean;
  localImportSupported: boolean;
  skillImportSupported: boolean;
  hookImportSupported: boolean;
  planLoading: boolean;
  mcpDisposition?: ExternalMcpImportDispositionV1;
}

export interface ContentPresentation {
  state: ContentState;
  descriptionKey?: string;
  canImport: boolean;
}

/** Independent discovery, copy and use facts, compressed into one row without changing owner policy. */
export function presentEcosystemContent(facts: ContentFacts): ContentPresentation {
  const { item } = facts;
  const result = (state: ContentState, descriptionKey?: string): ContentPresentation => ({
    state, descriptionKey, canImport: state === 'ready' || state === 'readyRename' || state === 'review',
  });
  if (facts.imported || facts.mcpDisposition === 'already_imported') {
    return result('imported', item.kind === 'mcp' ? 'content.mcpImportedDescription'
      : item.kind === 'hook' ? 'content.hookImportedDescription' : 'content.importedDescription');
  }
  if (!item.discovered && item.discoverySupport === 'unsupported') return result('discoveryUnsupported');
  if (facts.catalogFailed && item.detection === 'catalog') {
    return result('discoveryUnavailable', 'discovery.unavailableDescription');
  }
  // A cached entry is not evidence that the latest scan completed or discovery is enabled.
  if (facts.discoveryState !== 'notDetected') {
    const key = facts.discoveryState === 'checking' ? 'loading'
      : facts.discoveryState === 'discoveryDisabled' ? 'discovery.disabledDescription'
        : 'discovery.unavailableDescription';
    return result(facts.discoveryState, key);
  }
  if (!item.discovered) return result('notDetected', 'import.undetectedDescription');
  if (item.kind === 'instruction') return result('discovered', 'content.instructions.readOnly');
  if (['command', 'tool', 'subagent'].includes(item.kind)) {
    const usage = item.usageState ?? 'unknown';
    return result(usage === 'unknown' ? 'discovered' : usage, `content.directUse.${usage}`);
  }
  if (item.kind === 'hook' && !facts.hookImportSupported) {
    return result('discovered', 'content.hookDiscoveryOnly');
  }
  if (!facts.localImportSupported) return result('unsupportedContext', 'content.unsupportedContext');
  if (item.kind === 'skill') return facts.skillImportSupported ? result('ready')
    : result('importUnsupported', 'content.skillImportUnsupported');
  if (item.kind === 'hook') return result('review');
  if (item.kind !== 'mcp') return result('discovered', 'content.previewOnly');
  if (facts.planLoading) return result('checking', 'loading');
  if (facts.mcpDisposition === 'eligible') return result('ready');
  if (facts.mcpDisposition === 'automatic_rename') return result('readyRename');
  return result('unavailable');
}
