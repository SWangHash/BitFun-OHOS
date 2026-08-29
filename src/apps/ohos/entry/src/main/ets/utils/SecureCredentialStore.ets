import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { asset } from '@kit.AssetStoreKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const ASSET_NOT_FOUND = 24000002;
const ASSET_ALREADY_EXISTS = 24000003;
const LOG_DOMAIN = 0x0000;
const LOG_TAG = 'SecureCredentialStore';

class SecureCredentialOperationError extends Error {
  readonly code: number;

  constructor(code: number) {
    super('AssetStore operation failed');
    this.code = code;
  }
}

interface CredentialRequest {
  action: string;
  alias: string;
  value?: string;
}

interface CredentialResponse {
  status: string;
  value?: string;
  code?: string;
}

/**
 * Unified key->bytes secure credential store backed by the OHOS
 * AssetStoreKit. Each alias maps to one asset; secrets are base64-encoded
 * on the Rust side so the JSON wire envelope stays UTF-8 even when the
 * secret material is binary.
 *
 * Shared by subscription auth (per-chunk aliases under
 * `<provider>/v2/<set_id>/<field>/<index>`), the MiniApp and appearance
 * market (`github-oauth`), and feedback service credentials
 * (`bitfun.feedback.*`). Alias formats are consumer-specific and do not
 * collide inside the single AssetStoreKit namespace.
 */
export class SecureCredentialStore {
  private readonly encoder = new util.TextEncoder();
  private readonly decoder = util.TextDecoder.create('utf-8');

  async handle(input: string): Promise<string> {
    let action = 'parse';
    let alias = '';
    try {
      const request: CredentialRequest = JSON.parse(input);
      action = request.action;
      alias = request.alias;
      if (request.action === 'load') {
        return JSON.stringify(await this.load(request.alias));
      }
      if (request.action === 'store' && request.value !== undefined) {
        await this.store(request.alias, request.value);
        return JSON.stringify({ status: 'ok' } as CredentialResponse);
      }
      if (request.action === 'delete') {
        return JSON.stringify(await this.delete(request.alias));
      }
      return JSON.stringify({ status: 'error', code: 'REQUEST_INVALID' } as CredentialResponse);
    } catch (error) {
      const businessError = error as BusinessError;
      const code = businessError.code === undefined ? 'INTERNAL_ERROR' : String(businessError.code);
      hilog.error(
        LOG_DOMAIN,
        LOG_TAG,
        'Secure credential operation failed: action=%{public}s alias=%{public}s code=%{public}s',
        action,
        alias,
        code
      );
      return JSON.stringify({ status: 'error', code } as CredentialResponse);
    }
  }

  private async load(alias: string): Promise<CredentialResponse> {
    const aliasBytes = this.encoder.encodeInto(alias);
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, aliasBytes);
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const results = await asset.query(query);
      if (results.length === 0) {
        return { status: 'not_found' };
      }
      const secret = results[0].get(asset.Tag.SECRET) as Uint8Array;
      if (secret === undefined) {
        return { status: 'error', code: 'SECRET_MISSING' };
      }
      return { status: 'ok', value: this.decoder.decodeToString(secret) };
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code === ASSET_NOT_FOUND) {
        return { status: 'not_found' };
      }
      throw new SecureCredentialOperationError(businessError.code ?? -1);
    }
  }

  private async store(alias: string, value: string): Promise<void> {
    const aliasBytes = this.encoder.encodeInto(alias);
    const secretBytes = this.encoder.encodeInto(value);

    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, aliasBytes);
    const update: asset.AssetMap = new Map();
    update.set(asset.Tag.SECRET, secretBytes);
    try {
      await asset.update(query, update);
      return;
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code !== ASSET_NOT_FOUND) {
        throw new SecureCredentialOperationError(businessError.code ?? -1);
      }
    }

    // Entry did not exist; create it. `DEVICE_FIRST_UNLOCKED` keeps the
    // asset readable after the device has been unlocked at least once,
    // matching the lifecycle of the existing market and feedback stores.
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, aliasBytes);
    attributes.set(asset.Tag.SECRET, secretBytes);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.AUTH_TYPE, asset.AuthType.NONE);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    try {
      await asset.add(attributes);
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code !== ASSET_ALREADY_EXISTS) {
        throw new SecureCredentialOperationError(businessError.code ?? -1);
      }
      await asset.update(query, update);
    }
  }

  private async delete(alias: string): Promise<CredentialResponse> {
    const aliasBytes = this.encoder.encodeInto(alias);
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, aliasBytes);
    try {
      await asset.remove(query);
      return { status: 'ok' };
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code === ASSET_NOT_FOUND) {
        return { status: 'not_found' };
      }
      throw new SecureCredentialOperationError(businessError.code ?? -1);
    }
  }
}
