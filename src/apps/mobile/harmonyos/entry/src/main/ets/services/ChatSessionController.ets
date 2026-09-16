import { PermissionControlOverlay, SessionInteractionMailbox } from './PermissionControlOverlay';
import { DurableSessionReducer } from './DurableSessionReducer';
import { DurableSessionStream, DurableSessionEvent } from './DurableSessionStream';
import {
  ChatMessage,
  RemoteModelCatalog
} from '../model/RemoteModels';
import { RemoteSessionManager } from './RemoteSessionManager';

export interface ChatSessionCursor {
  pollVersion: number;
  knownMessageCount: number;
  knownModelCatalogVersion: number;
}

export interface ChatSessionSnapshot {
  sessionId: string;
  cursor: ChatSessionCursor;
  changed: boolean;
  title: string;
  sessionState: string;
  newMessages: ChatMessage[];
  messageSnapshot?: ChatMessage[];
  activeTurn?: ChatMessage;
  modelCatalog?: RemoteModelCatalog;
  shouldSyncAfterTurnEnded: boolean;
  // The desktop now holds fewer messages than this session had counted, so the
  // transcript it was handing out tails of is no longer the one on screen.
  // Nothing below can resume from an offset into a list that shrank.
  historyRewritten: boolean;
  /** Exact completed turn whose terminal assistant is now durable. */
  completedTurnId: string;
  hasMoreMessages?: boolean;
}

export interface ChatSessionControllerCallbacks {
  onSnapshot: (snapshot: ChatSessionSnapshot) => void;
  onError: (error: Object) => void;
  canPoll: (sessionId: string) => boolean;
}

export interface ChatSessionControllerOptions {
  /** Stabilization window before the first idle poll after selecting a session. */
  initialPollDelayMs: number;
}


/** Like Happy's normalized message reducer, history and realtime are one
 * stable-id collection. No separately timed transcript snapshot is merged in. */
interface MailboxRequest { sessionId: string; }
interface MailboxArgs { request: MailboxRequest; }

export class ChatSessionController {
  private sessionManager: RemoteSessionManager;
  private callbacks: ChatSessionControllerCallbacks;
  private sessionId: string = '';
  private cursor: ChatSessionCursor = { pollVersion: 0, knownMessageCount: 0, knownModelCatalogVersion: 0 };
  private stream?: DurableSessionStream;
  private reducer: DurableSessionReducer = new DurableSessionReducer();
  private controls: PermissionControlOverlay = new PermissionControlOverlay();
  private generation: number = 0;
  private stopped: boolean = true;
  private caughtUp: boolean = false;
  private sessionState: string = 'idle';
  private completedTurnId: string = '';
  private hasMoreMessages: boolean = false;
  private mailboxRead?: Promise<void>;
  private mailboxVersion: number = 0;

  constructor(sessionManager: RemoteSessionManager, callbacks: ChatSessionControllerCallbacks,
    _options?: ChatSessionControllerOptions) {
    this.sessionManager = sessionManager; this.callbacks = callbacks;
  }
  start(sessionId: string, cursor: ChatSessionCursor, _activeTurn?: ChatMessage): void {
    if (!this.stopped && this.sessionId === sessionId && this.stream && !this.stream.isClosed()) {
      this.stream.wake(); return;
    }
    this.stop(); this.sessionId = sessionId; this.cursor = cursor;
    this.reducer = new DurableSessionReducer(); this.controls = new PermissionControlOverlay(); this.stopped = false; this.caughtUp = false;
    this.sessionState = 'idle'; this.completedTurnId = ''; this.hasMoreMessages = false;
    const epoch = this.generation;
    try {
      this.stream = this.sessionManager.subscribeSession(sessionId, {
        onEvent: async (event: DurableSessionEvent): Promise<void> => {
          if (!this.current(epoch) || event.session_id !== sessionId) return;
          if (event.event === 'session-interaction-changed') { await this.refreshMailbox(sessionId, epoch); return; }
          const controlChanged = this.controls.apply(event);
          if (!this.reducer.apply(event) && !controlChanged) return;
          if (this.caughtUp) this.publish();
        },
        onResumed: async (): Promise<void> => { await this.refreshMailbox(sessionId, epoch); },
        onCaughtUp: async (): Promise<void> => {
          if (!this.current(epoch)) return;
          this.caughtUp = true; this.publish();
        },
        onHistory: (hasMore: boolean): void => { this.hasMoreMessages = hasMore; },
        onError: (error: Error): void => { if (this.current(epoch)) this.callbacks.onError(error); }
      });
    } catch (error) { this.callbacks.onError(error); }
  }
  stop(_clearActiveTurn: boolean = true): void {
    this.generation++; this.stopped = true; this.mailboxRead = undefined; this.stream?.close(); this.stream = undefined;
  }
  loadOlder(): void { this.stream?.loadOlder(); }
  nudge(): void { this.stream?.wake(); }
  updateCursor(cursor: ChatSessionCursor): void { this.cursor = cursor; }
  updateKnownModelCatalogVersion(version: number): void { this.cursor.knownModelCatalogVersion = version; }
  setKnownMessageCount(count: number): void { this.cursor.knownMessageCount = count; }
  clearActiveTurn(): void { /* Runtime message/state events own turn lifetime. */ }
  private refreshMailbox(sessionId: string, epoch: number): Promise<void> {
    this.mailboxVersion++;
    if (this.mailboxRead) return this.mailboxRead;
    const read = this.readMailbox(sessionId, epoch).finally(() => { if (this.mailboxRead === read) this.mailboxRead = undefined; });
    this.mailboxRead = read; return read;
  }
  private async readMailbox(sessionId: string, epoch: number): Promise<void> {
    try {
      while (this.current(epoch)) {
        const version = this.mailboxVersion; const revision = this.controls.revision;
        const args: MailboxArgs = { request: { sessionId: sessionId } };
        const pending = await this.sessionManager.hostInvoke<SessionInteractionMailbox>('get_session_interaction_mailbox', args);
        if (!this.current(epoch)) return;
        if (version !== this.mailboxVersion || revision !== this.controls.revision) continue;
        this.controls.hydrateMailbox(pending);
        if (this.caughtUp) this.publish();
        return;
      }
    } catch (error) { if (this.current(epoch)) this.callbacks.onError(error); }
  }
  private current(epoch: number): boolean { return epoch === this.generation && !this.stopped; }
  async pollNow(): Promise<void> { this.stream?.wake(); }
  private publish(): void {
    if (this.stopped || !this.callbacks.canPoll(this.sessionId)) return;
    const persisted: ChatMessage[] = [];
    let active: ChatMessage | undefined = undefined;
    this.controls.decorate(this.reducer.messages()).forEach((message: ChatMessage) => {
      if (message.role === 'assistant' && (message.status === 'active' || message.status === 'running')) active = message;
      else {
        persisted.push(message);
        if (message.role === 'assistant') this.completedTurnId = message.turnId || '';
      }
    });
    this.cursor.knownMessageCount = persisted.length;
    this.callbacks.onSnapshot({
      sessionId: this.sessionId, cursor: this.cursor, changed: true, title: '',
      sessionState: active ? 'active' : this.sessionState, newMessages: [],
      activeTurn: active, messageSnapshot: persisted, shouldSyncAfterTurnEnded: false,
      historyRewritten: false, completedTurnId: this.completedTurnId, hasMoreMessages: this.hasMoreMessages
    });
  }
}
