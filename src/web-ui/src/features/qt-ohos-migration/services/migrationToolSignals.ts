/**
 * Lightweight bridge between flow-chat tool events and the migration panel.
 *
 * `ToolEventModule` calls `reportMigrationToolEvent` for every Started /
 * Completed / Failed event. Classification is cheap and dependency-free so the
 * hot tool-event path does not pull in panel code.
 *
 * Three kinds of signals are emitted:
 *  - `skill`    — the agent invoked the `qt-harmonyos-migration` skill;
 *  - `script`   — a terminal tool ran one of the skill's scripts;
 *  - `activity` — any other tool call made by a session already known to be a
 *                 migration session (feeds the panel's "current action" row).
 */

import { MIGRATION_SCRIPT_NAMES, MIGRATION_SKILL_NAME, isSkillAssetPath } from '../model/ledgerSchema';

export type MigrationToolPhase = 'started' | 'completed' | 'failed';

export interface MigrationTodoItem {
  content: string;
  status: string;
}

export interface MigrationToolResult {
  /** Terminal output (or the assistant-facing result text). */
  output?: string;
  exitCode?: number;
  error?: string;
}

export interface MigrationToolSignal {
  kind: 'skill' | 'script' | 'activity';
  phase: MigrationToolPhase;
  sessionId: string;
  toolId?: string;
  toolName: string;
  /** Script file name for `kind === 'script'`. */
  script?: string;
  /**
   * Ledger roots (`…/migration/ohos`) or app roots mentioned by the call,
   * explicit `--target` values first. Skill-internal paths are never included.
   */
  pathHints: string[];
  /**
   * Feature-package directories (the skill's `features/`) named by the call:
   * `--features-root` values, else `<skill>/features` next to the script run.
   * Relative entries resolve against `workdir`.
   */
  featuresRootHints?: string[];
  /** Working directory of a terminal call; base for relative hints. */
  workdir?: string;
  /** One-line description: command, file path or search pattern. */
  summary: string;
  /** The call writes a ledger file under `migration/ohos`. */
  ledgerWrite: boolean;
  /** Full list of a `TodoWrite` call. */
  todos?: MigrationTodoItem[];
  result?: MigrationToolResult;
}

export interface MigrationToolEventPayload {
  phase: MigrationToolPhase;
  sessionId: string;
  toolId?: string;
  toolName: string | undefined;
  input: unknown;
  /** Raw `Completed` result object / string. */
  rawResult?: unknown;
  resultForAssistant?: string;
  error?: string;
}

type Listener = (signal: MigrationToolSignal) => void;
export type Classified = Omit<MigrationToolSignal, 'phase' | 'sessionId' | 'toolId' | 'result'>;

const listeners = new Set<Listener>();

/**
 * Sessions that invoked the skill, ran one of its scripts or touched a ledger.
 * Persisted so a session restored after an app restart is still recognized:
 * a resumed migration rarely loads the skill again.
 */
const MIGRATION_SESSIONS_KEY = 'bitfun:qt-ohos-migration:sessions:v1';
const MAX_REMEMBERED_SESSIONS = 50;
let migrationSessions: Set<string> | null = null;

function knownSessions(): Set<string> {
  if (migrationSessions) return migrationSessions;
  migrationSessions = new Set<string>();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MIGRATION_SESSIONS_KEY) ?? '[]');
    if (Array.isArray(stored)) {
      for (const id of stored) if (typeof id === 'string' && id) migrationSessions.add(id);
    }
  } catch {
    // Unreadable storage: start empty, sessions are re-learned from tool calls.
  }
  return migrationSessions;
}

