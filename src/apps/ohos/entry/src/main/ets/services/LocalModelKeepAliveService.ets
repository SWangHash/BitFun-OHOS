import { common, Want } from '@kit.AbilityKit';
import { rpc } from '@kit.IPCKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * Keeps the on-device model foundation service resident while BitFun runs.
 *
 * The 端侧大模型服务 (an Ollama-compatible HTTP API on localhost:11434 served by
 * com.huawei.hmos.hmmodelfoundation) is a SERVICE-type ability with no UI. The
 * system reclaims it when no client holds a connection, which made BitFun's
 * local model calls depend on the system settings page or another model app
 * being open. Model client apps hold a service-ability connection for exactly
 * this purpose; BitFun connects on startup and reconnects when the service is
 * reclaimed, so the local model APIs are available whenever the app is open.
 */
export class LocalModelKeepAliveService {
  private static readonly MODEL_SERVICE_BUNDLE: string = 'com.huawei.hmos.hmmodelfoundation';
  private static readonly MODEL_SERVICE_ABILITY: string = 'EntryAbility';
  private static readonly RECONNECT_DELAY_MS: number = 5000;

  private context: common.UIAbilityContext | undefined = undefined;
  private connection: number | undefined = undefined;
  private reconnectTimer: number = -1;
  private disposed: boolean = false;

  start(context: common.UIAbilityContext): void {
    this.context = context;
    this.disposed = false;
    // Idempotency guard: repeated start() calls must not leak the previous
    // connection or stack reconnect timers. If already connected, the call
    // is a no-op; if a reconnect timer is pending, cancel it before
    // reconnecting so the timer cannot produce a second connection.
    this.cancelReconnect();
    if (this.connection !== undefined) {
      hilog.info(0, 'LocalModel', 'Model service connection already established');
      return;
    }
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelReconnect();
    this.disconnect();
  }

  private connect(): void {
    const context = this.context;
    if (context === undefined || this.disposed) {
      return;
    }
    const want: Want = {
      bundleName: LocalModelKeepAliveService.MODEL_SERVICE_BUNDLE,
      abilityName: LocalModelKeepAliveService.MODEL_SERVICE_ABILITY,
    };
    // The callback parameter types (ElementName / rpc.IRemoteObject / code)
    // are inferred from common.ConnectOptions; the ElementName type is not
    // importable from any public kit module (SDK internal only), so explicit
    // annotations would reference an unresolvable name (build regression
    // 2026-11-05: "Cannot find name 'ElementName'").
    const options: common.ConnectOptions = {
      onConnect: (_elementName, _remote) => {
        hilog.info(0, 'LocalModel', 'Model service connection established');
      },
      onDisconnect: (_elementName) => {
        hilog.info(0, 'LocalModel', 'Model service connection dropped; reconnecting');
        this.connection = undefined;
        this.scheduleReconnect();
      },
      onFailed: (_code) => {
        hilog.warn(0, 'LocalModel', 'Model service connection failed; retrying');
        this.connection = undefined;
        this.scheduleReconnect();
      },
    };
    try {
      this.connection = context.connectServiceExtensionAbility(want, options);
    } catch (error) {
      hilog.error(0, 'LocalModel', 'Failed to connect model service: %{public}s', String(error));
      this.connection = undefined;
      this.scheduleReconnect();
    }
  }

  private disconnect(): void {
    const context = this.context;
    if (this.connection === undefined || context === undefined) {
      return;
    }
    const connection = this.connection;
    this.connection = undefined;
    try {
      context.disconnectServiceExtensionAbility(connection);
    } catch (error) {
      hilog.warn(0, 'LocalModel', 'Failed to release model service connection: %{public}s', String(error));
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== -1) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      this.connect();
    }, LocalModelKeepAliveService.RECONNECT_DELAY_MS);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === -1) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = -1;
  }
}
