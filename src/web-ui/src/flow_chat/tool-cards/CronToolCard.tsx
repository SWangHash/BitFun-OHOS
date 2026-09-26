import React, { useMemo, useState } from 'react';
import { CronToolCard as CronToolCardView } from '@bitfun/ui/flow-chat';
import { useI18n } from '@/infrastructure/i18n';
import type { CronSchedule } from '@/infrastructure/api';
import { formatDateTime, formatScheduleSummary } from '@/app/scenes/todos/todoPresentation';
import type { ToolCardProps } from '../types/flow-chat';
import { useToolCardHeightContract } from './useToolCardHeightContract';

type CronAction = 'get_time' | 'list' | 'add' | 'update' | 'remove' | 'run';

/**
 * Schedule shape emitted by the backend `Cron` tool.
 *
 * It intentionally differs from the `CronJob` wire shape used by the scheduled
 * job APIs: the tool speaks seconds and ISO strings so a model can write them,
 * while the service stores milliseconds.
 */
interface CronToolSchedule {
  kind?: 'at' | 'every' | 'cron';
  at?: string;
  every?: number;
  anchor?: string;
  expr?: string;
  tz?: string;
}

interface CronToolJobState {
  nextRunAtMs?: number | null;
  pendingTriggerAtMs?: number | null;
  retryAtMs?: number | null;
  lastRunStatus?: string | null;
  lastError?: string | null;
}

interface CronToolJob {
  id?: string;
  name?: string;
  schedule?: CronToolSchedule;
  payload?: string;
  enabled?: boolean;
  sessionId?: string;
  workspacePath?: string;
  state?: CronToolJobState;
}

interface CronToolJobInput {
  name?: string;
  schedule?: CronToolSchedule;
  payload?: string;
  enabled?: boolean;
}

interface CronToolInput {
  action?: CronAction;
  session_id?: string;
  job_id?: string;
  job?: CronToolJobInput;
  patch?: CronToolJobInput;
}

interface CronToolResult {
  success?: boolean;
  action?: CronAction;
  now?: string;
  workspace?: string;
  session_id?: string;
  job_id?: string;
  count?: number;
  deleted?: boolean;
  job?: CronToolJob;
  jobs?: CronToolJob[];
}

function parseData<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    return typeof value === 'string' ? JSON.parse(value) as T : value as T;
  } catch {
    return null;
  }
}

/** Convert the tool's seconds/ISO schedule into the service wire shape. */
function toCronSchedule(schedule: CronToolSchedule | undefined): CronSchedule | null {
  if (!schedule) return null;

  if (schedule.kind === 'at') {
    return schedule.at ? { kind: 'at', at: schedule.at } : null;
  }
  if (schedule.kind === 'every') {
    if (!Number.isFinite(schedule.every)) return null;
    const anchorMs = schedule.anchor ? new Date(schedule.anchor).getTime() : null;
    return {
      kind: 'every',
      everyMs: Number(schedule.every) * 1000,
      anchorMs: Number.isFinite(anchorMs) ? anchorMs : null,
    };
  }
  if (schedule.kind === 'cron') {
    return schedule.expr ? { kind: 'cron', expr: schedule.expr, tz: schedule.tz ?? null } : null;
  }
  return null;
}

/** Timestamp the scheduler will actually act on next, mirroring getNextExecutionAtMs. */
function nextExecutionAtMs(state: CronToolJobState | undefined): number | null {
  if (!state) return null;
  return state.pendingTriggerAtMs ?? state.retryAtMs ?? state.nextRunAtMs ?? null;
}

