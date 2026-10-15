import { create } from 'zustand';
import type { MigrationGateResult, MigrationPhaseId, MigrationSnapshot } from '../model/types';

export type MigrationRefreshMode = 'watch' | 'poll';

export interface MigrationRootState {
  snapshot?: MigrationSnapshot;
  loading: boolean;
  /** Last load error. The previous snapshot is kept when a refresh fails. */
  error?: string;
  /** `false` once a load confirmed `STATE.md` does not exist. */
  exists?: boolean;
  mode: MigrationRefreshMode;
  lastRefreshAt?: number;
}

export interface MigrationActiveAction {
  script: string;
  sessionId: string;
  startedAt: number;
}

export type MigrationActivityStatus = 'running' | 'done' | 'failed';

/** One tool call of the migration session, shown in "current action" / "recent activity". */
export interface MigrationActivity {
  id: string;
  tool: string;
  kind: 'skill' | 'script' | 'activity';
  script?: string;
  summary: string;
  ledgerWrite: boolean;
  status: MigrationActivityStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
}

export interface MigrationTodoProgress {
  done: number;
  total: number;
  /** Item currently in progress (or the next pending one). */
  current?: string;
  updatedAt: number;
}

export type MigrationGateMap = Partial<Record<MigrationPhaseId, MigrationGateResult>>;

/** Key for gate verdicts whose ledger root could not be determined from the command. */
export const UNSCOPED_GATES_KEY = '*';
export const MAX_ACTIVITY_ENTRIES = 10;
const MAX_HINTED_ROOTS = 8;

export function gateRootKey(root: string | undefined): string {
  return root ? root.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() : UNSCOPED_GATES_KEY;
}

interface MigrationProgressState {
  byRoot: Record<string, MigrationRootState>;
  /** Migration script currently executed by the agent (from tool events). */
  activeAction?: MigrationActiveAction;
  /** Skill invoked during this app run. */
  skillInvoked: boolean;
  /**
   * Workspaces known to hold `migration/ohos/STATE.md`. The panel and its
   * header entry exist only for these workspaces.
   */
  ledgerWorkspaces: string[];
  /** Ledger roots discovered from tool-command path hints, newest first. */
  hintedRoots: string[];
  /** Feature-package roots (`<skill>/features`) seen in skill commands, newest first. */
  featuresRoots: string[];

  /** Agent session driving the migration (latest one seen). */
  migrationSessionId?: string;
  /** That session is processing a turn right now. */
  sessionRunning: boolean;
  /** Last tool event of the migration session. */
  lastActivityAt?: number;
  /** Tool calls of the migration session, newest first. */
  activity: MigrationActivity[];
  /** Latest `TodoWrite` list of the migration session. */
  todos?: MigrationTodoProgress;
  /** Gate verdicts parsed from tool output, by ledger root key then phase. */
  gatesByRoot: Record<string, MigrationGateMap>;

  patchRoot: (root: string, patch: Partial<MigrationRootState>) => void;
  setActiveAction: (action: MigrationActiveAction | undefined) => void;
  markSkillInvoked: () => void;
  markLedgerWorkspace: (workspacePath: string) => void;
  unmarkLedgerWorkspace: (workspacePath: string) => void;
  addHintedRoots: (roots: string[]) => void;
  addFeaturesRoots: (roots: string[]) => void;
  /** Switch to `sessionId`; activity and todos of a previous session are dropped. */
  trackSession: (sessionId: string, now: number) => void;
  setSessionRunning: (running: boolean) => void;
  startActivity: (activity: MigrationActivity) => void;
  finishActivity: (
    id: string,
    patch: Pick<MigrationActivity, 'status' | 'endedAt' | 'exitCode'>,
    fallback: Omit<MigrationActivity, 'status' | 'endedAt' | 'exitCode'>,
  ) => void;
  /** Close entries still marked running (turn cancelled / session stopped). */
  settleActivities: (now: number) => void;
  setTodos: (todos: MigrationTodoProgress | undefined) => void;
  recordGates: (root: string | undefined, gates: MigrationGateResult[]) => void;
}

const DEFAULT_ROOT_STATE: MigrationRootState = { loading: false, mode: 'poll' };

/** Persisted so a restored session finds the feature packages without a new skill command. */
const FEATURES_ROOTS_KEY = 'bitfun:qt-ohos-migration:features-roots:v1';
const MAX_FEATURES_ROOTS = 4;

function loadFeaturesRoots(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FEATURES_ROOTS_KEY) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((entry): entry is string => typeof entry === 'string' && !!entry).slice(0, MAX_FEATURES_ROOTS)
      : [];
  } catch {
    return [];
  }
}

