import { createLogger } from '@/shared/utils/logger';
import { elapsedMs, nowMs, roundDurationMs } from '@/shared/utils/timing';
import { AppearanceCompiler } from '../compiler/AppearanceCompiler';
import type { AppearanceRegistry } from '../registry/AppearanceRegistry';
import type {
  AppearancePackage,
  AppearanceRendererId,
  AppearanceRendererContext,
  RegisteredAppearanceRendererAdapter,
  ResolvedAppearance,
  ResolvedAppearanceAsset,
  StoredAppearanceAsset,
} from '../types';

const log = createLogger('AppearanceRuntime');
const STYLE_ATTRIBUTE = 'data-bitfun-appearance-runtime';

interface PreparedRendererTransaction {
  id: AppearanceRendererId;
  commit(): void | Promise<void>;
  rollback(): void | Promise<void>;
}

interface AssetGeneration {
  urls: Map<string, string>;
  references: number;
  retired: boolean;
}

export class AppearanceRuntime {
  private readonly compiler: AppearanceCompiler;
  private snapshot: ResolvedAppearance | null = null;
  private revision = 0;
  private listeners = new Set<() => void>();
  private applyQueue: Promise<ResolvedAppearance | null> = Promise.resolve(null);
  private readonly assetGenerations = new Map<number, AssetGeneration>();
  private activeAssetRevision: number | null = null;

  constructor(private readonly registry: AppearanceRegistry) {
    this.compiler = new AppearanceCompiler(registry);
  }

  initialize(
    pkg: AppearancePackage,
    assets: Readonly<Record<string, StoredAppearanceAsset>> = {},
  ): Promise<ResolvedAppearance> {
    if (this.snapshot) return Promise.resolve(this.snapshot);
    return this.applyPackage(pkg, assets);
  }

  applyPackage(
    pkg: AppearancePackage,
    assets: Readonly<Record<string, StoredAppearanceAsset>> = {},
  ): Promise<ResolvedAppearance> {
    const run = () => this.compileAndApply(pkg, assets);
    const result = this.applyQueue.then(run, run);
    this.applyQueue = result;
    return result;
  }

  preflight(
    pkg: AppearancePackage,
    assets: Readonly<Record<string, StoredAppearanceAsset>> = {},
  ): ResolvedAppearance {
    const compiled = this.compiler.compile(pkg, this.revision + 1);
    Object.entries(compiled.assets).forEach(([id, resolved]) => {
      const stored = assets[id];
      if (!stored) throw new Error(`Appearance asset bytes are missing: ${id}`);
      if (stored.mimeType !== resolved.definition.mimeType) {
        throw new Error(`Appearance asset MIME does not match the manifest: ${id}`);
      }
    });
    return compiled;
  }

