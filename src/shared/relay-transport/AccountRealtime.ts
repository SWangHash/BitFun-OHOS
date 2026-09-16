import { DEFAULT_RPC_TIMEOUT_MS } from './RpcPolicy';
/** Shared account connection. Protocol reference: Happy apiSocket/RpcHandlerManager. */
import { io, type Socket } from 'socket.io-client';
import { RpcPayload } from './RpcPayload';

export interface DurableMessage {
  id: string;
  seq: number;
  localId: string;
  content: { t: 'encrypted'; c: string };
  createdAt: number;
  updatedAt: number;
}
export interface SessionMessageUpdate {
  id: string;
  seq: number;
  createdAt: number;
  body: { t: 'new-message'; sid: string; message: DurableMessage };
}
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'closed';
export interface RealtimeOptions {
  url: string;
  token: string;
  machineId?: string;
}

/** One owner per account. Reconnect reauthenticates and signals catch-up; it
 * does not retransmit mutations whose outcome is unknown. */
export class AccountRealtime {
  private readonly socket: Socket;
  private readonly payloads: RpcPayload;
  private epoch = 0;
  private closed = false;
  private readonly updates = new Set<(update: SessionMessageUpdate) => void>();
  private readonly reconnects = new Set<() => void>();
  private readonly directoryChanges = new Set<() => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = 'connecting';

  constructor(options: RealtimeOptions) {
    this.payloads = new RpcPayload(options.url, options.token);
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid Relay URL');
    }
    const path = `${url.pathname.replace(/\/$/, '')}/v1/updates`;
    this.socket = io(url.origin, {
      path, transports: ['websocket'], forceNew: true, autoConnect: false,
      auth: { token: options.token, clientType: options.machineId ? 'machine-scoped' : 'user-scoped',
        ...(options.machineId ? { machineId: options.machineId } : {}) },
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      randomizationFactor: 0.5, timeout: 15000,
    });
    this.socket.on('auth-ok', () => {
      if (this.closed) return;
      this.epoch++;
      this.setStatus('connected');
      for (const listener of this.reconnects) listener();
    });
    this.socket.on('disconnect', () => {
      this.epoch++;
      if (!this.closed) this.setStatus('disconnected');
    });
    this.socket.on('connect_error', () => {
      if (!this.closed) this.setStatus('disconnected');
    });
    this.socket.on('ephemeral', (event: unknown) => {
      if (this.closed || !event || typeof event !== 'object'
        || (event as { type?: unknown }).type !== 'device-presence') return;
      for (const listener of this.directoryChanges) listener();
    });
    this.socket.on('update', (update: unknown) => {
      if (this.closed || !isSessionMessageUpdate(update)) return;
      for (const listener of this.updates) listener(update);
    });
    this.socket.connect();
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener); listener(this.status);
    return () => { this.statusListeners.delete(listener); };
  }
  onReconnect(listener: () => void): () => void {
    this.reconnects.add(listener);
    return () => { this.reconnects.delete(listener); };
  }
  onDeviceDirectoryChanged(listener: () => void): () => void {
    this.directoryChanges.add(listener);
    return () => { this.directoryChanges.delete(listener); };
  }
  onUpdate(listener: (update: SessionMessageUpdate) => void): () => void {
    this.updates.add(listener);
    return () => { this.updates.delete(listener); };
  }
  private async ready(): Promise<void> {
    if (this.closed) throw new Error('Relay is closed');
    if (this.socket.connected && this.status === 'connected') return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error('Relay connection timed out; request was not submitted')); }, 15000);
      const listener = (status: ConnectionStatus) => {
        if (status === 'connected' || status === 'closed') {
          clearTimeout(timer); stop();
          if (status === 'connected') resolve(); else reject(new Error('Relay is closed'));
        }
      };
      const stop = () => { this.statusListeners.delete(listener); };
      this.statusListeners.add(listener);
      listener(this.status);
    });
  }
  async call<T>(deviceId: string, encryptedParams: unknown, options: { timeoutMs?: number; beforeSend?: () => void } = {}): Promise<T> {
    if (this.closed) throw new Error('Relay is closed; request was not submitted');
      await this.ready();
      options.beforeSend?.();
      const epoch = this.epoch;
      const params = await this.payloads.uploadIfLarge(encryptedParams);
      options.beforeSend?.();
      if (this.closed || this.epoch !== epoch || this.status !== 'connected') {
        throw new Error('Relay connection changed; request was not submitted');
      }
      const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid RPC timeout');
      const response = await this.socket.timeout(timeoutMs).emitWithAck('rpc-call', {
        method: `${deviceId}:invoke`, params, timeoutMs,
      });
      if (this.closed || this.epoch !== epoch) throw new Error('Relay connection changed; delivery outcome is unknown');
      if (!response || response.ok !== true) throw new Error(response?.error ?? 'Relay RPC failed');
      const result = await this.payloads.resolve(response.result);
      options.beforeSend?.();
      if (this.closed || this.epoch !== epoch) throw new Error('Relay connection changed; delivery outcome is unknown');
      return result as T;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.epoch++;
    this.payloads.close();
    this.socket.disconnect();
    this.socket.removeAllListeners();
    this.setStatus('closed');
    this.statusListeners.clear(); this.reconnects.clear(); this.updates.clear(); this.directoryChanges.clear();
  }
}