/** Mark `sessionId` as a migration session (newest last, bounded, persisted). */
export function rememberMigrationSession(sessionId: string): void {
  const sessions = knownSessions();
  if (sessions.has(sessionId)) return;
  sessions.add(sessionId);
  while (sessions.size > MAX_REMEMBERED_SESSIONS) {
    const oldest = sessions.values().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  try {
    localStorage.setItem(MIGRATION_SESSIONS_KEY, JSON.stringify([...sessions]));
  } catch {
    // Ignore storage failures: the session stays known for this app run.
  }
}

const TERMINAL_TOOL_NAMES = new Set(['Bash', 'ExecCommand', 'Shell', 'RunCommand']);
const FILE_WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'Delete']);
const SCRIPT_RE = new RegExp(
  `(?:^|[\\s"'\\\\/])(${MIGRATION_SCRIPT_NAMES.map((name) => name.replace('.', '\\.')).join('|')})(?=$|[\\s"'])`,
);
/** Options whose value is a skill-internal path, never an application path. */
const SKILL_PATH_OPTIONS = new Set(['--template-root', '--skill-root', '--kb-root', '--knowledge-root', '--features-root']);
const FEATURES_ROOT_OPTION = '--features-root';
const TARGET_OPTIONS = new Set(['--target', '--app-root', '--migration-root']);
const LEDGER_PATH_RE = /^(.*?[\\/]?migration[\\/]ohos)(?:[\\/]|$)/i;
/** Skill scripts that only read the ledgers. */
const READ_ONLY_SCRIPTS = new Set(['ledger_query.py', 'queue_status.py', 'scan_qt_api_gap.py', 'next_step.py']);
/** `feature_hooks.py` subcommands that do not write the ledgers. */
const READ_ONLY_FEATURE_COMMANDS = new Set(['lint', 'list', 'candidates', 'status']);
const SCRIPT_PATH_RE = new RegExp(
  `^(.*)[\\\\/]scripts[\\\\/](?:${MIGRATION_SCRIPT_NAMES.map((name) => name.replace('.', '\\.')).join('|')})$`,
);
const SUMMARY_MAX_LENGTH = 160;
const OUTPUT_MAX_LENGTH = 16_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function commandText(input: Record<string, unknown>): string {
  for (const key of ['command', 'cmd']) {
    const candidate = input[key];
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) return candidate.filter((part) => typeof part === 'string').join(' ');
  }
  return '';
}