function saveFeaturesRoots(roots: string[]): void {
  try {
    localStorage.setItem(FEATURES_ROOTS_KEY, JSON.stringify(roots));
  } catch {
    // Storage unavailable: the roots stay known for this app run.
  }
}

function mergeNewestFirst(added: string[], current: string[], limit: number): string[] | null {
  if (added.length === 0) return null;
  const next = [...new Set([...added, ...current.filter((entry) => !added.includes(entry))])].slice(0, limit);
  return next.length === current.length && next.every((entry, index) => entry === current[index]) ? null : next;
}

export const useMigrationProgressStore = create<MigrationProgressState>((set) => ({
  byRoot: {},
  activeAction: undefined,
  skillInvoked: false,
  ledgerWorkspaces: [],
  hintedRoots: [],
  featuresRoots: loadFeaturesRoots(),
  migrationSessionId: undefined,
  sessionRunning: false,
  lastActivityAt: undefined,
  activity: [],
  todos: undefined,
  gatesByRoot: {},

  patchRoot: (root, patch) => set((state) => ({
    byRoot: {
      ...state.byRoot,
      [root]: { ...DEFAULT_ROOT_STATE, ...state.byRoot[root], ...patch },
    },
  })),
  setActiveAction: (activeAction) => set({ activeAction }),
  markSkillInvoked: () => set({ skillInvoked: true }),
  markLedgerWorkspace: (workspacePath) => set((state) => (
    state.ledgerWorkspaces.includes(workspacePath)
      ? state
      : { ledgerWorkspaces: [...state.ledgerWorkspaces, workspacePath] }
  )),
  unmarkLedgerWorkspace: (workspacePath) => set((state) => (
    state.ledgerWorkspaces.includes(workspacePath)
      ? { ledgerWorkspaces: state.ledgerWorkspaces.filter((entry) => entry !== workspacePath) }
      : state
  )),
  addHintedRoots: (roots) => set((state) => {
    if (roots.length === 0) return state;
    const next = [...roots, ...state.hintedRoots.filter((root) => !roots.includes(root))].slice(0, MAX_HINTED_ROOTS);
    if (next.length === state.hintedRoots.length && next.every((root, index) => root === state.hintedRoots[index])) {
      return state;
    }
    return { hintedRoots: next };
  }),
  addFeaturesRoots: (roots) => set((state) => {
    const next = mergeNewestFirst(roots, state.featuresRoots, MAX_FEATURES_ROOTS);
    if (!next) return state;
    saveFeaturesRoots(next);
    return { featuresRoots: next };
  }),
  trackSession: (sessionId, now) => set((state) => (
    state.migrationSessionId === sessionId
      ? { lastActivityAt: now }
      : { migrationSessionId: sessionId, lastActivityAt: now, activity: [], todos: undefined, sessionRunning: false }
  )),
  setSessionRunning: (sessionRunning) => set((state) => (
    state.sessionRunning === sessionRunning ? state : { sessionRunning }
  )),
  startActivity: (activity) => set((state) => ({
    activity: [activity, ...state.activity.filter((entry) => entry.id !== activity.id)].slice(0, MAX_ACTIVITY_ENTRIES),
  })),
  finishActivity: (id, patch, fallback) => set((state) => {
    const known = state.activity.some((entry) => entry.id === id);
    const activity = known
      ? state.activity.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
      : [{ ...fallback, ...patch }, ...state.activity].slice(0, MAX_ACTIVITY_ENTRIES);
    return { activity };
  }),
  settleActivities: (now) => set((state) => (
    state.activity.some((entry) => entry.status === 'running')
      ? {
        activity: state.activity.map((entry) => (
          entry.status === 'running' ? { ...entry, status: 'done' as const, endedAt: now } : entry
        )),
      }
      : state
  )),
  setTodos: (todos) => set({ todos }),
  recordGates: (root, gates) => set((state) => {
    if (gates.length === 0) return state;
    const key = gateRootKey(root);
    const next: MigrationGateMap = { ...state.gatesByRoot[key] };
    for (const gate of gates) next[gate.phase] = gate;
    return { gatesByRoot: { ...state.gatesByRoot, [key]: next } };
  }),
}));

/** Gate verdicts that apply to `root`: its own plus the ones with an unknown root. */
export function gatesForRoot(gatesByRoot: Record<string, MigrationGateMap>, root: string): MigrationGateMap {
  const merged: MigrationGateMap = { ...gatesByRoot[UNSCOPED_GATES_KEY] };
  for (const [phase, gate] of Object.entries(gatesByRoot[gateRootKey(root)] ?? {}) as Array<[MigrationPhaseId, MigrationGateResult]>) {
    const other = merged[phase];
    if (!other || (gate.at ?? 0) >= (other.at ?? 0)) merged[phase] = gate;
  }
  return merged;
}