export const CronToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t, formatDate } = useI18n('flow-chat');
  const { t: tTodos } = useI18n('scenes/todos');
  const { toolCall, toolResult, status } = toolItem;
  const [isExpanded, setIsExpanded] = useState(false);
  const toolId = toolItem.id ?? toolCall?.id;
  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
    toolId,
    toolName: toolItem.toolName,
  });

  const inputData = useMemo(
    () => parseData<CronToolInput>(toolCall?.input) ?? {},
    [toolCall?.input]
  );

  const resultData = useMemo(
    () => parseData<CronToolResult>(toolResult?.result),
    [toolResult?.result]
  );

  const action = resultData?.action ?? inputData.action ?? 'list';
  const job = resultData?.job;
  const jobs = useMemo(
    () => (Array.isArray(resultData?.jobs) ? resultData.jobs : []),
    [resultData?.jobs]
  );
  const jobId = job?.id ?? resultData?.job_id ?? inputData.job_id;
  const jobName = job?.name
    ?? inputData.job?.name
    ?? inputData.patch?.name
    ?? jobId
    ?? t('toolCards.cron.unknownJob');
  const payload = job?.payload ?? inputData.job?.payload ?? inputData.patch?.payload;
  const workspace = job?.workspacePath ?? resultData?.workspace;
  const sessionId = job?.sessionId ?? resultData?.session_id ?? inputData.session_id;
  const jobCount = resultData?.count ?? jobs.length;

  const describeSchedule = useMemo(() => (schedule: CronToolSchedule | undefined): string | null => {
    const converted = toCronSchedule(schedule);
    return converted ? formatScheduleSummary(converted, tTodos, formatDate) : null;
  }, [formatDate, tTodos]);

  const scheduleText = describeSchedule(job?.schedule ?? inputData.job?.schedule ?? inputData.patch?.schedule);
  const nextRunMs = nextExecutionAtMs(job?.state);
  const nextRunText = nextRunMs != null ? formatDateTime(nextRunMs, formatDate) : null;
  const enabled = job?.enabled ?? inputData.job?.enabled ?? inputData.patch?.enabled;
  const lastRunStatus = job?.state?.lastRunStatus ?? null;
  const lastError = job?.state?.lastError ?? null;

  const fields = useMemo(() => {
    if (action === 'get_time') {
      return resultData?.now
        ? [{ label: `${t('toolCards.cron.currentTime')}:`, value: resultData.now }]
        : [];
    }

    if (action === 'list') {
      return jobs.map((item) => ({
        label: `${item.name ?? item.id ?? t('toolCards.cron.unknownJob')}:`,
        value: describeSchedule(item.schedule) ?? item.id ?? '-',
      }));
    }

    return [
      scheduleText ? { label: `${t('toolCards.cron.schedule')}:`, value: scheduleText } : null,
      nextRunText ? { label: `${t('toolCards.cron.nextRun')}:`, value: nextRunText } : null,
      enabled !== undefined ? {
        label: `${t('toolCards.cron.enabled')}:`,
        value: enabled ? t('toolCards.cron.enabledYes') : t('toolCards.cron.enabledNo'),
      } : null,
      lastRunStatus ? { label: `${t('toolCards.cron.lastRunStatus')}:`, value: lastRunStatus } : null,
      lastError ? { label: `${t('toolCards.cron.lastError')}:`, value: lastError } : null,
      jobId ? { label: `${t('toolCards.cron.jobId')}:`, value: jobId } : null,
      sessionId ? { label: `${t('toolCards.cron.sessionId')}:`, value: sessionId } : null,
      workspace ? { label: `${t('toolCards.cron.workspace')}:`, value: workspace } : null,
    ].filter((field): field is NonNullable<typeof field> => Boolean(field));
  }, [
    action,
    describeSchedule,
    enabled,
    jobId,
    jobs,
    lastError,
    lastRunStatus,
    nextRunText,
    resultData?.now,
    scheduleText,
    sessionId,
    t,
    workspace,
  ]);

  const emptyState = action === 'list' && jobs.length === 0 && status === 'completed'
    ? t('toolCards.cron.noJobs')
    : undefined;
  const message = action === 'add' || action === 'update' ? payload : undefined;
  const hasDetails = Boolean(fields.length || emptyState || message || toolResult?.error);

  const renderSummary = () => {
    if (status === 'error' || status === 'cancelled') {
      return t('toolCards.cron.actionFailed');
    }

    const running = status === 'running' || status === 'streaming';

    switch (action) {
      case 'get_time':
        if (status === 'completed') {
          return t('toolCards.cron.gotTime', { time: resultData?.now ?? '' });
        }
        return running ? t('toolCards.cron.gettingTime') : t('toolCards.cron.preparingGetTime');
      case 'add':
        if (status === 'completed') return t('toolCards.cron.addedJob', { name: jobName });
        return running
          ? t('toolCards.cron.addingJob', { name: jobName })
          : t('toolCards.cron.preparingAdd', { name: jobName });
      case 'update':
        if (status === 'completed') return t('toolCards.cron.updatedJob', { name: jobName });
        return running
          ? t('toolCards.cron.updatingJob', { name: jobName })
          : t('toolCards.cron.preparingUpdate', { name: jobName });
      case 'remove':
        if (status === 'completed') {
          return resultData?.deleted === false
            ? t('toolCards.cron.jobNotFound', { name: jobName })
            : t('toolCards.cron.removedJob', { name: jobName });
        }
        return running
          ? t('toolCards.cron.removingJob', { name: jobName })
          : t('toolCards.cron.preparingRemove', { name: jobName });
      case 'run':
        if (status === 'completed') return t('toolCards.cron.ranJob', { name: jobName });
        return running
          ? t('toolCards.cron.runningJob', { name: jobName })
          : t('toolCards.cron.preparingRun', { name: jobName });
      case 'list':
      default:
        if (status === 'completed') return t('toolCards.cron.listedJobs', { count: jobCount });
        return running ? t('toolCards.cron.listingJobs') : t('toolCards.cron.preparingList');
    }
  };

  return (
    <div ref={cardRootRef} data-bitfun-adapter="cron" data-tool-card-id={toolId ?? ''}>
      <CronToolCardView
        status={status}
        isExpanded={isExpanded}
        onToggle={hasDetails
          ? () => applyExpandedState(isExpanded, !isExpanded, setIsExpanded)
          : undefined}
        action={`${t('toolCards.cron.title')}:`}
        summary={renderSummary()}
        fields={fields}
        message={message}
        messageLabel={message ? t('toolCards.cron.payload') : undefined}
        emptyState={emptyState}
        error={toolResult?.error}
      />
    </div>
  );
});
