/**
 * Qt -> HarmonyOS migration progress panel (session aux pane tab).
 *
 * Single page, read-only view of `<app>/migration/ohos/` ledgers produced by the
 * built-in `qt-harmonyos-migration` skill. Built on the `@bitfun/ui` design
 * system components; appearance hooks use `data-bitfun-product-*`:
 *   header (project name, live pill, overall percent, 8-segment phase strip,
 *   "now" card with heartbeat / current action, notices) ->
 *   disclosures (pending decisions, phase timeline, external features,
 *   problems & diagnostics, references incl. migration documents) ->
 *   footer (watch mode, ledger root).
 * Empty sections are hidden.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  CirclePause,
  FileText,
  HelpCircle,
  Sheet,
  ListChecks,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  Alert,
  Button,
  Disclosure,
  Icon,
  IconButton,
  NumberBadge,
  OverflowText,
  Spinner,
  StatusPill,
  type StatusPillTone,
} from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import type {
  DiagnosticView,
  ExternalFeatureView,
  FeatureGateView,
  FeatureSelectionView,
  MigrationLiveStatus,
  MigrationSnapshot,
  MigrationStatus,
  PhaseItemView,
  PhaseView,
} from '../model/types';
import {
  acquireLedgerRoot,
  displayLedgerRoot,
  joinSegments,
  ledgerRootHasState,
  rankLedgerRoot,
  refreshLedgerRoot,
  resolveLedgerRoot,
} from '../services/MigrationProgressService';
import { closeMigrationProgressPanels } from '../services/openMigrationProgress';
import {
  useMigrationProgressStore,
  type MigrationActivity,
  type MigrationTodoProgress,
} from '../store/useMigrationProgressStore';
import './MigrationProgressPanel.scss';

export interface MigrationProgressPanelProps {
  ledgerRoot?: string;
  workspacePath?: string;
  remoteConnectionId?: string;
}

const UNRESOLVED_PROBE_MS = 3_000;
/** Clock tick for elapsed / "n seconds ago" labels. */
const LIVE_TICK_MS = 1_000;
const IDLE_TICK_MS = 30_000;

type TFn = ReturnType<typeof useI18n>['t'];
type FormatDateFn = ReturnType<typeof useI18n>['formatDate'];

/** Statuses that reuse the shared status vocabulary instead of panel-local copies. */
const SHARED_STATUS_KEYS: Partial<Record<string, string>> = {
  done: 'shared:statuses.done',
  error: 'shared:statuses.failed',
};
const SHARED_LIVE_KEYS: Partial<Record<string, string>> = {
  active: 'shared:statuses.running',
  completed: 'shared:statuses.done',
};

const MIGRATION_STATE_TONES: Record<NonNullable<PhaseItemView['migration']>, StatusPillTone> = {
  pending: 'neutral',
  doing: 'accent',
  done: 'success',
  blocked: 'warning',
};

const LIVE_TONES: Record<MigrationLiveStatus, StatusPillTone> = {
  active: 'accent',
  blocked: 'warning',
  completed: 'success',
  idle: 'neutral',
};

function statusLabel(status: string, t: TFn): string {
  return t(SHARED_STATUS_KEYS[status] ?? `status.${status}`);
}

function liveLabel(live: string, t: TFn): string {
  return t(SHARED_LIVE_KEYS[live] ?? `live.${live}`);
}

function joinStates(...states: Array<string | false | undefined>): string {
  return states.filter(Boolean).join(' ');
}

const STATUS_GLYPHS: Record<Exclude<MigrationStatus, 'doing'>, LucideIcon> = {
  done: CheckCircle2,
  ready: PlayCircle,
  pending: Circle,
  blocked: AlertTriangle,
  error: XCircle,
  unknown: HelpCircle,
};

/**
 * Inline status glyph. `paused`: a `doing` entry nobody is working on right
 * now; it stays static — the spinner is reserved for "an agent is running".
 */
function StatusGlyph({ status, paused }: { status: MigrationStatus; paused?: boolean }) {
  const className = `bitfun-migration-panel__glyph bitfun-migration-panel__glyph--${status}`;
  if (status === 'doing') {
    return paused
      ? <Icon className={className} glyph={CirclePause} size="xs" />
      : <Spinner className={className} size="xs" aria-hidden />;
  }
  return <Icon className={className} glyph={STATUS_GLYPHS[status]} size="xs" />;
}

