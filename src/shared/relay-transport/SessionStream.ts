import { AccountRealtime, SessionSync, type DurableMessage, type MessageReplica } from './AccountRealtime';
import { decryptSessionEvent, parseSessionFragment, type SessionEvent, type SessionFragment, type SessionDecrypt } from './SessionCipher';

/** Controller-only cache. The host log remains authoritative. Cursor and raw
 * encrypted fragments commit together; a killed browser resumes mid-event. */
class BrowserSessionReplica implements MessageReplica {
  constructor(private readonly db: IDBDatabase, private readonly stream: string,
    private readonly sessionId: string, private readonly key: string,
    private readonly emit: (event: SessionEvent) => void, private readonly decrypt?: SessionDecrypt) {}
  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async cursor(): Promise<number> {
    return (await this.request(this.db.transaction('cursors').objectStore('cursors').get(this.stream)) as number | undefined) ?? 0;
  }
  private writing = Promise.resolve();
  apply(messages: readonly DurableMessage[], cursor: number, history?: SessionHistoryState): Promise<void> {
    const operation = this.writing.then(() => this.commit(messages, cursor, history));
    this.writing = operation.catch(() => {});
    return operation;
  }
  async history(): Promise<SessionHistoryState> {
    const state = await this.request(this.db.transaction('cursors').objectStore('cursors').get(this.stream + ':history')) as SessionHistoryState | undefined;
    return state ?? {hasMore:false,oldestSeq:0,cursor:await this.cursor()};
  }
  async setHistory(state: SessionHistoryState): Promise<void> {
    await this.request(this.db.transaction('cursors','readwrite').objectStore('cursors').put(state,this.stream + ':history'));
  }
  private async commit(messages: readonly DurableMessage[], cursor: number, history?: SessionHistoryState): Promise<void> {
    cursor = Math.max(cursor, await this.cursor());
    const incoming = messages.map(message => parseSessionFragment(message.content.c));
    const finished = new Set(incoming.filter(part => part.index === part.count - 1).map(part => part.eventId));
    const events: SessionEvent[] = [];
    for (const eventId of finished) {
      const range = IDBKeyRange.bound([this.stream, eventId, 0], [this.stream, eventId, Number.MAX_SAFE_INTEGER]);
      const stored = await this.request(this.db.transaction('fragments').objectStore('fragments').getAll(range)) as SessionFragment[];
      const parts = new Map(stored.map(part => [part.index, part]));
      for (const part of incoming) if (part.eventId === eventId) parts.set(part.index, part);
      events.push(await decryptSessionEvent(this.sessionId, this.key, [...parts.values()].sort((a,b) => a.index - b.index), this.decrypt));
    }
    // Authentication/decryption and reducer failure must not advance the cursor.
    for (const event of events) this.emit(event);
    const transaction = this.db.transaction(['fragments', 'cursors'], 'readwrite');
    const complete = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
    const fragments = transaction.objectStore('fragments');
    for (const fragment of incoming) fragments.put(fragment, [this.stream, fragment.eventId, fragment.index]);
    transaction.objectStore('cursors').put(cursor, this.stream);
    if(history)transaction.objectStore('cursors').put({...history,cursor},this.stream + ':history');
    await complete;
  }
  async replay(): Promise<void> {
    const range = IDBKeyRange.bound([this.stream, ''], [this.stream, '\uffff']);
    // Walk cache keys rather than materializing the entire transcript at once.
    const keys = await this.request(this.db.transaction('fragments').objectStore('fragments').getAllKeys(range));
    let previous: string | undefined;
    for (const key of keys) {
      const eventId = (key as [string, string, number])[1];
      if (eventId === previous) continue;
      previous = eventId;
      const partRange = IDBKeyRange.bound([this.stream, eventId, 0], [this.stream, eventId, Number.MAX_SAFE_INTEGER]);
      const parts = await this.request(this.db.transaction('fragments').objectStore('fragments').getAll(partRange)) as SessionFragment[];
      if (parts.length && parts.length === parts[0].count) this.emit(await decryptSessionEvent(this.sessionId, this.key, parts, this.decrypt));
    }
  }
}

