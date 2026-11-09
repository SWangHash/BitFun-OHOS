/**
 * Qt -> HarmonyOS migration progress panel (session aux pane tab).
 *
 * Single page, read-only view of `<container>/migration/ohos/` ledgers produced by the
 * built-in `ohos-qt-skills` skill. Built on the `@bitfun/ui` design
 * system components; appearance hooks use `data-bitfun-product-*`:
 *   header (project name, live pill, overall percent, 8-segment phase strip,
 *   "now" card with heartbeat / current action, notices) ->
 *   disclosures (pending decisions, phase timeline, external features,
 *   problems & diagnostics, references incl. migration documents).
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
  Package,
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
  FeatureAnswerView,
  FeatureGateView,
  MigrationLiveStatus,
  MigrationSnapshot,
  MigrationStatus,
  PhaseNoteView,
  PhaseView,
} from '../model/types';
import {
  acquireLedgerRoot,
  ledgerRootHasState,
  refreshLedgerRoot,
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

const LIVE_TONES: Record<MigrationLiveStatus, StatusPillTone> = {
  active: 'accent',
  blocked: 'warning',
  completed: 'success',
  ended: 'warning',
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
          {header.scope.outputProject && (
            <span
              data-bitfun-product-component="migration-progress-panel"
              data-bitfun-product-part="scope"
              title={header.scope.revision || undefined}
            >
              {`${t('header.outputProject')} ${header.scope.outputProject}`}
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
  const ended = header.liveStatus === 'ended';
  const gateNotReady = header.completedGateNotReady;
  const problem = error
    ? t('errors.loadFailed', { error })
    : snapshot.schemaWarnings.length > 0
      ? t('warnings.legacyLayout', { detail: snapshot.schemaWarnings.join('; ') })
      : undefined;
  if (!completed && !ended && !problem) return null;
  return (
    <div
      className="bitfun-migration-panel__notices"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="notice"
    >
      {(completed || ended) && (
        <Alert
          tone={gateNotReady || ended ? 'warning' : 'success'}
          showIcon
          message={t(ended ? 'header.ended' : 'header.completed')}
          description={gateNotReady
            ? `${t('header.completedGateNotReady', { n: gateNotReady.unmetCount })}${gateNotReady.unmet[0] ? `: ${gateNotReady.unmet[0]}` : ''}`
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
      title={when}
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="gatePill"
      data-bitfun-status={ready ? 'done' : 'blocked'}
      data-testid={`migration-progress-gate-${phase.id}`}
    >
      {ready ? t('gate.ready') : t('gate.notReady', { n: gate.unmetCount })}
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

const NOTE_STATUS: Record<PhaseNoteView['tone'], MigrationStatus> = {
  neutral: 'pending',
  success: 'done',
  warning: 'blocked',
  error: 'error',
};

/** A fact of the phase that is not a ledger row (problem counts, device run). */
function PhaseNoteRow({ note, t }: { note: PhaseNoteView; t: TFn }) {
  return (
    <li
      className="bitfun-migration-panel__row"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="phaseNote"
      data-bitfun-status={NOTE_STATUS[note.tone]}
    >
      <StatusGlyph status={NOTE_STATUS[note.tone]} paused />
      <OverflowText className="bitfun-migration-panel__grow">{t(`phase.notes.${note.kind}`, note.values)}</OverflowText>
    </li>
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
  const notReadyGate = phase.gate?.verdict === 'not-ready' ? phase.gate : undefined;
  const [expanded, setExpanded] = useState(current || phase.status === 'blocked' || phase.status === 'error');
  useEffect(() => {
    if (current) setExpanded(true);
  }, [current]);
  const hasItems = phase.items.length > 0;
  // Environment rows: only the version shows a tooltip (the item's path).
  const isEnvironment = phase.id === 'environment';
  const expandable = hasItems || !!phase.notes?.length || !!notReadyGate || !!todos || current;
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
        <span className="bitfun-migration-panel__phase-sub" title={phase.rawStatus || undefined}>
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
          {notReadyGate && notReadyGate.unmet.length > 0 && (
            <div
              className="bitfun-migration-panel__unmet"
              data-bitfun-product-component="migration-progress-panel"
              data-bitfun-product-part="gateUnmet"
            >
              <p className="bitfun-migration-panel__unmet-title">
                {notReadyGate.invalid ? t('gate.invalid') : t('gate.unmetTitle')}
              </p>
              <ul>
                {notReadyGate.unmet.map((entry, index) => <li key={`${index}:${entry}`}>{entry}</li>)}
                {notReadyGate.unmetCount > notReadyGate.unmet.length && (
                  <li className="bitfun-migration-panel__muted">
                    {t('gate.more', { n: notReadyGate.unmetCount - notReadyGate.unmet.length })}
                  </li>
                )}
              </ul>
            </div>
          )}
          {phase.notes && phase.notes.length > 0 && (
            <ul
              className="bitfun-migration-panel__items"
              data-bitfun-product-component="migration-progress-panel"
              data-bitfun-product-part="phaseNotes"
            >
              {phase.notes.map((note) => <PhaseNoteRow key={note.kind} note={note} t={t} />)}
            </ul>
          )}
          {hasItems ? (
            <ul className="bitfun-migration-panel__items">
              {phase.items.map((entry) => (
                <li
                  key={entry.id}
                  className="bitfun-migration-panel__row bitfun-migration-panel__item-row"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="item"
                  data-bitfun-status={entry.status}
                  title={isEnvironment ? undefined : entry.rawStatus}
                >
                  <StatusGlyph status={entry.status} paused={entry.status === 'doing' && !sessionRunning} />
                  <span className="bitfun-migration-panel__id">{entry.id}</span>
                  <OverflowText className="bitfun-migration-panel__grow">{entry.label}</OverflowText>
                  <span className="bitfun-migration-panel__item-trail">
                    {entry.detail && (
                      <span
                        className="bitfun-migration-panel__item-detail"
                        title={isEnvironment ? entry.hint : entry.detail}
                      >
                        {entry.detail}
                      </span>
                    )}
                    {entry.tags?.map((tag) => <code key={tag} className="bitfun-migration-panel__code">{tag}</code>)}
                    {entry.notice && entry.notice.tone !== 'error' && (
                      <StatusPill tone={entry.notice.tone === 'warning' ? 'warning' : 'neutral'}>
                        {t(`phase.notice.${entry.notice.tone}`)}
                      </StatusPill>
                    )}
                    {entry.decidedByAgent && (
                      <StatusPill tone="warning">{t('phase.decidedByAgent')}</StatusPill>
                    )}
                  </span>
                  {entry.notice && (
                    <p
                      className={`bitfun-migration-panel__item-note bitfun-migration-panel__item-note--${entry.notice.tone}`}
                    >
                      {entry.notice.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : !phase.notes?.length && (
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

const PROBLEM_TONES: Partial<Record<MigrationStatus, StatusPillTone>> = {
  error: 'danger',
  blocked: 'warning',
  done: 'success',
};

/** One problem of diagnostics.tsv: where it showed, what was seen, why, and what fixes it. */
function ProblemCard({ diagnostic, workspacePath, t }: { diagnostic: DiagnosticView; workspacePath?: string; t: TFn }) {
  const label = diagnostic.open
    ? t('diagnostics.open')
    : diagnostic.status === 'blocked' ? t('status.blocked')
      : diagnostic.rawStatus === 'accepted-limitation' ? t('diagnostics.accepted') : t('diagnostics.fixed');
  return (
    <li
      className="bitfun-migration-panel__card"
      data-bitfun-product-component="migration-progress-panel"
      data-bitfun-product-part="diagnostic"
      data-bitfun-status={diagnostic.status}
    >
      <div className="bitfun-migration-panel__card-head">
        <StatusGlyph status={diagnostic.status} paused />
        <span className="bitfun-migration-panel__id">{diagnostic.id}</span>
        {diagnostic.stage && <code className="bitfun-migration-panel__code">{diagnostic.stage}</code>}
        <StatusPill tone={PROBLEM_TONES[diagnostic.status] ?? 'neutral'} title={diagnostic.rawStatus}>{label}</StatusPill>
        {diagnostic.where && (
          <OverflowText className="bitfun-migration-panel__grow bitfun-migration-panel__muted">{diagnostic.where}</OverflowText>
        )}
      </div>
      {diagnostic.symptom && <code className="bitfun-migration-panel__signature">{diagnostic.symptom}</code>}
      {diagnostic.cause
        ? <p>{t('diagnostics.cause')}: {diagnostic.cause}</p>
        : diagnostic.needsCause && <p className="bitfun-migration-panel__unmet">{t('diagnostics.needsCause')}</p>}
      {diagnostic.fix && (
        <p className={diagnostic.open ? 'bitfun-migration-panel__muted' : undefined}>
          {diagnostic.open ? t('diagnostics.plannedFix') : t('diagnostics.fix')}: {diagnostic.fix}
        </p>
      )}
      {diagnostic.reproduce && (
        <p className="bitfun-migration-panel__muted" title={diagnostic.reproduce}>
          <OverflowText>{`${t('diagnostics.reproduce')}: ${diagnostic.reproduce}`}</OverflowText>
        </p>
      )}
      <DiagnosticLogButton diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
    </li>
  );
}

// ------------------------------------------------------ external features

const FEATURE_GATE_TONES: Record<FeatureGateView['verdict'], StatusPillTone> = {
  ready: 'success',
  'not-ready': 'warning',
};

/** Lifecycle words of features.tsv with a dedicated label; anything else uses the generic status. */
const FEATURE_RAW_STATUSES = new Set(['planned', 'in-progress', 'passed', 'deferred-approved', 'blocked', 'verified']);

function featureStatusLabel(feature: ExternalFeatureView, t: TFn): string {
  const raw = feature.rawStatus.toLowerCase();
  return FEATURE_RAW_STATUSES.has(raw) ? t(`features.status.${raw}`) : statusLabel(feature.status, t);
}

function FeatureGateRow({ kind, gate, t }: { kind: 'entry' | 'exit'; gate: FeatureGateView; t: TFn }) {
  const verdict = gate.verdict === 'not-ready'
    ? t('features.gate.notReady', { n: gate.unmetCount ?? 0 })
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
        leading={<Icon glyph={gate.verdict === 'not-ready' ? ShieldAlert : ShieldCheck} size="2xs" />}
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

      {feature.answers.length > 0 && (
        <div
          className="bitfun-migration-panel__feature-answers"
          data-bitfun-product-component="migration-progress-panel"
          data-bitfun-product-part="featureAnswers"
          data-testid={`migration-progress-feature-answers-${feature.id}`}
        >
          {feature.answers.map((answer, index) => (
            <FeatureAnswerRow key={`${answer.context}-${index}`} answer={answer} t={t} />
          ))}
        </div>
      )}

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

/** One answer the user gave about a feature (recorded in its notes by the feature scripts). */
function FeatureAnswerRow({ answer, t }: { answer: FeatureAnswerView; t: TFn }) {
  return (
    <div className="bitfun-migration-panel__row" title={answer.text}>
      <span className="bitfun-migration-panel__label">
        {t(`features.answer.${answer.context}`, { status: answer.status ? t(`features.status.${answer.status}`) : '' })}
      </span>
      <OverflowText className="bitfun-migration-panel__grow">{answer.text}</OverflowText>
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
  /** The workspace's ledger root, resolved by useMigrationAutoOpen from the bound output container. */
  const storedRoot = useMigrationProgressStore((state) => (
    workspacePath ? state.ledgerRootByWorkspace[workspacePath] : undefined
  ));
  /** `undefined` = resolving, `null` = not found. */
  const [root, setRoot] = useState<string | null | undefined>(explicitRoot ?? storedRoot);
  const migrationSessionId = useMigrationProgressStore((state) => state.migrationSessionId);
  const sessionRunning = useMigrationProgressStore((state) => state.sessionRunning);
  const lastActivityAt = useMigrationProgressStore((state) => state.lastActivityAt);
  const activity = useMigrationProgressStore((state) => state.activity);
  const todos = useMigrationProgressStore((state) => state.todos);
  const now = useTick(sessionRunning ? LIVE_TICK_MS : IDLE_TICK_MS);
  const rootState = useMigrationProgressStore((state) => (root ? state.byRoot[root] : undefined));

  // Follow the ledger root of the workspace (or the explicit one).
  useEffect(() => {
    if (explicitRoot) {
      setRoot(explicitRoot);
      return;
    }
    if (!workspacePath) {
      setRoot(null);
      return;
    }
    setRoot(storedRoot);
  }, [explicitRoot, workspacePath, storedRoot]);

  // The panel exists only while the workspace holds `STATE.md`: once the
  // lookup (or a removal below) confirms there is none, close the tab.
  useEffect(() => {
    if (root !== null) return;
    if (workspacePath) useMigrationProgressStore.getState().unmarkLedgerWorkspace(workspacePath);
    closeMigrationProgressPanels();
  }, [root, workspacePath]);

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
  const currentPhase = snapshot?.header.currentPhase;
  const references = useMemo(
    () => (snapshot ? snapshot.documents.length : 0),
    [snapshot],
  );
  const problems = snapshot?.diagnostics ?? [];
  const openProblems = problems.some((entry) => entry.open);

  // Resolving / loading, or about to close because there is no ledger.
  if (!snapshot) return null;

  const currentAction = activity.find((entry) => entry.status === 'running') ?? activity[0];

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
        {snapshot.decisionsByAgent.length > 0 && (
          <Section id="agentDecisions" title={t('sections.agentDecisions')} count={snapshot.decisionsByAgent.length} warn>
            <p className="bitfun-migration-panel__muted">{t('agentDecisions.hint')}</p>
            <ul className="bitfun-migration-panel__list">
              {snapshot.decisionsByAgent.map((decision) => (
                <li
                  key={decision.id}
                  className="bitfun-migration-panel__card bitfun-migration-panel__card--decision"
                  data-bitfun-product-component="migration-progress-panel"
                  data-bitfun-product-part="agentDecision"
                >
                  <div className="bitfun-migration-panel__card-head">
                    <span className="bitfun-migration-panel__id">{decision.id}</span>
                    <span className="bitfun-migration-panel__card-title">{decision.question}</span>
                  </div>
                  {decision.answer && <p>{t('agentDecisions.selected')}: {decision.answer}</p>}
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

        {snapshot.externalFeatures.length > 0 && (
          <Section
            id="externalFeatures"
            title={t('sections.externalFeatures')}
            count={snapshot.externalFeatures.length}
            warn={snapshot.externalFeatures.some((feature) => feature.status === 'blocked' || feature.status === 'error')}
          >
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
          </Section>
        )}

        {problems.length > 0 && (
          <Section
            id="diagnostics"
            title={t('sections.diagnostics')}
            count={problems.length}
            warn={openProblems}
            defaultOpen={openProblems}
          >
            <ul className="bitfun-migration-panel__list">
              {problems.map((diagnostic) => (
                <ProblemCard key={diagnostic.id} diagnostic={diagnostic} workspacePath={workspacePath} t={t} />
              ))}
            </ul>
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
                  <Icon glyph={doc.kind === 'ledger' ? Sheet : doc.kind === 'artifact' ? Package : FileText} size="xs" tone="muted" />
                  <StatusPill tone="neutral">{t(`references.${doc.kind}`)}</StatusPill>
                  {doc.kind === 'artifact' ? (
                    // The deliverable is a binary (the .hap): show where it is, nothing to open.
                    <OverflowText className="bitfun-migration-panel__grow" title={doc.target}>
                      {doc.label}
                    </OverflowText>
                  ) : (
                    <button
                      type="button"
                      className="bitfun-migration-panel__link bitfun-migration-panel__grow"
                      data-overflow-trigger
                      onClick={() => openPath(doc.path, workspacePath)}
                      title={doc.path}
                    >
                      <OverflowText>{doc.label}</OverflowText>
                    </button>
                  )}
                  {doc.rows !== undefined && (
                    <span className="bitfun-migration-panel__muted">{t('references.rows', { n: doc.rows })}</span>
                  )}
                  {doc.target && (
                    <OverflowText className="bitfun-migration-panel__muted" title={doc.target}>{doc.target}</OverflowText>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
};

export default MigrationProgressPanel;
