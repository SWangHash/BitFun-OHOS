import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';

interface PayloadDescriptor { id: string; bytes: number; }
interface PayloadReference { $relayPayload?: PayloadDescriptor; }

/** Opaque temporary RPC blocks; never contains a caller-controlled fetch URL. */
export class RpcPayload {
  private readonly endpoint: string;
  private requests: Set<http.HttpRequest> = new Set();
  private closed: boolean = false;
  private token: string;
  constructor(relayUrl: string, token: string) {
    this.token = token;
    this.endpoint = `${relayUrl}/v1/rpc/payloads`;
  }
  close(): void {
    this.closed = true;
    this.requests.forEach((request: http.HttpRequest) => { request.destroy(); });
    this.requests.clear();
  }
  async uploadIfLarge(value: Object): Promise<Object> {
    const text = JSON.stringify(value);
    const size = new util.TextEncoder().encodeInto(text).byteLength;
    if (size <= 128 * 1024) return value;
    if (size > 64 * 1024 * 1024) throw new Error('RPC payload exceeds a transfer block; use chunked operations');
    const reply = await this.request(this.endpoint, text);
    const reference = JSON.parse(reply) as PayloadReference;
    this.validate(reference);
    return reference;
  }
  async resolve(value: Object): Promise<Object> {
    const reference = value as PayloadReference;
    if (!reference.$relayPayload) return value;
    const descriptor = this.validate(reference);
    const text = await this.request(`${this.endpoint}/${descriptor.id}`);
    if (new util.TextEncoder().encodeInto(text).byteLength !== descriptor.bytes) throw new Error('Relay payload length mismatch');
    return JSON.parse(text) as Object;
  }
  private validate(reference: PayloadReference): PayloadDescriptor {
    const value = reference.$relayPayload;
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
      || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > 64 * 1024 * 1024) {
      throw new Error('Invalid Relay payload reference');
    }
    return value;
  }
  private async request(url: string, body?: string): Promise<string> {
    if (this.closed) throw new Error('Relay is closed');
    const request = http.createHttp();
    this.requests.add(request);
    try {
      const options: http.HttpRequestOptions = {
        method: body === undefined ? http.RequestMethod.GET : http.RequestMethod.POST,
        header: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/octet-stream' },
        expectDataType: http.HttpDataType.STRING,
        maxLimit: 64 * 1024 * 1024,
        connectTimeout: 15000, readTimeout: 120000
      };
      if (body !== undefined) options.extraData = body;
      const response = await request.request(url, options);
      if (this.closed) throw new Error('Relay is closed');
      if (response.responseCode !== 200 || typeof response.result !== 'string') throw new Error(`Relay payload transfer failed (${response.responseCode})`);
      return response.result;
    } finally { this.requests.delete(request); request.destroy(); }
  }
}
