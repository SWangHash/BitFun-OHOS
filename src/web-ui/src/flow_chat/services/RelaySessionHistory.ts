import { remoteConnectAPI } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import type { SessionRecord } from '../session-stream/SessionRecordReplica';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('RelaySessionHistory');

export interface RelayHistoryReady {
  sessionId: string;
  hasMore: boolean;
  oldestSeq: number;
  cursor: number;
}

/** One session subscription, shared by opening history and receiving live records. */
export class RelaySessionHistory {
  private readonly scope = getActiveSurfaceScope();
  private readonly listeners: Array<() => void> = [];
  private subscriptionId: string | null = null;
  private closed = false;
  private ready: RelayHistoryReady | null = null;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;
  private readonly firstPage = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });
  private opening: Promise<void> | null = null;
  private older: Promise<boolean> | null = null;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private pageApplied: (() => void) | null = null;
  private rejectPage: ((error: unknown) => void) | null = null;

  constructor(
    readonly sessionId: string,
    onRecord: (record: SessionRecord) => void,
    onReady: (ready: RelayHistoryReady) => void,
    onError: (error: unknown) => void,
    onResumed?: () => Promise<void>,
  ) {
    // Register before asking Rust to replay its cache or fetch the first page.
    this.listeners.push(remoteConnectAPI.onSessionRecord(value => {
      if (!this.isCurrent()) return;
      const record = value as SessionRecord;
      if (record.sessionId !== this.sessionId) return;
      try { onRecord(record); } catch (error) { this.rejectReady(error); this.rejectPage?.(error); onError(error); }
    }));
    this.listeners.push(remoteConnectAPI.onSessionSyncError(error => {
      if (!this.isCurrent() || error.sessionId !== this.sessionId || error.targetDeviceId !== this.scope.surfaceId) return;
      this.rejectReady(new Error(error.message));
      this.rejectPage?.(new Error(error.message));
      onError(new Error(error.message));
    }));
    this.listeners.push(remoteConnectAPI.onSessionReady(ready => {
      if (!this.isCurrent() || ready.sessionId !== this.sessionId) return;
      const resumed = this.pageApplied === null;
      this.ready = ready;
      if (resumed && onResumed) void onResumed().catch(error => {
        log.warn('Session interaction mailbox refresh failed', { sessionId: this.sessionId, error });
      });
      onReady(ready);
      this.resolveReady();
      this.pageApplied?.();
    }));
    this.listeners.push(remoteConnectAPI.onSessionInteractionChanged(event => {
      if (!this.isCurrent() || event.sessionId !== this.sessionId || !onResumed) return;
      void onResumed().catch(error => log.warn('Session interaction mailbox refresh failed', {sessionId:this.sessionId,error}));
    }));
    // A closed subscription may never have had an open() caller.
    void this.firstPage.catch(() => {});
  }

  private isCurrent(): boolean { return !this.closed && this.scope.isCurrent(); }

  open(): Promise<void> {
    if (!this.opening) this.opening = this.start();
    return this.opening;
  }

  private async start(): Promise<void> {
    this.scope.assertCurrent('open relay session history');
    if (this.closed) throw new Error('Session subscription is closed');
    try {
      const id = await remoteConnectAPI.subscribeSession(this.scope.surfaceId, this.sessionId);
      if (!this.isCurrent()) {
        await remoteConnectAPI.unsubscribeSession(id);
        this.scope.assertCurrent('finish opening relay session history');
        throw new Error('Session subscription is closed');
      }
      this.subscriptionId = id;
      await this.firstPage;
      this.scheduleHistoryPrefetch();
    } catch (error) {
      this.rejectReady(error);
      this.close();
      throw error;
    }
  }

  // Happy sync.ts fetchOlderMessagesInBackground: paint the latest page first,
  // then reuse the same older-page owner and yield between bounded pages.
  private scheduleHistoryPrefetch(): void {
    if (!this.isCurrent() || !this.ready?.hasMore || this.historyTimer !== null) return;
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      if (!this.isCurrent()) return;
      void this.loadOlder().then(() => this.scheduleHistoryPrefetch()).catch(error => {
        log.warn('Session history prefetch stopped', { sessionId: this.sessionId, error });
      });
    }, 250);
  }

  loadOlder(): Promise<boolean> {
    if (!this.older) this.older = this.readOlder().finally(() => { this.older = null; });
    return this.older;
  }

  private async readOlder(): Promise<boolean> {
    await this.open();
    this.scope.assertCurrent('load older relay history');
    if (!this.ready?.hasMore) return false;
    if (!this.subscriptionId) throw new Error('Session subscription is closed');
    const applied = new Promise<void>((resolve, reject) => { this.pageApplied = resolve; this.rejectPage = reject; });
    try {
      await Promise.all([remoteConnectAPI.loadOlderSession(this.subscriptionId), applied]);
    } finally { this.pageApplied = null; this.rejectPage = null; }
    this.scope.assertCurrent('finish loading older relay history');
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.historyTimer !== null) clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.listeners.splice(0).forEach(unlisten => unlisten());
    this.rejectReady(new Error('Session subscription closed'));
    this.rejectPage?.(new Error('Session subscription closed'));
    if (this.subscriptionId) {
      void remoteConnectAPI.unsubscribeSession(this.subscriptionId).catch(error => log.warn('Session unsubscribe failed', { error }));
      this.subscriptionId = null;
    }
  }
}