function unquote(token: string): string {
  return token.replace(/^["']|["']$/g, '');
}

function tokenize(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

/**
 * Extract application path hints from a command line: explicit `--target` /
 * `--app-root` values first, then any `…/migration/ohos` path. Values of
 * `--template-root` / `--skill-root` and paths inside the skill are skipped —
 * the skill ships a `migration/ohos` template that is not an application ledger.
 */
export function extractPathHints(command: string): string[] {
  const targets: string[] = [];
  const ledgers: string[] = [];
  const tokens = tokenize(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = unquote(tokens[index]);
    const [option, inlineValue] = token.startsWith('--') && token.includes('=')
      ? [token.slice(0, token.indexOf('=')), unquote(token.slice(token.indexOf('=') + 1))]
      : [token, undefined];
    if (SKILL_PATH_OPTIONS.has(option)) {
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (TARGET_OPTIONS.has(option)) {
      const value = inlineValue ?? (tokens[index + 1] ? unquote(tokens[index + 1]) : '');
      if (inlineValue === undefined) index += 1;
      if (value && !isSkillAssetPath(value)) targets.push(value);
      continue;
    }
    const ledgerMatch = token.match(LEDGER_PATH_RE);
    if (ledgerMatch && ledgerMatch[1] && !isSkillAssetPath(token)) {
      ledgers.push(ledgerMatch[1]);
    }
  }
  return [...new Set([...targets, ...ledgers])];
}

/**
 * Feature-package roots named by a command line: explicit `--features-root`
 * values, else `<skill>/features` for a skill script invoked by path
 * (`…/qt-harmonyos-migration/scripts/feature_gate.py` → `…/qt-harmonyos-migration/features`).
 */
export function extractFeaturesRootHints(command: string): string[] {
  const explicit: string[] = [];
  const implied: string[] = [];
  const tokens = tokenize(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = unquote(tokens[index]);
    if (token === FEATURES_ROOT_OPTION) {
      const next = tokens[index + 1] ? unquote(tokens[index + 1]) : '';
      if (next && !next.startsWith('-')) explicit.push(next);
      index += 1;
      continue;
    }
    if (token.startsWith(`${FEATURES_ROOT_OPTION}=`)) {
      const inline = unquote(token.slice(FEATURES_ROOT_OPTION.length + 1));
      if (inline) explicit.push(inline);
      continue;
    }
    const script = token.match(SCRIPT_PATH_RE);
    if (script && script[1]) {
      const sep = script[1].includes('\\') && !script[1].includes('/') ? '\\' : '/';
      implied.push(`${script[1]}${sep}features`);
    }
  }
  return [...new Set(explicit.length > 0 ? explicit : implied)];
}

/** First positional argument after `script` (the subcommand of a multi-command script). */
function subcommandAfter(command: string, script: string): string | undefined {
  const tokens = tokenize(command).map(unquote);
  const start = tokens.findIndex((token) => token === script || token.endsWith(`/${script}`) || token.endsWith(`\\${script}`));
  if (start < 0) return undefined;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === FEATURES_ROOT_OPTION) {
      index += 1;
      continue;
    }
    if (!token.startsWith('-')) return token;
  }
  return undefined;
}

function shortenPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (path.length <= 48 || parts.length <= 3) return path;
  return `…/${parts.slice(-3).join('/')}`;
}

function clip(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > SUMMARY_MAX_LENGTH ? `${single.slice(0, SUMMARY_MAX_LENGTH - 1)}…` : single;
}

/** Shorten long path tokens so the interesting part of a command stays visible. */
function summarizeCommand(command: string): string {
  return clip(tokenize(command).map((raw) => {
    const token = unquote(raw);
    return /[\\/]/.test(token) && token.length > 48 && !token.includes('=') ? shortenPath(token) : raw;
  }).join(' '));
}

function writeTargetPath(toolName: string, input: Record<string, unknown>): string {
  const direct = text(input.file_path) || text(input.path) || text(input.target_file);
  if (direct) return direct;
  if (toolName === 'Write') {
    // BitFun `Write` carries "+++ <path>\n<content>" in `payload`.
    const payload = text(input.payload);
    const firstLine = payload.slice(0, payload.indexOf('\n') < 0 ? payload.length : payload.indexOf('\n')).replace(/\r$/, '');
    if (firstLine.startsWith('+++ ')) return firstLine.slice(4).trim();
  }
  return '';
}

function todoItems(input: Record<string, unknown>): MigrationTodoItem[] | undefined {
  if (!Array.isArray(input.todos)) return undefined;
  return input.todos
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map((entry) => ({ content: text(entry.content), status: text(entry.status) }))
    .filter((entry) => entry.content);
}

function describeTool(toolName: string, input: Record<string, unknown>): Classified {
  const base: Classified = { kind: 'activity', toolName, pathHints: [], summary: '', ledgerWrite: false };
  if (TERMINAL_TOOL_NAMES.has(toolName)) {
    const command = commandText(input);
    return {
      ...base,
      summary: summarizeCommand(command),
      pathHints: extractPathHints(command),
      workdir: text(input.workdir) || text(input.cwd) || undefined,
    };
  }
  if (toolName === 'TodoWrite') {
    const todos = todoItems(input);
    const current = todos?.find((todo) => todo.status === 'in_progress') ?? todos?.find((todo) => todo.status === 'pending');
    return { ...base, todos, summary: clip(current?.content ?? '') };
  }
  if (toolName === 'Grep' || toolName === 'Glob') {
    const scope = text(input.path) || text(input.glob);
    return { ...base, summary: clip([text(input.pattern), scope && shortenPath(scope)].filter(Boolean).join('  ·  ')) };
  }
  if (toolName === 'Skill') {
    return { ...base, summary: clip(text(input.command)) };
  }
  const path = writeTargetPath(toolName, input);
  if (path) {
    const inLedger = LEDGER_PATH_RE.test(path) && !isSkillAssetPath(path);
    return {
      ...base,
      summary: clip(shortenPath(path)),
      pathHints: inLedger ? extractPathHints(`"${path}"`) : [],
      ledgerWrite: inLedger && FILE_WRITE_TOOL_NAMES.has(toolName),
    };
  }
  return base;
}

/**
 * Classify a tool call. `skill` / `script` mark a migration step; everything
 * else is `activity` (only reported for sessions already tied to a migration).
 */
export function classifyMigrationToolEvent(toolName: string, input: unknown): Classified | null {
  const record = asRecord(input);
  if (!record) return null;
  const described = describeTool(toolName, record);
  if (toolName === 'Skill') {
    const command = text(record.command).trim();
    const normalized = command.replace(/^\$/, '').split(/[\s:]/)[0];
    return normalized === MIGRATION_SKILL_NAME ? { ...described, kind: 'skill' } : described;
  }
  if (TERMINAL_TOOL_NAMES.has(toolName)) {
    const command = commandText(record);
    const match = command.match(SCRIPT_RE);
    if (!match) return described;
    const script = match[1];
    const readOnly = READ_ONLY_SCRIPTS.has(script)
      || (script === 'feature_hooks.py' && READ_ONLY_FEATURE_COMMANDS.has(subcommandAfter(command, script) ?? ''));
    const featuresRootHints = extractFeaturesRootHints(command);
    return {
      ...described,
      kind: 'script',
      script,
      ledgerWrite: !readOnly && script !== 'feature_register.py',
      ...(featuresRootHints.length > 0 ? { featuresRootHints } : {}),
    };
  }
  return described;
}

/** Normalize a `Completed` / `Failed` payload into output text + exit code. */
export function extractToolResult(
  rawResult: unknown,
  resultForAssistant?: string,
  error?: string,
): MigrationToolResult | undefined {
  const record = asRecord(rawResult);
  let output = typeof rawResult === 'string' ? rawResult : '';
  let exitCode: number | undefined;
  if (record) {
    output = text(record.output) || text(record.stdout) || text(record.content);
    const code = record.exit_code ?? record.exitCode;
    if (typeof code === 'number') exitCode = code;
  }
  if (!output) output = resultForAssistant ?? '';
  if (!output && exitCode === undefined && !error) return undefined;
  return {
    output: output ? output.slice(-OUTPUT_MAX_LENGTH) : undefined,
    exitCode,
    error: error || undefined,
  };
}

export function isMigrationSession(sessionId: string): boolean {
  return knownSessions().has(sessionId);
}

/** The call marks its session as a migration session on its own. */
export function isMigrationEvidence(classified: Classified): boolean {
  return classified.kind !== 'activity' || classified.pathHints.length > 0;
}

export function reportMigrationToolEvent(payload: MigrationToolEventPayload): void {
  const { toolName, sessionId } = payload;
  if (!toolName || listeners.size === 0) return;
  const classified = classifyMigrationToolEvent(toolName, payload.input ?? {});
  if (!classified) return;
  if (isMigrationEvidence(classified)) {
    rememberMigrationSession(sessionId);
  } else if (!isMigrationSession(sessionId)) {
    return;
  }
  const signal: MigrationToolSignal = {
    ...classified,
    phase: payload.phase,
    sessionId,
    toolId: payload.toolId,
    result: payload.phase === 'started'
      ? undefined
      : extractToolResult(payload.rawResult, payload.resultForAssistant, payload.error),
  };
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch {
      // A broken listener must never break tool-event processing.
    }
  }
}

export function subscribeMigrationToolSignals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
