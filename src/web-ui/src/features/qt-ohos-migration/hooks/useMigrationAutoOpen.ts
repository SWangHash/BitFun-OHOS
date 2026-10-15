/**
 * Keep the migration progress tab bound to the current workspace's ledger.
 *
 * The panel exists only for a workspace that holds `migration/ohos/STATE.md`:
 *
 *  - Entering (switching to) such a workspace opens the tab.
 *  - When the `qt-harmonyos-migration` skill, run in a session of the current
 *    workspace, creates `STATE.md`, the tab opens as soon as the file exists.
 *  - The chat header offers the tab only for such a workspace.
 *
 * A workspace without `STATE.md` never shows the tab: entering it, or the
 * file disappearing, closes the tab. Sessions of other workspaces never open
 * a tab in the current one.
 *
 * Also routes tool signals to the ledger controllers (active action + refresh)
 * and to the store (activity feed, todo progress, gate verdicts), and mirrors
 * the running state of the migration session for the panel's heartbeat.
 */

import { useEffect, useRef } from 'react';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { SessionExecutionState, stateMachineManager } from '@/flow_chat/state-machine';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { parseGateOutput } from '../parsers/parseGateOutput';
import { subscribeMigrationToolSignals, type MigrationToolSignal } from '../services/migrationToolSignals';
import {
  featuresRootFromHint,
  ledgerRootFromHint,
  rederiveAll,
  resolveLedgerRoot,
  scheduleRefreshAll,
} from '../services/MigrationProgressService';
import { closeMigrationProgressPanels, openMigrationProgressPanel } from '../services/openMigrationProgress';
import { recoverMigrationSession } from '../services/recoverMigrationSession';
import { useMigrationProgressStore, type MigrationActivity } from '../store/useMigrationProgressStore';

const log = createLogger('useMigrationAutoOpen');

/** While the skill runs without a ledger yet, look for `STATE.md` this often. */
const PENDING_LEDGER_PROBE_MS = 3_000;
/** ...for at most this long after the last skill signal. */
const PENDING_LEDGER_WINDOW_MS = 30 * 60_000;

const GATE_SCRIPTS = new Set(['validate_ledgers.py', 'phase_gate.py']);
let anonymousActivitySeq = 0;

function isRunningState(state: SessionExecutionState): boolean {
  return state === SessionExecutionState.PROCESSING || state === SessionExecutionState.FINISHING;
}

/** Mirror one tool signal into the activity feed / todo progress / gate verdicts. */
function recordSignal(signal: MigrationToolSignal, ledgerRoots: string[]): void {
  const store = useMigrationProgressStore.getState();
  const now = Date.now();
  store.trackSession(signal.sessionId, now);

  const base: Omit<MigrationActivity, 'status' | 'endedAt' | 'exitCode'> = {
    id: signal.toolId ?? `anonymous-${anonymousActivitySeq += 1}`,
    tool: signal.toolName,
    kind: signal.kind,
    script: signal.script,
    summary: signal.summary,
    ledgerWrite: signal.ledgerWrite,
    startedAt: now,
  };
  if (signal.phase === 'started') {
    store.startActivity({ ...base, status: 'running' });
    // A tool only starts while the session is processing a turn.
    store.setSessionRunning(true);
    if (signal.todos) {
      const done = signal.todos.filter((todo) => todo.status === 'completed').length;
      store.setTodos(signal.todos.length > 0
        ? { done, total: signal.todos.length, current: signal.summary || undefined, updatedAt: now }
        : undefined);
    }
    return;
  }

  const exitCode = signal.result?.exitCode;
  const failed = signal.phase === 'failed' || (exitCode !== undefined && exitCode !== 0 && signal.kind !== 'script');
  store.finishActivity(base.id, { status: failed ? 'failed' : 'done', endedAt: now, exitCode }, base);

  if (signal.kind === 'script' && signal.script && GATE_SCRIPTS.has(signal.script)) {
    const gates = parseGateOutput(signal.result?.output, now, signal.script);
    if (gates.length > 0) store.recordGates(ledgerRoots[0], gates);
  }
}

/** Workspace id of a session, when known. */
function sessionWorkspaceId(sessionId: string): string | undefined {
  const session = flowChatStore.getState().sessions.get(sessionId);
  return session?.workspaceId ?? session?.config?.workspaceId ?? undefined;
}

type LedgerCheckReason = 'enter' | 'skill' | 'recheck';