export interface SessionHistoryState { hasMore: boolean; oldestSeq: number; cursor: number }
export interface SessionStreamHandle { close(): void; wake(): void; loadOlder(): Promise<void> }
export async function openSessionStream(options: {
  connection: AccountRealtime; relay: string; token: string; account: string; machine: string;
  decrypt?: SessionDecrypt; sessionId: string; relaySessionId: string; key: string; onEvent: (event: SessionEvent) => void; onError: (error: unknown) => void; onCaughtUp?: () => void; onHistoryState?: (state: SessionHistoryState) => void; onResumed?: () => void;
}): Promise<SessionStreamHandle> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('openbitfun-relay-session-cache', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('fragments'); request.result.createObjectStore('cursors');
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const stream = JSON.stringify([options.relay, options.account, options.machine, options.sessionId]);
  let active = true;
  const replica = new BrowserSessionReplica(db, stream, options.sessionId, options.key, event => {
    if (active) options.onEvent(event);
  }, options.decrypt);
  const lifetime = new AbortController();
  try { await replica.replay(); } catch (error) { db.close(); throw error; }
  const fetchPage = async (query: string) => {
    const response = await fetch(`${options.relay.replace(/\/$/, '')}/v3/sessions/${encodeURIComponent(options.relaySessionId)}/messages?${query}`, {
      headers: { Authorization: `Bearer ${options.token}` }, signal: lifetime.signal,
    });
    if (!response.ok) throw new Error(`Session catch-up failed (${response.status})`);
    return await response.json() as {messages:DurableMessage[];hasMore:boolean};
  };
  let history = await replica.history();
  let older: Promise<void> | null = null;
  const fetchBefore = async (before: number) => {
    const messages:DurableMessage[]=[];
    let hasMore=true;
    do {
      const page=await fetchPage(`before_seq=${before}&limit=100`);
      const sorted=[...page.messages].sort((a,b)=>a.seq-b.seq);
      if(!sorted.length){hasMore=false;break;}
      if(sorted.some((message,index)=>message.content.t!=='encrypted'||(index>0&&message.seq!==sorted[index-1].seq+1)))throw new Error('History sequence gap');
      if(messages.length&&sorted.slice(-1)[0]!.seq!==before-1)throw new Error('History page gap');
      if(sorted.slice(-1)[0]!.seq>=before)throw new Error('History pagination did not advance');
      messages.unshift(...sorted);before=sorted[0].seq;hasMore=page.hasMore;
      if(parseSessionFragment(messages[0].content.c).index===0)break;
      if(!hasMore)throw new Error('History starts within an incomplete event');
    }while(hasMore);
    const cursor=Math.max(await replica.cursor(),messages.slice(-1)[0]?.seq??0);
    history={hasMore,oldestSeq:messages[0]?.seq??history.oldestSeq,cursor};
    await replica.apply(messages,cursor,history);
    if(active)options.onHistoryState?.(history);
  };
  try {
    if(await replica.cursor()===0)await fetchBefore(Number.MAX_SAFE_INTEGER);
    else options.onHistoryState?.(history);
  }catch(error){lifetime.abort();db.close();throw error;}
  const sync = new SessionSync(options.connection, options.relaySessionId, replica,
    cursor => fetchPage(`after_seq=${cursor}`), options.onError,
    () => { if(active)options.onCaughtUp?.(); });
  const resumed=()=>{if(active)options.onResumed?.();};
  const stopResume=options.connection.onReconnect(resumed);
  const resume=()=>{if(document.visibilityState==='visible'){sync.invalidate();resumed();}};
  resumed();
  document.addEventListener('visibilitychange',resume);
  const loadOlder = () => {
    if (!active || !history.hasMore) return Promise.resolve();
    if (!older) older = fetchBefore(history.oldestSeq).finally(() => { older = null; });
    return older;
  };
  // Happy starts an exclusive older-page prefetch after the latest page is visible.
  // The same flight serves user scroll requests; disposal aborts both paths.
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  const prefetch = () => {
    if (!active || !history.hasMore) return;
    prefetchTimer = setTimeout(() => {
      void loadOlder().then(prefetch, error => { if (active) options.onError(error); });
    }, 250);
  };
  prefetch();
  return {
    close(){active=false;if(prefetchTimer)clearTimeout(prefetchTimer);stopResume();document.removeEventListener('visibilitychange',resume);sync.close();lifetime.abort();db.close();},
    wake(){if(active)sync.invalidate();},
    loadOlder,
  };
}
