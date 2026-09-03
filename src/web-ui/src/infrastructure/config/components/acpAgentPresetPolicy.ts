export interface AcpClientPreset {
  id: string;
  name: string;
  description: string;
  version?: string;
  command: string;
  args: string[];
}

export type AgentRowStatus =
  | 'enabled'
  | 'disabled'
  | 'ready'
  | 'partial'
  | 'not_installed'
  | 'invalid'
  | 'checking';

export type RequirementIssueKind =
  | 'none'
  | 'cli_missing'
  | 'adapter_missing'
  | 'connection_failed'
  | 'permission_denied'
  | 'path_invalid'
  | 'version_mismatch'
  | 'config_invalid';

// Presets that speak ACP natively and therefore need no separate adapter
// package (their CLI binary is launched directly).
export const NATIVE_ACP_PRESET_IDS = new Set([
  'opencode',
  'kimi-code',
  'qwen-code',
  'codebuddy-code',
  'dsh',
  'omp',
]);

// Presets BitFun cannot install on the user's behalf. The UI hides the
// one-click installer for these while retaining their manual and remote paths.
export const SELF_MANAGED_INSTALL_PRESET_IDS = new Set(['omp']);

const OHOS_SUPPORTED_PRESET_IDS = new Set([
  'kimi-code',
  'qwen-code',
  'codebuddy-code',
]);

export const ALL_ACP_CLIENT_PRESETS: AcpClientPreset[] = [
  {
    id: 'opencode',
    name: 'opencode',
    description: 'Native ACP coding agent.',
    command: 'opencode',
    args: ['acp'],
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    description: 'Native ACP coding agent available through HarmonyBrew.',
    command: 'kimi',
    args: ['acp'],
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    description: 'Native ACP coding agent available through HarmonyBrew.',
    command: 'qwen',
    args: ['--acp'],
  },
  {
    id: 'codebuddy-code',
    name: 'CodeBuddy Code',
    description: 'Native ACP coding agent that runs on HarmonyBrew Node.',
    command: 'codebuddy',
    args: ['--acp'],
  },
  // BitFun ships the ACP bridge for DeepSeek Harness and installs it into the
  // user's own dsh as a profile on first launch, so the only setup left is the
  // harness itself and the model the user picks inside it.
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    description: 'DeepSeek Harness with BitFun\'s bundled ACP bridge. Uses the model and API key configured in dsh.',
    command: 'dsh',
    args: ['--profile', 'bitfun-acp'],
  },
  {
    id: 'omp',
    name: 'Oh My Pi',
    description: 'Native ACP coding agent (omp acp).',
    command: 'omp',
    args: ['acp'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Claude Code via the official ACP adapter.',
    command: 'npx',
    args: ['--yes', '@agentclientprotocol/claude-agent-acp@latest'],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex via the official ACP adapter.',
    command: 'npx',
    args: ['--yes', '@agentclientprotocol/codex-acp@latest'],
  },
];

export function presetsForRuntime(isOhos: boolean): AcpClientPreset[] {
  return ALL_ACP_CLIENT_PRESETS
    .filter(preset => !isOhos || OHOS_SUPPORTED_PRESET_IDS.has(preset.id));
}

export function visiblePresetIdsForRuntime(isOhos: boolean): string[] {
  return presetsForRuntime(isOhos).map(preset => preset.id);
}

export function availableRemotePresetIds(): string[] {
  return Array.from(new Set(ALL_ACP_CLIENT_PRESETS.map(preset => preset.id)));
}

export function canInstallPresetCli({
  isOhos,
  presetId,
  status,
  issueKind,
  hasConfigEntry,
}: {
  isOhos: boolean;
  presetId: string;
  status: AgentRowStatus;
  issueKind: RequirementIssueKind;
  hasConfigEntry: boolean;
}): boolean {
  if (issueKind === 'connection_failed') return false;
  if (isOhos) {
    return OHOS_SUPPORTED_PRESET_IDS.has(presetId)
      && (status === 'not_installed' || (status === 'ready' && !hasConfigEntry));
  }
  return status === 'not_installed' && !SELF_MANAGED_INSTALL_PRESET_IDS.has(presetId);
}

export function isManagedInstallPresetForRuntime({
  isOhos,
  presetId,
}: {
  isOhos: boolean;
  presetId: string;
}): boolean {
  return isOhos && OHOS_SUPPORTED_PRESET_IDS.has(presetId);
}