function isSessionMessageUpdate(value: unknown): value is SessionMessageUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Partial<SessionMessageUpdate>;
  const message = update.body?.message;
  return update.body?.t === 'new-message' && typeof update.body.sid === 'string'
    && Number.isSafeInteger(update.seq) && !!message && Number.isSafeInteger(message.seq)
    && message.seq > 0 && typeof message.id === 'string'
    && typeof message.localId === 'string' && message.content?.t === 'encrypted'
    && typeof message.content.c === 'string';
}

export interface MessagePage { messages: DurableMessage[]; hasMore: boolean }
export interface MessageReplica {
  /** Durable receive cursor. Upload acknowledgements never write this value. */
  cursor(): Promise<number>;
  /** Commit messages and cursor together, after decryption/application succeeds. */
  apply(messages: readonly DurableMessage[], cursor: number): Promise<void>;
}

/** Happy's after_seq recovery with a single in-flight reader and invalidation
 * coalescing. Live updates wake this owner; they do not race a second reducer.
 * The replica commits only contiguous messages, including our own echoes. */
export class SessionSync {
  private dirty = false;
  private fetchRequired = true;
  private running: Promise<void> | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private readonly pending = new Map<number, DurableMessage>();
  private readonly stopUpdate: () => void;
  private readonly stopReconnect: () => void;
  constructor(
    connection: Pick<AccountRealtime, 'onUpdate' | 'onReconnect'>,
    sessionId: string,
    private readonly replica: MessageReplica,
    private readonly fetchAfter: (cursor: number) => Promise<MessagePage>,
    private readonly onError: (error: unknown) => void,
    private readonly onCaughtUp: () => void = () => {},
  ) {
    this.stopUpdate = connection.onUpdate(update => {
      if (update.body.sid !== sessionId || this.closed) return;
      if (this.pending.size >= 100) {
        // The committed log is the delivery authority. A burst can collapse
        // its notifications without discarding any committed message.
        this.pending.clear(); this.fetchRequired = true;
      }
      this.pending.set(update.body.message.seq, update.body.message);
      this.wake();
    });
    this.stopReconnect = connection.onReconnect(() => this.invalidate());
    this.invalidate();
  }
  invalidate(): void { this.fetchRequired = true; this.wake(); }
  private wake(): void {
    if (this.closed) return;
    this.dirty = true;
    if (this.running || this.retry) return;
    this.running = this.drain().then(() => { this.retryDelay = 1000; if (!this.closed) this.onCaughtUp(); }).catch(error => {
      if (this.closed) return;
      this.fetchRequired = true;
      this.retry = setTimeout(() => { this.retry = null; this.wake(); }, this.retryDelay);
      this.retryDelay = Math.min(30000, this.retryDelay * 2);
      this.onError(error);
    }).finally(() => {
      this.running = null;
      if (this.dirty && !this.closed && !this.retry) this.wake();
    });
  }
  private async drain(): Promise<void> {
    while (this.dirty && !this.closed) {
      this.dirty = false;
      let cursor = await this.replica.cursor();
      for (const seq of this.pending.keys()) if (seq <= cursor) this.pending.delete(seq);
      const contiguous: DurableMessage[] = [];
      while (this.pending.has(cursor + contiguous.length + 1)) {
        contiguous.push(this.pending.get(cursor + contiguous.length + 1)!);
      }
      if (contiguous.length) {
        if (this.closed) return;
        await this.replica.apply(contiguous, cursor + contiguous.length);
        for (const message of contiguous) this.pending.delete(message.seq);
        cursor += contiguous.length;
      }
      if (!this.fetchRequired && this.pending.size === 0) continue;
      this.fetchRequired = false;
      let more = true;
      while (more && !this.closed) {
        const page = await this.fetchAfter(cursor);
        if (this.closed) return;
        let next = cursor;
        for (const message of page.messages) {
          if (message.seq !== next + 1) throw new Error('Relay message sequence is not contiguous');
          next = message.seq;
        }
        if (page.hasMore && next === cursor) throw new Error('Relay message pagination did not advance');
        if (next > cursor) {
          await this.replica.apply(page.messages, next);
          for (const message of page.messages) this.pending.delete(message.seq);
        }
        cursor = next;
        more = page.hasMore;
      }
      for (const seq of this.pending.keys()) if (seq <= cursor) this.pending.delete(seq);
      if (this.pending.has(cursor + 1)) this.dirty = true;
      else if (this.pending.size > 0) throw new Error('Relay log has not supplied the notified message sequence');
    }
  }
  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.pending.clear(); this.stopUpdate(); this.stopReconnect();
  }
}
