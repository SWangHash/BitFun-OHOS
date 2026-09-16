/** Encrypted durable event framing shared with remote_connect/session_log.rs.
 * Fragment storage belongs to the durable replica, so reconnect/restart never
 * depends on an in-memory partial event. */
export interface SessionFragment {
  v: 1;
  eventId: string;
  index: number;
  count: number;
  data: string;
}
export type SessionDecrypt = (key: Uint8Array, ciphertext: Uint8Array, nonce: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export interface SessionEvent {
  session_id: string;
  event: string;
  payload: unknown;
}

export function parseSessionFragment(content: string): SessionFragment {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object') throw new Error('Invalid session fragment');
  const fragment = value as Partial<SessionFragment>;
  if (fragment.v !== 1 || typeof fragment.eventId !== 'string'
    || typeof fragment.data !== 'string' || !Number.isSafeInteger(fragment.index)
    || !Number.isSafeInteger(fragment.count) || fragment.index! < 0
    || fragment.count! < 1 || fragment.index! >= fragment.count!) {
    throw new Error('Invalid session fragment');
  }
  return fragment as SessionFragment;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

/** Read fragments from persistent storage in order. Allocation follows actual
 * bytes present, never the peer-provided fragment count. */
export async function decryptSessionEvent(
  sessionId: string,
  keyGrant: string,
  fragments: readonly SessionFragment[],
  decrypt?: SessionDecrypt,
): Promise<SessionEvent> {
  if (!fragments.length) throw new Error('Missing session fragments');
  const first = fragments[0];
  if (first.count !== fragments.length) throw new Error('Incomplete session event');
  const parts = fragments.map((fragment, index) => {
    if (fragment.index !== index || fragment.eventId !== first.eventId || fragment.count !== first.count) {
      throw new Error('Session fragment order mismatch');
    }
    return decodeBase64(fragment.data);
  });
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid session ciphertext');
  const ciphertext = envelope as { nonce?: unknown; data?: unknown };
  if (typeof ciphertext.nonce !== 'string' || typeof ciphertext.data !== 'string') {
    throw new Error('Invalid session ciphertext');
  }
  const keyBytes = decodeBase64(keyGrant);
  if (keyBytes.length !== 32) throw new Error('Invalid session key');
  const nonce = decodeBase64(ciphertext.nonce);
  if (nonce.length !== 12) throw new Error('Invalid session nonce');
  const data = decodeBase64(ciphertext.data);
  let plaintext: Uint8Array | ArrayBuffer;
  if (decrypt) plaintext = await decrypt(keyBytes, data, nonce);
  else {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, data);
  }
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as SessionEvent;
  if (event.session_id !== sessionId || typeof event.event !== 'string' || !('payload' in event)) {
    throw new Error('Session encryption binding mismatch');
  }
  return event;
}