export function useMigrationAutoOpen(): void {
  const { workspace, workspacePath } = useCurrentWorkspace();
  const workspaceId = workspace?.id;
  const remoteConnectionId = workspace?.connectionId;

  const contextRef = useRef({ workspaceId, workspacePath, remoteConnectionId });
  contextRef.current = { workspaceId, workspacePath, remoteConnectionId };
  /** Last skill/script signal of a current-workspace session, while no ledger exists yet. */
  const pendingSkillAtRef = useRef<number | undefined>(undefined);

  /**
   * Look for the current workspace's ledger and apply the panel rules:
   * found -> header entry (+ open on entering the workspace or on the skill
   * creating the file); missing -> no header entry and no tab.
   */
  const checkLedgerRef = useRef(async (reason: LedgerCheckReason, deep = true) => {
    const { workspacePath: path, remoteConnectionId: remote } = contextRef.current;
    if (!path) return;
    let root: string | null = null;
    try {
      root = await resolveLedgerRoot(path, remote, useMigrationProgressStore.getState().hintedRoots, { deep });
    } catch (error) {
      log.debug('Migration ledger probe failed', { workspacePath: path, error });
      return;
    }
    // The user switched workspaces meanwhile: this result is stale.
    if (contextRef.current.workspacePath !== path) return;
    const store = useMigrationProgressStore.getState();
    const known = store.ledgerWorkspaces.includes(path);
    if (root) {
      store.markLedgerWorkspace(path);
      pendingSkillAtRef.current = undefined;
      if (reason === 'enter' || (reason === 'skill' && !known)) {
        openMigrationProgressPanel({ workspacePath: path, remoteConnectionId: remote });
      }
      return;
    }
    // A shallow probe cannot prove absence of a nested ledger found before.
    if (!deep && known) return;
    store.unmarkLedgerWorkspace(path);
    closeMigrationProgressPanels();
  });

  // Entering a workspace: open the tab when it holds a ledger, close it otherwise.
  useEffect(() => {
    pendingSkillAtRef.current = undefined;
    if (!workspacePath) {
      closeMigrationProgressPanels();
      return;
    }
    void checkLedgerRef.current('enter');
  }, [workspacePath, remoteConnectionId]);

  // The ledger may appear or vanish outside the app (reset scripts, git): recheck on focus.
  useEffect(() => {
    const onFocus = () => void checkLedgerRef.current('recheck');
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // After the skill ran in this workspace, keep looking for the STATE.md it creates.
  useEffect(() => {
    const timer = setInterval(() => {
      const startedAt = pendingSkillAtRef.current;
      if (startedAt === undefined) return;
      if (Date.now() - startedAt > PENDING_LEDGER_WINDOW_MS) {
        pendingSkillAtRef.current = undefined;
        return;
      }
      void checkLedgerRef.current('skill', false);
    }, PENDING_LEDGER_PROBE_MS);
    return () => clearInterval(timer);
  }, []);

  // Route agent tool events.
  useEffect(() => {
    return subscribeMigrationToolSignals((signal) => {
      const store = useMigrationProgressStore.getState();
      const context = contextRef.current;
      const signalWorkspaceId = sessionWorkspaceId(signal.sessionId);
      const inCurrentWorkspace = !signalWorkspaceId || !context.workspaceId || signalWorkspaceId === context.workspaceId;
      const roots = signal.pathHints
        .map((hint) => ledgerRootFromHint(hint, signal.workdir ?? context.workspacePath))
        .filter((root): root is string => !!root);
      store.addHintedRoots(roots);
      const featuresRoots = (signal.featuresRootHints ?? [])
        .map((hint) => featuresRootFromHint(hint, signal.workdir ?? context.workspacePath))
        .filter((root): root is string => !!root);
      store.addFeaturesRoots(featuresRoots);
      const wasRunning = store.sessionRunning;
      const gatesBefore = store.gatesByRoot;
      recordSignal(signal, roots);
      const after = useMigrationProgressStore.getState();
      const derivedInputsChanged = after.sessionRunning !== wasRunning || after.gatesByRoot !== gatesBefore;

      // The skill (or its scripts / a ledger write) in a session of this
      // workspace may have just created STATE.md: look for it.
      const watchForLedger = () => {
        if (!inCurrentWorkspace || !context.workspacePath) return;
        if (useMigrationProgressStore.getState().ledgerWorkspaces.includes(context.workspacePath)) return;
        pendingSkillAtRef.current = Date.now();
        if (signal.phase !== 'started') void checkLedgerRef.current('skill', false);
      };

      if (signal.kind === 'activity') {
        if (derivedInputsChanged) rederiveAll();
        // Ledger files written directly by the agent: refresh without waiting for the poll.
        if (signal.ledgerWrite && signal.phase !== 'started') {
          scheduleRefreshAll();
          if (pendingSkillAtRef.current !== undefined) watchForLedger();
        }
        return;
      }

      if (signal.kind === 'skill') {
        if (signal.phase === 'started') store.markSkillInvoked();
        watchForLedger();
        if (derivedInputsChanged) rederiveAll();
        scheduleRefreshAll();
        return;
      }

      if (signal.phase === 'started') {
        store.setActiveAction({ script: signal.script ?? 'script', sessionId: signal.sessionId, startedAt: Date.now() });
        rederiveAll();
      } else {
        const active = store.activeAction;
        if (active && active.sessionId === signal.sessionId && (!signal.script || active.script === signal.script)) {
          store.setActiveAction(undefined);
        }
        rederiveAll();
        scheduleRefreshAll();
      }
      watchForLedger();
    });
  }, []);

  // Heartbeat: follow the running state of the migration session.
  useEffect(() => {
    return stateMachineManager.subscribeGlobal((sessionId, machine) => {
      let store = useMigrationProgressStore.getState();
      const running = isRunningState(machine.currentState);
      if (store.migrationSessionId !== sessionId) {
        // A migration session resumed after an app restart: only the turn
        // start reveals it, the skill is usually not loaded again.
        if (!running || !recoverMigrationSession(sessionId)) return;
        store.trackSession(sessionId, Date.now());
        store = useMigrationProgressStore.getState();
      }
      if (running === store.sessionRunning) return;
      store.setSessionRunning(running);
      if (!running) {
        store.settleActivities(Date.now());
        if (store.activeAction?.sessionId === sessionId) store.setActiveAction(undefined);
        scheduleRefreshAll();
      }
      rederiveAll();
    });
  }, []);
}