  getSnapshot = (): ResolvedAppearance | null => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  retainAssetRevision = (revision: number): (() => void) => {
    const generation = this.assetGenerations.get(revision);
    if (!generation) return () => undefined;
    generation.references += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      generation.references = Math.max(0, generation.references - 1);
      this.collectAssetGeneration(revision);
    };
  };

  async dispose(): Promise<void> {
    const previous = this.snapshot;
    if (previous) {
      const context: AppearanceRendererContext = {
        revision: previous.revision + 1,
        appearanceId: previous.id,
        mode: previous.mode,
        globals: previous.globals,
        assets: {},
      };
      for (const adapter of this.registry.getRendererAdapters()) {
        try {
          await this.applyRenderer(adapter, undefined, previous.renderers, context);
        } catch (error) {
          log.warn('Renderer adapter cleanup failed', { rendererId: adapter.id, error });
        }
      }
    }
    document.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`).forEach(node => node.remove());
    this.assetGenerations.forEach(generation => this.revokeAssetUrls(generation.urls));
    this.assetGenerations.clear();
    this.activeAssetRevision = null;
    const root = document.documentElement;
    root.removeAttribute('data-bitfun-appearance');
    root.removeAttribute('data-bitfun-appearance-mode');
    root.removeAttribute('data-bitfun-appearance-revision');
    root.removeAttribute('data-bitfun-appearance-root');
    this.snapshot = null;
    this.emit();
  }

  private async compileAndApply(
    pkg: AppearancePackage,
    storedAssets: Readonly<Record<string, StoredAppearanceAsset>>,
  ): Promise<ResolvedAppearance> {
    const startedAt = nowMs();
    const nextRevision = this.revision + 1;
    const compiled = this.preflight(pkg, storedAssets);
    const preparedAssets = this.prepareAssets(compiled, storedAssets);
    const next: ResolvedAppearance = Object.freeze({
      ...compiled,
      assets: Object.freeze(preparedAssets.assets),
      backgroundMedia: compiled.backgroundMedia ? Object.freeze({
        ...compiled.backgroundMedia,
        url: preparedAssets.assets[compiled.backgroundMedia.assetId]?.url,
        posterUrl: preparedAssets.assets[compiled.backgroundMedia.posterAssetId]?.url,
      }) : undefined,
      cssText: `${compiled.cssText}${preparedAssets.cssText ? `\n${preparedAssets.cssText}` : ''}`,
    });
    const compiledAt = nowMs();
    const previous = this.snapshot;
    const nextStyle = document.createElement('style');
    nextStyle.setAttribute(STYLE_ATTRIBUTE, String(nextRevision));
    nextStyle.textContent = next.cssText;
    document.head.appendChild(nextStyle);

    const context: AppearanceRendererContext = {
      revision: next.revision,
      appearanceId: next.id,
      mode: next.mode,
      globals: next.globals,
      assets: next.assets,
    };
    const rendererTransactions = this.prepareRendererTransactions(next, previous, context);
    const startedTransactions: PreparedRendererTransaction[] = [];
    // A theme switch is one paint surface wide: every phase below runs before the
    // browser can produce a frame, so a slow renderer adapter delays the colors
    // the user sees exactly as much as a slow compile does. Keep the split.
    const rendererTimings: Record<string, number> = {};
    try {
      for (const transaction of rendererTransactions) {
        startedTransactions.push(transaction);
        const rendererStartedAt = nowMs();
        await transaction.commit();
        rendererTimings[transaction.id] = elapsedMs(rendererStartedAt);
      }
    } catch (error) {
      nextStyle.remove();
      this.revokeAssetUrls(preparedAssets.urls);
      await this.rollbackRendererTransactions(startedTransactions);
      log.error('Appearance transaction failed', { appearanceId: next.id, revision: next.revision, error });
      throw error;
    }
    const renderersAt = nowMs();

    const root = document.documentElement;
    root.setAttribute('data-bitfun-appearance-root', 'true');
    root.setAttribute('data-bitfun-appearance', next.id);
    root.setAttribute('data-bitfun-appearance-mode', next.mode);
    // Revision is the activation switch because every generated selector is revision-scoped.
    root.setAttribute('data-bitfun-appearance-revision', String(next.revision));
    document.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`).forEach(node => {
      if (node !== nextStyle) node.remove();
    });
    const previousAssetRevision = this.activeAssetRevision;
    this.assetGenerations.set(nextRevision, {
      urls: preparedAssets.urls,
      references: 0,
      retired: false,
    });
    this.activeAssetRevision = nextRevision;
    if (previousAssetRevision !== null) {
      const previousGeneration = this.assetGenerations.get(previousAssetRevision);
      if (previousGeneration) previousGeneration.retired = true;
    }

    this.revision = nextRevision;
    this.snapshot = next;
    this.emit();
    if (previousAssetRevision !== null) this.collectAssetGeneration(previousAssetRevision);
    const commitMs = roundDurationMs(nowMs() - startedAt);
    const commitTiming = {
      appearanceId: next.id,
      revision: next.revision,
      mode: next.mode,
      compileMs: roundDurationMs(compiledAt - startedAt),
      renderersMs: roundDurationMs(renderersAt - compiledAt),
      renderers: rendererTimings,
      commitMs,
    };
    if (next.diagnostics.length > 0) {
      log.warn('Appearance applied with diagnostics', {
        ...commitTiming,
        diagnosticCount: next.diagnostics.length,
      });
    } else {
      log.info('Appearance applied', commitTiming);
    }
    this.reportFirstFrame(next, startedAt);
    return next;
  }

  /**
   * Log when the frame carrying the new appearance is actually produced. The
   * commit above only queues style work; on a webview that repaints the whole
   * document (HarmonyOS ArkWeb) the gap between "applied" and "painted" is the
   * delay the user sees, so it has to be measured rather than inferred.
   */
  private reportFirstFrame(appearance: ResolvedAppearance, startedAt: number): void {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        log.info('Appearance painted', {
          appearanceId: appearance.id,
          revision: appearance.revision,
          totalMs: elapsedMs(startedAt),
        });
      });
    });
  }

  private prepareRendererTransactions(
    next: ResolvedAppearance,
    previous: ResolvedAppearance | null,
    context: AppearanceRendererContext,
  ): PreparedRendererTransaction[] {
    const previousContext: AppearanceRendererContext = {
      revision: previous?.revision ?? 0,
      appearanceId: previous?.id ?? next.id,
      mode: previous?.mode ?? next.mode,
      globals: previous?.globals ?? next.globals,
      assets: previous?.assets ?? {},
    };
    return this.registry.getRendererAdapters().map(adapter => ({
      id: adapter.id,
      commit: () => this.applyRenderer(adapter, next.renderers, previous?.renderers, context),
      rollback: () => this.applyRenderer(adapter, previous?.renderers, next.renderers, previousContext),
    }));
  }

  private async rollbackRendererTransactions(
    transactions: readonly PreparedRendererTransaction[],
  ): Promise<void> {
    for (const transaction of [...transactions].reverse()) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        log.error('Renderer adapter rollback failed', { rendererId: transaction.id, rollbackError });
      }
    }
  }

  private applyRenderer(
    adapter: RegisteredAppearanceRendererAdapter,
    next: ResolvedAppearance['renderers'] | undefined,
    previous: ResolvedAppearance['renderers'] | undefined,
    context: AppearanceRendererContext,
  ): void | Promise<void> {
    switch (adapter.id) {
      case 'theme-tokens':
        return adapter.apply(next?.['theme-tokens'], previous?.['theme-tokens'], context);
      case 'monaco':
        return adapter.apply(next?.monaco, previous?.monaco, context);
      case 'xterm':
        return adapter.apply(next?.xterm, previous?.xterm, context);
      case 'mermaid':
        return adapter.apply(next?.mermaid, previous?.mermaid, context);
      case 'generative-widget':
        return adapter.apply(next?.['generative-widget'], previous?.['generative-widget'], context);
      case 'bitfun-canvas':
        return adapter.apply(next?.['bitfun-canvas'], previous?.['bitfun-canvas'], context);
    }
  }

  private prepareAssets(
    appearance: ResolvedAppearance,
    storedAssets: Readonly<Record<string, StoredAppearanceAsset>>,
  ): {
    assets: Record<string, ResolvedAppearanceAsset>;
    cssText: string;
    urls: Map<string, string>;
  } {
    const assets: Record<string, ResolvedAppearanceAsset> = {};
    const urls = new Map<string, string>();
    try {
      Object.entries(appearance.assets).forEach(([id, resolved]) => {
        const stored = storedAssets[id];
        if (!stored) throw new Error(`Appearance asset bytes are missing: ${id}`);
        const url = URL.createObjectURL(new Blob([stored.bytes], { type: stored.mimeType }));
        urls.set(id, url);
        assets[id] = Object.freeze({
          ...resolved,
          url,
          width: stored.width,
          height: stored.height,
          durationSeconds: stored.durationSeconds,
        });
      });
    } catch (error) {
      this.revokeAssetUrls(urls);
      throw error;
    }
    return {
      assets,
      cssText: this.compileAssetDeclarations(appearance.id, appearance.revision, assets),
      urls,
    };
  }

  private compileAssetDeclarations(
    appearanceId: string,
    revision: number,
    assets: Readonly<Record<string, ResolvedAppearanceAsset>>,
  ): string {
    const declarations = document.createElement('div').style;
    Object.entries(assets).forEach(([id, asset]) => {
      if (asset.definition.kind !== 'image' || !asset.url) return;
      declarations.setProperty(`--bitfun-appearance-asset-${id.replace(/\./g, '-')}`, `url("${asset.url}")`);
    });
    if (!declarations.cssText) return '';
    return `:root[data-bitfun-appearance="${appearanceId}"][data-bitfun-appearance-revision="${revision}"]{${declarations.cssText}}`;
  }

  private revokeAssetUrls(urls: ReadonlyMap<string, string>): void {
    urls.forEach(url => URL.revokeObjectURL(url));
  }

  private collectAssetGeneration(revision: number): void {
    const generation = this.assetGenerations.get(revision);
    if (!generation || !generation.retired || generation.references > 0) return;
    this.revokeAssetUrls(generation.urls);
    this.assetGenerations.delete(revision);
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}