function formatRelative(ms: number | undefined, t: TFn, formatDate: FormatDateFn): string | undefined {
  if (!ms) return undefined;
  const delta = Math.max(0, Date.now() - ms);
  if (delta < 60_000) return t('time.secondsAgo', { n: Math.round(delta / 1000) });
  if (delta < 3_600_000) return t('time.minutesAgo', { n: Math.round(delta / 60_000) });
  return formatDate(ms, { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(ms: number, t: TFn): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t('time.seconds', { n: seconds });
  return t('time.minutesSeconds', { m: Math.floor(seconds / 60), s: seconds % 60 });
}

/** Re-render on an interval so relative times stay current. */
function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function openPath(path: string, workspacePath?: string) {
  openFileInBestTarget({ filePath: path, workspacePath });
}

// ------------------------------------------------------------------ section

interface SectionProps {
  id: string;
  title: string;
  count?: number;
  warn?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ id, title, count, warn, defaultOpen = true, children }: SectionProps) {
  return (
    <Disclosure
      className="bitfun-migration-panel__section"
      contentClassName="bitfun-migration-panel__section-body"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="section"
      data-bitfun-status={warn ? 'blocked' : undefined}
      data-testid={`migration-progress-section-${id}`}
      defaultOpen={defaultOpen}
      unmountOnClose
      summary={title}
      actions={count !== undefined ? <NumberBadge value={count} /> : undefined}
    >
      {children}
    </Disclosure>
  );
}

// ------------------------------------------------------------------- header

function PhaseStrip({
  phases,
  currentPhase,
  sessionRunning,
  t,
}: {
  phases: PhaseView[];
  currentPhase?: string;
  sessionRunning: boolean;
  t: TFn;
}) {
  return (
    <div
      className="bitfun-migration-panel__strip"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="phaseStrip"
      role="list"
      aria-label={t('header.phaseStrip')}
    >
      {phases.map((phase) => {
        const current = phase.id === currentPhase;
        const running = phase.status === 'doing' && !phase.paused && sessionRunning;
        return (
          <div
            key={phase.id}
            role="listitem"
            className="bitfun-migration-panel__strip-segment"
            data-bitfun-product-component="migration-progress-panel"
            data-bitfun-product-part="phaseSegment"
            data-bitfun-status={phase.status}
            data-bitfun-state={joinStates(current && 'current', running && 'running', phase.paused && 'paused')}
            title={`${t(`phases.${phase.id}.name`)} · ${statusLabel(phase.status, t)}`}
          >
            <span className="bitfun-migration-panel__strip-bar" aria-hidden />
            <OverflowText className="bitfun-migration-panel__strip-label">
              {t(`phases.${phase.id}.short`)}
            </OverflowText>
          </div>
        );
      })}
    </div>
  );
}

function Header({
  snapshot,
  loading,
  onRefresh,
  currentPhase,
  sessionRunning,
  t,
}: {
  snapshot: MigrationSnapshot;
  loading: boolean;
  onRefresh: () => void;
  currentPhase?: string;
  sessionRunning: boolean;
  t: TFn;
}) {
  const { header } = snapshot;
  const phaseLabel = header.currentPhase ? t(`phases.${header.currentPhase}.name`) : header.currentPhaseRaw;
  const phaseIndex = snapshot.phases.findIndex((phase) => phase.id === currentPhase);
  const liveRunning = header.liveStatus === 'active' && sessionRunning;
  return (
    <>
      <div className="bitfun-migration-panel__title-row">
        <span
          className="bitfun-migration-panel__title"
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="title"
        >
          <OverflowText className="bitfun-migration-panel__title-text">{header.project || t('title')}</OverflowText>
        </span>
        <StatusPill
          tone={LIVE_TONES[header.liveStatus]}
          leading={liveRunning ? <Spinner size="xs" aria-hidden /> : undefined}
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="livePill"
          data-bitfun-live={header.liveStatus}
          data-testid="migration-progress-live-badge"
        >
          {liveLabel(header.liveStatus, t)}
        </StatusPill>
        <IconButton
          variant="quiet"
          size="xs"
          loading={loading}
          onClick={onRefresh}
          aria-label={t('header.refresh')}
          title={t('header.refresh')}
          icon={<Icon name="refresh" size="sm" />}
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="refresh"
          data-testid="migration-progress-refresh"
        />
      </div>

      <div
        className="bitfun-migration-panel__overview"
        data-bitfun-product-component="migration-progress-panel"
        data-bitfun-product-part="overview"
      >
        <span
          className="bitfun-migration-panel__percent"
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="percent"
          role="progressbar"
          aria-label={t('header.overall')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={header.overallPercent}
        >
          {header.overallPercent}
          <span className="bitfun-migration-panel__percent-unit">%</span>
        </span>
        <div className="bitfun-migration-panel__overview-meta">
          {phaseLabel && (
            <span>
              {t('header.currentPhase')} <strong>{phaseLabel}</strong>
              {phaseIndex >= 0 && ` · ${t('header.phaseIndex', { index: phaseIndex + 1, total: snapshot.phases.length })}`}
            </span>
          )}
          {(header.assessment || header.completionTier) && (
            <span>
              {header.assessment && (
                <>
                  {t('header.assessment')} <code className="bitfun-migration-panel__code">{header.assessment}</code>
                </>
              )}
              {header.assessment && header.completionTier && ' · '}
              {header.completionTier && `${t('header.completionTier')} ${header.completionTier}`}
            </span>
          )}
        </div>
      </div>

      <PhaseStrip phases={snapshot.phases} currentPhase={currentPhase} sessionRunning={sessionRunning} t={t} />
    </>
  );
}

function NowCard({
  session,
  currentAction,
  lastWriteAt,
  now,
  t,
  formatDate,
}: {
  /** Migration agent session seen in this app run, if any. */
  session?: { running: boolean; lastActivityAt?: number };
  /** Tool call in flight (or the latest finished one). */
  currentAction?: MigrationActivity;
  lastWriteAt?: number;
  now: number;
  t: TFn;
  formatDate: FormatDateFn;
}) {
  if (!session && !currentAction) return null;
  const lastActivity = formatRelative(session?.lastActivityAt, t, formatDate);
  const lastWrite = formatRelative(lastWriteAt, t, formatDate);
  const actionRunning = currentAction?.status === 'running';
  return (
    <div
      className="bitfun-migration-panel__now"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="now"
    >
      {session && (
        <div
          className="bitfun-migration-panel__now-row"
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="heartbeat"
          data-bitfun-state={session.running ? 'running' : ''}
          data-testid="migration-progress-heartbeat"
        >
          <span className="bitfun-migration-panel__pulse" aria-hidden />
          <span>{session.running ? t('heartbeat.running') : t('heartbeat.stopped')}</span>
          <span className="bitfun-migration-panel__time">
            {lastActivity
              ? t('heartbeat.lastActivity', { time: lastActivity })
              : lastWrite && `${t('header.lastWrite')}: ${lastWrite}`}
          </span>
        </div>
      )}
      {currentAction && (
        <div
          className="bitfun-migration-panel__now-row"
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="currentAction"
          data-bitfun-state={actionRunning ? 'running' : ''}
          data-testid="migration-progress-current-action"
          title={currentAction.summary}
        >
          {actionRunning
            ? <Spinner size="xs" aria-hidden />
            : <Icon glyph={Activity} size="xs" tone="muted" />}
          <span className="bitfun-migration-panel__label">
            {actionRunning ? t('header.currentAction') : t('header.lastAction')}
          </span>
          <code className="bitfun-migration-panel__code">{currentAction.script ?? currentAction.tool}</code>
          <OverflowText className="bitfun-migration-panel__grow">{currentAction.summary}</OverflowText>
          <span className="bitfun-migration-panel__time">
            {actionRunning
              ? formatDuration(now - currentAction.startedAt, t)
              : formatRelative(currentAction.endedAt ?? currentAction.startedAt, t, formatDate)}
          </span>
        </div>
      )}
    </div>
  );
}

function Notices({
  snapshot,
  error,
  t,
}: {
  snapshot: MigrationSnapshot;
  error?: string;
  t: TFn;
}) {
  const { header } = snapshot;
  const completed = header.liveStatus === 'completed';
  const gateBlocked = header.completedGateBlocked;
  const problem = error
    ? t('errors.loadFailed', { error })
    : snapshot.schemaWarnings.length > 0
      ? t('warnings.schema', { detail: snapshot.schemaWarnings.join('; ') })
      : undefined;
  if (!completed && !problem) return null;
  return (
    <div
      className="bitfun-migration-panel__notices"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="notice"
    >
      {completed && (
        <Alert
          tone={gateBlocked ? 'warning' : 'success'}
          showIcon
          message={t('header.completed')}
          description={gateBlocked
            ? `${t('header.completedGateBlocked', { n: gateBlocked.unmetCount })}${gateBlocked.unmet[0] ? `: ${gateBlocked.unmet[0]}` : ''}`
            : undefined}
          data-testid="migration-progress-completed"
        />
      )}
      {problem && <Alert tone="warning" showIcon message={problem} />}
    </div>
  );
}

// ---------------------------------------------------------------- phases

function GatePill({ phase, t, formatDate }: { phase: PhaseView; t: TFn; formatDate: FormatDateFn }) {
  const gate = phase.gate;
  if (!gate) return null;
  const ready = gate.verdict === 'ready';
  const when = formatRelative(gate.at, t, formatDate);
  return (
    <StatusPill
      tone={ready ? 'success' : 'warning'}
      leading={<Icon glyph={ready ? ShieldCheck : ShieldAlert} size="2xs" />}
      title={[gate.tool, when].filter(Boolean).join(' · ') || undefined}
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="gatePill"
      data-bitfun-status={ready ? 'done' : 'blocked'}
      data-testid={`migration-progress-gate-${phase.id}`}
    >
      {ready ? t('gate.ready') : t('gate.blocked', { n: gate.unmetCount })}
    </StatusPill>
  );
}

function PhaseNode({ status, paused, running }: { status: MigrationStatus; paused?: boolean; running: boolean }) {
  return (
    <span
      className="bitfun-migration-panel__node"
      data-node-status={status}
      data-node-paused={paused ? 'true' : undefined}
      data-node-running={running ? 'true' : undefined}
      aria-hidden
    >
      {status === 'done' && <Icon glyph={Check} size="2xs" />}
      {status === 'blocked' && <Icon glyph={AlertTriangle} size="2xs" />}
      {status === 'error' && <Icon glyph={XCircle} size="2xs" />}
    </span>
  );
}

function PhaseRow({
  phase,
  current,
  sessionRunning,
  todos,
  workspacePath,
  t,
  formatDate,
}: {
  phase: PhaseView;
  current: boolean;
  sessionRunning: boolean;
  workspacePath?: string;
  /** Agent todo-list progress, shown on the current phase only. */
  todos?: MigrationTodoProgress;
  t: TFn;
  formatDate: FormatDateFn;
}) {
  const blockedGate = phase.gate?.verdict === 'blocked' ? phase.gate : undefined;
  const [expanded, setExpanded] = useState(current || phase.status === 'blocked' || phase.status === 'error');
  useEffect(() => {
    if (current) setExpanded(true);
  }, [current]);
  const hasItems = phase.items.length > 0;
  const expandable = hasItems || !!phase.evidence || !!blockedGate || !!todos || current;
  const running = phase.status === 'doing' && !phase.paused && sessionRunning;
  // Always the translated status; the raw ledger word is only a tooltip.
  const subLabel = statusLabel(phase.status, t);
  const itemPercent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : undefined;
  return (
    <li
      className="bitfun-migration-panel__phase"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="phase"
      data-bitfun-status={phase.status}
      data-bitfun-state={joinStates(current && 'current', phase.paused && 'paused', running && 'running')}
      data-testid={`migration-progress-phase-${phase.id}`}
    >
      <PhaseNode status={phase.status} paused={phase.paused} running={running} />
      <button
        type="button"
        className="bitfun-migration-panel__phase-header"
        data-bitfun-product-component="migration-progress-panel"
        data-bitfun-product-part="phaseHeader"
        data-overflow-trigger
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
        onClick={() => setExpanded((value) => !value)}
      >
        <OverflowText className="bitfun-migration-panel__phase-name">{t(`phases.${phase.id}.name`)}</OverflowText>
        <span
          className="bitfun-migration-panel__phase-sub"
          title={phase.statusSource === 'ledger' && phase.rawStatus
            ? t('phase.ledgerOverride', { raw: phase.rawStatus })
            : phase.rawStatus || undefined}
        >
          {phase.paused ? t('status.paused') : subLabel}
        </span>
        <span className="bitfun-migration-panel__phase-trail">
          {phase.total > 0 && (
            <span className="bitfun-migration-panel__frac" title={t('phase.rowsFracHint')}>
              {t('phase.rowsFrac', { done: phase.done, total: phase.total })}
            </span>
          )}
          <GatePill phase={phase} t={t} formatDate={formatDate} />
          {expandable && (
            <Icon
              className="bitfun-migration-panel__chevron"
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size="xs"
              tone="muted"
            />
          )}
        </span>
      </button>
      {expandable && expanded && (
        <div className="bitfun-migration-panel__phase-body">
          <p className="bitfun-migration-panel__phase-desc">{t(`phases.${phase.id}.description`)}</p>
          <p className="bitfun-migration-panel__muted">
            {`${t('phase.ledger')} `}
            {phase.ledgerPath ? (
              <button
                type="button"
                className="bitfun-migration-panel__link"
                onClick={() => openPath(phase.ledgerPath!, workspacePath)}
                title={phase.ledgerPath}
              >
                {phase.ledger}
              </button>
            ) : (
              <code className="bitfun-migration-panel__code">{phase.ledger}</code>
            )}
          </p>
          {phase.evidence && <p className="bitfun-migration-panel__muted">{phase.evidence}</p>}
          {itemPercent !== undefined && (
            <span className="bitfun-migration-panel__mini" aria-hidden>
              <span className="bitfun-migration-panel__mini-fill" style={{ width: `${itemPercent}%` }} />
            </span>
          )}
          {todos && (
            <div
              className="bitfun-migration-panel__todo"
              data-bitfun-product-component="migration-progress-panel"
              data-bitfun-product-part="todo"
              data-testid="migration-progress-todos"
            >
              <Icon glyph={ListChecks} size="xs" tone="muted" />
              <span>{t('todos.progress', { done: todos.done, total: todos.total })}</span>
              {todos.current && <OverflowText className="bitfun-migration-panel__grow">{todos.current}</OverflowText>}
            </div>
          )}
          {blockedGate && blockedGate.unmet.length > 0 && (
            <div
              className="bitfun-migration-panel__unmet"
              data-bitfun-product-component="migration-progress-panel"
              data-bitfun-product-part="gateUnmet"
            >
              <p className="bitfun-migration-panel__unmet-title">
                {blockedGate.invalid ? t('gate.invalid') : t('gate.unmetTitle')}
              </p>
              <ul>
                {blockedGate.unmet.map((entry, index) => <li key={`${index}:${entry}`}>{entry}</li>)}
                {blockedGate.unmetCount > blockedGate.unmet.length && (
                  <li className="bitfun-migration-panel__muted">
                    {t('gate.more', { n: blockedGate.unmetCount - blockedGate.unmet.length })}
                  </li>
                )}
              </ul>
            </div>
          )}
          {hasItems ? (
            <ul className="bitfun-migration-panel__items">
              {phase.items.map((entry) => (
                <li
                  key={entry.id}
                  className="bitfun-migration-panel__row"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="item"
                  data-bitfun-status={entry.status}
                  title={entry.rawStatus}
                >
                  <StatusGlyph status={entry.status} paused={entry.status === 'doing' && !sessionRunning} />
                  <span className="bitfun-migration-panel__id">{entry.id}</span>
                  <OverflowText className="bitfun-migration-panel__grow">{entry.label}</OverflowText>
                  {entry.detail && <span className="bitfun-migration-panel__muted">{entry.detail}</span>}
                  {entry.migration && (
                    <StatusPill tone={MIGRATION_STATE_TONES[entry.migration]}>
                      {t(`phase.migrationState.${entry.migration}`)}
                    </StatusPill>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="bitfun-migration-panel__muted">{t('phase.noItems')}</p>
          )}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------ list rows

function DiagnosticLogButton({ diagnostic, workspacePath, t }: { diagnostic: DiagnosticView; workspacePath?: string; t: TFn }) {
  if (!diagnostic.logPath) return null;
  return (
    <Button variant="text" size="xs" onClick={() => openPath(diagnostic.logPath!, workspacePath)}>
      {t('diagnostics.openLog')}
    </Button>
  );
}

/** A problem met during the migration: what failed, why, and what fixed it (or what is next). */
function ProblemCard({ diagnostic, workspacePath, t }: { diagnostic: DiagnosticView; workspacePath?: string; t: TFn }) {
  const glyphStatus: MigrationStatus = diagnostic.open
    ? (diagnostic.status === 'blocked' ? 'blocked' : 'error')
    : 'done';
  return (
    <li
      className="bitfun-migration-panel__card"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="diagnostic"
      data-bitfun-status={glyphStatus}
    >
      <div className="bitfun-migration-panel__card-head">
        <StatusGlyph status={glyphStatus} paused />
        <span className="bitfun-migration-panel__id">{diagnostic.id}</span>
        {diagnostic.phase && <code className="bitfun-migration-panel__code">{diagnostic.phase}</code>}
        {diagnostic.category && !diagnostic.unclassified && (
          <code className="bitfun-migration-panel__code">{diagnostic.category}</code>
        )}
        {diagnostic.unclassified && <StatusPill tone="warning">{t('diagnostics.unclassified')}</StatusPill>}
        <StatusPill tone={diagnostic.open ? (glyphStatus === 'blocked' ? 'warning' : 'danger') : 'success'}>
          {diagnostic.open
            ? (glyphStatus === 'blocked' ? t('status.blocked') : t('diagnostics.open'))
            : t('diagnostics.resolved')}
        </StatusPill>
        {diagnostic.attempts > 1 && (
          <span className="bitfun-migration-panel__time">{t('diagnostics.attempts', { n: diagnostic.attempts })}</span>
        )}
      </div>
      {diagnostic.signature && <code className="bitfun-migration-panel__signature">{diagnostic.signature}</code>}
      {diagnostic.rootCause && !diagnostic.unclassified && (
        <p>{t('diagnostics.rootCause')}: {diagnostic.rootCause}</p>
      )}
      {diagnostic.nextAction && (
        <p className={diagnostic.open ? 'bitfun-migration-panel__muted' : undefined}>
          {diagnostic.open ? t('diagnostics.nextAction') : t('diagnostics.fix')}: {diagnostic.nextAction}
        </p>
      )}
      {diagnostic.recurrence && <p className="bitfun-migration-panel__muted">{t('diagnostics.recurrence')}: {diagnostic.recurrence}</p>}
      <DiagnosticLogButton diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
    </li>
  );
}

/** A passing build/pilot/device receipt: one compact line. */
function ReceiptRow({ diagnostic, workspacePath, t }: { diagnostic: DiagnosticView; workspacePath?: string; t: TFn }) {
  return (
    <li
      className="bitfun-migration-panel__row"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="diagnostic"
      data-bitfun-status={diagnostic.status}
      title={[diagnostic.signature, diagnostic.rawStatus].filter(Boolean).join(' · ')}
    >
      <StatusGlyph status={diagnostic.status} paused />
      <span className="bitfun-migration-panel__id">{diagnostic.id}</span>
      {diagnostic.phase && <code className="bitfun-migration-panel__code">{diagnostic.phase}</code>}
      <OverflowText className="bitfun-migration-panel__grow">{diagnostic.signature || diagnostic.category}</OverflowText>
      {diagnostic.unrecordedFailures > 0 && (
        <StatusPill tone="warning">{t('diagnostics.unrecorded', { n: diagnostic.unrecordedFailures })}</StatusPill>
      )}
      <DiagnosticLogButton diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
    </li>
  );
}

// ------------------------------------------------------ external features

const FEATURE_GATE_TONES: Record<FeatureGateView['verdict'], StatusPillTone> = {
  ready: 'success',
  blocked: 'warning',
  closed: 'neutral',
};

/** Lifecycle words of feature-adoption.tsv with a dedicated label; anything else uses the generic status. */
const FEATURE_RAW_STATUSES = new Set(['planned', 'in-progress', 'passed', 'deferred-approved', 'blocked', 'verified']);

function featureStatusLabel(feature: ExternalFeatureView, t: TFn): string {
  const raw = feature.rawStatus.toLowerCase();
  return FEATURE_RAW_STATUSES.has(raw) ? t(`features.status.${raw}`) : statusLabel(feature.status, t);
}

function FeatureGateRow({ kind, gate, t }: { kind: 'entry' | 'exit'; gate: FeatureGateView; t: TFn }) {
  const verdict = gate.verdict === 'blocked'
    ? t('features.gate.blocked', { n: gate.unmetCount ?? 0 })
    : gate.verdict === 'closed'
      ? t('features.gate.closed', { status: gate.closedStatus ?? '' })
      : gate.restart ? t('features.gate.readyRestart') : t('features.gate.ready');
  return (
    <div
      className="bitfun-migration-panel__feature-gate"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="featureGate"
      data-bitfun-gate={gate.verdict}
      title={gate.raw}
    >
      <span className="bitfun-migration-panel__label">{t(`features.gate.${kind}`)}</span>
      <StatusPill
        tone={FEATURE_GATE_TONES[gate.verdict]}
        leading={<Icon glyph={gate.verdict === 'blocked' ? ShieldAlert : ShieldCheck} size="2xs" />}
      >
        {verdict}
      </StatusPill>
      {gate.firstUnmet && <OverflowText className="bitfun-migration-panel__grow bitfun-migration-panel__muted">{gate.firstUnmet}</OverflowText>}
    </div>
  );
}

function FeatureMilestones({ feature, t }: { feature: ExternalFeatureView; t: TFn }) {
  if (feature.milestones.length === 0) return null;
  return (
    <ol
      className="bitfun-migration-panel__milestones"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="featureMilestones"
      aria-label={t('features.milestones')}
    >
      {feature.milestones.map((milestone, index) => {
        const current = milestone.state === 'current';
        return (
          <li
            key={`${index}:${milestone.label}`}
            className="bitfun-migration-panel__milestone"
            data-bitfun-product-component="migration-progress-panel"
            data-bitfun-product-part="featureMilestone"
            data-bitfun-milestone={milestone.state}
            data-bitfun-state={joinStates(current && 'current', current && feature.running && 'running')}
            aria-current={current ? 'step' : undefined}
          >
            <span className="bitfun-migration-panel__milestone-mark" aria-hidden>
              {milestone.state === 'done'
                ? <Icon glyph={Check} size="2xs" />
                : current && feature.running ? <Spinner size="xs" aria-hidden /> : index + 1}
            </span>
            <OverflowText className="bitfun-migration-panel__milestone-label">{milestone.label}</OverflowText>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One external feature registered through the skill's hook mechanism, kept
 * compact: title line (status glyph, title, FEAT id, host phase), summary,
 * milestones, entry/exit gates, and the workdir files. Every block is driven by
 * the FEAT row (+ optional package metadata) and is omitted when its data is
 * missing, so any feature package renders.
 */
function ExternalFeatureCard({
  feature,
  workspacePath,
  t,
}: {
  feature: ExternalFeatureView;
  workspacePath?: string;
  t: TFn;
}) {
  const doing = feature.status === 'doing';
  const hostPhase = feature.hostPhase ? t(`phases.${feature.hostPhase}.short`) : feature.hostPhaseRaw;
  return (
    <li
      className="bitfun-migration-panel__card bitfun-migration-panel__feature"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="externalFeature"
      data-bitfun-status={feature.status}
      data-bitfun-state={joinStates(feature.running && 'running', doing && !feature.running && 'paused')}
      data-testid={`migration-progress-feature-${feature.id}`}
    >
      <div className="bitfun-migration-panel__card-head" title={featureStatusLabel(feature, t)}>
        <StatusGlyph status={feature.status} paused={!feature.running} />
        <span className="bitfun-migration-panel__card-title">{feature.title}</span>
        <span className="bitfun-migration-panel__id">{feature.id}</span>
        {hostPhase && <span className="bitfun-migration-panel__muted">{t('features.hostPhase', { phase: hostPhase })}</span>}
      </div>
      {feature.summary && <p className="bitfun-migration-panel__muted">{feature.summary}</p>}

      <FeatureMilestones feature={feature} t={t} />

      {(feature.entryGate || feature.exitGate) && (
        <div className="bitfun-migration-panel__feature-gates">
          {feature.entryGate && <FeatureGateRow kind="entry" gate={feature.entryGate} t={t} />}
          {feature.exitGate && <FeatureGateRow kind="exit" gate={feature.exitGate} t={t} />}
        </div>
      )}

      {(feature.files.length > 0 || feature.playbookPath) && (
        <>
          <p className="bitfun-migration-panel__subhead">{t('features.files')}</p>
          <ul className="bitfun-migration-panel__items">
            {feature.playbookPath && (
              <li
                className="bitfun-migration-panel__row"
                data-bitfun-product-component="migration-progress-panel"
                data-bitfun-product-part="featureFile"
              >
                <Icon glyph={BookOpen} size="xs" tone="muted" />
                <button
                  type="button"
                  className="bitfun-migration-panel__link bitfun-migration-panel__grow"
                  data-overflow-trigger
                  onClick={() => openPath(feature.playbookPath!, workspacePath)}
                  title={feature.playbookPath}
                >
                  <OverflowText>{t('features.playbook')}</OverflowText>
                </button>
              </li>
            )}
            {feature.files.map((file) => (
              <li
                key={file.path}
                className="bitfun-migration-panel__row"
                data-bitfun-product-component="migration-progress-panel"
                data-bitfun-product-part="featureFile"
              >
                <Icon glyph={FileText} size="xs" tone="muted" />
                <button
                  type="button"
                  className="bitfun-migration-panel__link bitfun-migration-panel__grow"
                  data-overflow-trigger
                  onClick={() => openPath(file.path, workspacePath)}
                  title={file.path}
                >
                  <OverflowText>{file.name}</OverflowText>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

    </li>
  );
}

/**
 * The user's external-feature selection (decisions.tsv). Shown even when no
 * FEAT row exists, so "the user chose none" and "the question was never
 * answered" are visible instead of an empty panel.
 */
function FeatureSelectionRow({
  selection,
  activeIds,
  t,
}: {
  selection: FeatureSelectionView;
  activeIds: string[];
  t: TFn;
}) {
  const chosenNone = selection.selected.length === 0;
  const verdict = selection.unanswered
    ? t('features.selection.unanswered')
    : !selection.confirmed
      ? t('features.selection.unconfirmed')
      : chosenNone ? t('features.selection.none') : t('features.selection.selected', { n: selection.selected.length });
  const tone: StatusPillTone = !selection.confirmed ? 'warning' : chosenNone ? 'neutral' : 'accent';
  const active = new Set(activeIds.map((id) => id.toLowerCase()));
  const inactive = selection.selected.filter((id) => !active.has(id.toLowerCase()));
  return (
    <div
      className="bitfun-migration-panel__feature-selection"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="featureSelection"
      data-bitfun-status={selection.confirmed ? 'done' : 'blocked'}
      data-testid="migration-progress-feature-selection"
    >
      <div className="bitfun-migration-panel__row">
        <span className="bitfun-migration-panel__label">{t('features.selection.label')}</span>
        <StatusPill tone={tone} title={selection.evidence}>{verdict}</StatusPill>
        <span className="bitfun-migration-panel__id">{selection.decisionId}</span>
        {!chosenNone && (
          <OverflowText className="bitfun-migration-panel__grow bitfun-migration-panel__muted">
            {selection.selected.join(', ')}
          </OverflowText>
        )}
      </div>
      {!selection.confirmed && (
        <p className="bitfun-migration-panel__unmet">
          {selection.unanswered ? t('features.selection.unansweredHint') : t('features.selection.unconfirmedHint')}
        </p>
      )}
      {selection.confirmed && inactive.length > 0 && (
        <p className="bitfun-migration-panel__muted">
          {t('features.selection.notActivated', { ids: inactive.join(', ') })}
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- panel

export const MigrationProgressPanel: React.FC<MigrationProgressPanelProps> = ({
  ledgerRoot: explicitRoot,
  workspacePath,
  remoteConnectionId,
}) => {
  const { t, formatDate } = useI18n(['panels/migration', 'shared']);
  /** `undefined` = resolving, `null` = not found. */
  const [root, setRoot] = useState<string | null | undefined>(explicitRoot);
  const hintedRoots = useMigrationProgressStore((state) => state.hintedRoots);
  const migrationSessionId = useMigrationProgressStore((state) => state.migrationSessionId);
  const sessionRunning = useMigrationProgressStore((state) => state.sessionRunning);
  const lastActivityAt = useMigrationProgressStore((state) => state.lastActivityAt);
  const activity = useMigrationProgressStore((state) => state.activity);
  const todos = useMigrationProgressStore((state) => state.todos);
  const now = useTick(sessionRunning ? LIVE_TICK_MS : IDLE_TICK_MS);
  const rootState = useMigrationProgressStore((state) => (root ? state.byRoot[root] : undefined));

  // Full lookup on mount / workspace change.
  useEffect(() => {
    let cancelled = false;
    if (explicitRoot) {
      setRoot(explicitRoot);
      return;
    }
    if (!workspacePath) {
      setRoot(null);
      return;
    }
    setRoot(undefined);
    void resolveLedgerRoot(workspacePath, remoteConnectionId, useMigrationProgressStore.getState().hintedRoots)
      .then((found) => {
        if (!cancelled) setRoot(found);
      })
      .catch(() => {
        if (!cancelled) setRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [explicitRoot, workspacePath, remoteConnectionId]);

  // The panel exists only while the workspace holds `STATE.md`: once the
  // lookup (or a removal below) confirms there is none, close the tab.
  useEffect(() => {
    if (root !== null) return;
    if (workspacePath) useMigrationProgressStore.getState().unmarkLedgerWorkspace(workspacePath);
    closeMigrationProgressPanels();
  }, [root, workspacePath]);

  // A ledger outside `<workspace>/migration/ohos` may be a stale or unrelated
  // one (another app, an earlier hint): keep probing and switch as soon as a
  // better-ranked root exists, e.g. right after `init_migration.py` finishes.
  useEffect(() => {
    if (!root || explicitRoot || !workspacePath) return;
    const currentRank = rankLedgerRoot(root, workspacePath);
    if (currentRank === 0) return;
    let cancelled = false;
    const probe = async () => {
      const found = await resolveLedgerRoot(workspacePath, remoteConnectionId, hintedRoots, { deep: false })
        .catch(() => null);
      if (!cancelled && found && rankLedgerRoot(found, workspacePath) < currentRank) setRoot(found);
    };
    void probe();
    const timer = setInterval(() => void probe(), UNRESOLVED_PROBE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [root, explicitRoot, workspacePath, remoteConnectionId, hintedRoots]);

  // Watch the resolved root.
  useEffect(() => {
    if (!root) return;
    return acquireLedgerRoot(root, remoteConnectionId);
  }, [root, remoteConnectionId]);

  // Ledger removed after it was found -> no panel.
  useEffect(() => {
    if (!root || explicitRoot || rootState?.exists !== false) return;
    let cancelled = false;
    void ledgerRootHasState(root).then((exists) => {
      if (!cancelled && !exists) setRoot(null);
    });
    return () => {
      cancelled = true;
    };
  }, [root, explicitRoot, rootState?.exists]);

  const handleRefresh = useCallback(() => {
    if (root) refreshLedgerRoot(root);
  }, [root]);

  const snapshot = rootState?.snapshot;
  const currentPhase = snapshot?.header.currentPhase
    ?? snapshot?.phases.find((phase) => phase.status === 'doing')?.id;
  const references = useMemo(
    () => (snapshot ? snapshot.documents.length + snapshot.knowledge.length : 0),
    [snapshot],
  );
  const problems = useMemo(
    () => (snapshot ? snapshot.diagnostics.filter((entry) => entry.kind === 'problem') : []),
    [snapshot],
  );
  const receipts = useMemo(
    () => (snapshot ? snapshot.diagnostics.filter((entry) => entry.kind === 'receipt') : []),
    [snapshot],
  );
  const openProblems = problems.some((entry) => entry.open);
  const unrecordedFailures = receipts.reduce((sum, entry) => sum + entry.unrecordedFailures, 0);

  // Resolving / loading, or about to close because there is no ledger.
  if (!snapshot) return null;

  const currentAction = activity.find((entry) => entry.status === 'running') ?? activity[0];
  const rootLabel = displayLedgerRoot(snapshot.ledgerRoot, workspacePath);
  const rootOutside = rankLedgerRoot(snapshot.ledgerRoot, workspacePath) > 1;
  const mode = rootState?.mode ?? 'poll';

  return (
    <div
      className="bitfun-migration-panel"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="root"
      data-bitfun-state={sessionRunning ? 'running' : ''}
      data-testid="migration-progress-panel"
    >
      <header
        className="bitfun-migration-panel__header"
        data-bitfun-product-component="migration-progress-panel"
        data-bitfun-product-part="header"
      >
        <Header
          snapshot={snapshot}
          loading={!!rootState?.loading}
          onRefresh={handleRefresh}
          currentPhase={currentPhase}
          sessionRunning={sessionRunning}
          t={t}
        />
        <NowCard
          session={migrationSessionId ? { running: sessionRunning, lastActivityAt } : undefined}
          currentAction={currentAction}
          lastWriteAt={snapshot.header.lastWriteAt}
          now={now}
          t={t}
          formatDate={formatDate}
        />
        <Notices
          snapshot={snapshot}
          error={rootState?.error}
          t={t}
        />
      </header>

      <div
        className="bitfun-migration-panel__body"
        data-bitfun-product-component="migration-progress-panel"
        data-bitfun-product-part="body"
      >
        {snapshot.decisionsPending.length > 0 && (
          <Section id="decisions" title={t('sections.decisions')} count={snapshot.decisionsPending.length} warn>
            <ul className="bitfun-migration-panel__list">
              {snapshot.decisionsPending.map((decision) => (
                <li
                  key={`${decision.source}:${decision.id}`}
                  className="bitfun-migration-panel__card bitfun-migration-panel__card--decision"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="decision"
                  data-bitfun-status={decision.status}
                >
                  <div className="bitfun-migration-panel__card-head">
                    <span className="bitfun-migration-panel__id">{decision.id}</span>
                    <span className="bitfun-migration-panel__card-title">{decision.question}</span>
                  </div>
                  {decision.options && <p>{t('decisions.options')}: {decision.options}</p>}
                  {decision.impact && <p className="bitfun-migration-panel__muted">{t('decisions.impact')}: {decision.impact}</p>}
                  <p className="bitfun-migration-panel__muted">{t('decisions.source', { source: decision.source })}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section id="phases" title={t('sections.phases')} count={snapshot.phases.length}>
          <ol
            className="bitfun-migration-panel__timeline"
            data-bitfun-product-component="migration-progress-panel"
            data-bitfun-product-part="phaseList"
          >
            {snapshot.phases.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                current={phase.id === currentPhase}
                sessionRunning={sessionRunning}
                todos={phase.id === currentPhase ? todos : undefined}
                workspacePath={workspacePath}
                t={t}
                formatDate={formatDate}
              />
            ))}
          </ol>
        </Section>

        {(snapshot.externalFeatures.length > 0 || snapshot.featureSelection) && (
          <Section
            id="externalFeatures"
            title={t('sections.externalFeatures')}
            count={snapshot.externalFeatures.length > 0 ? snapshot.externalFeatures.length : undefined}
            warn={
              snapshot.externalFeatures.some((feature) => feature.status === 'blocked' || feature.status === 'error')
              || (!!snapshot.featureSelection && !snapshot.featureSelection.confirmed)
            }
          >
            {snapshot.featureSelection && (
              <FeatureSelectionRow
                selection={snapshot.featureSelection}
                activeIds={snapshot.externalFeatures.map((feature) => feature.featureId).filter(Boolean) as string[]}
                t={t}
              />
            )}
            {snapshot.externalFeatures.length > 0 && (
              <ul className="bitfun-migration-panel__list">
                {snapshot.externalFeatures.map((feature) => (
                  <ExternalFeatureCard
                    key={feature.id}
                    feature={feature}
                    workspacePath={workspacePath}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </Section>
        )}

        {snapshot.diagnostics.length > 0 && (
          <Section
            id="diagnostics"
            title={t('sections.diagnostics')}
            count={problems.length > 0 ? problems.length : undefined}
            warn={openProblems}
            defaultOpen={openProblems}
          >
            {problems.length > 0 ? (
              <ul className="bitfun-migration-panel__list">
                {problems.map((diagnostic) => (
                  <ProblemCard key={diagnostic.id} diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
                ))}
              </ul>
            ) : (
              <p className="bitfun-migration-panel__muted">
                {unrecordedFailures > 0
                  ? t('diagnostics.noneRecordedButRetried', { n: unrecordedFailures })
                  : t('diagnostics.noneRecorded')}
              </p>
            )}
            {receipts.length > 0 && (
              <>
                <p className="bitfun-migration-panel__subhead">{t('diagnostics.receipts', { n: receipts.length })}</p>
                <ul className="bitfun-migration-panel__list">
                  {receipts.map((diagnostic) => (
                    <ReceiptRow key={diagnostic.id} diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {references > 0 && (
          <Section id="references" title={t('sections.references')} count={references} defaultOpen={false}>
            <ul className="bitfun-migration-panel__list">
              {snapshot.documents.map((doc) => (
                <li
                  key={doc.id}
                  className="bitfun-migration-panel__row"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="reference"
                  data-bitfun-status="done"
                >
                  <Icon glyph={doc.kind === 'ledger' ? Sheet : FileText} size="xs" tone="muted" />
                  <StatusPill tone="neutral">{t(`references.${doc.kind}`)}</StatusPill>
                  <button
                    type="button"
                    className="bitfun-migration-panel__link bitfun-migration-panel__grow"
                    data-overflow-trigger
                    onClick={() => openPath(doc.path, workspacePath)}
                    title={doc.path}
                  >
                    <OverflowText>{doc.label}</OverflowText>
                  </button>
                  {doc.rows !== undefined && (
                    <span className="bitfun-migration-panel__muted">{t('references.rows', { n: doc.rows })}</span>
                  )}
                </li>
              ))}
              {snapshot.knowledge.map((ref) => (
                <li
                  key={`kb:${ref.id}`}
                  className="bitfun-migration-panel__row"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="reference"
                  data-bitfun-status="done"
                >
                  <Icon glyph={BookOpen} size="xs" tone="muted" />
                  <StatusPill tone="neutral">{t('references.knowledge')}</StatusPill>
                  {ref.snapshotPath ? (
                    <button
                      type="button"
                      className="bitfun-migration-panel__link bitfun-migration-panel__grow"
                      data-overflow-trigger
                      onClick={() => openPath(joinSegments(snapshot.appRoot, ref.snapshotPath!), workspacePath)}
                      title={ref.snapshotPath}
                    >
                      <OverflowText>{ref.sourcePath}</OverflowText>
                    </button>
                  ) : (
                    <OverflowText className="bitfun-migration-panel__grow">{ref.sourcePath}</OverflowText>
                  )}
                  {ref.modified === 'yes' && <span className="bitfun-migration-panel__muted">{t('references.modified')}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <footer
        className="bitfun-migration-panel__footer"
        data-bitfun-product-component="migration-progress-panel"
        data-bitfun-product-part="footer"
        data-testid="migration-progress-root-path"
        title={snapshot.ledgerRoot}
      >
        <span>{mode === 'watch' ? t('header.modeWatch') : t('header.modePoll')}</span>
        <span aria-hidden>·</span>
        <OverflowText className="bitfun-migration-panel__path">{rootLabel}</OverflowText>
        {rootOutside && <StatusPill tone="warning">{t('header.rootOutside')}</StatusPill>}
        <Button
          variant="text"
          size="xs"
          onClick={() => openPath(joinSegments(snapshot.ledgerRoot, 'STATE.md'), workspacePath)}
        >
          {t('header.openState')}
        </Button>
      </footer>
    </div>
  );
};

export default MigrationProgressPanel;
